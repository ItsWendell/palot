import { describe, expect, it } from "vitest";
import type { PalotMessage, PalotModel } from "../../shared";
import { getContextUsage } from "./context-usage";

const model: PalotModel = {
  id: "model-1",
  modelID: "model-1",
  providerID: "provider-1",
  name: "Model One",
  family: null,
  variants: [],
  inputLimit: null,
  contextLimit: 100_000,
  outputLimit: 10_000,
  releasedAt: 0,
  capabilities: { tools: true, input: ["text"], output: ["text"] },
  status: "active",
};

function assistant(input: number, output: number): PalotMessage {
  return {
    id: `message-${input}`,
    type: "assistant",
    createdAt: 1,
    completedAt: 2,
    text: null,
    agent: "build",
    model: { id: model.id, providerID: model.providerID },
    tokens: {
      input,
      output,
      reasoning: 1_000,
      cache: { read: 5_000, write: 0 },
    },
    finish: "stop",
    content: [],
    data: null,
  };
}

describe("getContextUsage", () => {
  it("uses the latest token-bearing assistant step and model context limit", () => {
    expect(getContextUsage([assistant(10_000, 4_000), assistant(20_000, 4_000)], [model])).toEqual({
      total: 30_000,
      limit: 100_000,
      percentage: 30,
    });
  });

  it("returns null when no assistant step has usage", () => {
    expect(getContextUsage([], [model])).toBeNull();
  });
});
