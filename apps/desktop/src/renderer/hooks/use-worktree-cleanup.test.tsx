import { act, cleanup, render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Provider, createStore } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenCodeRuntimeStatus, PalotSession } from "../../shared";
import type { PullRequestLink } from "../../shared/source-control-contract";
import {
  automaticWorktreeCleanupAtom,
  worktreeCleanupLogAtom,
} from "../atoms/worktree-preferences";
import { runtimeAtom } from "../atoms/workspace";
import { useAutomaticWorktreeCleanup } from "./use-worktree-cleanup";

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  status: vi.fn(),
  list: vi.fn(),
  remove: vi.fn(),
  check: vi.fn(),
}));
const task = {
  id: "task",
  projectID: "project",
  location: { directory: "/worktree" },
} as PalotSession;
const link = {
  sessionID: "task",
  syncError: null,
  pullRequest: { state: "merged", headBranch: "feature", url: "https://github.com/o/r/pull/1" },
} as PullRequestLink;
const owner = {
  connectionID: "local-connection",
  profileID: "local",
  connected: true,
  capabilities: { localPathActions: true },
} as OpenCodeRuntimeStatus;
const safe = {
  dirtyFiles: [],
  activeTasks: [],
  pullRequestHeadOid: "abc",
  git: { root: "/worktree", branch: "feature", oid: "abc", ahead: 0 },
};

vi.mock("./use-session-catalog", () => ({
  useProjectCatalog: () => [{ id: "project", canonical: "/repo" }],
  useSessionCatalog: () => [task],
}));
vi.mock("./use-source-control", () => ({
  sourceControl: { refreshPullRequests: mocks.refresh, gitStatus: mocks.status },
}));
vi.mock("../services/opencode-worktrees", () => ({
  listWorktrees: mocks.list,
  removeWorktree: mocks.remove,
}));
vi.mock("../components/worktrees/merged-worktree-retirement", async (original) => ({
  ...(await original<typeof import("../components/worktrees/merged-worktree-retirement")>()),
  readRetirementState: mocks.check,
}));

function mount(enabled = false) {
  const store = createStore();
  store.set(runtimeAtom, owner);
  store.set(automaticWorktreeCleanupAtom, enabled);
  store.set(worktreeCleanupLogAtom, []);
  const client = new QueryClient();
  function Automatic() {
    useAutomaticWorktreeCleanup();
    return null;
  }
  render(
    <Provider store={store}>
      <QueryClientProvider client={client}>
        <Automatic />
      </QueryClientProvider>
    </Provider>,
  );
  return store;
}

beforeEach(() => {
  window.localStorage.clear();
  mocks.refresh.mockResolvedValue([link]);
  mocks.status.mockResolvedValue({ root: "/repo" });
  mocks.list.mockResolvedValue([
    { directory: "/repo", strategy: null },
    { directory: "/worktree", strategy: "git" },
  ]);
  mocks.check.mockResolvedValue(safe);
  mocks.remove.mockResolvedValue(undefined);
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: {
      request: async (_name: string, _options: unknown, run: (lock: object) => unknown) => run({}),
    },
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.resetAllMocks();
  Reflect.deleteProperty(navigator, "locks");
});

describe("automatic worktree cleanup", () => {
  it("does not poll while off, runs on opt-in and each minute, and stops on opt-out", async () => {
    const store = mount();
    vi.useFakeTimers();
    expect(mocks.refresh).not.toHaveBeenCalled();
    await act(async () => {
      store.set(automaticWorktreeCleanupAtom, true);
    });
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(mocks.remove).toHaveBeenCalledExactlyOnceWith(
      "project",
      "/worktree",
      false,
      "local-connection",
    );
    expect(store.get(worktreeCleanupLogAtom)).toMatchObject([
      { directory: "/worktree", pullRequest: link.pullRequest.url },
    ]);
    mocks.list.mockResolvedValue([]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(mocks.refresh).toHaveBeenCalledTimes(2);
    await act(async () => {
      store.set(automaticWorktreeCleanupAtom, false);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(mocks.refresh).toHaveBeenCalledTimes(2);
  });

  it("keeps aliases of the main Git root even when they appear managed", async () => {
    mocks.check.mockResolvedValue({ ...safe, git: { ...safe.git, root: "/repo" } });
    const store = mount(true);
    await waitFor(() => expect(mocks.check).toHaveBeenCalledOnce());
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(store.get(worktreeCleanupLogAtom)).toEqual([]);
  });

  it("cancels removal if the connection changes during a safety check", async () => {
    const pending = Promise.withResolvers<typeof safe>();
    mocks.check.mockReturnValue(pending.promise);
    const store = mount(true);
    await waitFor(() => expect(mocks.check).toHaveBeenCalledOnce());
    await act(async () => {
      store.set(runtimeAtom, { ...owner, connectionID: "another-connection" });
      store.set(automaticWorktreeCleanupAtom, false);
      pending.resolve(safe);
    });
    expect(mocks.remove).not.toHaveBeenCalled();
  });
});
