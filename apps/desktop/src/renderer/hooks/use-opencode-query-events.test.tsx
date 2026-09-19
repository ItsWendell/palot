import { QueryClientProvider, QueryObserver } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { Provider, createStore } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PalotEvent, PalotEventBatch, PalotMessage } from "../../shared";
import { phaseAtom, runtimeAtom } from "../atoms/workspace";
import { openCodeReconciler } from "../lib/open-code-reconciler";
import { openCodeKeys } from "../lib/opencode-query";
import { createRendererQueryClient } from "../lib/query-client";
import { useOpenCodeQueryEvents } from "./use-opencode-query-events";
import { useSessionActivity } from "./use-session-activity";

const mocks = vi.hoisted(() => ({
  listeners: new Set<(batch: PalotEventBatch) => void>(),
  getSessionInfo: vi.fn(),
  listActiveSessionIDs: vi.fn<() => Promise<string[]>>(),
  loadRequests: vi.fn(),
}));

vi.mock("../services/opencode-catalog", () => ({
  getSessionInfo: mocks.getSessionInfo,
  listActiveSessionIDs: mocks.listActiveSessionIDs,
}));

vi.mock("../services/palot", () => ({
  palot: {
    isPreview: () => false,
    subscribe: (listener: (batch: PalotEventBatch) => void) => {
      mocks.listeners.add(listener);
      return () => mocks.listeners.delete(listener);
    },
    loadRequests: mocks.loadRequests,
  },
}));

function batch(
  batchSequence: number,
  events: PalotEventBatch["events"],
  streamEpoch = 1,
): PalotEventBatch {
  return {
    connectionID: "connection",
    contractVersion: "test",
    streamEpoch,
    batchSequence,
    receivedAt: 1,
    sentAt: 1,
    events,
  };
}

describe("useOpenCodeQueryEvents", () => {
  afterEach(() => vi.useRealTimers());

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listeners.clear();
    mocks.getSessionInfo.mockResolvedValue(null);
    mocks.listActiveSessionIDs.mockResolvedValue([]);
    mocks.loadRequests.mockResolvedValue({ permissions: [], forms: [], inbox: [], errors: [] });
  });

  it.each([
    ["session.execution.succeeded", "running"],
    ["session.execution.failed", "streaming"],
    ["session.execution.interrupted", "running"],
    ["session.execution.succeeded", "completed"],
  ] as const)(
    "reconciles %s with a %s tool from the authoritative transcript",
    async (type, status) => {
      const queryClient = createRendererQueryClient();
      const reconciler = openCodeReconciler(queryClient);
      const message: PalotMessage = {
        id: "assistant",
        type: "assistant",
        createdAt: 1,
        completedAt: null,
        text: "",
        agent: "build",
        model: null,
        tokens: null,
        finish: null,
        content: [{ type: "tool", id: "call", name: "execute", state: { status } }],
        data: null,
      };
      reconciler.setTranscriptSnapshot("connection", "session", [message], "rooted");
      reconciler.setTranscriptSnapshot("other", "session", [message], "rooted");
      const settled = {
        ...message,
        completedAt: 2,
        content: [{ type: "tool", id: "call", name: "execute", state: { status: "completed" } }],
      };
      const refresh = vi.fn(async () => {
        reconciler.setTranscriptSnapshot("connection", "session", [settled], "rooted");
        return [settled];
      });
      const unsubscribe = new QueryObserver(queryClient, {
        queryKey: openCodeKeys.transcript("connection", "session"),
        queryFn: refresh,
        initialData: [message],
        staleTime: Infinity,
      }).subscribe(() => {});
      const { unmount } = renderHook(() => useOpenCodeQueryEvents(), {
        wrapper: ({ children }) => (
          <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
        ),
      });
      act(() => {
        for (const listener of mocks.listeners) {
          listener(
            batch(1, [
              {
                id: "settled",
                type,
                createdAt: 2,
                receiveSequence: 1,
                data: { sessionID: "session", reason: "user" },
              } as PalotEvent,
            ]),
          );
        }
      });
      if (status === "completed") {
        await new Promise((resolve) => setTimeout(resolve, 200));
        expect(refresh).not.toHaveBeenCalled();
      } else {
        await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
        expect(reconciler.messages("connection", "session")[0]?.content[0]?.state).toEqual({
          status: "completed",
        });
      }
      expect(reconciler.messages("other", "session")[0]?.content[0]?.state).toEqual({ status });
      unmount();
      unsubscribe();
      queryClient.clear();
    },
  );

  it("reads settled tool state after an in-flight pre-settlement transcript fetch", async () => {
    vi.useFakeTimers();
    const queryClient = createRendererQueryClient();
    const reconciler = openCodeReconciler(queryClient);
    const message: PalotMessage = {
      id: "assistant",
      type: "assistant",
      createdAt: 1,
      completedAt: null,
      text: "",
      agent: "build",
      model: null,
      tokens: null,
      finish: null,
      content: [{ type: "tool", id: "call", name: "execute", state: { status: "running" } }],
      data: null,
    };
    const settled: PalotMessage = {
      ...message,
      completedAt: 2,
      content: [{ type: "tool", id: "call", name: "execute", state: { status: "completed" } }],
    };
    reconciler.setTranscriptSnapshot("connection", "session", [message], "rooted");
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let requests = 0;
    const refresh = vi.fn(async () => {
      const token = reconciler.beginSnapshot("connection");
      const snapshot = ++requests === 1 ? message : settled;
      if (requests === 1) await gate;
      reconciler.setTranscriptSnapshot("connection", "session", [snapshot], "rooted", token);
      return [snapshot];
    });
    const observer = new QueryObserver(queryClient, {
      queryKey: openCodeKeys.transcript("connection", "session"),
      queryFn: refresh,
      initialData: [message],
      staleTime: Infinity,
    });
    const unsubscribe = observer.subscribe(() => {});
    const staleFetch = observer.refetch();
    expect(refresh).toHaveBeenCalledOnce();
    const { unmount } = renderHook(() => useOpenCodeQueryEvents(), {
      wrapper: ({ children }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      ),
    });
    try {
      act(() => {
        for (const listener of mocks.listeners) {
          listener(
            batch(1, [
              {
                id: "interrupted",
                type: "session.execution.interrupted",
                createdAt: 2,
                receiveSequence: 1,
                data: { sessionID: "session", reason: "user" },
              } as PalotEvent,
            ]),
          );
        }
      });
      // Let the invalidation queue encounter the still-running stale fetch.
      await act(() => vi.advanceTimersByTimeAsync(200));
      await act(async () => {
        release();
        await staleFetch;
        await vi.advanceTimersByTimeAsync(200);
      });
      expect(reconciler.messages("connection", "session")[0]?.content[0]?.state).toEqual({
        status: "completed",
      });
      expect(observer.getCurrentResult().data?.[0]?.content[0]?.state).toEqual({
        status: "completed",
      });
      expect(refresh).toHaveBeenCalledTimes(2);
    } finally {
      release();
      unmount();
      unsubscribe();
      queryClient.clear();
    }
  });

  it("does not duplicate initial hydration and repairs reconnects and later batch gaps", async () => {
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
    const refreshInbox = vi.fn().mockResolvedValue({ inbox: [] });
    const refreshCatalog = vi.fn().mockResolvedValue([]);
    const unsubscribeInbox = new QueryObserver(queryClient, {
      queryKey: openCodeKeys.sessionRequests("connection", "session-1"),
      queryFn: refreshInbox,
      initialData: { inbox: [{ id: "missed-cancellation" }] },
      staleTime: Infinity,
    }).subscribe(() => {});
    const unsubscribeCatalog = new QueryObserver(queryClient, {
      queryKey: openCodeKeys.modelsLocation("connection", { directory: "/project" }),
      queryFn: refreshCatalog,
      initialData: [],
      staleTime: Infinity,
    }).subscribe(() => {});
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>
        <Provider store={store}>{children}</Provider>
      </QueryClientProvider>
    );
    renderHook(
      () => {
        useOpenCodeQueryEvents();
        useSessionActivity({ synchronize: true });
      },
      { wrapper },
    );
    await waitFor(() => expect(mocks.listActiveSessionIDs).toHaveBeenCalledOnce());

    act(() => {
      for (const listener of mocks.listeners) {
        listener(
          batch(1, [
            {
              id: "connected",
              type: "server.connected",
              createdAt: 1,
              receiveSequence: 1,
              data: {},
            },
          ]),
        );
      }
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(mocks.listActiveSessionIDs).toHaveBeenCalledOnce();
    expect(refreshInbox).not.toHaveBeenCalled();
    expect(refreshCatalog).not.toHaveBeenCalled();

    act(() => {
      for (const listener of mocks.listeners) {
        listener(
          batch(
            1,
            [
              {
                id: "reconnected",
                type: "server.connected",
                createdAt: 2,
                receiveSequence: 2,
                data: {},
              },
            ],
            2,
          ),
        );
      }
    });
    await waitFor(() => expect(mocks.listActiveSessionIDs).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(refreshInbox).toHaveBeenCalledOnce());
    await waitFor(() => expect(refreshCatalog).toHaveBeenCalledOnce());

    act(() => {
      for (const listener of mocks.listeners) listener(batch(3, [], 2));
    });
    await waitFor(() => expect(mocks.listActiveSessionIDs).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(refreshInbox).toHaveBeenCalledTimes(2));
    unsubscribeInbox();
    unsubscribeCatalog();
  });

  it("projects a request event without a confirmation fetch", async () => {
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
    mocks.loadRequests.mockResolvedValue({
      permissions: [
        {
          id: "permission-1",
          sessionID: "session-1",
          action: "read",
          resources: ["README.md"],
        },
      ],
      forms: [],
      inbox: [],
      errors: [],
    });
    const queryClient = createRendererQueryClient();
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>
        <Provider store={store}>{children}</Provider>
      </QueryClientProvider>
    );
    renderHook(() => useOpenCodeQueryEvents(), { wrapper });

    act(() => {
      for (const listener of mocks.listeners) {
        listener(
          batch(1, [
            {
              id: "permission-event",
              type: "permission.asked",
              created: 10,
              createdAt: 10,
              receiveSequence: 1,
              data: {
                id: "permission-1",
                sessionID: "session-1",
                action: "read",
                resources: ["README.md"],
              },
            },
          ]),
        );
      }
    });

    await waitFor(() =>
      expect(openCodeReconciler(queryClient).requests("connection", "session-1")).toMatchObject({
        permissions: [{ id: "permission-1" }],
      }),
    );
    expect(mocks.loadRequests).not.toHaveBeenCalled();
  });

  it("confirms activity after a final step even when the idle event is missing", async () => {
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
    mocks.listActiveSessionIDs.mockResolvedValue(["session-1"]);
    const queryClient = createRendererQueryClient();
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>
        <Provider store={store}>{children}</Provider>
      </QueryClientProvider>
    );
    renderHook(
      () => {
        useOpenCodeQueryEvents();
        useSessionActivity({ synchronize: true });
      },
      { wrapper },
    );
    await waitFor(() => expect(mocks.listActiveSessionIDs).toHaveBeenCalledOnce());
    vi.useFakeTimers();

    act(() => {
      for (const listener of mocks.listeners) {
        listener(
          batch(1, [
            {
              id: "step-ended",
              type: "session.step.ended",
              created: 10,
              createdAt: 10,
              receiveSequence: 1,
              durable: { aggregateID: "session-1", seq: 1, version: 1 },
              data: {
                sessionID: "session-1",
                assistantMessageID: "assistant",
                finish: "stop",
                cost: 0,
                tokens: {
                  input: 0,
                  output: 0,
                  reasoning: 0,
                  cache: { read: 0, write: 0 },
                },
              },
            },
          ]),
        );
      }
    });
    await act(() => vi.advanceTimersByTimeAsync(750));

    expect(mocks.listActiveSessionIDs).toHaveBeenCalledTimes(2);
  });

  it("coalesces terminal events into one trailing usage invalidation", async () => {
    vi.useFakeTimers();
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
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>
        <Provider store={store}>{children}</Provider>
      </QueryClientProvider>
    );
    renderHook(() => useOpenCodeQueryEvents(), { wrapper });

    const executionEvent = (
      id: string,
      receiveSequence: number,
    ): PalotEventBatch["events"][number] => ({
      id,
      type: "session.execution.succeeded",
      created: receiveSequence,
      createdAt: receiveSequence,
      receiveSequence,
      durable: { aggregateID: "session-1", seq: receiveSequence, version: 1 },
      data: { sessionID: "session-1" },
    });
    act(() => {
      for (const listener of mocks.listeners) listener(batch(1, [executionEvent("first", 1)]));
    });
    await act(() => vi.advanceTimersByTimeAsync(30_000));
    act(() => {
      for (const listener of mocks.listeners) listener(batch(2, [executionEvent("second", 2)]));
    });
    await act(() => vi.advanceTimersByTimeAsync(59_999));

    const statsKey = openCodeKeys.sessionStatsRoot("connection");
    const statsInvalidations = () =>
      invalidateQueries.mock.calls.filter(
        ([filters]) => JSON.stringify(filters?.queryKey) === JSON.stringify(statsKey),
      );
    expect(statsInvalidations()).toHaveLength(0);

    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(statsInvalidations()).toHaveLength(1);
    expect(statsInvalidations()[0]?.[0]).toMatchObject({ refetchType: "active" });
  });
});
