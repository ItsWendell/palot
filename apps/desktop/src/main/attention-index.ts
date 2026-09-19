import type {
  FormInfo,
  LocationRef,
  OpenCodeClient,
  OpenCodeEvent,
  PermissionRequest,
  SessionInfo,
} from "@opencode/client";
import type {
  AttentionSnapshotInput,
  PalotAttentionSnapshot,
  PalotSession,
  SessionRequestSnapshot,
} from "../shared";
import { openCodeRuntime } from "./opencode-runtime";

const REQUEST_TIMEOUT_MS = 30_000;
const SCAN_CONCURRENCY = 4;
const MIN_RECONCILE_INTERVAL_MS = 1_000;
const MISSING_SESSION_RETRY_MS = 30_000;

type AttentionRequest =
  | { type: "permission"; value: PermissionRequest }
  | { type: "form"; value: FormInfo };

interface AttentionRuntime {
  runtimeStatus(): { connectionID: string };
  withClient<T>(operation: (client: OpenCodeClient) => Promise<T>): Promise<T>;
  onReconnect(observer: (client: OpenCodeClient) => void | Promise<void>): () => void;
}

export class OpenCodeAttentionIndex {
  readonly #requests = new Map<string, AttentionRequest>();
  readonly #requestTouchedAt = new Map<string, number>();
  readonly #locationRequestKeys = new Map<string, Set<string>>();
  readonly #locationScans = new Set<string>();
  readonly #sessions = new Map<string, PalotSession>();
  readonly #deletedSessions = new Set<string>();
  readonly #listeners = new Set<() => void>();
  readonly #unsubscribeReconnect: () => void;
  #generation = "";
  #revision = 0;
  #epoch = 0;
  #controller = new AbortController();
  #stream: { ready: Promise<boolean>; controller: AbortController } | undefined;
  #reconciliation: Promise<boolean> | undefined;
  #disposed = false;
  #nextReconcileAt = 0;
  #retryDelay = 5_000;
  #lastComplete = false;
  readonly #missingSessions = new Map<string, number>();

  constructor(private readonly runtime: AttentionRuntime = openCodeRuntime) {
    this.#unsubscribeReconnect = runtime.onReconnect(() => this.reset());
  }

  dispose(): void {
    this.#disposed = true;
    this.#unsubscribeReconnect();
    this.#listeners.clear();
    this.reset();
    this.#requests.clear();
    this.#requestTouchedAt.clear();
    this.#locationRequestKeys.clear();
    this.#sessions.clear();
    this.#deletedSessions.clear();
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  reset(): void {
    this.#invalidate(true);
  }

  #invalidate(notify: boolean): void {
    this.#epoch += 1;
    this.#controller.abort();
    this.#stream?.controller.abort();
    this.#controller = new AbortController();
    this.#stream = undefined;
    this.#reconciliation = undefined;
    this.#locationScans.clear();
    this.#nextReconcileAt = 0;
    this.#retryDelay = 5_000;
    this.#lastComplete = false;
    this.#missingSessions.clear();
    this.#revision += 1;
    if (notify) this.#emit();
  }

  async snapshot(input: AttentionSnapshotInput): Promise<PalotAttentionSnapshot> {
    if (this.#disposed) throw new Error("Attention index is disposed");
    const generation = this.runtime.runtimeStatus().connectionID;
    if (input.connectionID !== generation) {
      throw new Error("Attention snapshot does not match its OpenCode connection");
    }
    this.#ensureGeneration(generation);
    const epoch = this.#epoch;
    for (const session of input.sessions) {
      if (
        !this.#deletedSessions.has(session.id) &&
        session.updatedAt >= (this.#sessions.get(session.id)?.updatedAt ?? 0)
      ) {
        this.#sessions.set(session.id, session);
        this.#missingSessions.delete(session.id);
      }
    }
    if (!this.#reconciliation) {
      // Capture before discovery: replies received while enumerating must win over lists.
      const revision = this.#revision;
      const reconcile = Date.now() >= this.#nextReconcileAt;
      const operation = this.runtime
        .withClient(async (client) =>
          reconcile
            ? this.#reconcile(client, epoch, revision)
            : (await this.#hydrateRequestLineage(client, epoch)) && this.#lastComplete,
        )
        .catch(() => false)
        .then((complete) => {
          if (reconcile && epoch === this.#epoch) {
            this.#lastComplete = complete;
            this.#nextReconcileAt =
              Date.now() + (complete ? MIN_RECONCILE_INTERVAL_MS : this.#retryDelay);
            this.#retryDelay = complete ? 5_000 : Math.min(this.#retryDelay * 2, 30_000);
          }
          return complete;
        });
      this.#reconciliation = operation;
      void operation.finally(() => {
        if (this.#reconciliation === operation) this.#reconciliation = undefined;
      });
    }
    const complete = await this.#reconciliation;
    if (
      this.runtime.runtimeStatus().connectionID !== generation ||
      this.#generation !== generation ||
      this.#epoch !== epoch
    ) {
      throw new Error("OpenCode connection changed during attention snapshot");
    }

    const requests = new Map<string, SessionRequestSnapshot>();
    for (const request of this.#requests.values()) {
      const sessionID = request.value.sessionID;
      const current = requests.get(sessionID) ?? {
        permissions: [],
        forms: [],
        inbox: [],
        errors: [],
      };
      if (request.type === "permission") current.permissions.push(request.value);
      else current.forms.push(request.value);
      requests.set(sessionID, current);
    }
    const lineage = this.#requestLineageIDs(requests.keys());
    return {
      complete: complete && lineage.complete,
      sessions: [...lineage.ids].flatMap((sessionID) => {
        const session = this.#sessions.get(sessionID);
        return session ? [session] : [];
      }),
      requests: [...requests].map(([sessionID, value]) => ({ sessionID, value })),
    };
  }

  #ensureGeneration(generation: string): void {
    if (this.#generation === generation) return;
    this.#generation = generation;
    this.#requests.clear();
    this.#requestTouchedAt.clear();
    this.#locationRequestKeys.clear();
    this.#sessions.clear();
    this.#deletedSessions.clear();
    this.#invalidate(false);
  }

  #signal(): AbortSignal {
    return AbortSignal.any([this.#controller.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]);
  }

  #ensureStream(client: OpenCodeClient, epoch: number): Promise<boolean> {
    if (this.#stream) return this.#stream.ready;
    const controller = new AbortController();
    const ready = Promise.withResolvers<boolean>();
    const stream = { controller, ready: ready.promise };
    this.#stream = stream;
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    void (async () => {
      try {
        for await (const event of client.event.subscribe({ signal: controller.signal })) {
          if (epoch !== this.#epoch || controller.signal.aborted) break;
          if (event.type === "server.connected") {
            clearTimeout(timeout);
            ready.resolve(true);
          } else this.#handleEvent(event);
        }
      } catch {
        // Includes the SDK's bounded subscriber overflow. Rescan on the next snapshot.
      } finally {
        clearTimeout(timeout);
        ready.resolve(false);
        if (this.#stream === stream) {
          // A failing subscription started by snapshot must not trigger another
          // snapshot through listeners forever. The current caller sees failure.
          this.#invalidate(!this.#reconciliation);
        }
      }
    })();
    return ready.promise;
  }

  async #reconcile(client: OpenCodeClient, epoch: number, revision: number): Promise<boolean> {
    if (epoch !== this.#epoch) return false;
    if (!(await this.#ensureStream(client, epoch)) || epoch !== this.#epoch) return false;
    let complete = true;
    try {
      const locations = await client.debug.location.list({ signal: this.#signal() });
      if (epoch !== this.#epoch) return false;
      const loaded = new Map(locations.map((location) => [locationKey(location), location]));
      // Enumeration is the only discovery source. Never activate session-history locations.
      for (const [key, requests] of this.#locationRequestKeys) {
        if (loaded.has(key)) continue;
        this.#locationScans.delete(key);
        for (const request of requests) {
          if ((this.#requestTouchedAt.get(request) ?? 0) > revision) continue;
          this.#requests.delete(request);
          requests.delete(request);
        }
        if (!requests.size) this.#locationRequestKeys.delete(key);
      }
      const results = await boundedMap([...loaded.values()], async (location) => {
        if (epoch !== this.#epoch) return false;
        const key = locationKey(location);
        if (this.#locationScans.has(key)) return true;
        // The API has no atomic enumerate-and-list: eviction here can rewarm this
        // just-enumerated ref, but can never fan out into historical locations.
        const success = await this.#scan(client, location, epoch, revision);
        if (success && epoch === this.#epoch) this.#locationScans.add(key);
        return success;
      });
      complete = results.every(Boolean);
    } catch {
      complete = false;
    }
    if (epoch !== this.#epoch) return false;
    return (await this.#hydrateRequestLineage(client, epoch)) && complete;
  }

  async #scan(
    client: OpenCodeClient,
    location: LocationRef,
    epoch: number,
    revision: number,
  ): Promise<boolean> {
    const locationID = locationKey(location);
    const target = {
      directory: location.directory,
    };
    const results = await Promise.allSettled([
      client.permission.request.list({ location: target }, { signal: this.#signal() }),
      client.form.list({ location: target }, { signal: this.#signal() }),
    ]);
    if (epoch !== this.#epoch) return false;

    const scanned = new Map<string, AttentionRequest>();
    const successfulTypes = new Set<AttentionRequest["type"]>();
    if (results[0]?.status === "fulfilled") {
      successfulTypes.add("permission");
      for (const request of results[0].value.data) {
        if (this.#deletedSessions.has(request.sessionID)) continue;
        scanned.set(requestKey("permission", request.sessionID, request.id), {
          type: "permission",
          value: request,
        });
      }
    }
    if (results[1]?.status === "fulfilled") {
      successfulTypes.add("form");
      for (const form of results[1].value.data) {
        if (form.sessionID === "global" || this.#deletedSessions.has(form.sessionID)) continue;
        scanned.set(requestKey("form", form.sessionID, form.id), { type: "form", value: form });
      }
    }

    const previousLocationKeys = this.#locationRequestKeys.get(locationID) ?? new Set();
    const nextLocationKeys = new Set(
      [...previousLocationKeys].filter((key) => {
        const request = this.#requests.get(key);
        return request && !successfulTypes.has(request.type);
      }),
    );
    for (const [key, request] of scanned) {
      if ((this.#requestTouchedAt.get(key) ?? 0) > revision) {
        if (this.#requests.has(key)) nextLocationKeys.add(key);
        continue;
      }
      this.#requests.set(key, request);
      nextLocationKeys.add(key);
    }
    for (const key of previousLocationKeys) {
      if (nextLocationKeys.has(key)) continue;
      const request = this.#requests.get(key);
      if (request && !successfulTypes.has(request.type)) continue;
      if ((this.#requestTouchedAt.get(key) ?? 0) > revision) {
        if (this.#requests.has(key)) nextLocationKeys.add(key);
        continue;
      }
      this.#requests.delete(key);
    }
    this.#locationRequestKeys.set(locationID, nextLocationKeys);
    return successfulTypes.size === 2;
  }

  async #hydrateRequestLineage(client: OpenCodeClient, epoch: number): Promise<boolean> {
    let pending = [
      ...new Set([...this.#requests.values()].map((request) => request.value.sessionID)),
    ];
    const visited = new Set<string>();
    let complete = true;
    while (pending.length > 0) {
      const sessionIDs = pending.filter((id) => !visited.has(id) && !this.#deletedSessions.has(id));
      for (const id of sessionIDs) visited.add(id);
      const results = await boundedMap(sessionIDs, async (sessionID) => {
        if (epoch !== this.#epoch) return undefined;
        const cached = this.#sessions.get(sessionID);
        if (cached) return cached;
        if ((this.#missingSessions.get(sessionID) ?? 0) > Date.now()) {
          complete = false;
          return undefined;
        }
        this.#missingSessions.delete(sessionID);
        try {
          return mapSession(await client.session.get({ sessionID }, { signal: this.#signal() }));
        } catch {
          if (epoch === this.#epoch)
            this.#missingSessions.set(sessionID, Date.now() + MISSING_SESSION_RETRY_MS);
          complete = false;
          return undefined;
        }
      });
      if (epoch !== this.#epoch) return false;
      pending = [];
      for (const session of results) {
        if (!session || this.#deletedSessions.has(session.id)) continue;
        this.#sessions.set(session.id, session);
        if (session.parentID) pending.push(session.parentID);
      }
    }
    return complete;
  }

  #requestLineageIDs(sessionIDs: Iterable<string>): { ids: Set<string>; complete: boolean } {
    const ids = new Set<string>();
    let complete = true;
    for (const sessionID of sessionIDs) {
      const path = new Set<string>();
      let currentID: string | null = sessionID;
      while (currentID) {
        const current = this.#sessions.get(currentID);
        if (!current || path.has(currentID)) {
          complete = false;
          break;
        }
        if (ids.has(currentID)) break;
        path.add(currentID);
        ids.add(currentID);
        currentID = current.parentID;
      }
    }
    return { ids, complete };
  }

  #handleEvent(event: OpenCodeEvent): void {
    let changed = false;
    if (event.type === "permission.asked") {
      this.#upsertEventRequest("permission", event.data, event.location);
      changed = true;
    } else if (event.type === "permission.replied") {
      changed = this.#deleteRequest("permission", event.data.sessionID, event.data.requestID);
    } else if (event.type === "form.created") {
      if (event.data.form.sessionID === "global") return;
      this.#upsertEventRequest("form", event.data.form, event.location);
      changed = true;
    } else if (event.type === "form.replied" || event.type === "form.cancelled") {
      changed = this.#deleteRequest("form", event.data.sessionID, event.data.id);
    } else if (event.type === "session.deleted") {
      this.#deletedSessions.add(event.data.sessionID);
      this.#missingSessions.delete(event.data.sessionID);
      changed = this.#sessions.delete(event.data.sessionID);
      for (const [key, request] of this.#requests) {
        if (request.value.sessionID !== event.data.sessionID) continue;
        this.#touch(key);
        this.#requests.delete(key);
        changed = true;
      }
    }
    if (changed) this.#emit();
  }

  #upsertEventRequest(
    type: AttentionRequest["type"],
    value: PermissionRequest | FormInfo,
    location?: LocationRef,
  ): void {
    if (this.#deletedSessions.has(value.sessionID)) return;
    // An authoritative request is new evidence even during a discovery cooldown.
    this.#missingSessions.delete(value.sessionID);
    const key = requestKey(type, value.sessionID, value.id);
    if (location) {
      const id = locationKey(location);
      const keys = this.#locationRequestKeys.get(id) ?? new Set<string>();
      keys.add(key);
      this.#locationRequestKeys.set(id, keys);
    }
    this.#touch(key);
    this.#requests.set(
      key,
      type === "permission"
        ? { type, value: value as PermissionRequest }
        : { type, value: value as FormInfo },
    );
  }

  #deleteRequest(type: AttentionRequest["type"], sessionID: string, requestID: string): boolean {
    const key = requestKey(type, sessionID, requestID);
    this.#touch(key);
    return this.#requests.delete(key);
  }

  #touch(key: string): void {
    this.#revision += 1;
    this.#requestTouchedAt.set(key, this.#revision);
  }

  #emit(): void {
    for (const listener of this.#listeners) listener();
  }
}

async function boundedMap<T, R>(items: T[], operation: (item: T) => Promise<R>): Promise<R[]> {
  let cursor = 0;
  const results: R[] = [];
  await Promise.all(
    Array.from({ length: Math.min(SCAN_CONCURRENCY, items.length) }, async () => {
      while (cursor < items.length) {
        const index = cursor++;
        results[index] = await operation(items[index]!);
      }
    }),
  );
  return results;
}

function locationKey(location: LocationRef): string {
  return `${location.directory}\u0000${location.workspaceID ?? ""}`;
}

function requestKey(type: AttentionRequest["type"], sessionID: string, requestID: string): string {
  return `${sessionID}:${type}:${requestID}`;
}

function mapSession(session: SessionInfo): PalotSession {
  return {
    id: session.id,
    parentID: session.parentID ?? null,
    projectID: session.projectID,
    title: session.title ?? null,
    agent: session.agent ?? null,
    model: session.model ? { ...session.model } : null,
    location: { ...session.location },
    createdAt: session.time.created,
    updatedAt: session.time.updated,
    ...(session.time.idle === undefined ? {} : { idleAt: session.time.idle }),
    ...(session.time.viewed === undefined ? {} : { viewedAt: session.time.viewed }),
    ...(session.outcome ? { outcome: session.outcome } : {}),
    archivedAt: session.time.archived ?? null,
    cost: session.cost,
    tokens: {
      input: session.tokens.input,
      output: session.tokens.output,
      reasoning: session.tokens.reasoning,
      cache: { ...session.tokens.cache },
    },
    ...(session.revert
      ? {
          revert: {
            ...session.revert,
            ...(session.revert.files
              ? { files: session.revert.files.map((file) => ({ ...file })) }
              : {}),
          },
        }
      : {}),
  };
}

const scopedIndexes = new Map<string, OpenCodeAttentionIndex>();
let unsubscribeDisposal: (() => void) | null = null;

export function openCodeAttentionIndex(connectionID: string): OpenCodeAttentionIndex {
  unsubscribeDisposal ??= openCodeRuntime.onConnectionDisposed((id) => {
    scopedIndexes.get(id)?.dispose();
    scopedIndexes.delete(id);
  });
  const retained = new Set(openCodeRuntime.listRuntimes().map((status) => status.connectionID));
  for (const [id, scoped] of scopedIndexes) {
    if (!retained.has(id)) {
      scoped.dispose();
      scopedIndexes.delete(id);
    }
  }
  const runtime = openCodeRuntime.scopedConnection(connectionID);
  let scoped = scopedIndexes.get(connectionID);
  if (!scoped) {
    scoped = new OpenCodeAttentionIndex(runtime);
    scopedIndexes.set(connectionID, scoped);
  }
  return scoped;
}

export function destroyOpenCodeAttentionIndex(): void {
  unsubscribeDisposal?.();
  unsubscribeDisposal = null;
  for (const scoped of scopedIndexes.values()) scoped.dispose();
  scopedIndexes.clear();
}
