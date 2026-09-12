import { describe, expect, it, vi } from "vitest";
import type { PalotEvent, PalotMessage } from "../../shared";
import { SessionSynchronization } from "./session-synchronization";

function message(id: string, text: string, createdAt = 1): PalotMessage {
  return {
    id,
    type: "user",
    createdAt,
    completedAt: createdAt,
    text,
    finish: null,
    tokens: null,
    model: null,
    agent: null,
    data: null,
    content: [],
  };
}

function event(sessionID: string): PalotEvent {
  return delivered({
    id: crypto.randomUUID(),
    type: "session.text.delta",
    createdAt: 1,
    data: { sessionID },
    receiveSequence: 1,
  });
}

function delivered(input: {
  id: string;
  type: PalotEvent["type"];
  createdAt: number;
  data: unknown;
  receiveSequence: number;
}): PalotEvent {
  return { ...input, created: input.createdAt } as PalotEvent;
}

describe("SessionSynchronization", () => {
  it("rejects an older snapshot for the same session", () => {
    const authority = new SessionSynchronization();
    const all = { messages: true, requests: true, diffs: true };
    const older = authority.beginSessionSnapshot("session-1", all);
    const newer = authority.beginSessionSnapshot("session-1", all);

    expect(authority.admitSessionMessages(older, [message("1", "old")], [])).toBeNull();
    expect(authority.admitSessionMessages(newer, [message("1", "new")], [])?.[0]?.text).toBe("new");
  });

  it("preserves live event projections when events arrive during a snapshot", () => {
    const authority = new SessionSynchronization();
    const token = authority.beginSessionSnapshot("session-1", {
      messages: true,
      requests: false,
      diffs: false,
    });
    authority.record([event("session-1")]);

    const result = authority.admitSessionMessages(
      token,
      [message("1", "persisted")],
      [message("1", "live"), message("2", "streaming", 2)],
    );

    expect(result?.map((item) => item.text)).toEqual(["live", "streaming"]);
  });

  it("preserves live shell projections when shell events arrive during a snapshot", () => {
    const authority = new SessionSynchronization();
    const token = authority.beginSessionSnapshot("session-1", {
      messages: true,
      requests: false,
      diffs: false,
    });
    authority.record([
      delivered({
        id: "shell-started",
        type: "session.shell.started",
        createdAt: 1,
        data: { sessionID: "session-1", shell: { id: "shell-1", status: "running" } },
        receiveSequence: 1,
      }),
    ]);
    const persisted = { ...message("shell", ""), type: "shell", data: { status: "exited" } };
    const live = {
      ...message("shell", ""),
      type: "shell",
      data: { shellID: "shell-1", status: "running" },
    };

    const result = authority.admitSessionMessages(token, [persisted], [live]);

    expect(result?.[0]?.data).toEqual({ shellID: "shell-1", status: "running" });
  });

  it("preserves live boundary and retry projections during a snapshot", () => {
    const authority = new SessionSynchronization();
    const token = authority.beginSessionSnapshot("session-1", {
      messages: true,
      requests: false,
      diffs: false,
    });
    authority.record([
      delivered({
        id: "synthetic",
        type: "session.synthetic",
        createdAt: 1,
        data: { sessionID: "session-1", text: "Restarted" },
        receiveSequence: 1,
      }),
      delivered({
        id: "retry",
        type: "session.retry.scheduled",
        createdAt: 2,
        data: { sessionID: "session-1", assistantMessageID: "assistant" },
        receiveSequence: 2,
      }),
    ]);

    const result = authority.admitSessionMessages(
      token,
      [message("1", "persisted")],
      [message("1", "live"), message("synthetic", "Restarted", 2)],
    );

    expect(result?.map((item) => item.text)).toEqual(["live", "Restarted"]);
  });

  it("admits snapshots independently for different sessions", () => {
    const authority = new SessionSynchronization();
    const first = authority.beginSessionSnapshot("session-1", {
      messages: true,
      requests: true,
      diffs: true,
    });
    authority.beginSessionSnapshot("session-2", {
      messages: true,
      requests: true,
      diffs: true,
    });

    expect(authority.isCurrentSessionSnapshot(first)).toBe(true);
  });

  it("does not supersede an overlapping snapshot for a disjoint resource", () => {
    const authority = new SessionSynchronization();
    const messages = authority.beginSessionSnapshot("session-1", {
      messages: true,
      requests: false,
      diffs: false,
    });
    authority.beginSessionSnapshot("session-1", {
      messages: false,
      requests: true,
      diffs: false,
    });

    expect(authority.isCurrentSessionSnapshot(messages)).toBe(true);
  });

  it("does not prefer live messages for unrelated request events", () => {
    const authority = new SessionSynchronization();
    const token = authority.beginSessionSnapshot("session-1", {
      messages: true,
      requests: false,
      diffs: false,
    });
    authority.record([
      delivered({
        id: "permission",
        type: "permission.asked",
        createdAt: 1,
        data: { sessionID: "session-1" },
        receiveSequence: 1,
      }),
    ]);

    expect(
      authority.admitSessionMessages(
        token,
        [message("1", "persisted")],
        [message("1", "live")],
      )?.[0]?.text,
    ).toBe("persisted");
  });

  it("retains first-token timing when an authoritative snapshot replaces live content", () => {
    const authority = new SessionSynchronization();
    const token = authority.beginSessionSnapshot("session-1", {
      messages: true,
      requests: false,
      diffs: false,
    });
    const persisted = message("1", "persisted");
    const live = { ...message("1", "live"), firstTokenAt: 3 };

    const result = authority.admitSessionMessages(token, [persisted], [live]);

    expect(result?.[0]?.text).toBe("persisted");
    expect(result?.[0]?.firstTokenAt).toBe(3);
  });

  it("keeps equal-timestamp snapshot reconciliation deterministic", () => {
    const authority = new SessionSynchronization();
    const token = authority.beginSessionSnapshot("session-1", {
      messages: true,
      requests: false,
      diffs: false,
    });

    const result = authority.admitSessionMessages(
      token,
      [message("message-b", "second"), message("message-a", "first")],
      [],
    );

    expect(result?.map((item) => item.id)).toEqual(["message-a", "message-b"]);
  });

  it("rejects workspace request snapshots after a newer session request starts", () => {
    const authority = new SessionSynchronization();
    const workspace = authority.beginWorkspaceSnapshot();

    authority.beginSessionSnapshot("session-1", {
      messages: false,
      requests: true,
      diffs: false,
    });

    expect(authority.isCurrentWorkspaceSnapshot(workspace)).toBe(true);
    expect(authority.isCurrentWorkspaceRequestSnapshot(workspace)).toBe(false);
  });

  it("keeps unrelated resources current when a request-only refresh starts", () => {
    const authority = new SessionSynchronization();
    const full = authority.beginSessionSnapshot("session-1", {
      messages: true,
      requests: true,
      diffs: true,
    });

    authority.beginSessionSnapshot("session-1", {
      messages: false,
      requests: true,
      diffs: false,
    });

    expect(authority.isCurrentSessionResource(full, "messages")).toBe(true);
    expect(authority.isCurrentSessionResource(full, "requests")).toBe(false);
    expect(authority.isCurrentSessionResource(full, "diffs")).toBe(true);
  });

  it("coalesces reconcile work and cancels timers on dispose", () => {
    vi.useFakeTimers();
    const authority = new SessionSynchronization();
    const first = vi.fn();
    const second = vi.fn();
    const workspace = vi.fn();

    const admitted: unknown[] = [];
    authority.scheduleSessionReconcile(
      "session-1",
      { messages: true, requests: false, diffs: false },
      (sessionID, targets) => {
        admitted.push({ sessionID, targets });
        first();
      },
    );
    authority.scheduleSessionReconcile(
      "session-1",
      { messages: false, requests: true, diffs: false },
      (sessionID, targets) => {
        admitted.push({ sessionID, targets });
        second();
      },
    );
    authority.scheduleWorkspaceReconcile(workspace);
    vi.advanceTimersByTime(120);

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
    expect(admitted).toEqual([
      {
        sessionID: "session-1",
        targets: { messages: true, requests: true, diffs: false },
      },
    ]);
    expect(workspace).toHaveBeenCalledOnce();

    authority.scheduleSessionReconcile(
      "session-2",
      { messages: true, requests: false, diffs: false },
      () => first(),
    );
    authority.dispose();
    vi.runAllTimers();
    expect(first).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("keeps pending reconciliation scoped to its session", () => {
    vi.useFakeTimers();
    const authority = new SessionSynchronization();
    const admitted: unknown[] = [];

    authority.scheduleSessionReconcile(
      "session-1",
      { messages: true, requests: false, diffs: false },
      (sessionID, targets) => admitted.push({ sessionID, targets }),
    );
    authority.scheduleSessionReconcile(
      "session-2",
      { messages: false, requests: true, diffs: false },
      (sessionID, targets) => admitted.push({ sessionID, targets }),
    );
    vi.advanceTimersByTime(120);

    expect(admitted).toEqual([
      {
        sessionID: "session-1",
        targets: { messages: true, requests: false, diffs: false },
      },
      {
        sessionID: "session-2",
        targets: { messages: false, requests: true, diffs: false },
      },
    ]);
    vi.useRealTimers();
  });
});
