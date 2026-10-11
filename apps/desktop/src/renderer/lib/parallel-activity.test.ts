import { describe, expect, it } from "vitest";
import type { PalotMessage, PalotMessageContent } from "../../shared";
import { parallelActivityLabel } from "./parallel-activity";
import { projectTranscriptTurns } from "./turn-projection";

function tool(id: string, name: string, status: string, input: Record<string, string>) {
  return { type: "tool", id, name, state: { status, input } } satisfies PalotMessageContent;
}

function workingTurn(content: PalotMessageContent[]) {
  const message: PalotMessage = {
    id: "assistant",
    type: "assistant",
    createdAt: 1,
    completedAt: null,
    text: null,
    agent: "build",
    model: null,
    tokens: null,
    finish: null,
    content,
    data: null,
  };
  return projectTranscriptTurns([message])[0]!;
}

describe("parallelActivityLabel", () => {
  it("counts concurrent tools by what they are doing", () => {
    expect(
      parallelActivityLabel(
        workingTurn([
          tool("a", "read", "running", { path: "a.ts" }),
          tool("b", "read", "running", { path: "b.ts" }),
          tool("c", "read", "pending", { path: "c.ts" }),
          tool("done", "read", "completed", { path: "d.ts" }),
        ]),
      ),
    ).toBe("Reading 3 files");
    expect(
      parallelActivityLabel(
        workingTurn([
          tool("a", "read", "running", { path: "a.ts" }),
          tool("b", "shell", "running", { command: "bun test" }),
          tool("c", "grep", "running", { pattern: "x" }),
          tool("d", "shell", "running", { command: "bun run lint" }),
        ]),
      ),
    ).toBe("Running 4 tools");
  });

  it("stays quiet for a single running tool", () => {
    expect(
      parallelActivityLabel(
        workingTurn([
          tool("a", "read", "running", { path: "a.ts" }),
          tool("b", "read", "completed", { path: "b.ts" }),
        ]),
      ),
    ).toBeNull();
  });
});
