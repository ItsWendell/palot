import type { Project, SessionInfo, SessionsResponse } from "@opencode/client";
import {
  infiniteQueryOptions,
  queryOptions,
  type InfiniteData,
  type QueryClient,
} from "@tanstack/react-query";
import { openCodeKeys } from "./opencode-query";
import type { PalotEvent } from "../../shared";
import type { PalotProject, PalotSession } from "../../shared";
import {
  getSessionInfo,
  listChildSessionInfo,
  listProjectInfo,
  listRootSessionInfo,
} from "../services/opencode-catalog";
import {
  openCodeReconciler,
  projectInfoFromPalot,
  sessionInfoFromPalot,
} from "./open-code-reconciler";

export { projectInfoFromPalot, sessionInfoFromPalot } from "./open-code-reconciler";

export type RootSessionCatalogData = InfiniteData<SessionsResponse, string | null>;

const catalogTombstones = new WeakMap<QueryClient, Map<string, Set<string>>>();

function sessionTombstones(queryClient: QueryClient, connectionID: string): Set<string> {
  let connections = catalogTombstones.get(queryClient);
  if (!connections) {
    connections = new Map();
    catalogTombstones.set(queryClient, connections);
  }
  let tombstones = connections.get(connectionID);
  if (!tombstones) {
    tombstones = new Set();
    connections.set(connectionID, tombstones);
  }
  return tombstones;
}

function tombstonedSession(
  queryClient: QueryClient,
  connectionID: string,
  session: { id: string; parentID?: string | null },
): boolean {
  const tombstones = sessionTombstones(queryClient, connectionID);
  if (tombstones.has(session.id)) return true;
  if (!session.parentID || !tombstones.has(session.parentID)) return false;
  tombstones.add(session.id);
  return true;
}

function visibleSessions(
  queryClient: QueryClient,
  connectionID: string,
  sessions: readonly SessionInfo[],
): SessionInfo[] {
  return sessions.filter((session) => !tombstonedSession(queryClient, connectionID, session));
}

function mergeSessionInfo(
  current: SessionInfo | null | undefined,
  incoming: SessionInfo,
): SessionInfo {
  if (!current) return incoming;
  const newer = current.time.updated >= incoming.time.updated ? current : incoming;
  return {
    ...newer,
    time: {
      ...newer.time,
      ...(current.time.idle === undefined && incoming.time.idle === undefined
        ? {}
        : { idle: Math.max(current.time.idle ?? 0, incoming.time.idle ?? 0) }),
      ...(current.time.viewed === undefined && incoming.time.viewed === undefined
        ? {}
        : { viewed: Math.max(current.time.viewed ?? 0, incoming.time.viewed ?? 0) }),
    },
  };
}

export function projectsQueryOptions(queryClient: QueryClient, connectionID: string) {
  return queryOptions({
    queryKey: openCodeKeys.projects(connectionID),
    queryFn: async ({ signal }) => {
      const reconciler = openCodeReconciler(queryClient);
      const token = reconciler.beginSnapshot(connectionID);
      const projects = await listProjectInfo(signal, connectionID);
      reconciler.replaceProjects(connectionID, projects, token);
      return projects;
    },
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnMount: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  });
}

export async function reconcileSessionCatalog(
  queryClient: QueryClient,
  connectionID: string,
): Promise<void> {
  const beforeCatalog = sessionCatalogInfo(queryClient, connectionID);
  const before = new Set(
    rootSessionInfo(
      queryClient.getQueryData<RootSessionCatalogData>(openCodeKeys.rootSessions(connectionID)),
    ).map((session) => session.id),
  );
  await Promise.allSettled([
    queryClient.refetchQueries({
      queryKey: openCodeKeys.projects(connectionID),
      exact: true,
      type: "all",
    }),
    queryClient.refetchQueries({
      queryKey: openCodeKeys.rootSessions(connectionID),
      exact: true,
      type: "all",
    }),
  ]);
  const roots = rootSessionInfo(
    queryClient.getQueryData<RootSessionCatalogData>(openCodeKeys.rootSessions(connectionID)),
  );
  seedSessionDetails(queryClient, connectionID, roots);
  const current = new Set(roots.map((session) => session.id));
  const missingRoots = [...before].filter((sessionID) => !current.has(sessionID));
  const confirmations = await Promise.allSettled(
    missingRoots.map((sessionID) => getSessionInfo(sessionID, undefined, connectionID)),
  );
  for (const [index, confirmation] of confirmations.entries()) {
    const sessionID = missingRoots[index];
    if (!sessionID || confirmation.status === "rejected") continue;
    if (confirmation.value) {
      seedSessionDetails(queryClient, connectionID, [confirmation.value]);
      continue;
    }
    for (const deletedID of deletedSessionIDs(queryClient, connectionID, sessionID)) {
      removeSession(queryClient, connectionID, deletedID);
    }
  }
  const childrenByParent = new Map<string, SessionInfo[]>();
  for (const session of beforeCatalog) {
    if (!session.parentID) continue;
    const children = childrenByParent.get(session.parentID) ?? [];
    children.push(session);
    childrenByParent.set(session.parentID, children);
  }
  await Promise.all(
    [...childrenByParent].map(async ([parentID, previousChildren]) => {
      try {
        const children = await queryClient.fetchQuery({
          ...childSessionsQueryOptions(queryClient, connectionID, parentID),
          staleTime: 0,
        });
        seedSessionDetails(queryClient, connectionID, children);
        const childIDs = new Set(children.map((session) => session.id));
        for (const session of previousChildren) {
          if (childIDs.has(session.id)) continue;
          for (const deletedID of deletedSessionIDs(queryClient, connectionID, session.id)) {
            removeSession(queryClient, connectionID, deletedID);
          }
        }
      } catch {
        // Keep the last known child family when its reconciliation request fails.
      }
    }),
  );
}

export function rootSessionsQueryOptions(queryClient: QueryClient, connectionID: string) {
  return infiniteQueryOptions({
    queryKey: openCodeKeys.rootSessions(connectionID),
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam, signal }) => {
      const reconciler = openCodeReconciler(queryClient);
      const token = reconciler.beginSnapshot(connectionID);
      const page = await listRootSessionInfo(
        { limit: 50, ...(pageParam ? { cursor: pageParam } : {}) },
        signal,
        connectionID,
      );
      const data = visibleSessions(queryClient, connectionID, page.data);
      reconciler.upsertSessionInfos(connectionID, data, token);
      return { ...page, data };
    },
    getNextPageParam: (page, _pages, _lastPageParam, pageParams) => {
      const next = page.cursor.next ?? undefined;
      return next && !pageParams.includes(next) ? next : undefined;
    },
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnMount: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  });
}

export function sessionQueryOptions(
  queryClient: QueryClient,
  connectionID: string,
  sessionID: string,
) {
  return queryOptions({
    queryKey: openCodeKeys.session(connectionID, sessionID),
    queryFn: async ({ signal }) => {
      const reconciler = openCodeReconciler(queryClient);
      const token = reconciler.beginSnapshot(connectionID);
      const session = await getSessionInfo(sessionID, signal, connectionID);
      const visible =
        session && !tombstonedSession(queryClient, connectionID, session) ? session : null;
      if (visible) reconciler.upsertSessionInfos(connectionID, [visible], token);
      return visible;
    },
    enabled: Boolean(sessionID),
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnMount: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  });
}

export function childSessionsQueryOptions(
  queryClient: QueryClient,
  connectionID: string,
  parentID: string,
) {
  return queryOptions({
    queryKey: openCodeKeys.childSessions(connectionID, parentID),
    queryFn: async ({ signal }) => {
      const reconciler = openCodeReconciler(queryClient);
      const token = reconciler.beginSnapshot(connectionID);
      const sessions = await listChildSessionInfo(parentID, signal, connectionID);
      const visible = sessionTombstones(queryClient, connectionID).has(parentID)
        ? []
        : visibleSessions(queryClient, connectionID, sessions);
      reconciler.upsertSessionInfos(connectionID, visible, token);
      return visible;
    },
    enabled: Boolean(parentID),
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnMount: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  });
}

export function seedSessionDetails(
  queryClient: QueryClient,
  connectionID: string,
  sessions: readonly SessionInfo[],
): void {
  openCodeReconciler(queryClient).upsertSessionInfos(connectionID, sessions);
  for (const session of sessions) {
    if (tombstonedSession(queryClient, connectionID, session)) {
      for (const deletedID of deletedSessionIDs(queryClient, connectionID, session.id)) {
        removeSession(queryClient, connectionID, deletedID);
      }
      continue;
    }
    queryClient.setQueryData<SessionInfo | null>(
      openCodeKeys.session(connectionID, session.id),
      (current) => mergeSessionInfo(current, session),
    );
  }
}

export function rootSessionInfo(data: RootSessionCatalogData | undefined): SessionInfo[] {
  if (!data) return [];
  const byID = new Map<string, SessionInfo>();
  for (const page of data.pages) {
    for (const session of page.data) byID.set(session.id, session);
  }
  return [...byID.values()].toSorted(
    (left, right) => right.time.updated - left.time.updated || left.id.localeCompare(right.id),
  );
}

export function sessionCatalogInfo(queryClient: QueryClient, connectionID: string): SessionInfo[] {
  return openCodeReconciler(queryClient).sessions(connectionID);
}

export function cacheSession(
  queryClient: QueryClient,
  connectionID: string,
  session: PalotSession,
): void {
  openCodeReconciler(queryClient).upsertPalotSessions(connectionID, [session]);
  if (tombstonedSession(queryClient, connectionID, session)) {
    for (const deletedID of deletedSessionIDs(queryClient, connectionID, session.id)) {
      removeSession(queryClient, connectionID, deletedID);
    }
    return;
  }
  queryClient.setQueryData<SessionInfo | null>(
    openCodeKeys.session(connectionID, session.id),
    (current) => sessionInfoFromPalot(session, current),
  );
}

export function cacheSessions(
  queryClient: QueryClient,
  connectionID: string,
  sessions: readonly PalotSession[],
): void {
  const reconciler = openCodeReconciler(queryClient);
  // Hydration snapshots can finish after live metadata events. Unlike an
  // acknowledged single-session mutation, a snapshot must not overwrite them.
  seedSessionDetails(
    queryClient,
    connectionID,
    sessions.map((session) =>
      sessionInfoFromPalot(session, reconciler.session(connectionID, session.id)),
    ),
  );
}

function insertSessionInfo(
  queryClient: QueryClient,
  connectionID: string,
  session: SessionInfo,
): void {
  queryClient.setQueryData<SessionInfo | null>(
    openCodeKeys.session(connectionID, session.id),
    (current) => mergeSessionInfo(current, session),
  );
  if (session.parentID) {
    queryClient.setQueryData<SessionInfo[]>(
      openCodeKeys.childSessions(connectionID, session.parentID),
      (current) =>
        current
          ? [...current.filter((candidate) => candidate.id !== session.id), session].toSorted(
              (left, right) => left.time.created - right.time.created,
            )
          : current,
    );
    return;
  }
  queryClient.setQueryData<RootSessionCatalogData>(
    openCodeKeys.rootSessions(connectionID),
    (current) => {
      if (!current?.pages[0]) return current;
      const pages = current.pages.map((page) => ({
        ...page,
        data: page.data.filter((candidate) => candidate.id !== session.id),
      }));
      const first = pages[0];
      if (!first) return current;
      const updatedFirst = {
        ...first,
        data: [session, ...first.data].toSorted(
          (left, right) =>
            right.time.updated - left.time.updated || left.id.localeCompare(right.id),
        ),
      };
      return { ...current, pages: [updatedFirst, ...pages.slice(1)] };
    },
  );
}

export function cacheRootSessions(
  queryClient: QueryClient,
  connectionID: string,
  sessions: readonly PalotSession[],
  cursor: { previous?: string | null; next?: string | null } = {},
): void {
  openCodeReconciler(queryClient).upsertPalotSessions(connectionID, sessions);
  queryClient.setQueryData<RootSessionCatalogData>(openCodeKeys.rootSessions(connectionID), {
    pages: [
      {
        data: sessions
          .filter((session) => session.parentID === null)
          .map((session) => sessionInfoFromPalot(session)),
        cursor: {
          ...(cursor.previous ? { previous: cursor.previous } : {}),
          ...(cursor.next ? { next: cursor.next } : {}),
        },
      },
    ],
    pageParams: [null],
  });
}

export function cacheProjects(
  queryClient: QueryClient,
  connectionID: string,
  projects: readonly PalotProject[],
): void {
  const current = queryClient.getQueryData<Project[]>(openCodeKeys.projects(connectionID));
  const previous = new Map(current?.map((project) => [project.id, project]));
  const values = projects.map((project) => projectInfoFromPalot(project, previous.get(project.id)));
  openCodeReconciler(queryClient).replaceProjects(connectionID, values);
  queryClient.setQueryData(openCodeKeys.projects(connectionID), values);
}

export function patchSession(
  queryClient: QueryClient,
  connectionID: string,
  sessionID: string,
  update: (session: SessionInfo) => SessionInfo,
): void {
  openCodeReconciler(queryClient).patchSession(connectionID, sessionID, update);
  queryClient.setQueryData<SessionInfo | null>(
    openCodeKeys.session(connectionID, sessionID),
    (current) => (current ? update(current) : current),
  );
  queryClient.setQueryData<RootSessionCatalogData>(
    openCodeKeys.rootSessions(connectionID),
    (current) =>
      current
        ? {
            ...current,
            pages: current.pages.map((page) => ({
              ...page,
              data: page.data.map((session) =>
                session.id === sessionID ? update(session) : session,
              ),
            })),
          }
        : current,
  );
  for (const [queryKey] of queryClient.getQueriesData({
    queryKey: [...openCodeKeys.sessions(connectionID), "children"],
  })) {
    queryClient.setQueryData<SessionInfo[]>(queryKey, (current) =>
      current?.map((session) => (session.id === sessionID ? update(session) : session)),
    );
  }
}

export function removeSession(
  queryClient: QueryClient,
  connectionID: string,
  sessionID: string,
): void {
  const session = sessionCatalogInfo(queryClient, connectionID).find(
    (candidate) => candidate.id === sessionID,
  );
  openCodeReconciler(queryClient).removeSession(connectionID, sessionID);
  sessionTombstones(queryClient, connectionID).add(sessionID);
  if (session?.parentID) {
    void queryClient.cancelQueries({
      queryKey: openCodeKeys.childSessions(connectionID, session.parentID),
      exact: true,
    });
  } else {
    void queryClient.cancelQueries({
      queryKey: openCodeKeys.rootSessions(connectionID),
      exact: true,
    });
  }
  void queryClient.cancelQueries({
    queryKey: openCodeKeys.childSessions(connectionID, sessionID),
    exact: true,
  });
  queryClient.removeQueries({ queryKey: openCodeKeys.session(connectionID, sessionID) });
  queryClient.removeQueries({ queryKey: openCodeKeys.transcript(connectionID, sessionID) });
  queryClient.removeQueries({ queryKey: openCodeKeys.sessionRequests(connectionID, sessionID) });
  queryClient.setQueryData<RootSessionCatalogData>(
    openCodeKeys.rootSessions(connectionID),
    (current) =>
      current
        ? {
            ...current,
            pages: current.pages.map((page) => ({
              ...page,
              data: page.data.filter((session) => session.id !== sessionID),
            })),
          }
        : current,
  );
  for (const [queryKey] of queryClient.getQueriesData({
    queryKey: [...openCodeKeys.sessions(connectionID), "children"],
  })) {
    queryClient.setQueryData<SessionInfo[]>(queryKey, (current) =>
      current?.filter((session) => session.id !== sessionID),
    );
  }
}

function deletedSessionIDs(
  queryClient: QueryClient,
  connectionID: string,
  sessionID: string,
): string[] {
  const sessions = sessionCatalogInfo(queryClient, connectionID);
  const children = new Map<string, string[]>();
  for (const session of sessions) {
    if (!session.parentID) continue;
    const ids = children.get(session.parentID) ?? [];
    ids.push(session.id);
    children.set(session.parentID, ids);
  }
  const deleted = [sessionID];
  for (let index = 0; index < deleted.length; index += 1) {
    deleted.push(...(children.get(deleted[index]!) ?? []));
  }
  return deleted;
}

export function markSessionViewed(
  queryClient: QueryClient,
  connectionID: string,
  sessionID: string,
  idle: number,
): void {
  patchSession(queryClient, connectionID, sessionID, (session) => ({
    ...session,
    time: { ...session.time, viewed: idle },
  }));
}

export function applyOpenCodeCatalogEvent(
  queryClient: QueryClient,
  connectionID: string,
  event: PalotEvent,
): void {
  if (event.type === "session.created") {
    sessionTombstones(queryClient, connectionID).delete(event.data.sessionID);
    insertSessionInfo(queryClient, connectionID, {
      id: event.data.sessionID,
      ...(event.data.parentID ? { parentID: event.data.parentID } : {}),
      projectID: event.data.projectID,
      ...(event.data.agent ? { agent: event.data.agent } : {}),
      ...(event.data.model ? { model: event.data.model } : {}),
      ...(event.data.permissions === undefined ? {} : { permissions: event.data.permissions }),
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      time: { created: event.createdAt, updated: event.createdAt },
      ...(event.data.title ? { title: event.data.title } : {}),
      location: event.data.location,
      ...(event.data.subpath ? { subpath: event.data.subpath } : {}),
    });
    return;
  }
  if (event.type === "session.deleted") {
    for (const sessionID of deletedSessionIDs(queryClient, connectionID, event.data.sessionID)) {
      removeSession(queryClient, connectionID, sessionID);
    }
    return;
  }
  if (event.type === "session.execution.started") {
    patchSession(queryClient, connectionID, event.data.sessionID, (session) => {
      const { outcome: _outcome, ...current } = session;
      return {
        ...current,
        time: { ...session.time, updated: Math.max(session.time.updated, event.createdAt) },
      };
    });
    return;
  }
  if (event.type === "session.renamed") {
    patchSession(queryClient, connectionID, event.data.sessionID, (session) => ({
      ...session,
      title: event.data.title,
      time: { ...session.time, updated: Math.max(session.time.updated, event.createdAt) },
    }));
    return;
  }
  if (event.type === "session.moved") {
    patchSession(queryClient, connectionID, event.data.sessionID, (session) => ({
      ...session,
      projectID: event.data.projectID,
      location: event.data.location,
      ...(event.data.subpath ? { subpath: event.data.subpath } : {}),
      time: { ...session.time, updated: Math.max(session.time.updated, event.createdAt) },
    }));
    return;
  }
  if (event.type === "session.model.selected") {
    patchSession(queryClient, connectionID, event.data.sessionID, (session) => ({
      ...session,
      model: event.data.model,
      time: { ...session.time, updated: Math.max(session.time.updated, event.createdAt) },
    }));
    return;
  }
  if (event.type === "session.permissions") {
    patchSession(queryClient, connectionID, event.data.sessionID, (session) => ({
      ...session,
      permissions: event.data.permissions,
      time: { ...session.time, updated: Math.max(session.time.updated, event.createdAt) },
    }));
    return;
  }
  if (event.type === "session.agent.selected") {
    patchSession(queryClient, connectionID, event.data.sessionID, (session) => ({
      ...session,
      agent: event.data.agent,
      time: { ...session.time, updated: Math.max(session.time.updated, event.createdAt) },
    }));
    return;
  }
  if (event.type === "session.usage.updated") {
    patchSession(queryClient, connectionID, event.data.sessionID, (session) => ({
      ...session,
      cost: event.data.cost,
      tokens: event.data.tokens,
      time: { ...session.time, updated: Math.max(session.time.updated, event.createdAt) },
    }));
    return;
  }
  if (event.type === "session.inbox.delivered") {
    patchSession(queryClient, connectionID, event.data.sessionID, (session) => ({
      ...session,
      time: { ...session.time, updated: event.createdAt },
    }));
    return;
  }
  if (event.type === "session.revert.staged") {
    patchSession(queryClient, connectionID, event.data.sessionID, (session) => ({
      ...session,
      revert: event.data.revert,
      time: { ...session.time, updated: Math.max(session.time.updated, event.createdAt) },
    }));
    return;
  }
  if (event.type === "session.revert.cleared" || event.type === "session.revert.committed") {
    patchSession(queryClient, connectionID, event.data.sessionID, (session) => ({
      ...session,
      revert: undefined,
      time: { ...session.time, updated: Math.max(session.time.updated, event.createdAt) },
    }));
    return;
  }
  if (
    event.type === "session.idle" ||
    (event.type === "session.status" && event.data.status.type === "idle")
  ) {
    patchSession(queryClient, connectionID, event.data.sessionID, (session) => ({
      ...session,
      time: {
        ...session.time,
        updated: Math.max(session.time.updated, event.createdAt),
        idle: Math.max(session.time.idle ?? 0, event.createdAt),
      },
    }));
    return;
  }
  if (
    event.type === "session.execution.succeeded" ||
    event.type === "session.execution.failed" ||
    event.type === "session.execution.interrupted"
  ) {
    const outcome =
      event.type === "session.execution.succeeded"
        ? "succeeded"
        : event.type === "session.execution.failed"
          ? event.data.error.type === "MessageAbortedError"
            ? "interrupted"
            : "failed"
          : "interrupted";
    patchSession(queryClient, connectionID, event.data.sessionID, (session) => ({
      ...session,
      outcome,
      time: {
        ...session.time,
        updated: Math.max(session.time.updated, event.createdAt),
        idle: Math.max(session.time.idle ?? 0, event.createdAt),
      },
    }));
    return;
  }
  if (event.type === "session.viewed") {
    markSessionViewed(queryClient, connectionID, event.data.sessionID, event.data.idle);
  }
}
