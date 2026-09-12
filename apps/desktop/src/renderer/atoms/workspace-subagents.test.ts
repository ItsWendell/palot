import { describe, expect, it } from "vitest";
import { activeShellCount, subagentProgress, type SessionExecutionState } from "./workspace";

function state(
  status: SessionExecutionState["status"],
  parentID?: string,
  startedAt: number | null = null,
  completedAt: number | null = null,
): SessionExecutionState {
  return { status, startedAt, completedAt, parentID };
}

describe("subagentProgress", () => {
  it("counts active and total direct and nested child sessions for the current turn", () => {
    const states = new Map([
      ["parent", state("running", undefined, 100)],
      ["child-running", state("running", "parent", 110)],
      ["child-done", state("succeeded", "parent", 120, 130)],
      ["nested-running", state("running", "child-running", 140)],
      ["historical", state("succeeded", "parent", 10, 20)],
      ["unrelated", state("running", "other-parent", 150)],
    ]);

    expect(subagentProgress(states, "parent", 100)).toEqual({ active: 2, total: 3 });
    expect(subagentProgress(states, "child-running", 100)).toEqual({ active: 1, total: 1 });
  });

  it("does not loop on malformed parent relationships", () => {
    const states = new Map([
      ["child-a", state("running", "child-b")],
      ["child-b", state("running", "child-a")],
    ]);

    expect(subagentProgress(states, "parent", null)).toEqual({ active: 0, total: 0 });
  });
});

describe("activeShellCount", () => {
  it("counts shells in the selected session and nested subagent sessions", () => {
    const states = new Map([
      ["parent", state("running")],
      ["child", state("running", "parent")],
      ["nested", state("running", "child")],
      ["other", state("running")],
    ]);
    const shells = new Map([
      ["parent", new Set(["parent-shell"])],
      ["child", new Set(["child-shell-1", "child-shell-2"])],
      ["nested", new Set(["nested-shell"])],
      ["other", new Set(["other-shell"])],
    ]);

    expect(activeShellCount(shells, states, "parent")).toBe(4);
    expect(activeShellCount(shells, states, "child")).toBe(3);
  });
});
