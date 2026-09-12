import { QueryClientProvider } from "@tanstack/react-query";
import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import { Provider, createStore } from "jotai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { phaseAtom, runtimeAtom, selectedSessionIDAtom } from "../atoms/workspace";
import { createRendererQueryClient } from "../lib/query-client";
import {
  createSessionActivitySelector,
  useSessionActivity,
  useSessionActivityForSession,
} from "./use-session-activity";

const mocks = vi.hoisted(() => ({
  listActiveSessionIDs: vi.fn<() => Promise<string[]>>(),
  loadSessionLog: vi.fn().mockResolvedValue([]),
}));

vi.mock("../services/opencode-catalog", () => ({
  getSessionInfo: vi.fn().mockResolvedValue(null),
  listActiveSessionIDs: mocks.listActiveSessionIDs,
  loadSessionLog: mocks.loadSessionLog,
}));

vi.mock("../services/palot", () => ({
  palot: { isPreview: () => false },
}));

describe("useSessionActivity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listActiveSessionIDs.mockResolvedValue([]);
  });

  it("does not refetch OpenCode activity from browser focus", async () => {
    const store = createStore();
    store.set(phaseAtom, "ready");
    store.set(runtimeAtom, {
      phase: "connected",
      connected: true,
      connectionID: "connection",
      profileID: "profile",
      contractVersion: "test",
      binaryPath: "/usr/local/bin/opencode2",
      version: "test",
      pid: 1,
      managed: true,
      lastConnectedAt: 1,
      error: null,
      versionMismatch: null,
    });
    const queryClient = createRendererQueryClient();
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>
        <Provider store={store}>{children}</Provider>
      </QueryClientProvider>
    );
    renderHook(() => useSessionActivity({ synchronize: true }), { wrapper });
    await waitFor(() => expect(mocks.listActiveSessionIDs).toHaveBeenCalledOnce());

    act(() => window.dispatchEvent(new Event("focus")));

    expect(mocks.listActiveSessionIDs).toHaveBeenCalledOnce();
  });

  it("preserves a selected session view when unrelated activity changes", () => {
    const selected = { status: "running", startedAt: 1, completedAt: null } as const;
    const selector = createSessionActivitySelector("selected");
    const first = selector({
      activeIDs: new Set(["selected"]),
      execution: new Map([["selected", selected]]),
      statuses: new Map([["selected", { type: "busy" }]]),
    });
    const second = selector({
      activeIDs: new Set(["selected", "other"]),
      execution: new Map([
        ["selected", selected],
        ["other", { status: "running", startedAt: 2, completedAt: null }],
      ]),
      statuses: new Map([
        ["selected", first.status!],
        ["other", { type: "busy" }],
      ]),
    });

    expect(second).toBe(first);
    expect(second.active).toBe(true);
    expect(second.execution).toBe(first.execution);
  });

  it("does not rerender a selected session for an unchanged activity refetch", async () => {
    const store = createStore();
    store.set(phaseAtom, "ready");
    store.set(runtimeAtom, {
      phase: "connected",
      connected: true,
      connectionID: "connection-stable-view",
      profileID: "profile",
      contractVersion: "test",
      binaryPath: "/usr/local/bin/opencode2",
      version: "test",
      pid: 1,
      managed: true,
      lastConnectedAt: 1,
      error: null,
      versionMismatch: null,
    });
    store.set(selectedSessionIDAtom, "selected");
    mocks.listActiveSessionIDs.mockResolvedValue(["selected"]);
    const queryClient = createRendererQueryClient();
    function Synchronizer() {
      useSessionActivity({ synchronize: true });
      return null;
    }

    function SelectedSession() {
      const activity = useSessionActivityForSession("selected");
      return <span>{activity.data.active ? "active" : "inactive"}</span>;
    }

    render(
      <QueryClientProvider client={queryClient}>
        <Provider store={store}>
          <Synchronizer />
          <SelectedSession />
        </Provider>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(mocks.listActiveSessionIDs).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.getByText("active")).toBeTruthy());
    const before = screen.getByText("active");

    await act(() =>
      queryClient.refetchQueries({
        queryKey: ["opencode", "connection-stable-view", "sessions", "activity"],
        exact: true,
      }),
    );

    expect(screen.getByText("active")).toBe(before);
  });

  it("uses authoritative active IDs instead of stale running projections", () => {
    const selector = createSessionActivitySelector("selected");
    const staleRunning = { status: "running", startedAt: 1, completedAt: null } as const;

    const inactive = selector({
      activeIDs: new Set(),
      execution: new Map([["selected", staleRunning]]),
      statuses: new Map([["selected", { type: "idle" }]]),
    });
    const active = selector({
      activeIDs: new Set(["selected"]),
      execution: new Map([["selected", staleRunning]]),
      statuses: new Map([["selected", { type: "busy" }]]),
    });

    expect(inactive.active).toBe(false);
    expect(active.active).toBe(true);
  });

  it("replays a newly selected session without refetching global activity", async () => {
    const store = createStore();
    store.set(phaseAtom, "ready");
    store.set(runtimeAtom, {
      phase: "connected",
      connected: true,
      connectionID: "connection-selection",
      profileID: "profile",
      contractVersion: "test",
      binaryPath: "/usr/local/bin/opencode2",
      version: "test",
      pid: 1,
      managed: true,
      lastConnectedAt: 1,
      error: null,
      versionMismatch: null,
    });
    store.set(selectedSessionIDAtom, "session-one");
    const queryClient = createRendererQueryClient();
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>
        <Provider store={store}>{children}</Provider>
      </QueryClientProvider>
    );
    renderHook(() => useSessionActivity({ synchronize: true }), { wrapper });
    await waitFor(() => expect(mocks.listActiveSessionIDs).toHaveBeenCalledOnce());
    mocks.loadSessionLog.mockClear();

    act(() => store.set(selectedSessionIDAtom, "session-two"));

    await waitFor(() =>
      expect(mocks.loadSessionLog).toHaveBeenCalledWith(
        "session-two",
        undefined,
        expect.any(AbortSignal),
        "connection-selection",
      ),
    );
    expect(mocks.listActiveSessionIDs).toHaveBeenCalledOnce();
  });

  it("keeps read-only observers from owning activity requests", async () => {
    const store = createStore();
    store.set(phaseAtom, "ready");
    store.set(runtimeAtom, {
      phase: "connected",
      connected: true,
      connectionID: "connection-local",
      profileID: "profile",
      contractVersion: "test",
      binaryPath: "/usr/local/bin/opencode2",
      version: "test",
      pid: 1,
      managed: true,
      lastConnectedAt: 1,
      error: null,
      versionMismatch: null,
    });
    store.set(selectedSessionIDAtom, "session-one");
    const queryClient = createRendererQueryClient();
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>
        <Provider store={store}>{children}</Provider>
      </QueryClientProvider>
    );
    renderHook(() => useSessionActivity(), { wrapper });
    await new Promise((resolve) => window.setTimeout(resolve, 20));
    expect(mocks.listActiveSessionIDs).not.toHaveBeenCalled();

    act(() => store.set(selectedSessionIDAtom, "session-two"));
    await new Promise((resolve) => window.setTimeout(resolve, 20));

    expect(mocks.listActiveSessionIDs).not.toHaveBeenCalled();
  });
});
