import type { QueryClient } from "@tanstack/react-query";
import type {
  OpenCodeProfile,
  OpenCodeRuntimeStatus,
  PalotProject,
  PalotSession,
  SessionTriageCommand,
  SessionTriageSnapshot,
} from "../../shared";
import { openCodeClient, registerOpenCodeRuntime } from "../services/opencode-client";
import { mapProject, mapSession } from "../services/opencode-mappers";
import { palot } from "../services/palot";
import { openCodeReconciler, type OpenCodeAppliedBatch } from "./open-code-reconciler";
import { openCodeKeys } from "./opencode-query";
import {
  projectsQueryOptions,
  cacheSessions,
  rootSessionsQueryOptions,
  seedSessionDetails,
  removeSession,
  type RootSessionCatalogData,
} from "./session-catalog-query";
import { sessionActivityQueryOptions } from "./session-activity-query";
import {
  projectSessionInbox,
  sameInboxSessionView,
  type SessionInboxSnapshot,
} from "./session-inbox";
import {
  EMPTY_SESSION_REQUEST_SNAPSHOT,
  mergeAttentionRequests,
  setSessionRequestSnapshot,
} from "./session-request-query";

const ATTENTION_MIN_INTERVAL_MS = 1_000;
const RETAINED_LOOKUP_CONCURRENCY = 4;
const MISSING_SESSION_RETRY_MS = 30_000;

export type OverviewTriageCommand = SessionTriageCommand extends infer Command
  ? Command extends { profileID: string }
    ? Omit<Command, "profileID">
    : never
  : never;

export interface ConnectionOverview {
  profile: OpenCodeProfile;
  runtime: OpenCodeRuntimeStatus | null;
  phase: "idle" | "loading" | "ready" | "error";
  error: string | null;
  lastSyncedAt: number | null;
  projects: PalotProject[];
  sessions: PalotSession[];
  inbox: SessionInboxSnapshot;
  hasMore: boolean;
  loadingMore: boolean;
  triageReady: boolean;
  attentionState: "syncing" | "ready" | "error";
}

const emptyInbox = (): SessionInboxSnapshot => ({
  pinned: [],
  inbox: [],
  snoozed: [],
  settled: [],
  nextSnoozeDeadline: null,
});

function reuseRows<T extends { id: string }>(
  previous: T[],
  incoming: T[],
  summary: (row: T) => unknown = (row) => row,
): T[] {
  const old = new Map(previous.map((row) => [row.id, row]));
  const next = incoming.map((row) => {
    const prior = old.get(row.id);
    return prior && JSON.stringify(summary(prior)) === JSON.stringify(summary(row)) ? prior : row;
  });
  return next.length === previous.length && next.every((row, index) => row === previous[index])
    ? previous
    : next;
}

function sessionSummary({ tokens: _tokens, cost: _cost, ...session }: PalotSession) {
  return session;
}

function reuseSessionRows(previous: PalotSession[], incoming: PalotSession[]) {
  const old = new Map(previous.map((row) => [row.id, row]));
  return reuseRows(
    previous,
    incoming.map((row) => {
      const prior = old.get(row.id);
      if (
        !prior ||
        (prior.cost === row.cost && JSON.stringify(prior.tokens) === JSON.stringify(row.tokens))
      )
        return row;
      // Usage events advance the server's updated timestamp too; they are not new inbox activity.
      return JSON.stringify(sessionSummary({ ...row, updatedAt: prior.updatedAt })) ===
        JSON.stringify(sessionSummary(prior))
        ? prior
        : row;
    }),
    sessionSummary,
  );
}

function reuseInbox(
  previous: SessionInboxSnapshot,
  incoming: SessionInboxSnapshot,
): SessionInboxSnapshot {
  for (const section of ["pinned", "inbox", "snoozed", "settled"] as const) {
    const old = new Map(previous[section].map((row) => [row.session.id, row]));
    incoming[section] = incoming[section].map((row) => {
      const prior = old.get(row.session.id);
      return prior && sameInboxSessionView(prior, row) ? prior : row;
    });
    if (
      incoming[section].length === previous[section].length &&
      incoming[section].every((row, index) => row === previous[section][index])
    )
      incoming[section] = previous[section];
  }
  return incoming.nextSnoozeDeadline === previous.nextSnoozeDeadline &&
    incoming.pinned === previous.pinned &&
    incoming.inbox === previous.inbox &&
    incoming.snoozed === previous.snoozed &&
    incoming.settled === previous.settled
    ? previous
    : incoming;
}

/** One summary index per renderer; no transcript, VCS, or terminal hydration. */
export class ConnectionOverviewController {
  private snapshot: ConnectionOverview[] = [];
  private readonly listeners = new Set<() => void>();
  private readonly triage = new Map<string, SessionTriageSnapshot>();
  private readonly pending = new Map<string, Promise<void>>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly refreshRequested = new Set<string>();
  private readonly epochs = new Map<string, number>();
  private readonly triageRevisions = new Map<string, number>();
  private readonly mutations = new Map<string, Promise<void>>();
  private readonly attentionPending = new Map<string, Promise<void>>();
  private readonly attentionRequested = new Set<string>();
  private readonly attentionRetryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly attentionRetryDelays = new Map<string, number>();
  private readonly attentionNextAttempt = new Map<string, number>();
  private readonly missingSessions = new Map<string, Map<string, number>>();
  private readonly retainedLookups = new Map<string, AbortController>();
  private included = new Set<string>();
  private includedInitialized = false;
  private unsubscribe: (() => void) | null = null;
  private searchGeneration = 0;
  private generation = 0;
  private registryPending: Promise<void> | null = null;

  constructor(private readonly queryClient: QueryClient) {}

  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  start() {
    this.unsubscribe ??= openCodeReconciler(this.queryClient).subscribe(this.onBatch);
    void this.refreshRegistry().catch(() => undefined);
    return () => {
      this.generation++;
      this.unsubscribe?.();
      this.unsubscribe = null;
      for (const timer of this.timers.values()) clearTimeout(timer);
      this.timers.clear();
      this.refreshRequested.clear();
      this.pending.clear();
      for (const timer of this.attentionRetryTimers.values()) clearTimeout(timer);
      this.attentionRetryTimers.clear();
      this.attentionRetryDelays.clear();
      this.attentionNextAttempt.clear();
      for (const controller of this.retainedLookups.values()) controller.abort();
      this.retainedLookups.clear();
      this.missingSessions.clear();
      this.attentionPending.clear();
      this.attentionRequested.clear();
      this.registryPending = null;
    };
  }

  setIncluded(ids: string[]) {
    this.includedInitialized = true;
    const monitored = new Set([
      ...this.included,
      ...this.snapshot.filter((entry) => entry.runtime?.connected).map((entry) => entry.profile.id),
    ]);
    for (const id of monitored) {
      if (ids.includes(id)) continue;
      this.invalidate(id);
      const entry = this.entry(id);
      if (entry?.runtime) {
        this.update(id, {
          runtime: { ...entry.runtime, connected: false, phase: "stopped" },
          phase: "idle",
          loadingMore: false,
        });
      }
      void window.palot?.disconnectOpenCodeProfile(id).catch(() => undefined);
    }
    this.included = new Set(ids);
    for (const id of ids) {
      const entry = this.entry(id);
      if (entry && entry.phase === "idle") void this.connect(id).catch(() => undefined);
    }
  }

  async refreshRegistry() {
    if (palot.isPreview() || !window.palot?.listOpenCodeRuntimes) return;
    if (this.registryPending) return this.registryPending;
    const generation = this.generation;
    const work = async () => {
      const [profiles, runtimes] = await Promise.all([
        palot.listOpenCodeProfiles(),
        window.palot.listOpenCodeRuntimes(),
      ]);
      if (generation !== this.generation) return;
      const previous = new Map(this.snapshot.map((entry) => [entry.profile.id, entry]));
      this.snapshot = profiles.profiles.map((profile) => {
        const old = previous.get(profile.id);
        const listedRuntime = runtimes.find((item) => item.profileID === profile.id);
        const retained =
          !listedRuntime && old?.runtime && !this.included.has(profile.id)
            ? { ...old.runtime, connected: false, phase: "stopped" as const }
            : null;
        const runtime = listedRuntime ?? retained ?? null;
        if (runtime) registerOpenCodeRuntime(runtime);
        if (old && old.runtime?.connectionID === runtime?.connectionID)
          return { ...old, profile, runtime };
        this.invalidate(profile.id);
        this.triage.delete(profile.id);
        if (old?.runtime)
          openCodeReconciler(this.queryClient).resetConnection(old.runtime.connectionID);
        return {
          profile,
          runtime,
          phase: "idle",
          error: null,
          lastSyncedAt: null,
          projects: [],
          sessions: [],
          inbox: emptyInbox(),
          hasMore: false,
          loadingMore: false,
          triageReady: false,
          attentionState: "syncing",
        } satisfies ConnectionOverview;
      });
      for (const [id, entry] of previous) {
        if (profiles.profiles.some((profile) => profile.id === id)) continue;
        this.invalidate(id);
        this.triage.delete(id);
        if (entry.runtime) {
          openCodeReconciler(this.queryClient).resetConnection(entry.runtime.connectionID);
          void this.queryClient.cancelQueries({
            queryKey: openCodeKeys.all(entry.runtime.connectionID),
          });
          this.queryClient.removeQueries({
            queryKey: openCodeKeys.all(entry.runtime.connectionID),
          });
        }
      }
      this.emit();
      if (this.includedInitialized) this.setIncluded([...this.included]);
      for (const entry of this.snapshot) {
        if (entry.phase === "idle" && this.included.has(entry.profile.id)) {
          void this.connect(entry.profile.id).catch(() => undefined);
        }
      }
    };
    const promise = work().finally(() => {
      if (this.registryPending === promise) this.registryPending = null;
    });
    this.registryPending = promise;
    return promise;
  }

  connect = async (profileID: string, forceAttention = false) => {
    if (!this.entry(profileID)) return;
    const previous = this.pending.get(profileID);
    if (previous) return previous;
    const generation = this.generation;
    const epoch = this.epoch(profileID);
    const work = async () => {
      this.update(profileID, { phase: "loading", error: null, attentionState: "syncing" });
      try {
        const runtime = await window.palot.connectOpenCodeProfile(profileID);
        if (!this.valid(profileID, generation, epoch)) return;
        registerOpenCodeRuntime(runtime);
        this.update(profileID, { runtime });
        if (!runtime.connected) throw new Error(runtime.error ?? "Connection unavailable");
        await this.hydrate(profileID, runtime, generation, epoch, forceAttention);
      } catch (error) {
        if (this.valid(profileID, generation, epoch))
          this.update(profileID, {
            phase: "error",
            error: error instanceof Error ? error.message : "Connection unavailable",
          });
        throw error;
      }
    };
    const promise = work().finally(() => {
      if (this.pending.get(profileID) !== promise) return;
      this.pending.delete(profileID);
      if (this.refreshRequested.has(profileID)) this.schedule(profileID, true);
    });
    this.pending.set(profileID, promise);
    return promise;
  };

  refresh = async (profileID?: string, automatic = false) => {
    if (profileID) {
      const generation = this.generation;
      const epoch = this.epoch(profileID);
      const entry = this.entry(profileID);
      if (entry?.runtime)
        await this.queryClient.invalidateQueries({
          queryKey: openCodeKeys.all(entry.runtime.connectionID),
          refetchType: "none",
        });
      if (!this.valid(profileID, generation, epoch)) return;
      return this.connect(profileID, !automatic);
    }
    await this.refreshRegistry();
    await Promise.allSettled([...this.included].map((id) => this.refresh(id)));
  };

  private async hydrate(
    profileID: string,
    runtime: OpenCodeRuntimeStatus,
    generation: number,
    epoch: number,
    forceAttention: boolean,
  ) {
    const id = runtime.connectionID;
    const updateSummaries = () => {
      if (this.current(profileID, id, generation, epoch)) this.project(profileID);
    };
    const supplemental = Promise.allSettled([
      this.queryClient.fetchQuery(projectsQueryOptions(this.queryClient, id)).then(updateSummaries),
      this.queryClient
        .fetchQuery(sessionActivityQueryOptions(this.queryClient, id))
        .then(updateSummaries),
      this.loadTriage(profileID, generation, epoch).then(updateSummaries),
    ]);
    await this.queryClient.fetchInfiniteQuery(rootSessionsQueryOptions(this.queryClient, id));
    if (!this.current(profileID, id, generation, epoch)) return;
    this.update(profileID, { phase: "ready" });
    this.project(profileID);
    const attention = this.hydrateAttention(profileID, runtime, generation, epoch, forceAttention);
    await supplemental;
    if (!this.current(profileID, id, generation, epoch)) return;
    const reconciler = openCodeReconciler(this.queryClient);
    const known = new Set(reconciler.sessions(id).map((session) => session.id));
    const retained =
      this.triage
        .get(profileID)
        ?.sessions.filter(
          (record) =>
            record.pinnedAt !== null ||
            record.snoozedUntil !== null ||
            record.disposition === "inbox",
        ) ?? [];
    const missing = this.missingSessions.get(profileID) ?? new Map<string, number>();
    this.missingSessions.set(profileID, missing);
    const retainedIDs = new Set(retained.map((record) => record.sessionID));
    for (const [sessionID, deadline] of missing)
      if (deadline <= Date.now() || !retainedIDs.has(sessionID) || known.has(sessionID))
        missing.delete(sessionID);
    const queue = retained.filter(
      (record) => !known.has(record.sessionID) && !missing.has(record.sessionID),
    );
    const controller = new AbortController();
    this.retainedLookups.set(profileID, controller);
    let cursor = 0;
    try {
      await Promise.all(
        Array.from({ length: Math.min(RETAINED_LOOKUP_CONCURRENCY, queue.length) }, async () => {
          while (
            cursor < queue.length &&
            this.current(profileID, id, generation, epoch) &&
            !controller.signal.aborted
          ) {
            const record = queue[cursor++]!;
            try {
              const session = await openCodeClient(id).session.get(
                { sessionID: record.sessionID },
                {
                  signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]),
                },
              );
              if (this.current(profileID, id, generation, epoch))
                seedSessionDetails(this.queryClient, id, [session]);
            } catch {
              if (this.current(profileID, id, generation, epoch) && !controller.signal.aborted)
                missing.set(record.sessionID, Date.now() + MISSING_SESSION_RETRY_MS);
            }
          }
        }),
      );
    } finally {
      if (this.retainedLookups.get(profileID) === controller)
        this.retainedLookups.delete(profileID);
    }
    if (!this.current(profileID, id, generation, epoch)) return;
    this.project(profileID);
    await attention;
  }

  private hydrateAttention(
    profileID: string,
    runtime: OpenCodeRuntimeStatus,
    generation: number,
    epoch: number,
    force = false,
  ): Promise<void> {
    const pending = this.attentionPending.get(profileID);
    if (pending) return pending;
    const delay = (this.attentionNextAttempt.get(profileID) ?? 0) - Date.now();
    if (!force && delay > 0) {
      this.attentionRequested.add(profileID);
      this.deferAttention(profileID, runtime, generation, epoch, delay);
      return Promise.resolve();
    }
    this.attentionRequested.delete(profileID);
    this.attentionNextAttempt.set(
      profileID,
      Math.max(
        this.attentionNextAttempt.get(profileID) ?? 0,
        Date.now() + ATTENTION_MIN_INTERVAL_MS,
      ),
    );
    const id = runtime.connectionID;
    const work = async () => {
      const reconciler = openCodeReconciler(this.queryClient);
      const token = reconciler.beginSnapshot(id);
      const sessions = reconciler.sessions(id).map(mapSession);
      try {
        const attention = await palot.loadAttentionSnapshot(sessions, id);
        if (!this.current(profileID, id, generation, epoch)) return;
        cacheSessions(this.queryClient, id, attention.sessions);
        const requests = new Map(attention.requests.map((item) => [item.sessionID, item.value]));
        for (const session of [...sessions, ...attention.sessions]) {
          const previous = reconciler.requests(id, session.id);
          const next = requests.get(session.id);
          if (!next && !attention.complete) continue;
          setSessionRequestSnapshot(
            this.queryClient,
            id,
            session.id,
            mergeAttentionRequests(
              previous,
              next ?? EMPTY_SESSION_REQUEST_SNAPSHOT,
              attention.complete,
            ),
            token,
          );
        }
        this.update(profileID, {
          attentionState: attention.complete
            ? this.attentionRequested.has(profileID)
              ? "syncing"
              : "ready"
            : "error",
        });
        if (attention.complete) {
          this.update(profileID, { lastSyncedAt: Date.now() });
          clearTimeout(this.attentionRetryTimers.get(profileID));
          this.attentionRetryTimers.delete(profileID);
          this.attentionRetryDelays.delete(profileID);
          this.attentionNextAttempt.set(profileID, Date.now() + ATTENTION_MIN_INTERVAL_MS);
        } else this.retryAttention(profileID, runtime, generation, epoch);
        this.project(profileID);
      } catch {
        if (!this.current(profileID, id, generation, epoch)) return;
        this.update(profileID, { attentionState: "error" });
        this.retryAttention(profileID, runtime, generation, epoch);
      }
    };
    const promise = work().finally(() => {
      if (this.attentionPending.get(profileID) !== promise) return;
      this.attentionPending.delete(profileID);
      if (this.attentionRequested.has(profileID)) this.schedule(profileID, false);
    });
    this.attentionPending.set(profileID, promise);
    return promise;
  }

  private retryAttention(
    profileID: string,
    runtime: OpenCodeRuntimeStatus,
    generation: number,
    epoch: number,
  ) {
    if (this.attentionRetryTimers.has(profileID)) return;
    const delay = this.attentionRetryDelays.get(profileID) ?? 5_000;
    this.attentionRetryDelays.set(profileID, Math.min(delay * 2, 30_000));
    this.attentionNextAttempt.set(profileID, Date.now() + delay);
    this.deferAttention(profileID, runtime, generation, epoch, delay);
  }

  private deferAttention(
    profileID: string,
    runtime: OpenCodeRuntimeStatus,
    generation: number,
    epoch: number,
    delay: number,
  ) {
    if (this.attentionRetryTimers.has(profileID)) return;
    this.attentionRetryTimers.set(
      profileID,
      setTimeout(() => {
        this.attentionRetryTimers.delete(profileID);
        if (
          !this.current(profileID, runtime.connectionID, generation, epoch) ||
          !this.entry(profileID)?.runtime?.connected
        )
          return;
        void this.hydrateAttention(profileID, runtime, generation, epoch);
      }, delay),
    );
  }

  private async loadTriage(profileID: string, generation: number, epoch: number) {
    await this.mutations.get(profileID);
    if (!this.valid(profileID, generation, epoch)) return;
    const revision = this.triageRevisions.get(profileID) ?? 0;
    const snapshot = await palot.loadSessionTriage(profileID);
    if (
      !this.valid(profileID, generation, epoch) ||
      revision !== (this.triageRevisions.get(profileID) ?? 0)
    )
      return;
    this.triage.set(profileID, snapshot);
    this.update(profileID, { triageReady: true });
  }

  acceptTriage(snapshot: SessionTriageSnapshot) {
    if (!this.entry(snapshot.profileID)) return;
    this.bumpTriage(snapshot.profileID);
    if (this.triage.get(snapshot.profileID) === snapshot) return;
    this.triage.set(snapshot.profileID, snapshot);
    this.project(snapshot.profileID);
  }

  loadMore = async (profileID: string) => {
    const generation = this.generation;
    const epoch = this.epoch(profileID);
    const runtime = this.connected(profileID);
    const key = openCodeKeys.rootSessions(runtime.connectionID);
    const old = this.queryClient.getQueryData<RootSessionCatalogData>(key);
    const cursor = old?.pages.at(-1)?.cursor.next;
    if (!cursor || old?.pageParams.includes(cursor) || this.entry(profileID)?.loadingMore) return;
    this.update(profileID, { loadingMore: true });
    try {
      const page = await openCodeClient(runtime.connectionID).session.list({
        parentID: null,
        limit: 50,
        cursor,
      });
      if (!this.current(profileID, runtime.connectionID, generation, epoch)) return;
      seedSessionDetails(this.queryClient, runtime.connectionID, page.data);
      this.queryClient.setQueryData<RootSessionCatalogData>(key, (data) =>
        data
          ? {
              pages: [...data.pages, page],
              pageParams: [...data.pageParams, cursor],
            }
          : data,
      );
      this.project(profileID);
    } finally {
      if (this.current(profileID, runtime.connectionID, generation, epoch))
        this.update(profileID, { loadingMore: false });
    }
  };

  dispatch = async (profileID: string, command: OverviewTriageCommand) => {
    if (!this.entry(profileID)?.triageReady) throw new Error("Inbox state is not loaded");
    const generation = this.generation;
    const epoch = this.epoch(profileID);
    this.bumpTriage(profileID);
    const previous = this.mutations.get(profileID);
    const work = (async () => {
      await previous?.catch(() => undefined);
      if (!this.valid(profileID, generation, epoch)) return;
      const snapshot = await palot.dispatchSessionTriage({
        ...command,
        profileID,
      } as SessionTriageCommand);
      if (!this.valid(profileID, generation, epoch)) return;
      this.bumpTriage(profileID);
      this.triage.set(profileID, snapshot);
      this.project(profileID);
    })();
    this.mutations.set(profileID, work);
    try {
      await work;
    } finally {
      if (this.mutations.get(profileID) === work) this.mutations.delete(profileID);
    }
  };

  rename = async (profileID: string, sessionID: string, title: string) => {
    const runtime = this.connected(profileID);
    const generation = this.generation;
    const epoch = this.epoch(profileID);
    await openCodeClient(runtime.connectionID).session.rename({ sessionID, title });
    if (!this.current(profileID, runtime.connectionID, generation, epoch)) return;
    const session = await openCodeClient(runtime.connectionID).session.get({ sessionID });
    if (!this.current(profileID, runtime.connectionID, generation, epoch)) return;
    seedSessionDetails(this.queryClient, runtime.connectionID, [session]);
    this.project(profileID);
  };

  archive = async (profileID: string, sessionID: string) => {
    // Palot's existing archive action deletes the session through the official API.
    const runtime = this.connected(profileID);
    const generation = this.generation;
    const epoch = this.epoch(profileID);
    await openCodeClient(runtime.connectionID).session.remove({ sessionID });
    if (!this.current(profileID, runtime.connectionID, generation, epoch)) return;
    removeSession(this.queryClient, runtime.connectionID, sessionID);
    this.project(profileID);
  };

  /** Fill a selected project's summary catalog without loading conversation messages. */
  loadProject = async (profileID: string, projectID: string) => {
    const runtime = this.connected(profileID);
    const generation = this.generation;
    const epoch = this.epoch(profileID);
    const client = openCodeClient(runtime.connectionID);
    const page = await this.queryClient.fetchQuery({
      queryKey: openCodeKeys.search(runtime.connectionID, `project:${projectID}`),
      queryFn: ({ signal }) =>
        client.session.list({ parentID: null, project: projectID, limit: 100 }, { signal }),
      staleTime: 30_000,
      retry: false,
    });
    if (!this.current(profileID, runtime.connectionID, generation, epoch)) return;
    seedSessionDetails(this.queryClient, runtime.connectionID, page.data);
    this.project(profileID);
  };

  search = async (text: string) => {
    const generation = ++this.searchGeneration;
    const lifecycle = this.generation;
    if (!text.trim()) return;
    await Promise.allSettled(
      this.snapshot
        .filter((entry) => this.included.has(entry.profile.id) && entry.runtime?.connected)
        .map(async (entry) => {
          const runtime = entry.runtime!;
          const epoch = this.epoch(entry.profile.id);
          const page = await openCodeClient(runtime.connectionID).session.list({
            parentID: null,
            search: text.trim(),
            limit: 100,
          });
          if (
            generation !== this.searchGeneration ||
            !this.current(entry.profile.id, runtime.connectionID, lifecycle, epoch)
          )
            return;
          seedSessionDetails(this.queryClient, runtime.connectionID, page.data);
          this.project(entry.profile.id);
        }),
    );
  };

  tick() {
    for (const entry of this.snapshot) {
      if (entry.inbox.nextSnoozeDeadline !== null && entry.inbox.nextSnoozeDeadline <= Date.now())
        this.project(entry.profile.id);
    }
  }

  private onBatch = ({ batch, result }: OpenCodeAppliedBatch) => {
    const entry = this.snapshot.find((item) => item.runtime?.connectionID === batch.connectionID);
    if (!entry) return;
    if (!this.included.has(entry.profile.id)) return;
    if (
      batch.events.some(
        (event) => event.type.startsWith("permission.") || event.type.startsWith("form."),
      )
    ) {
      this.attentionRequested.add(entry.profile.id);
      this.update(entry.profile.id, { attentionState: "syncing" });
    }
    const status = batch.events.findLast((event) => event.type === "palot.runtime.status");
    if (status?.type === "palot.runtime.status") {
      registerOpenCodeRuntime(status.data);
      if (JSON.stringify(entry.runtime) !== JSON.stringify(status.data))
        this.update(entry.profile.id, { runtime: status.data });
    }
    if (
      result.gap ||
      result.streamChanged ||
      (status?.data.connected && !entry.runtime?.connected && !this.pending.has(entry.profile.id))
    ) {
      this.update(entry.profile.id, { attentionState: "syncing" });
      this.schedule(entry.profile.id, true);
    } else if (
      batch.events.some((event) =>
        /^(session\.(created|deleted|renamed|updated|viewed|idle|execution\.|status|inbox\.)|permission\.|form\.)/.test(
          event.type,
        ),
      )
    ) {
      this.schedule(entry.profile.id, false);
    }
  };

  private schedule(profileID: string, refresh: boolean) {
    if (refresh) this.refreshRequested.add(profileID);
    if (this.timers.has(profileID)) return;
    this.timers.set(
      profileID,
      setTimeout(() => {
        this.timers.delete(profileID);
        this.project(profileID);
        const entry = this.entry(profileID);
        if (
          this.attentionRequested.has(profileID) &&
          !this.attentionPending.has(profileID) &&
          entry?.runtime?.connected
        ) {
          this.attentionRequested.delete(profileID);
          void this.hydrateAttention(
            profileID,
            entry.runtime,
            this.generation,
            this.epoch(profileID),
          );
        }
        if (this.refreshRequested.has(profileID) && !this.pending.has(profileID)) {
          this.refreshRequested.delete(profileID);
          void this.refresh(profileID, true).catch(() => undefined);
        }
      }, 50),
    );
  }

  private project(profileID: string) {
    const entry = this.entry(profileID);
    if (!entry?.runtime) return;
    const id = entry.runtime.connectionID;
    const reconciler = openCodeReconciler(this.queryClient);
    const sessions = reuseSessionRows(entry.sessions, reconciler.sessions(id).map(mapSession));
    const projects = reuseRows(entry.projects, reconciler.projects(id).map(mapProject));
    const activity = reconciler.activity(id);
    const inbox = projectSessionInbox({
      sessions,
      projects,
      requests: reconciler.requestMap(id),
      activeIDs: activity.activeIDs,
      runningSinceBySession: new Map(
        [...activity.execution].map(([id, state]) => [id, state.startedAt]),
      ),
      triage: this.triage.get(profileID) ?? null,
      now: Date.now(),
    });
    const catalog = this.queryClient.getQueryData<RootSessionCatalogData>(
      openCodeKeys.rootSessions(id),
    );
    const cursor = catalog?.pages.at(-1)?.cursor.next;
    this.update(profileID, {
      sessions,
      projects,
      inbox: reuseInbox(entry.inbox, inbox),
      hasMore: Boolean(cursor && !catalog?.pageParams.includes(cursor)),
    });
  }

  private connected(profileID: string) {
    const runtime = this.entry(profileID)?.runtime;
    if (!runtime?.connected)
      throw new Error("This connection is offline. Reconnect before changing its tasks.");
    return runtime;
  }
  private entry(profileID: string) {
    return this.snapshot.find((entry) => entry.profile.id === profileID);
  }
  private epoch(profileID: string) {
    return this.epochs.get(profileID) ?? 0;
  }
  private bumpTriage(profileID: string) {
    this.triageRevisions.set(profileID, (this.triageRevisions.get(profileID) ?? 0) + 1);
  }
  private valid(profileID: string, generation: number, epoch: number) {
    return (
      generation === this.generation &&
      epoch === this.epoch(profileID) &&
      Boolean(this.entry(profileID))
    );
  }
  private invalidate(profileID: string) {
    this.epochs.set(profileID, this.epoch(profileID) + 1);
    this.bumpTriage(profileID);
    this.pending.delete(profileID);
    clearTimeout(this.timers.get(profileID));
    this.timers.delete(profileID);
    this.refreshRequested.delete(profileID);
    this.attentionRequested.delete(profileID);
    this.attentionPending.delete(profileID);
    clearTimeout(this.attentionRetryTimers.get(profileID));
    this.attentionRetryTimers.delete(profileID);
    this.attentionRetryDelays.delete(profileID);
    this.attentionNextAttempt.delete(profileID);
    this.missingSessions.delete(profileID);
    this.retainedLookups.get(profileID)?.abort();
    this.retainedLookups.delete(profileID);
    const id = this.entry(profileID)?.runtime?.connectionID;
    if (id) void this.queryClient.cancelQueries({ queryKey: openCodeKeys.all(id) });
  }
  private current(profileID: string, connectionID: string, generation: number, epoch: number) {
    return (
      this.valid(profileID, generation, epoch) &&
      this.entry(profileID)?.runtime?.connectionID === connectionID
    );
  }
  private update(profileID: string, patch: Partial<ConnectionOverview>) {
    const current = this.entry(profileID);
    if (
      !current ||
      Object.entries(patch).every(
        ([key, value]) => current[key as keyof ConnectionOverview] === value,
      )
    )
      return;
    this.snapshot = this.snapshot.map((entry) =>
      entry.profile.id === profileID ? { ...entry, ...patch } : entry,
    );
    this.emit();
  }
  private emit() {
    for (const listener of this.listeners) listener();
  }
}

const controllers = new WeakMap<QueryClient, ConnectionOverviewController>();
export function connectionOverview(queryClient: QueryClient) {
  let controller = controllers.get(queryClient);
  if (!controller) {
    controller = new ConnectionOverviewController(queryClient);
    controllers.set(queryClient, controller);
  }
  return controller;
}
