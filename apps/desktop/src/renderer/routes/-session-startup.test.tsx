import type { SessionInfo } from "@opencode/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { afterEach, expect, it, vi } from "vitest";
import type { OpenCodeRuntimeStatus } from "../../shared";
import { phaseAtom, runtimeAtom, selectedSessionIDAtom } from "../atoms/workspace";
import { useSessionInfo } from "../hooks/use-session-info";
import { useWorkspaceController } from "../hooks/use-workspace";
import { openCodeKeys } from "../lib/opencode-query";
import { createRendererQueryClient } from "../lib/query-client";
import * as catalog from "../services/opencode-catalog";
import { resetOpenCodeClientForTest } from "../services/opencode-client";
import { palot } from "../services/palot";
import { Route } from "./_workspace.sessions.$sessionID";

vi.mock("../components/thread", () => ({ Thread: () => null }));

const connected: OpenCodeRuntimeStatus = {
  connectionID: "startup-connection",
  profileID: "startup-profile",
  phase: "connected",
  connected: true,
  contractVersion: "test",
  version: "test",
  binaryPath: null,
  pid: null,
  managed: false,
  lastConnectedAt: 1,
  error: null,
  versionMismatch: null,
};

const selected: SessionInfo = {
  id: "selected-outside-recent-page",
  projectID: "project",
  title: "Current task",
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: 1, updated: 1 },
  location: { directory: "/project" },
};

afterEach(() => {
  cleanup();
  resetOpenCodeClientForTest();
  vi.restoreAllMocks();
});

it.each(["connecting", "unknown"])(
  "defers an initial task route while runtime is %s and loads the selected task after connect",
  async (initial) => {
    const store = createStore();
    const queryClient = createRendererQueryClient();
    const connecting = { ...connected, connected: false, phase: "connecting" as const };
    store.set(runtimeAtom, initial === "connecting" ? connecting : null);
    store.set(selectedSessionIDAtom, selected.id);
    const connection = Promise.withResolvers<OpenCodeRuntimeStatus>();
    const projects = Promise.withResolvers<Awaited<ReturnType<typeof catalog.listProjectInfo>>>();
    let connectionResolved = false;
    vi.spyOn(palot, "isPreview").mockReturnValue(false);
    vi.spyOn(palot, "runtimeStatus").mockResolvedValue(connecting);
    const connect = vi.spyOn(palot, "connectOpenCode").mockReturnValue(connection.promise);
    const fallbackGet = vi.spyOn(palot, "getSession");
    const getSession = vi.spyOn(catalog, "getSessionInfo").mockImplementation(async () => {
      if (!connectionResolved) throw new Error("OpenCode request target is not connected");
      return selected;
    });
    vi.spyOn(catalog, "listRootSessionInfo").mockResolvedValue({ data: [], cursor: {} });
    vi.spyOn(catalog, "listProjectInfo").mockReturnValue(projects.promise);
    vi.spyOn(catalog, "listActiveSessionIDs").mockResolvedValue([]);
    vi.spyOn(palot, "loadAttentionSnapshot").mockResolvedValue({
      sessions: [],
      requests: [],
      complete: true,
    });
    const loader = Route.options.loader;
    if (typeof loader !== "function") throw new Error("Session route loader is required");
    await expect(
      loader({
        context: { store, queryClient },
        params: { sessionID: selected.id },
        deps: {},
        preload: false,
        cause: "enter",
        abortController: new AbortController(),
      } as Parameters<typeof loader>[0]),
    ).resolves.toBeUndefined();
    expect(getSession).not.toHaveBeenCalled();
    expect(fallbackGet).not.toHaveBeenCalled();
    expect(
      queryClient.getQueryState(openCodeKeys.session(connected.connectionID, selected.id)),
    ).toBeUndefined();

    const hook = renderHook(
      () => {
        useWorkspaceController(selected.id);
        return useSessionInfo(selected.id);
      },
      {
        wrapper: ({ children }) => (
          <QueryClientProvider client={queryClient}>
            <Provider store={store}>{children}</Provider>
          </QueryClientProvider>
        ),
      },
    );
    await waitFor(() => expect(connect).toHaveBeenCalledOnce());
    expect(getSession).not.toHaveBeenCalled();
    await act(async () => {
      connectionResolved = true;
      connection.resolve(connected);
    });
    await waitFor(() => expect(store.get(phaseAtom)).toBe("ready"));
    await waitFor(() => expect(hook.result.current.data?.title).toBe("Current task"));
    expect(hook.result.current.error).toBeNull();
    expect(store.get(selectedSessionIDAtom)).toBe(selected.id);
    expect(getSession).toHaveBeenCalledExactlyOnceWith(
      selected.id,
      expect.any(AbortSignal),
      connected.connectionID,
    );
    expect(
      queryClient.getQueryState(openCodeKeys.projects(connected.connectionID))?.fetchStatus,
    ).toBe("fetching");
    await act(async () => projects.resolve([]));
  },
);

it("still reports a real session lookup failure on a connected route", async () => {
  const store = createStore();
  store.set(runtimeAtom, connected);
  const queryClient = createRendererQueryClient();
  vi.spyOn(palot, "isPreview").mockReturnValue(false);
  const failure = new Error("Session lookup failed");
  vi.spyOn(catalog, "getSessionInfo").mockRejectedValue(failure);
  const loader = Route.options.loader;
  if (typeof loader !== "function") throw new Error("Session route loader is required");
  await expect(
    loader({
      context: { store, queryClient },
      params: { sessionID: selected.id },
      deps: {},
      preload: false,
      cause: "enter",
      abortController: new AbortController(),
    } as Parameters<typeof loader>[0]),
  ).rejects.toBe(failure);
});
