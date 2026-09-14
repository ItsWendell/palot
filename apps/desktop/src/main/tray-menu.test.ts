import { describe, expect, it } from "vitest";
import { formatTrayRelativeTime, prioritizeTrayTasks, type TrayTaskItem } from "./tray-menu";

const item = (sessionID: string): TrayTaskItem => ({
  sessionID,
  title: sessionID,
  detail: sessionID,
  target: { type: "session", sessionID },
});

describe("tray task menu", () => {
  it("keeps equal session IDs on different servers while deduplicating the same owner", () => {
    const a = {
      ...item("same"),
      target: { type: "session" as const, sessionID: "same", profileID: "a" },
    };
    const b = {
      ...item("same"),
      target: { type: "session" as const, sessionID: "same", profileID: "b" },
    };
    const result = prioritizeTrayTasks({
      attention: [a],
      pinned: [a, b],
      running: [b],
      recent: [a, b],
    });
    expect(result.attention).toEqual([a]);
    expect(result.pinned).toEqual([b]);
    expect(result.running).toEqual([]);
    expect(result.recent).toEqual([]);
  });
  it("prioritizes sections, deduplicates tasks, and caps the menu at ten items", () => {
    const result = prioritizeTrayTasks({
      attention: [item("a1"), item("a2"), item("a3"), item("a4")],
      pinned: [item("a1"), item("p1"), item("p2"), item("p3"), item("p4")],
      running: [item("p1"), item("r1"), item("r2"), item("r3"), item("r4")],
      recent: [item("a2"), item("p2"), item("r2"), item("x1"), item("x2"), item("x3")],
    });

    expect(result.attention.map((value) => value.sessionID)).toEqual(["a1", "a2", "a3"]);
    expect(result.pinned.map((value) => value.sessionID)).toEqual(["p1", "p2", "p3"]);
    expect(result.running.map((value) => value.sessionID)).toEqual(["r1", "r2", "r3"]);
    expect(result.recent.map((value) => value.sessionID)).toEqual(["x1"]);
  });

  it("fills unused priority capacity with recent tasks", () => {
    const result = prioritizeTrayTasks({
      attention: [item("a1")],
      pinned: [],
      running: [item("r1")],
      recent: Array.from({ length: 12 }, (_, index) => item(`x${index + 1}`)),
    });

    expect(result.recent).toHaveLength(8);
  });

  it("formats compact relative times", () => {
    const now = 10 * 24 * 60 * 60 * 1_000;
    expect(formatTrayRelativeTime(now - 30_000, now)).toBe("now");
    expect(formatTrayRelativeTime(now - 5 * 60_000, now)).toBe("5m ago");
    expect(formatTrayRelativeTime(now - 2 * 3_600_000, now)).toBe("2h ago");
  });
});
