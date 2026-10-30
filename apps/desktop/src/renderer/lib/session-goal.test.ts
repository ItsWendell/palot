import { describe, expect, it } from "vitest";
import { goalChangedEvent, parseSessionGoal, replacesGoal, type SessionGoal } from "./session-goal";

const raw = {
  id: "goal-1",
  objective: "Make the tests pass",
  status: "active",
  reason: "  Two tests still fail.  ",
  rounds: 3,
  maxRounds: 50,
  boot: "boot-1",
  updatedAt: 10,
};

describe("session goals", () => {
  it("reads the goal state OpenCode sends, trimming the reason", () => {
    expect(parseSessionGoal(raw)).toEqual({
      id: "goal-1",
      objective: "Make the tests pass",
      status: "active",
      reason: "Two tests still fail.",
      rounds: 3,
      maxRounds: 50,
      updatedAt: 10,
    });
  });

  it("treats no goal or an unknown shape as no goal", () => {
    expect(parseSessionGoal(null)).toBeNull();
    expect(parseSessionGoal({ ...raw, status: "abandoned" })).toBeNull();
    expect(parseSessionGoal({ ...raw, rounds: "3" })).toBeNull();
  });

  it("reads the changed event for one session, including a cleared goal", () => {
    expect(
      goalChangedEvent({ type: "rpc.opencode.goal.changed", data: { sessionID: "s1", goal: raw } }),
    ).toMatchObject({ sessionID: "s1", goal: { id: "goal-1" } });
    expect(
      goalChangedEvent({
        type: "rpc.opencode.goal.changed",
        data: { sessionID: "s1", goal: null },
      }),
    ).toEqual({ sessionID: "s1", goal: null });
    expect(goalChangedEvent({ type: "session.idle", data: { sessionID: "s1" } })).toBeNull();
  });

  it("asks before a new objective replaces an unfinished goal, not for controls", () => {
    const goal = parseSessionGoal(raw) as SessionGoal;
    expect(replacesGoal(goal, "Ship the release")).toBe(true);
    for (const control of [undefined, "", "pause", " Resume ", '"clear"'])
      expect(replacesGoal(goal, control)).toBe(false);
    expect(replacesGoal({ ...goal, status: "complete" }, "Ship the release")).toBe(false);
    expect(replacesGoal(null, "Ship the release")).toBe(false);
  });
});
