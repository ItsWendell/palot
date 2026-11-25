import { describe, expect, it, vi } from "vitest";
import type { PermissionRequest } from "@opencode/client";
import { OFFLINE_MESSAGE } from "./actions";
import { createTaskListDataSource, type TaskListAppDeps } from "./data-source";
import { projectKey, taskID } from "./ids";
import type { ServerData } from "./project";
import { NOW, requests, serverData, session } from "./fixtures.test-support";

function setup(servers: ServerData[], open: { serverID: string; sessionID: string } | null = null) {
  const deps = {
    now: () => NOW,
    dispatch: vi.fn().mockResolvedValue(undefined),
    openSession: vi.fn().mockResolvedValue(undefined),
    openWindow: vi.fn().mockResolvedValue(undefined),
    reportError: vi.fn(),
    setUnreadMark: vi.fn(),
    markViewed: vi.fn().mockResolvedValue(undefined),
    interrupt: vi.fn().mockResolvedValue(undefined),
    replyPermission: vi.fn().mockResolvedValue(undefined),
    replyQuestion: vi.fn().mockResolvedValue(undefined),
    rename: vi.fn().mockResolvedValue(undefined),
    loadOlder: vi.fn(),
    startTask: vi.fn(),
    reconnect: vi.fn(),
  } satisfies TaskListAppDeps;
  const source = createTaskListDataSource(deps);
  source.update({ servers, openTask: open, now: NOW });
  return { source, actions: source.actions, deps };
}

const local = (extra: Partial<Parameters<typeof serverData>[0]> = {}) =>
  serverData({
    sessions: [session({ id: "a" }), session({ id: "b" }), session({ id: "c" })],
    ...extra,
  });
const watermark = (id: string) => ({ updatedAt: NOW - 600_000, sessionID: id });
const a = taskID("local", "a");
const b = taskID("local", "b");
const c = taskID("local", "c");

describe("triage actions", () => {
  it("settles one task with its watermark and undoes it back to the Inbox", async () => {
    const { actions, deps } = setup([local()]);
    const undo = await actions.settle([a]);
    expect(deps.dispatch).toHaveBeenCalledWith("local", {
      type: "settle",
      sessionID: "a",
      at: NOW,
      through: watermark("a"),
    });
    await undo!();
    expect(deps.dispatch).toHaveBeenLastCalledWith("local", {
      type: "inbox",
      sessionID: "a",
      at: NOW,
    });
  });

  it("settles a sweep in one batch per server and undoes every server", async () => {
    const remote = serverData({ serverID: "remote", sessions: [session({ id: "a" })] });
    const { actions, deps } = setup([local(), remote]);
    const undo = await actions.settle([a, b, taskID("remote", "a")]);
    expect(deps.dispatch).toHaveBeenCalledWith("local", {
      type: "settle-many",
      at: NOW,
      trigger: "bulk",
      sessions: [
        { sessionID: "a", through: watermark("a") },
        { sessionID: "b", through: watermark("b") },
      ],
    });
    expect(deps.dispatch).toHaveBeenCalledWith(
      "remote",
      expect.objectContaining({ type: "settle" }),
    );
    deps.dispatch.mockClear();
    await undo!();
    expect(deps.dispatch).toHaveBeenCalledWith("local", {
      type: "inbox-many",
      at: NOW,
      sessionIDs: ["a", "b"],
    });
    expect(deps.dispatch).toHaveBeenCalledWith("remote", {
      type: "inbox",
      sessionID: "a",
      at: NOW,
    });
  });

  it("opens the next task in the list's order after settling the open one", async () => {
    const { source, actions, deps } = setup([local()], { serverID: "local", sessionID: "b" });
    source.setListOrder(() => [a, b, c]);
    await actions.settle([b]);
    expect(deps.openSession).toHaveBeenCalledWith(expect.objectContaining({ id: c }));
    deps.openSession.mockClear();
    source.setListOrder(() => [a, c, b]);
    await actions.settle([b]);
    // Nothing after it, so the one before.
    expect(deps.openSession).toHaveBeenCalledWith(expect.objectContaining({ id: c }));
  });

  it("falls back to today's Inbox order, and leaves other tasks' focus alone", async () => {
    const { actions, deps } = setup([local()], { serverID: "local", sessionID: "a" });
    await actions.settle([b]);
    expect(deps.openSession).not.toHaveBeenCalled();
    await actions.settle([a]);
    expect(deps.openSession).toHaveBeenCalledTimes(1);
    expect(deps.openSession.mock.calls[0]![0].id).not.toBe(a);
  });

  it("refuses to settle working or waiting tasks, and changes nothing offline", async () => {
    const { actions, deps } = setup([
      local({
        sessions: [session({ id: "a" }), session({ id: "b" })],
        running: { a: NOW - 1_000 },
        requests: {
          b: requests({
            permissions: [
              { id: "p1", sessionID: "b", action: "bash", resources: [] } as PermissionRequest,
            ],
          }),
        },
      }),
      serverData({ serverID: "remote", online: false, sessions: [session({ id: "a" })] }),
    ]);
    await expect(actions.settle([a])).rejects.toThrow("Task is still working");
    await expect(actions.settle([b])).rejects.toThrow("Task needs input");
    await expect(actions.settle([taskID("remote", "a")])).rejects.toThrow(OFFLINE_MESSAGE);
    await expect(actions.stop(taskID("remote", "a"))).rejects.toThrow(OFFLINE_MESSAGE);
    expect(deps.dispatch).not.toHaveBeenCalled();
  });

  it("undoes a snooze to the previous snooze, or wakes the task", async () => {
    const { actions, deps } = setup([
      local({
        sessions: [session({ id: "a" }), session({ id: "b" })],
        triage: [
          {
            sessionID: "b",
            disposition: null,
            settledThrough: null,
            pinnedAt: null,
            snoozedUntil: NOW + 60_000,
            snoozedThrough: watermark("b"),
            updatedAt: NOW,
          },
        ],
      }),
    ]);
    const undoA = await actions.snooze([a], NOW + 3_600_000);
    expect(deps.dispatch).toHaveBeenCalledWith("local", {
      type: "snooze",
      sessionID: "a",
      at: NOW,
      until: NOW + 3_600_000,
      through: watermark("a"),
    });
    await undoA!();
    expect(deps.dispatch).toHaveBeenLastCalledWith("local", {
      type: "wake",
      sessionID: "a",
      at: NOW,
    });
    const undoB = await actions.snooze([b], NOW + 3_600_000);
    await undoB!();
    expect(deps.dispatch).toHaveBeenLastCalledWith(
      "local",
      expect.objectContaining({ type: "snooze", sessionID: "b", until: NOW + 60_000 }),
    );
  });

  it("pins with an undo, and unsettles and wakes directly", async () => {
    const { actions, deps } = setup([local()]);
    const undo = await actions.setPinned(a, true);
    expect(deps.dispatch).toHaveBeenLastCalledWith("local", {
      type: "pin",
      sessionID: "a",
      at: NOW,
    });
    await undo!();
    expect(deps.dispatch).toHaveBeenLastCalledWith("local", {
      type: "unpin",
      sessionID: "a",
      at: NOW,
    });
    await expect(actions.setPinned(a, false)).resolves.toBeNull();
    await actions.unsettle(a);
    expect(deps.dispatch).toHaveBeenLastCalledWith("local", {
      type: "inbox",
      sessionID: "a",
      at: NOW,
    });
    await actions.wake(a);
    expect(deps.dispatch).toHaveBeenLastCalledWith("local", {
      type: "wake",
      sessionID: "a",
      at: NOW,
    });
  });

  it("marks unread locally, and marking read also records the view on the server", async () => {
    const { actions, deps } = setup([
      local({
        sessions: [
          session({ id: "a", idleAt: NOW - 1_000, viewedAt: NOW - 2_000 }),
          session({ id: "b" }),
        ],
      }),
    ]);
    await actions.setUnread([a, b], true);
    expect(deps.setUnreadMark.mock.calls).toEqual([
      ["local", "a", true],
      ["local", "b", true],
    ]);
    expect(deps.markViewed).not.toHaveBeenCalled();
    await actions.setUnread([a, b], false);
    expect(deps.markViewed).toHaveBeenCalledTimes(1);
    expect(deps.markViewed).toHaveBeenCalledWith(expect.objectContaining({ id: a }), NOW - 1_000);
  });
});

describe("task actions on any server", () => {
  const remote = () =>
    serverData({
      serverID: "remote",
      sessions: [
        session({ id: "root" }),
        session({ id: "child", parentID: "root", agent: "explore" }),
      ],
      requests: {
        child: requests({
          permissions: [
            {
              id: "p1",
              sessionID: "child",
              action: "bash",
              resources: ["ls"],
            } as PermissionRequest,
          ],
        }),
        root: requests({
          forms: [
            {
              id: "f1",
              sessionID: "root",
              title: "Which?",
              metadata: { kind: "question" },
              fields: [
                {
                  key: "q0",
                  type: "string",
                  title: "Which?",
                  options: [{ label: "A", value: "a" }],
                },
              ],
            },
          ],
        }),
      },
    });
  const root = taskID("remote", "root");

  it("answers on the connection and session that own the request", async () => {
    const { actions, deps } = setup([local(), remote()]);
    await actions.replyPermission(root, "p1", "always");
    expect(deps.replyPermission).toHaveBeenCalledWith({
      connectionID: "remote-connection",
      sessionID: "child",
      requestID: "p1",
      reply: "always",
    });
    await actions.replyQuestion(root, "f1", "A");
    expect(deps.replyQuestion).toHaveBeenCalledWith({
      connectionID: "remote-connection",
      sessionID: "root",
      requestID: "f1",
      answers: [["A"]],
    });
  });

  it("stops, retries by opening, renames, and asks before deleting", async () => {
    const { source, actions, deps } = setup([local(), remote()]);
    await actions.stop(root);
    expect(deps.interrupt).toHaveBeenCalledWith(
      expect.objectContaining({ connectionID: "remote-connection", sessionID: "root" }),
    );
    await actions.retry(root);
    expect(deps.openSession).toHaveBeenCalledWith(expect.objectContaining({ id: root }));
    await expect(actions.rename(root, "   ")).rejects.toThrow("cannot be empty");
    await actions.rename(root, "root");
    expect(deps.rename).not.toHaveBeenCalled();
    await actions.rename(root, "  New title ");
    expect(deps.rename).toHaveBeenCalledWith(expect.objectContaining({ id: root }), "New title");
    actions.requestDelete(root);
    expect(source.deleteRequest.get().pending).toEqual({ taskID: root, title: "root" });
  });

  it("opens, starts tasks in a project or a chat, loads older and reconnects", () => {
    const { actions, deps } = setup([local(), remote()]);
    actions.open(root, { newWindow: true });
    expect(deps.openWindow).toHaveBeenCalledWith(expect.objectContaining({ serverID: "remote" }));
    actions.open(root, { newWindow: true, background: true });
    expect(vi.mocked(deps.openWindow).mock.lastCall).toEqual([
      expect.objectContaining({ serverID: "remote" }),
      { background: true },
    ]);
    actions.startTask(projectKey("remote", "project"));
    expect(deps.startTask).toHaveBeenLastCalledWith({ serverID: "remote", projectID: "project" });
    actions.startTask(null);
    expect(deps.startTask).toHaveBeenLastCalledWith(null);
    // The header's New task goes where Mod+N goes, not to the open task's server.
    actions.startTask();
    expect(deps.startTask).toHaveBeenLastCalledWith(undefined);
    actions.loadOlder();
    actions.reconnect("remote");
    expect(deps.loadOlder).toHaveBeenCalled();
    expect(deps.reconnect).toHaveBeenCalledWith("remote");
  });
});
