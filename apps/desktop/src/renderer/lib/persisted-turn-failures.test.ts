import { describe, expect, it } from "vitest";
import type { PalotMessage } from "../../shared";
import type { SessionExecutionState } from "../atoms/workspace";
import { withPersistedTurnFailures } from "./persisted-turn-failures";
import { projectTranscriptTurns, type TranscriptTurn } from "./turn-projection";

function message(input: Partial<PalotMessage> & Pick<PalotMessage, "id" | "type">): PalotMessage {
  return {
    createdAt: 1,
    completedAt: 2,
    text: null,
    agent: input.type === "assistant" ? "build" : null,
    model: null,
    tokens: null,
    finish: null,
    content: [],
    data: null,
    ...input,
  };
}

const prompt = message({ id: "u1", type: "user", text: "Fix the build", createdAt: 1 });
const toolStep = message({
  id: "a1",
  type: "assistant",
  createdAt: 2,
  completedAt: 3,
  finish: "tool-calls",
  content: [
    { type: "tool", id: "t1", name: "read", state: { status: "completed", input: { path: "a" } } },
  ],
});

function idle(id: string, createdAt: number, error?: Record<string, string | number>) {
  return message({
    id,
    type: "idle",
    createdAt,
    completedAt: createdAt,
    data: {
      id,
      type: "idle",
      outcome: "failed",
      time: { created: createdAt },
      ...(error ? { error } : {}),
    },
  });
}

function failureCards(turns: TranscriptTurn[]) {
  return turns.flatMap((turn) =>
    turn.activity.flatMap((group) =>
      group.entries.flatMap((entry) =>
        entry.part.type === "timeline-boundary" && entry.part.status === "failed"
          ? [{ turn: turn.id, name: entry.part.name, text: entry.part.text }]
          : [],
      ),
    ),
  );
}

describe("persisted turn failures", () => {
  it("shows the idle marker's failure after the turn's last step, with no execution state", () => {
    const messages = [
      prompt,
      toolStep,
      idle("i1", 4, { type: "ProviderError", message: "Rate limited" }),
    ];

    expect(failureCards(projectTranscriptTurns(messages))).toEqual([]);
    const turns = projectTranscriptTurns(withPersistedTurnFailures(messages));
    expect(failureCards(turns)).toEqual([
      { turn: "a1", name: "Response failed", text: "Rate limited" },
    ]);
    expect(turns.find((turn) => turn.id === "a1")?.status).toBe("failed");
  });

  it("titles usage limits and says when they reset", () => {
    const messages = [
      prompt,
      toolStep,
      idle("i1", 4, {
        type: "provider.free-limit",
        message: "Free usage limit reached.",
        retryAfterMs: 8 * 86_400_000,
      }),
    ];
    // An implausible wait shows the plain message.
    expect(failureCards(projectTranscriptTurns(withPersistedTurnFailures(messages)))).toEqual([
      { turn: "a1", name: "Free usage limit reached", text: "Free usage limit reached." },
    ]);

    const withReset = [
      prompt,
      toolStep,
      idle("i1", 4, {
        type: "provider.rate-limit",
        message: "Too many requests.",
        retryAfterMs: 3_600_000,
      }),
    ];
    const [card] = failureCards(projectTranscriptTurns(withPersistedTurnFailures(withReset)));
    expect(card?.name).toBe("Rate limited");
    expect(card?.text).toMatch(
      /^Too many requests\.\n\n(Try again after .+\.|The limit has reset; you can try again\.)$/,
    );
  });

  it("titles a live usage-limit failure before its message records it", () => {
    const execution: SessionExecutionState = {
      status: "failed",
      startedAt: 1,
      completedAt: 4,
      error: { type: "provider.quota", message: "Quota exceeded." },
    };
    expect(failureCards(projectTranscriptTurns([prompt, toolStep], execution))).toEqual([
      { turn: "a1", name: "Usage limit reached", text: "Quota exceeded." },
    ]);
  });

  it("does not duplicate the live execution error for the same turn", () => {
    const execution: SessionExecutionState = {
      status: "failed",
      startedAt: 1,
      completedAt: 4,
      error: { type: "ProviderError", message: "Rate limited" },
    };
    const live = projectTranscriptTurns([prompt, toolStep], execution);
    expect(failureCards(live)).toHaveLength(1);

    const reconciled = projectTranscriptTurns(
      withPersistedTurnFailures([
        prompt,
        toolStep,
        idle("i1", 4, { type: "ProviderError", message: "Rate limited" }),
      ]),
      execution,
    );
    expect(failureCards(reconciled)).toEqual([
      { turn: "a1", name: "Response failed", text: "Rate limited" },
    ]);
  });

  it("carries a failure that happened before any step, after the prompt that started it", () => {
    const turns = projectTranscriptTurns(
      withPersistedTurnFailures([
        prompt,
        toolStep,
        message({ id: "i0", type: "idle", createdAt: 4, data: { outcome: "succeeded" } }),
        message({ id: "u2", type: "user", text: "Try again", createdAt: 5 }),
        idle("i1", 6, { message: "Invalid API key" }),
      ]),
    );
    expect(failureCards(turns)).toEqual([
      { turn: "i1", name: "Response failed", text: "Invalid API key" },
    ]);
    expect(turns.map((turn) => turn.id)).toEqual(["u1", "a1", "u2", "i1"]);
  });

  it("leaves turns that already show their own failure or recorded none", () => {
    const failedStep = message({
      ...toolStep,
      data: { error: { type: "ProviderError", message: "Step failed" } },
    });
    const messages = [prompt, failedStep, idle("i1", 4, { message: "Step failed" })];
    expect(withPersistedTurnFailures(messages)).toBe(messages);

    const failedCompaction = message({
      id: "c1",
      type: "compaction",
      createdAt: 3,
      content: [{ type: "compaction", status: "failed", error: "Context overflow" }],
    });
    const compacted = [prompt, toolStep, failedCompaction, idle("i1", 4, { message: "Overflow" })];
    expect(withPersistedTurnFailures(compacted)).toBe(compacted);

    const legacy = [prompt, toolStep, idle("i1", 4)];
    expect(withPersistedTurnFailures(legacy)).toBe(legacy);
  });

  it("keeps projected messages stable across unchanged inputs", () => {
    const messages = [prompt, toolStep, idle("i1", 4, { message: "Rate limited" })];
    const first = withPersistedTurnFailures(messages);
    const second = withPersistedTurnFailures([...messages]);
    expect(second[1]).toBe(first[1]);
    expect(second[0]).toBe(prompt);
  });
});
