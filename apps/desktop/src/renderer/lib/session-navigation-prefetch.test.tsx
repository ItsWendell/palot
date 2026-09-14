import { QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { Provider, createStore } from "jotai";
import { afterEach, expect, it, vi } from "vitest";
import type { OpenCodeRuntimeStatus } from "../../shared";
import { runtimeAtom } from "../atoms/workspace";
import { usePalotNavigation } from "../hooks/use-navigation";
import { transcriptQueryKey } from "../hooks/use-session-transcript";
import * as client from "../services/opencode-client";
import { palot } from "../services/palot";
import { connectionOverview } from "./connection-overview";
import { openCodeReconciler } from "./open-code-reconciler";
import { createRendererQueryClient } from "./query-client";
import { prefetchSessionNavigation } from "./session-navigation-prefetch";

const { navigate, preloadRoute } = vi.hoisted(() => ({
  navigate: vi.fn().mockResolvedValue(undefined),
  preloadRoute: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigate,
  useRouter: () => ({ preloadRoute }),
}));

function runtime(profileID: string): OpenCodeRuntimeStatus {
  return {
    profileID,
    connectionID: `connection-${profileID}`,
    connected: true,
    phase: "connected",
    contractVersion: "test",
    version: null,
    binaryPath: null,
    pid: null,
    managed: false,
    lastConnectedAt: 1,
    error: null,
    versionMismatch: null,
  };
}

function setup() {
  const queryClient = createRendererQueryClient();
  const local = runtime("local");
  const remote = runtime("remote");
  client.setFocusedOpenCodeRuntime(local);
  const focus = vi.spyOn(client, "setFocusedOpenCodeRuntime");
  vi.spyOn(connectionOverview(queryClient), "getSnapshot").mockReturnValue([
    {
      profile: {
        id: "remote",
        kind: "remote",
        name: "Remote",
        urls: ["https://remote.example"],
        credentialID: null,
        allowPlainHttp: false,
        lastSuccessfulUrl: null,
        lastConnectedAt: 1,
      },
      runtime: remote,
      phase: "ready",
      error: null,
      lastSyncedAt: 1,
      projects: [],
      sessions: [],
      inbox: { pinned: [], inbox: [], snoozed: [], settled: [], nextSnoozeDeadline: null },
      hasMore: false,
      loadingMore: false,
      triageReady: true,
      attentionState: "ready",
    },
  ]);
  for (const owner of [local, remote]) {
    openCodeReconciler(queryClient).upsertSessionInfos(owner.connectionID, [
      {
        id: "same-session",
        projectID: "project",
        title: owner.profileID,
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        time: { created: 1, updated: 1 },
        location: { directory: `/${owner.profileID}` },
      },
    ]);
  }
  const load = vi.spyOn(palot, "loadTranscript").mockImplementation(() => new Promise(() => {}));
  return { queryClient, local, remote, focus, load };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  client.resetOpenCodeClientForTest();
});

it("starts the cached remote owner before navigating, without waiting or changing focus", async () => {
  const { queryClient, local, remote, focus, load } = setup();
  const store = createStore();
  store.set(runtimeAtom, local);
  const { result, unmount } = renderHook(usePalotNavigation, {
    wrapper: ({ children }) => (
      <QueryClientProvider client={queryClient}>
        <Provider store={store}>{children}</Provider>
      </QueryClientProvider>
    ),
  });
  await act(async () => {
    await result.current.openSession("same-session", { profileID: "remote" });
  });
  expect(load).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ title: "remote", location: { directory: "/remote" } }),
    "rooted",
    expect.any(AbortSignal),
    remote.connectionID,
  );
  expect(load.mock.invocationCallOrder[0]).toBeLessThan(navigate.mock.invocationCallOrder[0]!);
  expect(focus).not.toHaveBeenCalled();
  expect(store.get(runtimeAtom)).toBe(local);
  await result.current.preloadSession("same-session", "remote");
  expect(load).toHaveBeenCalledTimes(1);
  unmount();
  queryClient.clear();
});

it.each(["disabled", "offline", "missing", "warm", "invalidated"])(
  "skips %s destinations",
  async (state) => {
    const { queryClient, local, remote, load } = setup();
    if (state === "offline") remote.connected = false;
    const key = transcriptQueryKey(remote.connectionID, "same-session");
    if (state === "warm" || state === "invalidated") {
      queryClient.setQueryData(key, {
        pages: [{ data: [], cursor: { previous: null, next: null } }],
        pageParams: [null],
      });
      if (state === "invalidated") await queryClient.invalidateQueries({ queryKey: key });
    }
    prefetchSessionNavigation(
      queryClient,
      state === "missing" ? "absent" : "same-session",
      "remote",
      local,
      state === "disabled" ? ["remote"] : [],
    );
    expect(load).not.toHaveBeenCalled();
    queryClient.clear();
  },
);

it("uses the active runtime without overview discovery", () => {
  const { queryClient, local, load } = setup();
  prefetchSessionNavigation(queryClient, "same-session", "local", local, []);
  expect(load).toHaveBeenCalledWith(
    expect.objectContaining({ title: "local" }),
    "rooted",
    expect.any(AbortSignal),
    local.connectionID,
  );
  expect(connectionOverview(queryClient).getSnapshot).not.toHaveBeenCalled();
  queryClient.clear();
});
