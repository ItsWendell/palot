import { QueryClient, QueryClientProvider, QueryObserver } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import type { OpenCodeRuntimeStatus, PalotProject } from "../../shared";
import { runtimeAtom } from "../atoms/workspace";
import { openCodeKeys } from "../lib/opencode-query";
import { palot } from "../services/palot";
import {
  projectWorktreesQueryOptions,
  useCreateProjectCopy,
  useProjectWorktrees,
} from "./use-project-worktrees";

afterEach(cleanup);

it.each([true, false])(
  "discovers on opening a worktree surface without rediscovering on inventory events (enabled=%s)",
  async (enabled) => {
    const refresh = vi.spyOn(palot, "refreshProjectCopies").mockResolvedValue(undefined);
    const list = vi
      .spyOn(palot, "listProjectDirectories")
      .mockResolvedValue([{ directory: "/repo", strategy: null }]);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const store = createStore();
    const owner = {
      connectionID: "local",
      profileID: "local",
      connected: true,
      phase: "connected",
    } as OpenCodeRuntimeStatus;
    const project = { id: "project", canonical: "/repo" } as PalotProject;
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>
        <Provider store={store}>{children}</Provider>
      </QueryClientProvider>
    );
    const { result, unmount } = renderHook(() => useProjectWorktrees(project, enabled, owner), {
      wrapper,
    });
    try {
      if (!enabled)
        await act(async () => {
          await result.current.refetch();
        });
      await waitFor(() => expect(result.current.isFetching).toBe(false));
      expect(refresh).toHaveBeenCalledOnce();
      const reads = list.mock.calls.length;
      await act(async () => {
        await client.invalidateQueries({ queryKey: openCodeKeys.worktrees("local", "project") });
      });
      await client.fetchQuery(projectWorktreesQueryOptions("local", project));
      await waitFor(() => expect(list.mock.calls.length).toBeGreaterThan(reads));
      expect(refresh).toHaveBeenCalledOnce();
    } finally {
      unmount();
      client.clear();
      refresh.mockRestore();
      list.mockRestore();
    }
  },
);

it("refreshes a worktree list invalidated while the menu was closed", async () => {
  const main = { directory: "/repo", strategy: null };
  const added = { directory: "/repo-copy", strategy: "git" };
  const list = vi.spyOn(palot, "listProjectDirectories").mockResolvedValue([main, added]);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const options = projectWorktreesQueryOptions("local", { id: "project", canonical: "/repo" });
  client.setQueryData(options.queryKey, [main]);
  await client.invalidateQueries({ queryKey: options.queryKey });
  const observer = new QueryObserver(client, options);
  const unsubscribe = observer.subscribe(() => {});
  try {
    await waitFor(() => expect(observer.getCurrentResult().data).toEqual([main, added]));
    expect(list).toHaveBeenCalledOnce();
  } finally {
    unsubscribe();
    client.clear();
    list.mockRestore();
  }
});

it("reconciles worktree inventory after a setup timeout instead of treating it as rollback", async () => {
  const create = vi
    .spyOn(palot, "createProjectCopy")
    .mockRejectedValue(new DOMException("Setup timed out", "TimeoutError"));
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const store = createStore();
  store.set(runtimeAtom, {
    connectionID: "local",
    profileID: "local",
    contractVersion: "0.0.0-beta-19425",
    phase: "connected",
    connected: true,
    version: "0.0.0-beta-19425",
    binaryPath: null,
    pid: 1,
    managed: false,
    lastConnectedAt: 1,
    error: null,
    versionMismatch: null,
  });
  const project = { id: "project", canonical: "/repo" } as PalotProject;
  const key = openCodeKeys.worktrees("local", project.id);
  client.setQueryData(key, []);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <Provider store={store}>{children}</Provider>
    </QueryClientProvider>
  );
  const { result, unmount } = renderHook(() => useCreateProjectCopy(project), { wrapper });
  try {
    await act(async () => {
      await expect(result.current.mutateAsync("/repo")).rejects.toThrow("Setup timed out");
    });
    expect(client.getQueryState(key)?.isInvalidated).toBe(true);
    expect(create).toHaveBeenCalledOnce();
  } finally {
    unmount();
    client.clear();
  }
});
