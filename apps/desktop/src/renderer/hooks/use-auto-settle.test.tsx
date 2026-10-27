import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { autoSettleAfterDaysAtom, chatAutoSettleAfterDaysAtom } from "../atoms/ui";
import type { ConnectionOverview } from "../lib/connection-overview";
import { openCodeKeys } from "../lib/opencode-query";
import type { InboxSessionView } from "../lib/session-inbox";
import { useAutoSettle } from "./use-auto-settle";

const state = vi.hoisted(() => ({
  connections: [] as ConnectionOverview[],
  dispatch: vi.fn().mockResolvedValue(undefined),
  announce: vi.fn(),
}));
const controller = {
  getSnapshot: () => state.connections,
  subscribe: () => () => {},
  dispatch: state.dispatch,
};
vi.mock("../lib/connection-overview", () => ({ connectionOverview: () => controller }));
vi.mock("../components/settle-idle-menu", () => ({ announceSettledBatch: state.announce }));

const DAY = 86_400_000;
function item(id: string, days: number, chat: boolean): InboxSessionView {
  const updatedAt = Date.now() - days * DAY;
  return {
    kind: chat ? "chat" : "task",
    session: {
      id,
      parentID: null,
      projectID: id,
      title: id,
      agent: null,
      model: null,
      location: { directory: chat ? `/home/user/.palot/chats/${id}` : `/repo/${id}` },
      createdAt: updatedAt,
      updatedAt,
      idleAt: updatedAt,
      archivedAt: null,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      cost: null,
    },
    project: null,
    projectName: id,
    section: "inbox",
    attention: false,
    attentionCount: 0,
    running: false,
    runningSince: null,
    failed: false,
    canSettle: true,
    pinnedAt: null,
    snoozedUntil: null,
    keptInInboxAt: null,
    activityThrough: { sessionID: id, updatedAt },
  };
}

function setup(items: InboxSessionView[], activityReady = true) {
  const store = createStore();
  // Keep preferences independent of persisted state from other tests.
  store.set(autoSettleAfterDaysAtom, 7);
  store.set(chatAutoSettleAfterDaysAtom, 1);
  const client = new QueryClient();
  if (activityReady) client.setQueryData(openCodeKeys.sessionActivity("connection"), {});
  state.connections = [
    {
      profile: { id: "server", name: "Server" },
      phase: "ready",
      runtime: { connectionID: "connection", connected: true },
      triageReady: true,
      attentionState: "ready",
      inbox: { inbox: items },
    } as ConnectionOverview,
  ];
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <Provider store={store}>{children}</Provider>
    </QueryClientProvider>
  );
  return { store, start: () => renderHook(() => useAutoSettle(), { wrapper }) };
}

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe("automatic chat settling", () => {
  it("uses the shorter chat delay while preserving task age and safety checks", async () => {
    const { start } = setup([
      item("chat", 2, true),
      item("task", 2, false),
      item("old-task", 8, false),
      item("recent-chat", 0.5, true),
      { ...item("failed-chat", 2, true), failed: true },
      { ...item("busy-chat", 2, true), running: true, canSettle: false },
      { ...item("kept-chat", 2, true), keptInInboxAt: Date.now() },
    ]);
    start();
    await waitFor(() => expect(state.dispatch).toHaveBeenCalledOnce());
    expect(state.dispatch).toHaveBeenCalledWith(
      "server",
      expect.objectContaining({
        type: "settle-many",
        trigger: "auto",
        sessions: [
          { sessionID: "chat", through: expect.any(Object) },
          { sessionID: "old-task", through: expect.any(Object) },
        ],
      }),
    );
    await waitFor(() => expect(state.announce).toHaveBeenCalledOnce());
  });

  it.each([
    [null, 1, ["chat"]],
    [1, null, ["task"]],
    [null, null, []],
  ] as const)(
    "respects independent Off preferences (%s tasks, %s chats)",
    async (tasks, chats, ids) => {
      const { store, start } = setup([item("chat", 2, true), item("task", 2, false)]);
      store.set(autoSettleAfterDaysAtom, tasks);
      store.set(chatAutoSettleAfterDaysAtom, chats);
      start();
      if (ids.length === 0) {
        expect(state.dispatch).not.toHaveBeenCalled();
        return;
      }
      await waitFor(() => expect(state.dispatch).toHaveBeenCalledOnce());
      expect(
        state.dispatch.mock.calls[0]![1].sessions.map(
          (entry: { sessionID: string }) => entry.sessionID,
        ),
      ).toEqual(ids);
    },
  );

  it("sweeps again when the chat delay changes", async () => {
    const { store, start } = setup([item("chat", 2, true)]);
    store.set(chatAutoSettleAfterDaysAtom, 3);
    start();
    expect(state.dispatch).not.toHaveBeenCalled();
    act(() => store.set(chatAutoSettleAfterDaysAtom, 1));
    await waitFor(() => expect(state.dispatch).toHaveBeenCalledOnce());
  });

  it("does not settle chats before running-state hydration", () => {
    const { start } = setup([item("chat", 2, true)], false);
    start();
    expect(state.dispatch).not.toHaveBeenCalled();
  });
});
