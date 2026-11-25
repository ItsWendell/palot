import { describe, expect, it } from "vitest";
import { makeTask, NOW, running } from "./fixtures.test-support";
import { rowActions, statusSentence, taskStatus, type StatusContext } from "./status";

const context: StatusContext = {
  now: NOW,
  liveDetail: true,
  serverOnline: true,
  serverLastSeenAt: null,
};

const permission = {
  id: "r1",
  kind: "permission" as const,
  arrivedAt: NOW - 60_000,
  summary: "bun test",
  detail: "bun test --run",
  rule: "bun test *",
  from: null,
};

describe("taskStatus", () => {
  it("ranks a pending request above a failure, and a failure above unseen work", () => {
    const failed = makeTask({
      id: "a",
      failure: "rate limit reached",
      requests: [permission],
      unread: true,
    });
    expect(taskStatus(failed, context).kind).toBe("approval");
    expect(taskStatus({ ...failed, requests: [] }, context).kind).toBe("failed");
    expect(taskStatus({ ...failed, requests: [], failure: null }, context).kind).toBe("unseen");
  });

  it("reads a stopped run as Stopped, not finished, while it is still unread", () => {
    const stopped = makeTask({
      id: "s",
      stopped: true,
      unread: true,
      summary: { durationMs: 125_000, filesChanged: 3, commands: 2 },
    });
    const value = taskStatus(stopped, context);
    expect(value.kind).toBe("stopped");
    expect(statusSentence(value, NOW)).toBe("Stopped");
    expect(taskStatus({ ...stopped, failure: "rate limit reached" }, context).kind).toBe("failed");
  });

  it("writes one sentence per state", () => {
    const sentence = (task: Parameters<typeof taskStatus>[0], ctx = context) =>
      statusSentence(taskStatus(task, ctx), NOW);
    expect(sentence(makeTask({ id: "a", requests: [permission] }))).toBe(
      "Waiting for approval · bun test",
    );
    expect(
      sentence(
        makeTask({
          id: "q",
          requests: [{ ...permission, kind: "question", question: "Which branch?", options: [] }],
        }),
      ),
    ).toBe("Waiting for your answer · Which branch?");
    expect(sentence(makeTask({ id: "f", failure: "rate limit reached" }))).toBe(
      "Failed · rate limit reached",
    );
    expect(
      sentence(
        makeTask({
          id: "u",
          unread: true,
          summary: { durationMs: 125_000, filesChanged: 3, commands: 2 },
        }),
      ),
    ).toBe("Worked for 2m 5s · changed 3 files");
    expect(sentence(makeTask({ id: "w", ...running(42_000, 1_000, "Running bun test") }))).toBe(
      "Running bun test · 42s",
    );
    expect(
      sentence(makeTask({ id: "w", ...running(42_000, 1_000, "Running bun test") }), {
        ...context,
        liveDetail: false,
      }),
    ).toBe("Working · 42s");
    expect(sentence(makeTask({ id: "s", stopped: true }))).toBe("Stopped");
    expect(sentence(makeTask({ id: "i" }))).toBeNull();
  });

  it("names the subagent that asked", () => {
    const task = makeTask({ id: "a", requests: [{ ...permission, from: "explore" }] });
    expect(statusSentence(taskStatus(task, context), NOW)).toBe(
      "Waiting for approval · From explore subagent",
    );
    const unnamed = makeTask({ id: "u", requests: [{ ...permission, from: "" }] });
    expect(statusSentence(taskStatus(unnamed, context), NOW)).toBe(
      "Waiting for approval · From a subagent",
    );
  });

  it("marks a quiet working task stale, and any working task on an offline server", () => {
    const quiet = makeTask({ id: "q", ...running(30 * 60_000, 12 * 60_000) });
    const status = taskStatus(quiet, context);
    expect(status.kind).toBe("stale");
    expect(statusSentence(status, NOW)).toBe("No update for 12m");
    const offline = taskStatus(makeTask({ id: "o", ...running(60_000) }), {
      ...context,
      serverOnline: false,
      serverLastSeenAt: Date.UTC(2026, 10, 11, 11, 50),
    });
    expect(offline.kind).toBe("stale");
    expect(offline.text).toMatch(/^Offline · last seen /);
  });
});

describe("rowActions", () => {
  it("offers exactly the one triage step for where the row sits", () => {
    const idle = makeTask({ id: "i" });
    expect(rowActions(idle, "idle", "inbox")).toEqual(["settle", "snooze"]);
    expect(rowActions(idle, "idle", "snoozed")).toEqual(["wake"]);
    expect(rowActions(idle, "idle", "settled")).toEqual(["unsettle"]);
    expect(rowActions(idle, "idle", "pinned")).toEqual(["unpin"]);
    expect(rowActions(makeTask({ id: "w", ...running(1_000) }), "working", "working")).toEqual([
      "stop",
    ]);
    expect(
      rowActions(makeTask({ id: "a", requests: [permission] }), "approval", "needs-you"),
    ).toEqual([]);
  });
});
