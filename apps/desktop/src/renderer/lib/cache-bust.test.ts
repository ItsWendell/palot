import { describe, expect, it } from "vitest";
import type { PalotMessage } from "../../shared";
import { likelyCacheBusts } from "./cache-bust";

function assistant(
  id: string,
  read: number,
  providerID = "anthropic",
  variant?: string,
): PalotMessage {
  return {
    id,
    type: "assistant",
    createdAt: 1,
    completedAt: 2,
    text: null,
    agent: null,
    model: { id: "model", providerID, ...(variant ? { variant } : {}) },
    tokens: { input: 10, output: 5, reasoning: 0, cache: { read, write: 0 } },
    finish: "stop",
    content: [],
    data: null,
  };
}

function compaction(): PalotMessage {
  return {
    id: "compaction",
    type: "compaction",
    createdAt: 2,
    completedAt: 3,
    text: null,
    agent: null,
    model: null,
    tokens: null,
    finish: null,
    content: [{ type: "compaction", status: "completed" }],
    data: null,
  };
}

describe("likely cache busts", () => {
  it("flags lower cache reuse on the same model and variant", () => {
    expect(
      likelyCacheBusts([
        assistant("one", 8_000, "anthropic", "high"),
        assistant("two", 3_000, "anthropic", "high"),
      ]),
    ).toEqual([{ messageID: "two", drop: 5_000, previousRead: 8_000, currentRead: 3_000 }]);
  });

  it("ignores model changes, completed compaction, and OpenAI bucket shifts", () => {
    const changed = assistant("changed", 2_000);
    changed.model = { id: "other", providerID: "anthropic" };
    expect(
      likelyCacheBusts([
        assistant("one", 8_000),
        changed,
        assistant("openai-one", 8_000, "openai"),
        assistant("openai-two", 6_500, "openai"),
        compaction(),
        assistant("after", 1_000),
      ]),
    ).toEqual([]);
  });
});
