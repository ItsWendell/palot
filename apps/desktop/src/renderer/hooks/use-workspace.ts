import { isCancelledError, useQueryClient } from "@tanstack/react-query";
import { useSetAtom, useStore } from "jotai";
import { useCallback, useEffect, useRef } from "react";
import type { JsonValue, PalotSession } from "../../shared";
import {
  activeShellsAtom,
  errorAtom,
  messagesAtom,
  messagesForProfileAtom,
  shellsForProfileAtom,
  phaseAtom,
  runtimeAtom,
  selectedSessionIDAtom,
  workspaceRecoveryAtom,
} from "../atoms/workspace";
import {
  applyShellEvents,
  needsWorkspaceReconcile,
  reconcileShellSnapshot,
  sessionReconcileTargets,
  type SessionReconcileTargets,
} from "../lib/opencode-session-reducer";
import { SessionSynchronization } from "../lib/session-synchronization";
import { recordReplicaApplied } from "../lib/streaming-latency";
import { SessionViewRetention, retainSessionViews } from "../lib/session-view-retention";
import { palot } from "../services/palot";
import { showErrorToast } from "../lib/toast-error";
import {
  getTranscriptMessages,
  hasTranscript,
  mergeTranscriptMessages,
  removeTranscriptCacheMessage,
  setTranscriptSnapshot,
  transcriptQueryKey,
} from "./use-session-transcript";
import {
  attentionSyncStateAtom,
  sessionCatalogReadyAtom,
  sessionTriageSnapshotAtom,
} from "../atoms/inbox";
import { sidebarModeAtom } from "../atoms/ui";
import {
  EMPTY_SESSION_REQUEST_SNAPSHOT,
  mergeAttentionRequests,
  setSessionRequestSnapshot,
} from "../lib/session-request-query";
import { openCodeKeys } from "../lib/opencode-query";
import {
  cacheProjects,
  cacheRootSessions,
  cacheSessions,
  projectsQueryOptions,
  rootSessionInfo,
  rootSessionsQueryOptions,
  seedSessionDetails,
  sessionCatalogInfo,
  sessionQueryOptions,
} from "../lib/session-catalog-query";
import { sessionActivityData, sessionActivityQueryOptions } from "../lib/session-activity-query";
import { mapSession } from "../services/opencode-mappers";
import { listProjectInfo } from "../services/opencode-catalog";
import { useCatalogSession } from "./use-session-catalog";
import { registerOpenCodeRuntime, setFocusedOpenCodeRuntime } from "../services/opencode-client";
import { openCodeReconciler, type OpenCodeAppliedBatch } from "../lib/open-code-reconciler";

function record(value: unknown): Record<string, JsonValue> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, JsonValue>)
    : null;
}

async function withSessionAncestors(
  sessions: PalotSession[],
  connectionID: string,
): Promise<PalotSession[]> {
  const byID = new Map(sessions.map((session) => [session.id, session]));
  let pending = sessions.flatMap((session) =>
    session.parentID && !byID.has(session.parentID) ? [session.parentID] : [],
  );
  while (pending.length) {
    const results = await Promise.allSettled(
      pending.map((sessionID) => palot.getSession(sessionID, connectionID)),
    );
    pending = [];
    for (const result of results) {
      if (result.status !== "fulfilled" || !result.value || byID.has(result.value.id)) continue;
      byID.set(result.value.id, result.value);
      if (result.value.parentID && !byID.has(result.value.parentID)) {
        pending.push(result.value.parentID);
      }
    }
  }
  return [...byID.values()];
}

async function resolveSessionRoot(
  sessionID: string,
  sessions: PalotSession[],
  connectionID: string,
): Promise<{ rootID: string; isRoot: boolean; lineage: PalotSession[] } | null> {
  const byID = new Map(sessions.map((session) => [session.id, session]));
  const initial = byID.get(sessionID) ?? (await palot.getSession(sessionID, connectionID));
  if (!initial) return null;
  let current: PalotSession = initial;
  const isRoot = current.parentID === null;
  const lineage = [current];
  const seen = new Set([current.id]);
  while (current.parentID && !seen.has(current.parentID)) {
    const parent: PalotSession | null =
      byID.get(current.parentID) ?? (await palot.getSession(current.parentID, connectionID));
    if (!parent) break;
    lineage.push(parent);
    seen.add(parent.id);
    current = parent;
  }
  return { rootID: current.id, isRoot, lineage };
}

export function useWorkspaceController(selectedSessionID: string | null) {
  const queryClient = useQueryClient();
  const store = useStore();
  const ownerProfileID = store.get(runtimeAtom)?.profileID ?? "unscoped";
  const alive = useRef(true);
  const selectedSession = useCatalogSession(selectedSessionID);
  const selectedSessionKey = selectedSession?.id ?? null;
  const setRuntime = useSetAtom(runtimeAtom);
  const setPhase = useSetAtom(phaseAtom);
  const setError = useSetAtom(errorAtom);
  const setActiveShells = useSetAtom(shellsForProfileAtom(ownerProfileID));
  const setSessionCatalogReady = useSetAtom(sessionCatalogReadyAtom);
  const setAttentionSyncState = useSetAtom(attentionSyncStateAtom);
  const setSessionTriageSnapshot = useSetAtom(sessionTriageSnapshotAtom);
  const setMessages = useSetAtom(messagesForProfileAtom(ownerProfileID));
  const setWorkspaceRecovery = useSetAtom(workspaceRecoveryAtom);
  const synchronization = useRef(new SessionSynchronization());
  const initialHydrationStarted = useRef(false);
  const connectionIDRef = useRef<string | null>(store.get(runtimeAtom)?.connectionID ?? null);
  const sessionViews = useRef(new SessionViewRetention());
  const selectedSessionRef = useRef(selectedSession);
  const selectedSessionIDRef = useRef(selectedSessionID);
  const cancelledInputIDs = useRef(new Map<string, Set<string>>());
  const attentionGeneration = useRef(0);
  const attentionRetry = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelAttention = useCallback(() => {
    attentionGeneration.current += 1;
    if (attentionRetry.current) clearTimeout(attentionRetry.current);
    attentionRetry.current = null;
  }, []);

  const refreshAttention = useCallback(
    (connectionID: string, workspaceCurrent: () => boolean) => {
      cancelAttention();
      const generation = attentionGeneration.current;
      const isCurrent = () =>
        alive.current &&
        attentionGeneration.current === generation &&
        store.get(runtimeAtom)?.connectionID === connectionID &&
        workspaceCurrent();
      setAttentionSyncState("syncing");
      setSessionCatalogReady(false);
      const attempt = async (retry: number) => {
        if (!isCurrent()) return;
        const reconciler = openCodeReconciler(queryClient);
        const snapshotToken = reconciler.beginSnapshot(connectionID);
        const knownSessions = sessionCatalogInfo(queryClient, connectionID).map(mapSession);
        const sessionIDs = new Set([
          ...knownSessions.map((session) => session.id),
          ...reconciler.requestMap(connectionID).keys(),
        ]);
        const updates = new Map(
          [...sessionIDs].map((id) => [
            id,
            queryClient.getQueryState(openCodeKeys.sessionRequests(connectionID, id))
              ?.dataUpdateCount ?? 0,
          ]),
        );
        try {
          const snapshot = await palot.loadAttentionSnapshot(knownSessions, connectionID);
          if (!isCurrent()) return;
          cacheSessions(queryClient, connectionID, snapshot.sessions);
          const requests = new Map(
            snapshot.requests.map((entry) => [entry.sessionID, entry.value]),
          );
          for (const session of snapshot.sessions) sessionIDs.add(session.id);
          for (const id of requests.keys()) sessionIDs.add(id);
          for (const sessionID of sessionIDs) {
            const value = requests.get(sessionID);
            if (!snapshot.complete && !value) continue;
            const count =
              queryClient.getQueryState(openCodeKeys.sessionRequests(connectionID, sessionID))
                ?.dataUpdateCount ?? 0;
            if (count > (updates.get(sessionID) ?? 0)) continue;
            const previous = reconciler.requests(connectionID, sessionID);
            if (!value && !previous) continue;
            const next = value ?? EMPTY_SESSION_REQUEST_SNAPSHOT;
            setSessionRequestSnapshot(
              queryClient,
              connectionID,
              sessionID,
              mergeAttentionRequests(previous, next, snapshot.complete),
              snapshotToken,
            );
          }
          if (snapshot.complete) {
            setAttentionSyncState("ready");
            setSessionCatalogReady(true);
            return;
          }
        } catch {
          if (!isCurrent()) return;
        }
        setAttentionSyncState("error");
        if (retry < 3) {
          attentionRetry.current = setTimeout(
            () => {
              attentionRetry.current = null;
              void attempt(retry + 1);
            },
            1000 * 2 ** retry,
          );
        }
      };
      void attempt(0);
    },
    [cancelAttention, queryClient, setAttentionSyncState, setSessionCatalogReady, store],
  );

  useEffect(() => {
    selectedSessionRef.current = selectedSession;
    selectedSessionIDRef.current = selectedSessionID;
  }, [selectedSession, selectedSessionID]);

  useEffect(() => {
    if (!selectedSessionID) return;
    sessionViews.current.touch(selectedSessionID);
    const connectionID = connectionIDRef.current;
    const activeSessionIDs = [
      ...sessionActivityData(queryClient, connectionID ?? "disconnected").execution,
    ]
      .filter(([, state]) => state.status === "running")
      .map(([sessionID]) => sessionID);
    const activeShellSessionIDs = [...store.get(activeShellsAtom).keys()];
    const retained = sessionViews.current.retained([
      selectedSessionID,
      ...activeSessionIDs,
      ...activeShellSessionIDs,
    ]);
    setMessages((current) => retainSessionViews(current, retained));
    setActiveShells((current) => retainSessionViews(current, retained));
  }, [queryClient, selectedSessionID, setActiveShells, setMessages, store]);

  const loadSession = useCallback(
    async (
      session: PalotSession,
      targets: SessionReconcileTargets = { messages: true, requests: false, diffs: false },
      messageMode: "rooted" | "recent" = "rooted",
    ) => {
      const token = synchronization.current.beginSessionSnapshot(session.id, targets);
      const connectionID = connectionIDRef.current;
      const transcriptToken =
        targets.messages && connectionID
          ? openCodeReconciler(queryClient).beginSnapshot(connectionID)
          : null;
      try {
        const result = await palot.loadSession(
          session,
          targets,
          messageMode,
          connectionID ?? undefined,
        );
        if (
          !alive.current ||
          (connectionID && store.get(runtimeAtom)?.connectionID !== connectionID)
        )
          return;
        if (
          result.messages &&
          synchronization.current.isCurrentSessionResource(token, "messages")
        ) {
          let messagesCurrent = true;
          if (connectionID) {
            await queryClient.cancelQueries({
              queryKey: transcriptQueryKey(connectionID, session.id),
              exact: true,
            });
            messagesCurrent =
              alive.current &&
              store.get(runtimeAtom)?.connectionID === connectionID &&
              synchronization.current.isCurrentSessionResource(token, "messages");
          }
          if (messagesCurrent) {
            const cancelled = cancelledInputIDs.current.get(session.id);
            const messages = cancelled
              ? {
                  ...result.messages,
                  data: result.messages.data.filter((message) => !cancelled.has(message.id)),
                }
              : result.messages;
            if (cancelled) {
              const returned = new Set(result.messages.data.map((message) => message.id));
              for (const inputID of cancelled) {
                if (!returned.has(inputID)) cancelled.delete(inputID);
              }
              if (cancelled.size === 0) cancelledInputIDs.current.delete(session.id);
            }
            const currentMessages = store.get(messagesAtom).get(session.id) ?? [];
            const resolvedConnectionID = connectionID ?? "disconnected";
            setTranscriptSnapshot(
              queryClient,
              resolvedConnectionID,
              session.id,
              messages,
              messageMode,
              transcriptToken ?? undefined,
            );
            const settled = new Set(messages.data.map((message) => message.id));
            const optimistic = currentMessages.filter(
              (message) => message.optimistic === true && !settled.has(message.id),
            );
            const combined = mergeTranscriptMessages(
              getTranscriptMessages(queryClient, resolvedConnectionID, session.id),
              optimistic,
            );
            setActiveShells((current) => reconcileShellSnapshot(current, session.id, combined));
            setMessages((current) => {
              const next = new Map(current);
              if (optimistic.length > 0) next.set(session.id, optimistic);
              else next.delete(session.id);
              return next;
            });
          }
        }
      } catch (error) {
        if (
          (targets.messages &&
            synchronization.current.isCurrentSessionResource(token, "messages")) ||
          (targets.diffs && synchronization.current.isCurrentSessionResource(token, "diffs"))
        ) {
          showErrorToast(`Could not load task "${session.title || session.id}"`, error);
        }
      }
    },
    [queryClient, setActiveShells, setMessages, store],
  );

  const hydrate = useCallback(
    async (refresh = false, connectInput?: Parameters<typeof palot.connectOpenCode>[0]) => {
      if (!refresh) {
        if (initialHydrationStarted.current) return;
        initialHydrationStarted.current = true;
      }
      const token = synchronization.current.beginWorkspaceSnapshot();
      cancelAttention();
      setAttentionSyncState("syncing");
      const previousConnection = connectionIDRef.current;
      if (previousConnection) {
        void queryClient.cancelQueries({
          queryKey: openCodeKeys.projects(previousConnection),
          exact: true,
        });
        void queryClient.cancelQueries({
          queryKey: openCodeKeys.sessionActivity(previousConnection),
          exact: true,
        });
      }
      if (!refresh) setPhase("loading");
      setSessionCatalogReady(false);
      setError(null);
      const focused = store.get(runtimeAtom);
      let focusedConnectionID = focused?.connectionID;
      const isCurrent = () =>
        alive.current &&
        synchronization.current.isCurrentWorkspaceSnapshot(token) &&
        store.get(runtimeAtom)?.connectionID === focusedConnectionID;
      if (
        focused &&
        !focused.connected &&
        !connectInput &&
        sessionCatalogInfo(queryClient, focused.connectionID).length > 0
      ) {
        connectionIDRef.current = focused.connectionID;
        setFocusedOpenCodeRuntime(focused);
        openCodeReconciler(queryClient).setFocusedConnection(focused.connectionID);
        setPhase("ready");
        setAttentionSyncState("error");
        return;
      }
      try {
        const result = palot.isPreview()
          ? await palot.hydratePreview()
          : await (async () => {
              let runtime = store.get(runtimeAtom) ?? (await palot.runtimeStatus());
              if (!runtime.connected)
                runtime =
                  !connectInput && window.palot?.connectOpenCodeProfile
                    ? await window.palot.connectOpenCodeProfile(runtime.profileID)
                    : await palot.connectOpenCode(connectInput);
              if (!isCurrent()) throw new Error("Workspace focus changed");
              registerOpenCodeRuntime(runtime);
              setFocusedOpenCodeRuntime(runtime);
              openCodeReconciler(queryClient).setFocusedConnection(runtime.connectionID);
              const previousConnectionID = connectionIDRef.current;
              if (previousConnectionID && previousConnectionID !== runtime.connectionID) {
                await queryClient.cancelQueries({
                  queryKey: openCodeKeys.all(previousConnectionID),
                });
              } else if (refresh) {
                await queryClient.cancelQueries({
                  queryKey: openCodeKeys.all(runtime.connectionID),
                });
                await queryClient.invalidateQueries({
                  queryKey: openCodeKeys.all(runtime.connectionID),
                  refetchType: "none",
                });
              }
              if (!isCurrent()) throw new Error("Workspace focus changed");
              focusedConnectionID = runtime.connectionID;
              connectionIDRef.current = runtime.connectionID;
              setRuntime(runtime);
              // Labels and detailed execution replay are independent of the recent-root view.
              void queryClient
                .fetchQuery({
                  ...projectsQueryOptions(queryClient, runtime.connectionID),
                  queryFn: async ({ signal }) => {
                    const reconciler = openCodeReconciler(queryClient);
                    const snapshotToken = reconciler.beginSnapshot(runtime.connectionID);
                    const projects = await listProjectInfo(signal, runtime.connectionID);
                    if (signal.aborted || !isCurrent()) throw new Error("Workspace focus changed");
                    reconciler.replaceProjects(runtime.connectionID, projects, snapshotToken);
                    return projects;
                  },
                })
                .catch(() => undefined);
              void queryClient
                .fetchQuery(sessionActivityQueryOptions(queryClient, runtime.connectionID))
                .catch(() => undefined);
              const rootCatalog = await queryClient.fetchInfiniteQuery(
                rootSessionsQueryOptions(queryClient, runtime.connectionID),
              );
              if (!isCurrent()) throw new Error("Workspace focus changed");
              const rootSessions = rootSessionInfo(rootCatalog);
              seedSessionDetails(queryClient, runtime.connectionID, rootSessions);
              const firstPage = rootCatalog.pages[0];
              return {
                runtime,
                projects: [],
                sessions: {
                  data: rootSessions.map(mapSession),
                  cursor: {
                    previous: firstPage?.cursor.previous ?? null,
                    next: firstPage?.cursor.next ?? null,
                  },
                },
                activeSessions: [],
              };
            })();
        if (!isCurrent()) return;
        const activeFamily = await withSessionAncestors(
          result.activeSessions,
          result.runtime.connectionID,
        );
        if (!isCurrent()) return;
        connectionIDRef.current = result.runtime.connectionID;
        const persistedSelectedSessionID = store.get(selectedSessionIDAtom);
        const restoredSessionID = selectedSessionIDRef.current ?? persistedSelectedSessionID;
        const restoredSessionKnown = Boolean(
          restoredSessionID &&
          (result.sessions.data.some((session) => session.id === restoredSessionID) ||
            activeFamily.some((session) => session.id === restoredSessionID)),
        );
        let restoreFailed = false;
        const restoredSession =
          restoredSessionID && !restoredSessionKnown
            ? palot.isPreview()
              ? await palot.getSession(restoredSessionID, result.runtime.connectionID)
              : await queryClient
                  .fetchQuery(
                    sessionQueryOptions(
                      queryClient,
                      result.runtime.connectionID,
                      restoredSessionID,
                    ),
                  )
                  .then((session) => (session ? mapSession(session) : null))
                  .catch(() => {
                    restoreFailed = true;
                    return null;
                  })
            : null;
        if (!isCurrent()) return;
        if (restoredSessionID && !restoredSessionKnown && !restoredSession && !restoreFailed) {
          store.set(selectedSessionIDAtom, null);
          if (selectedSessionIDRef.current === restoredSessionID) {
            selectedSessionIDRef.current = null;
          }
        }
        const restoredFamily = restoredSession
          ? await withSessionAncestors([restoredSession], result.runtime.connectionID)
          : [];
        if (!isCurrent()) return;
        const knownSessions = [...result.sessions.data, ...activeFamily, ...restoredFamily];
        if (palot.isPreview())
          cacheProjects(queryClient, result.runtime.connectionID, result.projects);
        cacheSessions(queryClient, result.runtime.connectionID, knownSessions);
        if (palot.isPreview()) {
          cacheRootSessions(
            queryClient,
            result.runtime.connectionID,
            result.sessions.data,
            result.sessions.cursor,
          );
        }
        focusedConnectionID = result.runtime.connectionID;
        setRuntime(result.runtime);
        refreshAttention(result.runtime.connectionID, isCurrent);
        setPhase("ready");
      } catch (error) {
        if (!isCurrent()) return;
        if (isCancelledError(error)) return;
        try {
          const runtime = await palot.runtimeStatus();
          if (!isCurrent()) return;
          focusedConnectionID = runtime.connectionID;
          setRuntime(runtime);
        } catch {
          // Preserve the connection error when runtime status is unavailable too.
        }
        if (!isCurrent()) return;
        setError(error instanceof Error ? error.message : "Could not connect to OpenCode");
        setAttentionSyncState("error");
        setPhase("error");
      }
    },
    [
      cancelAttention,
      refreshAttention,
      setAttentionSyncState,
      setError,
      setPhase,
      setRuntime,
      setSessionCatalogReady,
      queryClient,
      setMessages,
      store,
    ],
  );

  useEffect(() => {
    alive.current = true;
    let connectionID = store.get(runtimeAtom)?.connectionID;
    let connected = store.get(runtimeAtom)?.connected;
    const unsubscribeFocus = store.sub(runtimeAtom, () => {
      const runtime = store.get(runtimeAtom);
      const next = runtime?.connectionID;
      if (next === connectionID && runtime?.connected === connected) return;
      cancelAttention();
      setAttentionSyncState(runtime?.connected ? "syncing" : "error");
      setSessionCatalogReady(false);
      if (connectionID && (next !== connectionID || !runtime?.connected))
        void queryClient.cancelQueries({ queryKey: openCodeKeys.all(connectionID) });
      connectionID = next;
      connected = runtime?.connected;
    });
    return () => {
      alive.current = false;
      cancelAttention();
      unsubscribeFocus();
      if (connectionID)
        void queryClient.cancelQueries({ queryKey: openCodeKeys.all(connectionID) });
      synchronization.current.dispose();
    };
  }, [cancelAttention, queryClient, setAttentionSyncState, setSessionCatalogReady, store]);

  useEffect(() => {
    const recovery = {
      run: (input?: Parameters<typeof palot.connectOpenCode>[0]) => hydrate(true, input),
    };
    setWorkspaceRecovery(recovery);
    return () => setWorkspaceRecovery(null);
  }, [hydrate, setWorkspaceRecovery]);

  useEffect(() => {
    void hydrate();
    const applyBatch = ({ batch, result: ingestion }: OpenCodeAppliedBatch) => {
      if (batch.connectionID !== store.get(runtimeAtom)?.connectionID) return;
      recordReplicaApplied(batch, ingestion.changedTranscriptSessionIDs);
      connectionIDRef.current = batch.connectionID;

      for (const event of batch.events) {
        const data = record(event.data);
        if (!data) continue;
        const sessionID = typeof data.sessionID === "string" ? data.sessionID : null;
        if (!sessionID) continue;
        if (event.type === "session.inbox.cancelled" && typeof data.inboxID === "string") {
          const inputID = data.inboxID;
          const cancelled = cancelledInputIDs.current.get(sessionID) ?? new Set<string>();
          cancelled.add(inputID);
          cancelledInputIDs.current.set(sessionID, cancelled);
          synchronization.current.beginSessionSnapshot(sessionID, {
            messages: true,
            requests: false,
            diffs: false,
          });
          removeTranscriptCacheMessage(queryClient, batch.connectionID, sessionID, inputID);
          void queryClient
            .cancelQueries({
              queryKey: transcriptQueryKey(batch.connectionID, sessionID),
              exact: true,
            })
            .then(() =>
              removeTranscriptCacheMessage(queryClient, batch.connectionID, sessionID, inputID),
            );
          setMessages((current) => {
            const existing = current.get(sessionID);
            if (!existing?.some((message) => message.id === inputID)) return current;
            const next = new Map(current);
            const messages = existing.filter((message) => message.id !== inputID);
            if (messages.length > 0) next.set(sessionID, messages);
            else next.delete(sessionID);
            return next;
          });
        }
        if (event.type === "session.deleted") {
          synchronization.current.beginSessionSnapshot(sessionID, {
            messages: true,
            requests: true,
            diffs: true,
          });
          cancelledInputIDs.current.delete(sessionID);
          queryClient.removeQueries({
            queryKey: transcriptQueryKey(batch.connectionID, sessionID),
            exact: true,
          });
          setMessages((current) => {
            if (!current.has(sessionID)) return current;
            const next = new Map(current);
            next.delete(sessionID);
            return next;
          });
          if (store.get(selectedSessionIDAtom) === sessionID) {
            store.set(selectedSessionIDAtom, null);
          }
        }
      }

      setActiveShells((current) => applyShellEvents(current, batch.events));

      const runtimeEvent = batch.events.findLast((event) => event.type === "palot.runtime.status");
      if (runtimeEvent) setRuntime(runtimeEvent.data);

      const currentSession = selectedSessionRef.current;
      if (currentSession) {
        const recoverMissingMessage = ingestion.missingMessageSessionIDs.includes(
          currentSession.id,
        );
        const targets = sessionReconcileTargets(batch.events, currentSession.id);
        if (ingestion.gap) targets.requests = true;
        if (
          recoverMissingMessage ||
          ingestion.gap ||
          ingestion.gapSessionIDs.includes(currentSession.id)
        ) {
          targets.messages = true;
        }
        if (targets.messages || targets.requests || targets.diffs) {
          synchronization.current.scheduleSessionReconcile(
            currentSession.id,
            targets,
            (sessionID, pendingTargets) => {
              const session = sessionCatalogInfo(queryClient, batch.connectionID)
                .map(mapSession)
                .find((candidate) => candidate.id === sessionID);
              if (session) void loadSession(session, pendingTargets, "recent");
            },
          );
        }
      }

      const gapRecoverySessionIDs = new Set(ingestion.gapSessionIDs);
      if (ingestion.gap) {
        refreshAttention(batch.connectionID, () => true);
        for (const [sessionID, state] of sessionActivityData(queryClient, batch.connectionID)
          .execution) {
          if (state.status === "running") gapRecoverySessionIDs.add(sessionID);
        }
      }
      for (const sessionID of gapRecoverySessionIDs) {
        if (sessionID === currentSession?.id) continue;
        const session = sessionCatalogInfo(queryClient, batch.connectionID)
          .map(mapSession)
          .find((candidate) => candidate.id === sessionID);
        if (session) {
          void loadSession(session, { messages: true, requests: false, diffs: false }, "recent");
        }
      }

      const profileID = store.get(runtimeAtom)?.profileID;
      if (store.get(sidebarModeAtom) === "inbox" && profileID) {
        const knownSessions = sessionCatalogInfo(queryClient, batch.connectionID).map(mapSession);
        for (const event of batch.events) {
          const data = record(event.data);
          const sessionID = typeof data?.sessionID === "string" ? data.sessionID : undefined;
          if (!sessionID) continue;
          if (event.type !== "session.deleted" && event.type !== "session.inbox.enqueued") {
            continue;
          }
          const isCurrent = () =>
            alive.current && store.get(runtimeAtom)?.connectionID === batch.connectionID;
          void resolveSessionRoot(sessionID, knownSessions, batch.connectionID)
            .then(async (resolved) => {
              if (!resolved || !isCurrent()) return;
              if (event.type === "session.deleted") {
                if (!resolved.isRoot) return;
                return palot.dispatchSessionTriage({
                  type: "remove",
                  profileID,
                  sessionID: resolved.rootID,
                });
              }
              cacheSessions(queryClient, batch.connectionID, resolved.lineage);
              return palot.dispatchSessionTriage({
                type: "inbox",
                profileID,
                sessionID: resolved.rootID,
                at: Date.now(),
                activity: { updatedAt: event.createdAt, sessionID },
              });
            })
            .then((next) => {
              if (next && isCurrent() && store.get(runtimeAtom)?.profileID === next.profileID) {
                setSessionTriageSnapshot(next);
              }
            })
            .catch(() => undefined);
        }
      }
      const workspaceEvents = batch.events.filter((event) => event.type !== "server.connected");
      const initialConnectedOnly =
        batch.streamEpoch === 1 && batch.events.length > 0 && workspaceEvents.length === 0;
      if (
        store.get(phaseAtom) === "ready" &&
        ((ingestion.streamChanged && !initialConnectedOnly) ||
          needsWorkspaceReconcile(workspaceEvents))
      ) {
        synchronization.current.scheduleWorkspaceReconcile(() => {
          void hydrate(true).then(() => {
            const selected = selectedSessionRef.current;
            if (selected) void loadSession(selected, undefined, "recent");
          });
        });
      }
    };
    const unsubscribe = openCodeReconciler(queryClient).subscribe(applyBatch);
    return unsubscribe;
  }, [
    refreshAttention,
    hydrate,
    loadSession,
    queryClient,
    setActiveShells,
    setMessages,
    setSessionCatalogReady,
    setSessionTriageSnapshot,
    setRuntime,
    store,
  ]);

  useEffect(() => {
    if (!selectedSessionID) return;
    const connectionID = connectionIDRef.current;
    const selectedSession = connectionID
      ? sessionCatalogInfo(queryClient, connectionID)
          .map(mapSession)
          .find((session) => session.id === selectedSessionID)
      : null;
    if (!selectedSession) return;
    const cached = connectionID
      ? hasTranscript(queryClient, connectionID, selectedSession.id)
      : false;
    if (cached) {
      void loadSession(
        selectedSession,
        { messages: true, requests: false, diffs: false },
        "recent",
      );
    }
  }, [loadSession, queryClient, selectedSessionID, selectedSessionKey]);

  return { hydrate, loadSession };
}
