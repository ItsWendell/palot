import type { OpenCodeClient } from "@opencode/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { Provider, createStore } from "jotai";
import { render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runtimeAtom } from "../atoms/workspace";
import { createRendererQueryClient } from "../lib/query-client";
import { resetOpenCodeClientForTest, setOpenCodeClientForTest } from "../services/opencode-client";
import { useVcsInfo, useVcsStatusMap, vcsLocationKey } from "./use-vcs-info";

const location = { directory: "/repo", workspaceID: "workspace-1" };

afterEach(() => {
  resetOpenCodeClientForTest();
  Reflect.deleteProperty(window, "palot");
});

describe("OpenCode VCS queries", () => {
  it("reads the selected task's branch for its location", async () => {
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
      return <span>{single.data?.currentBranch}</span>;
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
