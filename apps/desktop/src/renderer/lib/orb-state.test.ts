import { describe, expect, it } from "vitest";
import type { TranscriptTurn, TurnPart } from "./turn-projection";
import { resolveTurnOrbState } from "./orb-state";

function turn(input: Partial<TranscriptTurn>): TranscriptTurn {
  return {
    id: "turn",
    user: null,
    users: [],
    activity: [],
    blockingRequests: [],
    final: null,
    postFinal: [],
    tokensPerSecond: null,
    status: "working",
    startedAt: 1,
    finalStartedAt: null,
    workCompletedAt: null,
    completedAt: null,
    canCollapse: false,
    shouldAutoCollapse: false,
    ...input,
  };
}

function entry(type: string, name?: string): TurnPart {
  return {
    message: {
      id: "assistant",
      type: "assistant",
      createdAt: 1,
      completedAt: null,
      text: null,
      agent: null,
      model: null,
      tokens: null,
      finish: null,
      content: [],
      data: null,
    },
    part: { type, ...(name ? { name } : {}) },
    index: 0,
  };
}

describe("resolveTurnOrbState", () => {
  it("does not animate a settled turn", () => {
    expect(resolveTurnOrbState(turn({ status: "completed" }))).toBeNull();
  });

  it("uses semantic states for reasoning and tool boundaries", () => {
    expect(
      resolveTurnOrbState(
        turn({
          activity: [
            {
              id: "reasoning",
              kind: "reasoning",
              title: "Thinking",
              status: "running",
              entries: [entry("reasoning")],
            },
          ],
        }),
      ),
    ).toBe("solving");
    expect(
      resolveTurnOrbState(
        turn({
          activity: [
            {
              id: "read",
              kind: "tools",
              title: "Reading",
              status: "running",
              entries: [entry("tool", "read")],
            },
          ],
        }),
      ),
    ).toBe("searching");
    expect(
      resolveTurnOrbState(
        turn({
          activity: [
            {
              id: "edit",
              kind: "tools",
              title: "Editing",
              status: "running",
              entries: [entry("tool", "edit")],
            },
          ],
        }),
      ),
    ).toBe("shaping");
    expect(
      resolveTurnOrbState(
        turn({
          activity: [
            {
              id: "task",
              kind: "tools",
              title: "Delegating",
              status: "running",
              entries: [entry("tool", "task")],
            },
          ],
        }),
      ),
    ).toBe("weaving");
  });

  it("uses composing while final answer text streams", () => {
    const final = entry("text");
    expect(resolveTurnOrbState(turn({ final }))).toBe("composing");
  });
});
