import { QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { Provider, createStore } from "jotai";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OpenCodeRuntimeStatus } from "../../shared";
import type {
  PalotSourceControlApi,
  PullRequestLink,
  SourceControlChangedEvent,
} from "../../shared/source-control-contract";
import { runtimeAtom } from "../atoms/workspace";
import { createRendererQueryClient } from "../lib/query-client";
import {
  SourceControlError,
  useGitCommit,
  useGitStatus,
  usePullRequestLinksBySession,
  useSessionPullRequests,
  usePullRequestDetail,
  usePullRequestFiles,
  useSetPullRequestState,
} from "./use-source-control";

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, "palot");
});

function link(sessionID: string, number: number): PullRequestLink {
  return {
    profileID: "p1",
    sessionID,
    key: `github.com/acme/web#${number}`,
    source: "url",
    linkedAt: 1,
    syncedAt: 1,
    syncError: null,
    watch: null,
    watchEnded: null,
    settledAt: null,
    pullRequest: {
      host: "github.com",
      repository: "acme/web",
      number,
      title: `PR ${number}`,
      url: `https://github.com/acme/web/pull/${number}`,
      state: "open",
      checks: "passing",
      reviewDecision: null,
      mergeable: "mergeable",
      headBranch: "feature",
      baseBranch: "main",
      author: "me",
      updatedAt: 1,
      mergedAt: null,
      closedAt: null,
    },
  };
}

function install(overrides: Partial<PalotSourceControlApi> = {}) {
  const listeners = new Set<(event: SourceControlChangedEvent) => void>();
  const api = {
    listPullRequestLinks: vi.fn(async () => ({
      ok: true as const,
      value: [link("s1", 1), link("s2", 2), link("s1", 3)],
    })),
    onChanged: vi.fn((listener: (event: SourceControlChangedEvent) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
    ...overrides,
  };
  Object.defineProperty(window, "palot", { configurable: true, value: { sourceControl: api } });
  return {
    api,
    listeners,
    emit: (event: SourceControlChangedEvent) => listeners.forEach((listener) => listener(event)),
  };
}

function wrapper() {
  const store = createStore();
  store.set(runtimeAtom, {
    profileID: "p1",
    connectionID: "c1",
    connected: true,
  } as OpenCodeRuntimeStatus);
  const queryClient = createRendererQueryClient();
  return ({ children }: { children: ReactNode }) => (
    <Provider store={store}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </Provider>
  );
}

describe("source control hooks", () => {
  it("serves per-task links from one profile query and refetches on change events", async () => {
    const { api, emit } = install();
    const Wrapper = wrapper();
    const hook = renderHook(
      () => ({ task: useSessionPullRequests("s1"), all: usePullRequestLinksBySession() }),
      { wrapper: Wrapper },
    );
    await waitFor(() => expect(hook.result.current.task.data).toHaveLength(2));
    expect(hook.result.current.all.data?.get("s2")?.[0]?.pullRequest.number).toBe(2);
    expect(api.listPullRequestLinks).toHaveBeenCalledTimes(1);
    expect(api.listPullRequestLinks).toHaveBeenCalledWith({ profileID: "p1" });
    // Several mounted hooks share one main-process subscription.
    expect(api.onChanged).toHaveBeenCalledTimes(1);

    act(() =>
      emit({ type: "pull-requests", profileID: "other", sessionIDs: ["s1"], reason: "synced" }),
    );
    act(() =>
      emit({ type: "pull-requests", profileID: "p1", sessionIDs: ["s1"], reason: "synced" }),
    );
    await waitFor(() => expect(api.listPullRequestLinks).toHaveBeenCalledTimes(2));
  });

  it("surfaces failures as SourceControlError with a stable code", async () => {
    install({
      gitStatus: vi.fn(async () => ({
        ok: false as const,
        error: { code: "not-a-repository" as const, message: "Not a Git repository." },
      })),
    });
    const hook = renderHook(() => useGitStatus("/repo"), { wrapper: wrapper() });
    await waitFor(() => expect(hook.result.current.error).toBeInstanceOf(SourceControlError));
    expect(hook.result.current.error).toMatchObject({ code: "not-a-repository" });
  });

  it("fills the focused profile into mutations and refreshes the directory's status", async () => {
    const gitStatus = vi.fn(async () => ({
      ok: true as const,
      value: {
        root: "/repo",
        branch: { name: "main", oid: null, upstream: null, ahead: 0, behind: 0 },
        files: [],
        truncated: false,
      },
    }));
    const gitCommit = vi.fn(async () => ({
      ok: true as const,
      value: {
        oid: "abc",
        summary: "Fix",
        branch: { name: "main", oid: "abc", upstream: null, ahead: 1, behind: 0 },
      },
    }));
    install({ gitStatus, gitCommit });
    const hook = renderHook(() => ({ status: useGitStatus("/repo"), commit: useGitCommit() }), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(hook.result.current.status.data).toBeDefined());
    await act(() => hook.result.current.commit.mutateAsync({ directory: "/repo", message: "Fix" }));
    expect(gitCommit).toHaveBeenCalledWith({ directory: "/repo", message: "Fix", profileID: "p1" });
    await waitFor(() => expect(gitStatus).toHaveBeenCalledTimes(2));
  });

  it("keeps a viewed toggle cheap and avoids re-reading detail an action returned", async () => {
    const ref = { host: "github.com", repository: "acme/web", number: 7 };
    const key = "github.com/acme/web#7";
    const detail = { headOid: "a".repeat(40), body: "", state: "open" };
    const pullRequestDetail = vi.fn(async () => ({ ok: true as const, value: detail }));
    const pullRequestFiles = vi.fn(async () => ({
      ok: true as const,
      value: { headOid: detail.headOid, files: [], truncated: false },
    }));
    const setPullRequestState = vi.fn(async () => ({
      ok: true as const,
      value: { ...detail, state: "closed" },
    }));
    const { emit } = install({
      pullRequestDetail,
      pullRequestFiles,
      setPullRequestState,
    } as unknown as Partial<PalotSourceControlApi>);
    const hook = renderHook(
      () => ({
        detail: usePullRequestDetail(ref),
        files: usePullRequestFiles(ref),
        close: useSetPullRequestState(),
      }),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(hook.result.current.files.data).toBeDefined());
    await waitFor(() => expect(hook.result.current.detail.data).toBeDefined());

    act(() => emit({ type: "pull-request", key, reason: "viewed" }));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(pullRequestFiles).toHaveBeenCalledTimes(1);
    expect(pullRequestDetail).toHaveBeenCalledTimes(1);

    await act(() => hook.result.current.close.mutateAsync({ ...ref, state: "closed" }));
    await waitFor(() => expect(pullRequestFiles).toHaveBeenCalledTimes(2));
    expect(hook.result.current.detail.data).toMatchObject({ state: "closed" });
    expect(pullRequestDetail).toHaveBeenCalledTimes(1);

    act(() => emit({ type: "pull-request", key, reason: "commented" }));
    await waitFor(() => expect(pullRequestDetail).toHaveBeenCalledTimes(2));
  });
});
