import { describe, expect, it } from "vitest";
import type { JsonValue, PalotMessage, PalotMessageContent } from "../../shared";
import { SESSION_PROJECTION_PRESETS } from "./session-projection-policy";
import { createSessionTranscriptProjector, type TranscriptTurn } from "./turn-projection";
import { turnWorkSummary, turnWorkSummaryClauses, type TurnWorkSummary } from "./turn-work-summary";

function message(overrides: Partial<PalotMessage>): PalotMessage {
  return {
    id: "assistant-1",
    type: "assistant",
    createdAt: 2,
    completedAt: 3,
    text: null,
    agent: "build",
    model: null,
    tokens: null,
    finish: "stop",
    content: [],
    data: null,
    ...overrides,
  };
}

let toolID = 0;

function tool(
  name: string,
  status: string,
  input: Record<string, JsonValue> = {},
  extra: Record<string, JsonValue> = {},
): PalotMessageContent {
  toolID += 1;
  return { type: "tool", id: `tool-${toolID}`, name, state: { status, input, ...extra } };
}

function edit(
  path: string,
  status = "completed",
  lines?: { additions: number; deletions: number },
) {
  return tool(
    "edit",
    status,
    { path, oldString: "a", newString: "b" },
    lines
      ? {
          metadata: { files: [{ file: path, patch: "@@ -1 +1 @@", status: "modified", ...lines }] },
        }
      : {},
  );
}

function shell(command: string, status = "completed", extra: Record<string, JsonValue> = {}) {
  return tool("shell", status, { command }, extra);
}

const stopped = { error: { type: "aborted", message: "Tool execution aborted" } };

/** One finished prompt whose assistant steps used `steps` (one array per step), then answered. */
function finishedTurn(...steps: PalotMessageContent[][]): TranscriptTurn {
  const messages = [
    message({ id: "user-1", type: "user", createdAt: 1, completedAt: 1, text: "Do the work" }),
    ...steps.map((content, index) =>
      message({
        id: `assistant-${index + 1}`,
        createdAt: 2 + index,
        completedAt: 2 + index,
        finish: "tool-calls",
        content,
      }),
    ),
    message({
      id: "assistant-answer",
      createdAt: 10,
      completedAt: 11,
      content: [{ type: "text", text: "Done." }],
    }),
  ];
  const projection = createSessionTranscriptProjector().project({
    messages,
    execution: { status: "succeeded", startedAt: 1, completedAt: 11 },
    policy: SESSION_PROJECTION_PRESETS.compact,
  });
  const turns = projection.rows.map((row) => row.turn);
  return { ...turns[0]!, activity: turns.flatMap((turn) => turn.activity) };
}

function summary(overrides: Partial<TurnWorkSummary> = {}): TurnWorkSummary {
  return {
    changedFiles: 0,
    additions: null,
    deletions: null,
    commands: 0,
    subagents: 0,
    failed: 0,
    machines: [],
    ...overrides,
  };
}

describe("turnWorkSummary", () => {
  it("counts a file once across several edits and totals their lines", () => {
    const turn = finishedTurn(
      [edit("src/a.ts", "completed", { additions: 3, deletions: 1 })],
      [
        edit("src/a.ts", "completed", { additions: 5, deletions: 2 }),
        edit("src/b.ts", "completed", { additions: 1, deletions: 0 }),
      ],
    );
    expect(turnWorkSummary(turn)).toEqual(summary({ changedFiles: 2, additions: 9, deletions: 3 }));
  });

  it("leaves line totals unknown when no edit reported them", () => {
    const turn = finishedTurn([edit("src/a.ts"), edit("src/b.ts")]);
    expect(turnWorkSummary(turn)).toEqual(summary({ changedFiles: 2 }));
  });

  it("counts a failed call as a failure and a stopped call as neither", () => {
    const turn = finishedTurn([
      shell("bun test", "completed", { metadata: { exit: 1 } }),
      shell("bun run build"),
      shell("bun run dev", "error", stopped),
      edit("src/a.ts", "error", undefined),
      edit("src/b.ts", "error", undefined),
    ]);
    const result = turnWorkSummary(turn);
    expect(result).toMatchObject({ commands: 2, failed: 3, changedFiles: 0 });
  });

  it("does not count calls that never started", () => {
    const turn = finishedTurn([
      shell("bun test", "pending"),
      edit("src/a.ts", "pending"),
      tool("task", "pending", { description: "Explore", prompt: "Go", subagent_type: "explore" }),
      tool("task", "completed", { description: "Review", prompt: "Go", subagent_type: "general" }),
    ]);
    expect(turnWorkSummary(turn)).toEqual(summary({ subagents: 1 }));
  });

  it("does not mention reads, searches or web activity", () => {
    const turn = finishedTurn([
      tool("read", "completed", { path: "src/a.ts" }),
      tool("grep", "completed", { pattern: "TODO" }),
      tool("webfetch", "completed", { url: "https://example.com" }),
    ]);
    expect(turnWorkSummaryClauses(turnWorkSummary(turn))).toEqual([]);
  });

  it("says which machines the calls worked on, keeping failures last", () => {
    const turn = finishedTurn([
      tool("read", "completed", { path: "devbox:/srv/app/a.ts" }),
      tool(
        "shell",
        "completed",
        { command: "ls", workdir: "devbox:/srv" },
        { metadata: { exit: 1 } },
      ),
      tool("read", "completed", { path: "src/local.ts" }),
    ]);
    const result = turnWorkSummary(turn);
    expect(result.machines).toEqual(["devbox"]);
    expect(turnWorkSummaryClauses(result)).toEqual(["ran 1 command", "on devbox", "1 failed"]);
  });

  it("counts a call once when the turn lists it twice", () => {
    const turn = finishedTurn([shell("bun test")]);
    const doubled = { ...turn, activity: [...turn.activity, ...turn.activity] };
    expect(turnWorkSummary(doubled).commands).toBe(1);
  });
});

describe("turnWorkSummaryClauses", () => {
  it("puts changes first, then commands, subagents and failures", () => {
    expect(
      turnWorkSummaryClauses(
        summary({
          changedFiles: 3,
          additions: 40,
          deletions: 12,
          commands: 4,
          subagents: 2,
          failed: 1,
        }),
      ),
    ).toEqual(["changed 3 files +40 −12", "ran 4 commands", "2 subagents", "1 failed"]);
  });

  it("uses the singular for one and omits unknown line counts", () => {
    expect(
      turnWorkSummaryClauses(summary({ changedFiles: 1, commands: 1, subagents: 1, failed: 2 })),
    ).toEqual(["changed 1 file", "ran 1 command", "1 subagent", "2 failed"]);
  });

  it("is empty when there is nothing to say", () => {
    expect(turnWorkSummaryClauses(summary())).toEqual([]);
  });
});
