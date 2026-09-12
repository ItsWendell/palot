import type { OpenCodeClient } from "@opencode/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { Provider, createStore } from "jotai";
import { render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runtimeAtom } from "../atoms/workspace";
import type { OpenCodeRuntimeStatus } from "../../shared";
import { createRendererQueryClient } from "../lib/query-client";
import {
  registerOpenCodeRuntime,
  setFocusedOpenCodeRuntime,
  resetOpenCodeClientForTest,
  setOpenCodeClientForTest,
} from "../services/opencode-client";
import {
  ownedVcsLocationKey,
  useOwnedVcsInfoMap,
  useVcsInfo,
  useVcsInfoMap,
  useVcsStatusMap,
  vcsLocationKey,
  vcsQueryKey,
} from "./use-vcs-info";

const location = { directory: "/repo", workspaceID: "workspace-1" };

afterEach(() => {
  resetOpenCodeClientForTest();
  Reflect.deleteProperty(window, "palot");
});

describe("OpenCode VCS queries", () => {
  it("deduplicates visible locations by owner without borrowing the focused connection", async () => {
    const runtime = (connectionID: string) =>
      ({ connectionID, profileID: `profile-${connectionID}` }) as OpenCodeRuntimeStatus;
    registerOpenCodeRuntime(runtime("a"));
    registerOpenCodeRuntime(runtime("b"));
    setFocusedOpenCodeRuntime(runtime("elsewhere"));
    const openCodeRequest = vi.fn(async ({ connectionID }: { connectionID: string }) => ({
      status: 200,
      statusText: "OK",
      headers: { "content-type": "application/json" },
      body: new TextEncoder().encode(
        JSON.stringify({
          data: { branch: { current: connectionID === "a" ? "feature/a" : null, default: "main" } },
        }),
      ).buffer,
    }));
    Object.defineProperty(window, "palot", {
      configurable: true,
      value: { openCodeRequest, cancelOpenCodeRequest: vi.fn() },
    });
    const a = { connectionID: "a", location };
    const b = { connectionID: "b", location };
    const queryClient = createRendererQueryClient();
    function Probe({ visible = true }: { visible?: boolean }) {
      const branches = useOwnedVcsInfoMap(visible ? [a, b, a] : []);
      return (
        <span>
          {branches.get(ownedVcsLocationKey(a))?.currentBranch}/
          {branches.has(ownedVcsLocationKey(b)) ? "detached" : "loading"}
        </span>
      );
    }
    const result = render(
      <QueryClientProvider client={queryClient}>
        <Probe />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(result.getByText("feature/a/detached")).toBeTruthy());
    expect(openCodeRequest).toHaveBeenCalledTimes(2);
    expect(openCodeRequest.mock.calls.map(([request]) => request.connectionID).sort()).toEqual([
      "a",
      "b",
    ]);
    expect(queryClient.getQueryData(vcsQueryKey("a", location))).toMatchObject({
      currentBranch: "feature/a",
    });
    expect(queryClient.getQueryData(vcsQueryKey("b", location))).toMatchObject({
      currentBranch: null,
    });
    result.rerender(
      <QueryClientProvider client={queryClient}>
        <Probe visible={false} />
      </QueryClientProvider>,
    );
    result.rerender(
      <QueryClientProvider client={queryClient}>
        <Probe />
      </QueryClientProvider>,
    );
    expect(result.getByText("feature/a/detached")).toBeTruthy();
    expect(openCodeRequest).toHaveBeenCalledTimes(2);
    result.unmount();
    queryClient.clear();
  });

  it("deduplicates branch reads across single and batched consumers", async () => {
    const get = vi.fn().mockResolvedValue({
      data: { branch: { current: "feature/inbox", default: "main" } },
    });
    setOpenCodeClientForTest({ vcs: { get } } as unknown as OpenCodeClient);
    const store = createStore();
    store.set(runtimeAtom, {
      connectionID: "connection-1",
      profileID: "local-default",
      contractVersion: "0.0.0-beta-19425",
      phase: "connected",
      connected: true,
      binaryPath: null,
      version: "0.0.0-beta-19425",
      pid: 1,
      managed: false,
      lastConnectedAt: 1,
      error: null,
      versionMismatch: null,
    });
    const queryClient = createRendererQueryClient();

    function Probe() {
      const single = useVcsInfo(location);
      const batch = useVcsInfoMap([location]);
      return (
        <span>{single.data?.currentBranch ?? batch.values().next().value?.currentBranch}</span>
      );
    }

    const result = render(
      <QueryClientProvider client={queryClient}>
        <Provider store={store}>
          <Probe />
        </Provider>
      </QueryClientProvider>,
    );

    await waitFor(() => expect(result.getByText("feature/inbox")).toBeTruthy());
    expect(get).toHaveBeenCalledOnce();
    expect(get).toHaveBeenCalledWith(
      { location: { directory: "/repo", workspace: "workspace-1" } },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("loads working status for managed worktree indicators", async () => {
    const status = vi.fn().mockResolvedValue({
      data: [{ file: "src/app.ts", additions: 2, deletions: 1, status: "modified" }],
    });
    setOpenCodeClientForTest({ vcs: { status } } as unknown as OpenCodeClient);
    const store = createStore();
    store.set(runtimeAtom, {
      connectionID: "connection-1",
      profileID: "local-default",
      contractVersion: "0.0.0-beta-19425",
      phase: "connected",
      connected: true,
      binaryPath: null,
      version: "0.0.0-beta-19425",
      pid: 1,
      managed: false,
      lastConnectedAt: 1,
      error: null,
      versionMismatch: null,
    });

    function Probe() {
      const statuses = useVcsStatusMap([location]);
      return <span>{statuses.get(vcsLocationKey(location))?.[0]?.file}</span>;
    }

    const result = render(
      <QueryClientProvider client={createRendererQueryClient()}>
        <Provider store={store}>
          <Probe />
        </Provider>
      </QueryClientProvider>,
    );

    await waitFor(() => expect(result.getByText("src/app.ts")).toBeTruthy());
    expect(status).toHaveBeenCalledWith(
      { location: { directory: "/repo", workspace: "workspace-1" } },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });
});
