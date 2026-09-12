import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import { useCallback, useMemo, useSyncExternalStore } from "react";
import type { OpenCodeRuntimeStatus, PalotProject, PalotSession } from "../../shared";
import { runtimeAtom, selectedSessionIDAtom } from "../atoms/workspace";
import {
  cacheSessions,
  childSessionsQueryOptions,
  projectsQueryOptions,
  rootSessionsQueryOptions,
  seedSessionDetails,
} from "../lib/session-catalog-query";
import { mapProject, mapSession } from "../services/opencode-mappers";
import { useOpenCodeRecords } from "./use-open-code-records";
import { openCodeReconciler } from "../lib/open-code-reconciler";
import { canFetchOpenCode } from "../lib/opencode-runtime-query";

class SessionCatalogSelection<T> {
  private initialized = false;
  private previous!: T;

  constructor(
    private readonly sessions: () => PalotSession[],
    private readonly select: (sessions: PalotSession[]) => T,
    private readonly equal: (left: T, right: T) => boolean,
  ) {}

  readonly getSnapshot = () => {
    const next = this.select(this.sessions());
    if (this.initialized && this.equal(this.previous, next)) return this.previous;
    this.initialized = true;
    this.previous = next;
    return next;
  };
}

export function useProjectCatalog(): PalotProject[] {
  return useProjectCatalogState().projects;
}

export function useProjectCatalogState() {
  const runtime = useAtomValue(runtimeAtom);
  const queryClient = useQueryClient();
  const connectionID = runtime?.connectionID ?? "disconnected";
  const query = useQuery({
    ...projectsQueryOptions(queryClient, connectionID),
    enabled: canFetchOpenCode(runtime),
  });
  const records = useOpenCodeRecords(connectionID, "project");
  const projects = useMemo(() => records.map((record) => mapProject(record.value)), [records]);
  return {
    projects,
    ready: query.data !== undefined,
    error: query.error,
    refetch: query.refetch,
  };
}

export function useSessionCatalog(): PalotSession[] {
  const runtime = useAtomValue(runtimeAtom);
  const connectionID = runtime?.connectionID ?? "disconnected";
  const records = useOpenCodeRecords(connectionID, "session");
  return useMemo(
    () =>
      records
        .map((record) => mapSession(record.value))
        .toSorted(
          (left, right) => right.updatedAt - left.updatedAt || left.id.localeCompare(right.id),
        ),
    [records],
  );
}

export function useSessionCatalogSelector<T>(
  select: (sessions: PalotSession[]) => T,
  equal: (left: T, right: T) => boolean = Object.is,
): T {
  const runtime = useAtomValue(runtimeAtom);
  const queryClient = useQueryClient();
  const connectionID = runtime?.connectionID ?? "disconnected";
  const reconciler = openCodeReconciler(queryClient);
  const selection = useMemo(
    () =>
      new SessionCatalogSelection(
        () => reconciler.sessions(connectionID).map(mapSession),
        select,
        equal,
      ),
    [connectionID, equal, reconciler, select],
  );
  const subscribe = useCallback(
    (notify: () => void) => {
      const subscription = reconciler.graph.collection.subscribeChanges((changes) => {
        if (
          changes.some(
            (change) =>
              change.value.connectionID === connectionID && change.value.kind === "session",
          )
        ) {
          notify();
        }
      });
      return () => subscription.unsubscribe();
    },
    [connectionID, reconciler],
  );
  return useSyncExternalStore(subscribe, selection.getSnapshot, selection.getSnapshot);
}

export function useCatalogSession(sessionID: string | null): PalotSession | null {
  const sessions = useSessionCatalog();
  return sessionID ? (sessions.find((session) => session.id === sessionID) ?? null) : null;
}

export function useCacheSession(owner?: OpenCodeRuntimeStatus | null) {
  const activeRuntime = useAtomValue(runtimeAtom);
  const runtime = owner === undefined ? activeRuntime : owner;
  const queryClient = useQueryClient();
  return useCallback(
    (session: PalotSession) => {
      cacheSessions(queryClient, runtime?.connectionID ?? "disconnected", [session]);
    },
    [queryClient, runtime?.connectionID],
  );
}

export function useSelectedSession(): PalotSession | null {
  return useCatalogSession(useAtomValue(selectedSessionIDAtom));
}

export function useChildSessions(parentID: string | null): PalotSession[] {
  const runtime = useAtomValue(runtimeAtom);
  const connectionID = runtime?.connectionID ?? "disconnected";
  const queryClient = useQueryClient();
  const catalog = useSessionCatalog();
  useQuery({
    ...childSessionsQueryOptions(queryClient, connectionID, parentID ?? ""),
    enabled: Boolean(parentID && canFetchOpenCode(runtime)),
  });
  return useMemo(() => {
    return catalog
      .filter((session) => session.parentID === parentID)
      .toSorted(
        (left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id),
      );
  }, [catalog, parentID]);
}

export function useRootSessionPagination() {
  const runtime = useAtomValue(runtimeAtom);
  const queryClient = useQueryClient();
  const activeConnectionID = runtime?.connectionID;
  const connectionID = activeConnectionID ?? "disconnected";
  const query = useInfiniteQuery({
    ...rootSessionsQueryOptions(queryClient, connectionID),
    enabled: canFetchOpenCode(runtime),
  });
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage } = query;
  const loadMore = useCallback(async () => {
    if (!hasNextPage || isFetchingNextPage || !activeConnectionID) return;
    const previousPages = data?.pages.length ?? 0;
    const result = await fetchNextPage();
    const page = result.data?.pages[previousPages];
    if (!page) return;
    seedSessionDetails(queryClient, activeConnectionID, page.data);
  }, [
    activeConnectionID,
    data?.pages.length,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    queryClient,
  ]);
  return {
    hasNextPage,
    isFetchingNextPage,
    loadMore,
  };
}
