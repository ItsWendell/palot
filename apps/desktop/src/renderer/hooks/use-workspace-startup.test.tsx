import { QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, renderHook, waitFor } from "@testing-library/react";
import { createStore, Provider, useAtomValue } from "jotai";
import { afterEach, expect, it, vi } from "vitest";
import type { OpenCodeRuntimeStatus } from "../../shared";
import type { ConnectionOverview } from "../lib/connection-overview";
import { discoveredProfileIDsAtom, includedProfileIDsAtom } from "../atoms/connections";
import { phaseAtom, runtimeAtom, selectedSessionIDAtom } from "../atoms/workspace";
import { sessionCatalogReadyAtom } from "../atoms/inbox";
import { createRendererQueryClient } from "../lib/query-client";
import { rootSessionsQueryOptions } from "../lib/session-catalog-query";
import * as catalog from "../services/opencode-catalog";
import { resetOpenCodeClientForTest } from "../services/opencode-client";
import { palot } from "../services/palot";
import { useWorkspaceController } from "./use-workspace";
import { useConnectionOverviewController } from "./use-connection-overview";

const overview = vi.hoisted(() => ({
  entries: [] as ConnectionOverview[],
  listeners: new Set<() => void>(),
}));
vi.mock("@tanstack/react-router", () => ({ useRouterState: () => "/new" }));
vi.mock("../lib/connection-overview", () => ({ connectionOverview: () => controller }));
const controller = {
  getSnapshot: () => overview.entries,
  subscribe: (listener: () => void) => {
    overview.listeners.add(listener);
    return () => {
      overview.listeners.delete(listener);
    };
  },
  start: () => () => undefined,
  setIncluded: vi.fn(),
  refreshRegistry: vi.fn().mockResolvedValue(undefined),
  acceptTriage: vi.fn(),
  tick: vi.fn(),
};
afterEach(() => {
  cleanup();
  overview.listeners.clear();
  vi.restoreAllMocks();
  resetOpenCodeClientForTest();
});

it("adopts a completed enable for a stopped focused profile and still honors explicit disabling", async () => {
  const runtime: OpenCodeRuntimeStatus = {
    connectionID: "replacement",
    profileID: "local",
    connected: true,
    phase: "connected",
    contractVersion: "test",
    binaryPath: null,
    version: null,
    pid: null,
    managed: false,
    lastConnectedAt: 1,
    error: null,
    versionMismatch: null,
  };
  const store = createStore();
  const queryClient = createRendererQueryClient();
  store.set(runtimeAtom, {
    ...runtime,
    connectionID: "stopped",
    connected: false,
    phase: "stopped",
  });
  store.set(includedProfileIDsAtom, [runtime.profileID]);
  store.set(discoveredProfileIDsAtom, [runtime.profileID]);
  overview.entries = [
    {
      profile: { id: runtime.profileID, kind: "local", name: "Local" },
      runtime,
      phase: "ready",
      error: null,
      lastSyncedAt: null,
      projects: [],
      sessions: [],
      inbox: { pinned: [], inbox: [], snoozed: [], settled: [], nextSnoozeDeadline: null },
      hasMore: false,
      loadingMore: false,
      triageReady: true,
      attentionState: "ready",
    },
  ];
  renderHook(() => useConnectionOverviewController(), {
    wrapper: ({ children }) => (
      <QueryClientProvider client={queryClient}>
        <Provider store={store}>{children}</Provider>
      </QueryClientProvider>
    ),
  });
  await waitFor(() => expect(store.get(runtimeAtom)).toEqual(runtime));
  act(() => store.set(includedProfileIDsAtom, []));
  expect(store.get(runtimeAtom)).toMatchObject({
    connectionID: "replacement",
    connected: false,
    phase: "stopped",
  });
  queryClient.clear();
});

it("does not let an older registry status cancel startup hydration after the runtime has connected", async () => {
  const runtime: OpenCodeRuntimeStatus = {
    connectionID: "startup",
    profileID: "local",
    connected: true,
    phase: "connected",
    contractVersion: "test",
    binaryPath: null,
    version: null,
    pid: null,
    managed: false,
    lastConnectedAt: 1,
    error: null,
    versionMismatch: null,
  };
  const store = createStore();
  const queryClient = createRendererQueryClient();
  store.set(runtimeAtom, runtime);
  store.set(includedProfileIDsAtom, [runtime.profileID]);
  store.set(discoveredProfileIDsAtom, [runtime.profileID]);
  overview.entries = [
    {
      profile: { id: runtime.profileID, kind: "local", name: "Local" },
      runtime: { ...runtime, connected: false, phase: "connecting" },
      phase: "loading",
      error: null,
      lastSyncedAt: null,
      projects: [],
      sessions: [],
      inbox: { pinned: [], inbox: [], snoozed: [], settled: [], nextSnoozeDeadline: null },
      hasMore: false,
      loadingMore: false,
      triageReady: false,
      attentionState: "syncing",
    },
  ];
  const roots = Promise.withResolvers<void>();
  vi.spyOn(palot, "isPreview").mockReturnValue(false);
  vi.spyOn(palot, "runtimeStatus").mockResolvedValue(runtime);
  vi.spyOn(palot, "loadAttentionSnapshot").mockResolvedValue({
    complete: true,
    sessions: [],
    requests: [],
  });
  vi.spyOn(catalog, "listProjectInfo").mockResolvedValue([]);
  vi.spyOn(catalog, "listActiveSessionIDs").mockResolvedValue([]);
  const listRoots = vi.spyOn(catalog, "listRootSessionInfo").mockImplementation(async () => {
    await roots.promise;
    return { data: [], cursor: {} };
  });
  renderHook(
    () => {
      useWorkspaceController(null);
      useConnectionOverviewController();
    },
    {
      wrapper: ({ children }) => (
        <QueryClientProvider client={queryClient}>
          <Provider store={store}>{children}</Provider>
        </QueryClientProvider>
      ),
    },
  );
  await waitFor(() => expect(listRoots).toHaveBeenCalledOnce());
  expect(store.get(phaseAtom)).toBe("loading");
  await act(async () => {
    overview.entries = [{ ...overview.entries[0]!, runtime }];
    for (const listener of overview.listeners) listener();
  });
  await act(async () => {
    // The overview's shared catalog read succeeds after the stale registry delivery.
    const replacement = queryClient.fetchInfiniteQuery(
      rootSessionsQueryOptions(queryClient, runtime.connectionID),
    );
    roots.resolve();
    await replacement;
  });
  await waitFor(() => expect(store.get(phaseAtom)).toBe("ready"));
  expect(store.get(sessionCatalogReadyAtom)).toBe(true);
  expect(listRoots).toHaveBeenCalledOnce();
  queryClient.clear();
});

function WorkspaceController() {
  useWorkspaceController(null);
  return null;
}

function OwnerKeyedWorkspace() {
  const runtime = useAtomValue(runtimeAtom);
  return <WorkspaceController key={runtime?.connectionID} />;
}

function navigationRuntime(profileID: string): OpenCodeRuntimeStatus {
  return {
    connectionID: `connection-${profileID}`,
    profileID,
    connected: true,
    phase: "connected",
    contractVersion: "test",
    binaryPath: null,
    version: null,
    pid: null,
    managed: false,
    lastConnectedAt: 1,
    error: null,
    versionMismatch: null,
  };
}

it.each([false, true])(
  "keeps the shell ready across cached owner remounts (invalidated: %s)",
  async (invalidated) => {
    const store = createStore();
    const queryClient = createRendererQueryClient();
    const first = navigationRuntime("first");
    const second = navigationRuntime("second");
    store.set(runtimeAtom, first);
    store.set(phaseAtom, "ready");
    store.set(selectedSessionIDAtom, null);
    const session = (id: string) => ({
      id,
      projectID: "project",
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      time: { created: 1, updated: 1 },
      location: { directory: "/project" },
    });
    const retained = {
      pages: [
        { data: [session("recent")], cursor: { next: "older" } },
        { data: [session("older")], cursor: {} },
      ],
      pageParams: [null, "older"],
    };
    for (const runtime of [first, second]) {
      queryClient.setQueryData(
        rootSessionsQueryOptions(queryClient, runtime.connectionID).queryKey,
        retained,
      );
    }
    if (invalidated) {
      await queryClient.invalidateQueries({
        queryKey: rootSessionsQueryOptions(queryClient, second.connectionID).queryKey,
        refetchType: "none",
      });
    }
    const roots = Promise.withResolvers<Awaited<ReturnType<typeof catalog.listRootSessionInfo>>>();
    vi.spyOn(palot, "isPreview").mockReturnValue(false);
    vi.spyOn(catalog, "listProjectInfo").mockResolvedValue([]);
    vi.spyOn(catalog, "listActiveSessionIDs").mockResolvedValue([]);
    const listRoots = vi.spyOn(catalog, "listRootSessionInfo").mockReturnValue(roots.promise);
    const attention = vi.spyOn(palot, "loadAttentionSnapshot").mockResolvedValue({
      complete: true,
      sessions: [],
      requests: [],
    });
    const phases: string[] = [];
    const unsubscribe = store.sub(phaseAtom, () => phases.push(store.get(phaseAtom)));
    render(
      <QueryClientProvider client={queryClient}>
        <Provider store={store}>
          <OwnerKeyedWorkspace />
        </Provider>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(attention).toHaveBeenCalledTimes(1));
    act(() => store.set(runtimeAtom, second));
    await waitFor(() => expect(attention).toHaveBeenCalledTimes(2));
    expect(store.get(phaseAtom)).toBe("ready");
    expect(phases).toEqual([]);
    expect(listRoots).toHaveBeenCalledTimes(invalidated ? 1 : 0);
    expect(
      queryClient.getQueryData(rootSessionsQueryOptions(queryClient, second.connectionID).queryKey),
    ).toBe(retained);
    act(() => store.set(runtimeAtom, first));
    await waitFor(() => expect(attention).toHaveBeenCalledTimes(3));
    expect(phases).toEqual([]);
    expect(
      queryClient.getQueryData(rootSessionsQueryOptions(queryClient, second.connectionID).queryKey),
    ).toBe(retained);
    unsubscribe();
    queryClient.clear();
  },
);

it("loads an uncached owner without replacing the ready shell, including on failure", async () => {
  const store = createStore();
  const queryClient = createRendererQueryClient();
  const first = navigationRuntime("first");
  const second = navigationRuntime("uncached");
  store.set(runtimeAtom, first);
  store.set(phaseAtom, "ready");
  store.set(selectedSessionIDAtom, null);
  queryClient.setQueryData(rootSessionsQueryOptions(queryClient, first.connectionID).queryKey, {
    pages: [{ data: [], cursor: {} }],
    pageParams: [null],
  });
  vi.spyOn(palot, "isPreview").mockReturnValue(false);
  vi.spyOn(palot, "runtimeStatus").mockResolvedValue(second);
  vi.spyOn(catalog, "listProjectInfo").mockResolvedValue([]);
  vi.spyOn(catalog, "listActiveSessionIDs").mockResolvedValue([]);
  vi.spyOn(palot, "loadAttentionSnapshot").mockResolvedValue({
    complete: true,
    sessions: [],
    requests: [],
  });
  const roots = Promise.withResolvers<Awaited<ReturnType<typeof catalog.listRootSessionInfo>>>();
  const listRoots = vi.spyOn(catalog, "listRootSessionInfo").mockReturnValue(roots.promise);
  render(
    <QueryClientProvider client={queryClient}>
      <Provider store={store}>
        <OwnerKeyedWorkspace />
      </Provider>
    </QueryClientProvider>,
  );
  await act(async () => store.set(runtimeAtom, second));
  await waitFor(() => expect(listRoots).toHaveBeenCalledOnce());
  expect(store.get(phaseAtom)).toBe("ready");
  const key = rootSessionsQueryOptions(queryClient, second.connectionID).queryKey;
  expect(queryClient.getQueryState(key)?.fetchStatus).toBe("fetching");
  await act(async () => roots.reject(new Error("Owner catalog unavailable")));
  await waitFor(() => expect(queryClient.getQueryState(key)?.status).toBe("error"));
  expect(store.get(phaseAtom)).toBe("ready");
  queryClient.clear();
});
