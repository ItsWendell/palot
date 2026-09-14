import type { OpenCodeClient } from "@opencode/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor, act, cleanup } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { runtimeAtom } from "../atoms/workspace";
import { reviewBaseChoiceAtom, reviewBaseScope } from "../atoms/review-base";
import { createRendererQueryClient } from "../lib/query-client";
import { setOpenCodeClientForTest, resetOpenCodeClientForTest } from "../services/opencode-client";
import { palot } from "../services/palot";
import { useLocationDiffs, locationDiffsQueryOptions } from "./use-location-diffs";

afterEach(() => {
  cleanup();
  resetOpenCodeClientForTest();
  vi.restoreAllMocks();
  localStorage.clear();
});
const location = { directory: "/repo", workspaceID: "tree" };
function setup(data: { name: string; ref: string; source: "reflog" } | null) {
  const base = vi.fn().mockResolvedValue({ data });
  setOpenCodeClientForTest({ vcs: { base } } as unknown as OpenCodeClient);
  const diffs = vi.spyOn(palot, "listDiffs").mockResolvedValue([]);
  const store = createStore();
  store.set(runtimeAtom, {
    connectionID: "one",
    profileID: "local",
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
  const client = createRendererQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <Provider store={store}>{children}</Provider>
    </QueryClientProvider>
  );
  return { base, diffs, store, wrapper };
}

it("uses the official inferred ref, then manual selection, then reset", async () => {
  const { base, diffs, wrapper } = setup({
    name: "release",
    ref: "refs/heads/release",
    source: "reflog",
  });
  const { result } = renderHook(() => useLocationDiffs(location, true, "branch"), { wrapper });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(base).toHaveBeenCalledWith(
    { location: { directory: "/repo", workspace: "tree" } },
    expect.objectContaining({ signal: expect.any(AbortSignal) }),
  );
  expect(diffs).toHaveBeenLastCalledWith(
    { ...location, mode: "branch", context: 3, base: "refs/heads/release" },
    expect.any(AbortSignal),
    "one",
  );
  act(() => result.current.reviewBase.setManual(" origin/topic "));
  await waitFor(() =>
    expect(diffs).toHaveBeenLastCalledWith(
      { ...location, mode: "branch", context: 3, base: "origin/topic" },
      expect.any(AbortSignal),
      "one",
    ),
  );
  act(() => result.current.reviewBase.setManual(null));
  await waitFor(() => expect(result.current.reviewBase.ref).toBe("refs/heads/release"));
});

it("does not request a branch diff for null inference; manual refs still work", async () => {
  const { diffs, wrapper } = setup(null);
  const { result } = renderHook(() => useLocationDiffs(location, true, "branch"), { wrapper });
  await waitFor(() => expect(result.current.reviewBase.inferred.isSuccess).toBe(true));
  expect(diffs).not.toHaveBeenCalled();
  act(() => result.current.reviewBase.setManual("abc123"));
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(diffs).toHaveBeenLastCalledWith(
    expect.objectContaining({ base: "abc123" }),
    expect.any(AbortSignal),
    "one",
  );
});

it("isolates persisted choices and query data by connection, directory, worktree and ref", () => {
  const store = createStore();
  const scope = reviewBaseScope("one", location);
  store.set(reviewBaseChoiceAtom, scope, "release");
  expect(createStore().get(reviewBaseChoiceAtom)(scope)).toBe("release");
  const variants = [
    ["two", location],
    ["one", { directory: "/else", workspaceID: "tree" }],
    ["one", { ...location, workspaceID: "other" }],
  ] as const;
  const key = locationDiffsQueryOptions("one", location, "branch", 3, "release").queryKey;
  for (const [connection, loc] of variants) {
    expect(store.get(reviewBaseChoiceAtom)(reviewBaseScope(connection, loc))).toBeNull();
    expect(locationDiffsQueryOptions(connection, loc, "branch", 3, "release").queryKey).not.toEqual(
      key,
    );
  }
  expect(locationDiffsQueryOptions("one", location, "branch", 3, "main").queryKey).not.toEqual(key);
  store.set(reviewBaseChoiceAtom, scope, null);
  expect(createStore().get(reviewBaseChoiceAtom)(scope)).toBeNull();
});

it("does not carry a manual ref into another worktree or working mode", async () => {
  const { diffs, wrapper } = setup({ name: "main", ref: "refs/heads/main", source: "reflog" });
  const { result, rerender } = renderHook(
    ({ workspaceID, mode }: { workspaceID: string; mode: "branch" | "working" }) =>
      useLocationDiffs({ directory: "/repo", workspaceID }, true, mode),
    { wrapper, initialProps: { workspaceID: "tree", mode: "branch" } },
  );
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  act(() => result.current.reviewBase.setManual("release"));
  await waitFor(() =>
    expect(diffs).toHaveBeenLastCalledWith(
      expect.objectContaining({ base: "release" }),
      expect.any(AbortSignal),
      "one",
    ),
  );
  rerender({ workspaceID: "other", mode: "branch" });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(result.current.reviewBase.manual).toBeNull();
  expect(diffs).toHaveBeenLastCalledWith(
    expect.objectContaining({ workspaceID: "other", base: "refs/heads/main" }),
    expect.any(AbortSignal),
    "one",
  );
  rerender({ workspaceID: "tree", mode: "working" });
  await waitFor(() =>
    expect(diffs).toHaveBeenLastCalledWith(
      { directory: "/repo", workspaceID: "tree", mode: "working", context: 3 },
      expect.any(AbortSignal),
      "one",
    ),
  );
});
