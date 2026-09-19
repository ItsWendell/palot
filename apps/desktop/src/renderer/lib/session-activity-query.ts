import type { QueryClient } from "@tanstack/react-query";
import { queryOptions } from "@tanstack/react-query";
import type { PalotEvent } from "../../shared";
import type { SessionExecutionState, SessionRuntimeStatus } from "../atoms/workspace";
import { getSessionInfo, listActiveSessionIDs, loadSessionLog } from "../services/opencode-catalog";
import {
  applyExecutionEvents,
  applySessionStatusEvents,
  reconcileExecutionSnapshot,
  sameSessionExecutionState,
  sameSessionRuntimeStatus,
} from "./opencode-session-reducer";
import { openCodeKeys } from "./opencode-query";
import { openCodeReconciler } from "./open-code-reconciler";
import { removeSession, seedSessionDetails, sessionCatalogInfo } from "./session-catalog-query";

const DURABLE_RECONCILE_INTERVAL = 60_000;

export interface SessionActivityData {
  activeIDs: Set<string>;
  execution: Map<string, SessionExecutionState>;
  statuses: Map<string, SessionRuntimeStatus>;
}

interface SessionActivityLedger {
  data: SessionActivityData;
  sequence: number;
  sessionSequences: Map<string, number>;
  sessionEventTimes: Map<string, number>;
  missingSessionIDs: Set<string>;
  deletedSessionIDs: Set<string>;
  lastReconciledAt: number;
  selectedSessionID: string | null;
}

const ledgers = new WeakMap<QueryClient, Map<string, SessionActivityLedger>>();

function emptySessionActivity(): SessionActivityData {
  return { activeIDs: new Set(), execution: new Map(), statuses: new Map() };
}

function sameStringSet(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  return left.size === right.size && [...left].every((value) => right.has(value));
}

function reuseStringSet(current: Set<string>, next: Set<string>): Set<string> {
  return sameStringSet(current, next) ? current : next;
}

function sameMapValues<T>(
  left: ReadonlyMap<string, T>,
  right: ReadonlyMap<string, T>,
  equal: (left: T | undefined, right: T | undefined) => boolean,
): boolean {
  return (
    left.size === right.size && [...left].every(([key, value]) => equal(value, right.get(key)))
  );
}

function updateActivityData(
  current: SessionActivityData,
  activeIDs: Set<string>,
  execution: Map<string, SessionExecutionState>,
  statuses: Map<string, SessionRuntimeStatus>,
): SessionActivityData {
  if (
    current.activeIDs === activeIDs &&
    current.execution === execution &&
    current.statuses === statuses
  ) {
    return current;
  }
  return { activeIDs, execution, statuses };
}

export function reuseSessionActivityData(
  current: SessionActivityData | undefined,
  next: SessionActivityData,
): SessionActivityData {
  if (!current) return next;
  return updateActivityData(
    current,
    sameStringSet(current.activeIDs, next.activeIDs) ? current.activeIDs : next.activeIDs,
    sameMapValues(current.execution, next.execution, sameSessionExecutionState)
      ? current.execution
      : next.execution,
    sameMapValues(current.statuses, next.statuses, sameSessionRuntimeStatus)
      ? current.statuses
      : next.statuses,
  );
}

export function sessionActivityData(
  queryClient: QueryClient,
  connectionID: string,
): SessionActivityData {
  return openCodeReconciler(queryClient).activity(connectionID);
}

function ledgerFor(queryClient: QueryClient, connectionID: string): SessionActivityLedger {
  let clientLedgers = ledgers.get(queryClient);
  if (!clientLedgers) {
    clientLedgers = new Map();
    ledgers.set(queryClient, clientLedgers);
  }
  let ledger = clientLedgers.get(connectionID);
  if (!ledger) {
    ledger = {
      data:
        queryClient.getQueryData<SessionActivityData>(openCodeKeys.sessionActivity(connectionID)) ??
        emptySessionActivity(),
      sequence: 0,
      sessionSequences: new Map(),
      sessionEventTimes: new Map(),
      missingSessionIDs: new Set(),
      deletedSessionIDs: new Set(),
      lastReconciledAt: 0,
      selectedSessionID: null,
    };
    clientLedgers.set(connectionID, ledger);
  }
  return ledger;
}

function activitySessionID(event: PalotEvent): string | null {
  const data: unknown = event.data;
  if (!data || typeof data !== "object" || !("sessionID" in data)) return null;
  return typeof data.sessionID === "string" ? data.sessionID : null;
}

function isSessionActivityEvent(event: PalotEvent): boolean {
  return (
    event.type === "session.created" ||
    event.type === "session.deleted" ||
    event.type === "session.idle" ||
    event.type === "session.status" ||
    event.type === "session.retry.scheduled" ||
    event.type === "session.execution.started" ||
    event.type === "session.execution.succeeded" ||
    event.type === "session.execution.failed" ||
    event.type === "session.execution.interrupted" ||
    event.type === "session.step.started" ||
    event.type === "session.step.ended"
  );
}

export function sessionActivityCompletionHint(event: PalotEvent): boolean {
  return (
    event.type === "session.step.ended" &&
    event.data.finish !== "tool-calls" &&
    event.data.finish !== "unknown"
  );
}

export function applySessionActivityEvents(
  queryClient: QueryClient,
  connectionID: string,
  events: readonly PalotEvent[],
): void {
  const activityEvents = events.filter(isSessionActivityEvent).map((event) =>
    event.type === "session.idle"
      ? ({
          ...event,
          type: "session.status",
          data: { ...event.data, status: { type: "idle" } },
        } as PalotEvent)
      : event,
  );
  if (activityEvents.length === 0) return;

  const ledger = ledgerFor(queryClient, connectionID);
  for (const event of activityEvents) {
    const sessionID = activitySessionID(event);
    if (!sessionID) continue;
    if (event.type === "session.created") ledger.deletedSessionIDs.delete(sessionID);
    if (event.type === "session.deleted") {
      ledger.deletedSessionIDs.add(sessionID);
      ledger.missingSessionIDs.delete(sessionID);
    }
    ledger.sequence += 1;
    ledger.sessionSequences.set(sessionID, ledger.sequence);
    ledger.sessionEventTimes.set(
      sessionID,
      Math.max(ledger.sessionEventTimes.get(sessionID) ?? 0, event.createdAt),
    );
  }
  const current = ledger.data;
  const execution = applyExecutionEvents(current.execution, activityEvents);
  const statuses = applySessionStatusEvents(current.statuses, activityEvents);
  const activeIDs = new Set(ledger.data.activeIDs);
  for (const event of activityEvents) {
    const sessionID = activitySessionID(event);
    if (!sessionID) continue;
    if (
      event.type === "session.execution.started" ||
      event.type === "session.step.started" ||
      event.type === "session.retry.scheduled" ||
      (event.type === "session.status" && event.data.status.type !== "idle")
    ) {
      activeIDs.add(sessionID);
    }
    if (
      event.type === "session.deleted" ||
      event.type === "session.execution.succeeded" ||
      event.type === "session.execution.failed" ||
      event.type === "session.execution.interrupted" ||
      (event.type === "session.status" && event.data.status.type === "idle")
    ) {
      activeIDs.delete(sessionID);
    }
  }
  ledger.data = updateActivityData(
    current,
    reuseStringSet(current.activeIDs, activeIDs),
    execution,
    statuses,
  );
  queryClient.setQueryData<SessionActivityData>(
    openCodeKeys.sessionActivity(connectionID),
    ledger.data,
  );
}

async function hydrateExecutionLogs(
  queryClient: QueryClient,
  connectionID: string,
  ledger: SessionActivityLedger,
  sessionIDs: readonly string[],
  fetchSequence: number,
  signal: AbortSignal,
): Promise<Set<string>> {
  const hydratedSessionIDs = new Set<string>();
  const uniqueIDs = [...new Set(sessionIDs)].filter(
    (sessionID) => sessionID && !ledger.deletedSessionIDs.has(sessionID),
  );
  const results = await Promise.allSettled(
    uniqueIDs.map(async (sessionID) => {
      const after = openCodeReconciler(queryClient).replayCursor(connectionID, sessionID);
      return {
        sessionID,
        after,
        events: await loadSessionLog(sessionID, after, signal, connectionID),
      };
    }),
  );
  if (signal.aborted) throw signal.reason;

  for (const result of results) {
    if (result.status === "rejected") continue;
    const { sessionID, after, events } = result.value;
    if ((ledger.sessionSequences.get(sessionID) ?? 0) > fetchSequence) continue;
    const liveThrough = ledger.sessionEventTimes.get(sessionID) ?? 0;
    const replay = openCodeReconciler(queryClient).applyReplay(
      connectionID,
      sessionID,
      events.filter((event) => event.type === "log.synced" || event.created >= liveThrough),
      after,
    );
    if (!replay.synced || replay.regression) continue;
    if (replay.changedSessionIDs.includes(sessionID)) hydratedSessionIDs.add(sessionID);
    if (replay.events.length > 0)
      ledger.data = openCodeReconciler(queryClient).activity(connectionID);
  }
  return hydratedSessionIDs;
}

export function updateSessionActivity(
  queryClient: QueryClient,
  connectionID: string,
  update: (current: SessionActivityData) => SessionActivityData,
  touchedSessionIDs: readonly string[] = [],
): SessionActivityData {
  const ledger = ledgerFor(queryClient, connectionID);
  for (const sessionID of touchedSessionIDs) {
    ledger.sequence += 1;
    ledger.sessionSequences.set(sessionID, ledger.sequence);
  }
  ledger.data = update(ledger.data);
  queryClient.setQueryData(openCodeKeys.sessionActivity(connectionID), ledger.data);
  openCodeReconciler(queryClient).replaceActivity(connectionID, ledger.data);
  return ledger.data;
}

export async function hydrateSessionLineage(
  queryClient: QueryClient,
  connectionID: string,
  sessionIDs: readonly string[],
  signal?: AbortSignal,
): Promise<void> {
  const catalog = sessionCatalogInfo(queryClient, connectionID);
  const ledger = ledgerFor(queryClient, connectionID);
  const known = new Map(catalog.map((session) => [session.id, session]));
  let pending = [
    ...new Set(
      [...sessionIDs, ...ledger.missingSessionIDs].flatMap((sessionID) => {
        if (ledger.deletedSessionIDs.has(sessionID)) return [];
        const session = known.get(sessionID);
        if (!session) return [sessionID];
        return session.parentID && !known.has(session.parentID) ? [session.parentID] : [];
      }),
    ),
  ];
  while (pending.length > 0) {
    const results = await Promise.allSettled(
      pending.map((sessionID) => getSessionInfo(sessionID, signal, connectionID)),
    );
    if (signal?.aborted) throw signal.reason;
    const sessions = results.flatMap((result, index) => {
      const sessionID = pending[index];
      if (!sessionID) return [];
      if (result.status === "rejected") {
        ledger.missingSessionIDs.add(sessionID);
        return [];
      }
      ledger.missingSessionIDs.delete(sessionID);
      if (!result.value) {
        if ([...known.values()].some((session) => session.parentID === sessionID)) {
          removeSession(queryClient, connectionID, sessionID);
        }
        return [];
      }
      return result.value && !ledger.deletedSessionIDs.has(result.value.id) ? [result.value] : [];
    });
    if (sessions.length === 0) return;
    seedSessionDetails(queryClient, connectionID, sessions);
    for (const session of sessions) known.set(session.id, session);
    pending = [
      ...new Set(
        sessions.flatMap((session) =>
          session.parentID && !known.has(session.parentID) ? [session.parentID] : [],
        ),
      ),
    ];
  }
}

export async function hydrateSelectedSessionActivity(
  queryClient: QueryClient,
  connectionID: string,
  sessionID: string,
  signal?: AbortSignal,
): Promise<void> {
  const ledger = ledgerFor(queryClient, connectionID);
  const fetchSequence = ledger.sequence;
  const requestSignal = signal ?? new AbortController().signal;
  await hydrateSessionLineage(queryClient, connectionID, [sessionID], requestSignal);
  const hydratedSessionIDs = await hydrateExecutionLogs(
    queryClient,
    connectionID,
    ledger,
    [sessionID],
    fetchSequence,
    requestSignal,
  );
  let activeIDs = new Set(ledger.data.activeIDs);
  let statuses = ledger.data.statuses;
  for (const hydratedSessionID of hydratedSessionIDs) {
    const running = ledger.data.execution.get(hydratedSessionID)?.status === "running";
    if (running) activeIDs.add(hydratedSessionID);
    else activeIDs.delete(hydratedSessionID);
    const current = statuses.get(hydratedSessionID);
    const updated: SessionRuntimeStatus = running ? { type: "busy" } : { type: "idle" };
    if (current?.type === "retry" && running) continue;
    if (sameSessionRuntimeStatus(current, updated)) continue;
    if (statuses === ledger.data.statuses) statuses = new Map(statuses);
    statuses.set(hydratedSessionID, updated);
  }
  activeIDs = reuseStringSet(ledger.data.activeIDs, activeIDs);
  ledger.data = updateActivityData(ledger.data, activeIDs, ledger.data.execution, statuses);
  ledger.selectedSessionID = sessionID;
  openCodeReconciler(queryClient).replaceActivity(connectionID, ledger.data);
  queryClient.setQueryData(openCodeKeys.sessionActivity(connectionID), ledger.data);
}

export function sessionActivityQueryOptions(
  queryClient: QueryClient,
  connectionID: string,
  synchronize = false,
  selectedSessionID: string | null = null,
) {
  return queryOptions({
    queryKey: openCodeKeys.sessionActivity(connectionID),
    queryFn: async ({ signal }) => {
      const reconciler = openCodeReconciler(queryClient);
      const snapshotToken = reconciler.beginSnapshot(connectionID);
      const ledger = ledgerFor(queryClient, connectionID);
      if (queryClient.getQueryData(openCodeKeys.sessionActivity(connectionID)) === undefined) {
        ledger.data = emptySessionActivity();
      }
      const fetchSequence = ledger.sequence;
      const activeSessionIDs = await listActiveSessionIDs(signal, connectionID);
      if (signal.aborted) throw signal.reason;
      const activeSnapshot = new Set(activeSessionIDs);
      const activeIDsChanged = !sameStringSet(ledger.data.activeIDs, activeSnapshot);
      const selectionChanged = ledger.selectedSessionID !== selectedSessionID;
      const cachedCatalogSessions = sessionCatalogInfo(queryClient, connectionID);
      const cachedKnownSessions = cachedCatalogSessions.map((session) => ({
        id: session.id,
        parentID: session.parentID ?? null,
      }));
      const executionNeedsReconcile =
        reconcileExecutionSnapshot(ledger.data.execution, activeSessionIDs, [
          ...cachedKnownSessions,
          ...activeSessionIDs,
          ...ledger.data.execution.keys(),
        ]) !== ledger.data.execution;
      const durableReconcileDue =
        Date.now() - ledger.lastReconciledAt >= DURABLE_RECONCILE_INTERVAL;
      if (
        synchronize &&
        !activeIDsChanged &&
        !selectionChanged &&
        !executionNeedsReconcile &&
        ledger.sequence === fetchSequence &&
        !durableReconcileDue
      ) {
        reconciler.replaceActivity(connectionID, ledger.data, snapshotToken);
        return ledger.data;
      }
      await hydrateSessionLineage(queryClient, connectionID, activeSessionIDs, signal);
      if (signal.aborted) throw signal.reason;
      const protectedSessionIDs = new Set(
        [...ledger.sessionSequences].flatMap(([sessionID, sequence]) =>
          sequence > fetchSequence ? [sessionID] : [],
        ),
      );
      let activeIDs = new Set(activeSessionIDs);
      for (const sessionID of protectedSessionIDs) {
        if (ledger.data.activeIDs.has(sessionID)) activeIDs.add(sessionID);
        else activeIDs.delete(sessionID);
      }
      const catalogSessions = sessionCatalogInfo(queryClient, connectionID);
      const knownSessions = catalogSessions.map((session) => ({
        id: session.id,
        parentID: session.parentID ?? null,
      }));
      let execution = reconcileExecutionSnapshot(
        ledger.data.execution,
        activeSessionIDs,
        [...knownSessions, ...activeSessionIDs, ...ledger.data.execution.keys()],
        protectedSessionIDs,
      );
      for (const session of catalogSessions) {
        if (activeIDs.has(session.id) || protectedSessionIDs.has(session.id) || !session.outcome) {
          continue;
        }
        const current = execution.get(session.id);
        const updated: SessionExecutionState = {
          status: session.outcome,
          startedAt: current?.startedAt ?? null,
          completedAt: session.time.idle ?? session.time.updated,
          ...((current?.parentID ?? session.parentID)
            ? { parentID: current?.parentID ?? session.parentID }
            : {}),
        };
        if (sameSessionExecutionState(current, updated)) continue;
        if (execution === ledger.data.execution) execution = new Map(execution);
        execution.set(session.id, updated);
      }
      ledger.data = updateActivityData(
        ledger.data,
        reuseStringSet(ledger.data.activeIDs, activeIDs),
        execution,
        ledger.data.statuses,
      );
      reconciler.replaceActivity(connectionID, ledger.data, snapshotToken);
      // Our intermediate write advances the graph revision. Protect the final
      // status projection against events arriving during log hydration, not our
      // own snapshot write, or the UI can retain busy after the query is idle.
      const activityToken = reconciler.beginSnapshot(connectionID);
      const hydratedExecutionSessionIDs = await hydrateExecutionLogs(
        queryClient,
        connectionID,
        ledger,
        [...activeSessionIDs, ...(selectedSessionID ? [selectedSessionID] : [])],
        fetchSequence,
        signal,
      );
      execution = ledger.data.execution;
      for (const sessionID of hydratedExecutionSessionIDs) {
        if (ledger.data.execution.get(sessionID)?.status === "running") activeIDs.add(sessionID);
        else activeIDs.delete(sessionID);
      }
      activeIDs = reuseStringSet(ledger.data.activeIDs, activeIDs);
      let statuses = ledger.data.statuses;
      const statusSessionIDs = new Set([
        ...statuses.keys(),
        ...ledger.data.execution.keys(),
        ...activeSessionIDs,
      ]);
      for (const sessionID of statusSessionIDs) {
        if (protectedSessionIDs.has(sessionID)) continue;
        const current = statuses.get(sessionID);
        const updated: SessionRuntimeStatus = activeIDs.has(sessionID)
          ? { type: "busy" }
          : { type: "idle" };
        if (current?.type === "retry" && activeIDs.has(sessionID)) continue;
        if (sameSessionRuntimeStatus(current, updated)) continue;
        if (statuses === ledger.data.statuses) statuses = new Map(statuses);
        statuses.set(sessionID, updated);
      }
      ledger.data = updateActivityData(ledger.data, activeIDs, execution, statuses);
      for (const [sessionID, sequence] of ledger.sessionSequences) {
        if (sequence <= fetchSequence) ledger.sessionSequences.delete(sessionID);
      }
      ledger.lastReconciledAt = Date.now();
      ledger.selectedSessionID = selectedSessionID;
      reconciler.replaceActivity(connectionID, ledger.data, activityToken);
      return ledger.data;
    },
    staleTime: 0,
    refetchOnMount: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
    refetchInterval: false,
    structuralSharing: (current, next) =>
      reuseSessionActivityData(
        current as SessionActivityData | undefined,
        next as SessionActivityData,
      ),
  });
}
