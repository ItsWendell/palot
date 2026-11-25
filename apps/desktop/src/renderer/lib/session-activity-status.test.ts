import { describe, expect, it } from "vitest";
import type { JsonValue, PalotMessage, PalotMessageContent } from "../../shared";
import type { SessionRuntimeStatus } from "../atoms/workspace";
import { SESSION_PROJECTION_PRESETS } from "./session-projection-policy";
import {
  sessionActivityLabel,
  sessionActivityStatus,
  type SessionActivityStatus,
} from "./session-activity-status";
import {
  createSessionTranscriptProjector,
  type TranscriptTurn,
  type TurnActivityGroup,
} from "./turn-projection";
import type { PendingRequestView } from "./view-models";

function assistant(overrides: Partial<PalotMessage> = {}): PalotMessage {
  return {
    id: "assistant-1",
    type: "assistant",
    createdAt: 2,
    completedAt: null,
    text: null,
    agent: "build",
    model: null,
    tokens: null,
    finish: null,
    content: [],
    data: null,
    ...overrides,
  };
}

function tool(
  name: string,
  status: string,
  input: Record<string, JsonValue> = {},
  metadata: Record<string, JsonValue> = {},
): PalotMessageContent {
  return {
    type: "tool",
    id: `${name}-${JSON.stringify(input)}`,
    name,
    state: { status, input, metadata },
  };
}

function group(
  parts: PalotMessageContent[],
  overrides: Partial<TurnActivityGroup> = {},
  message = assistant(),
): TurnActivityGroup {
  return {
    id: `group-${parts.map((part) => part.id ?? part.type).join("-")}`,
    kind: "tools",
    title: "Working",
    status: "running",
    entries: parts.map((part, index) => ({ message, part, index })),
    ...overrides,
  };
}

function turn(
  activity: TurnActivityGroup[],
  overrides: Partial<TranscriptTurn> = {},
): TranscriptTurn {
  return {
    id: "turn-1",
    user: null,
    users: [],
    activity,
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
    ...overrides,
  };
}

function request(type: PendingRequestView["type"], id: string, title: string): PendingRequestView {
  return { id, type, title, resources: [], savePatterns: [], questions: [], fields: [] };
}

function status(input: {
  turn?: TranscriptTurn | null;
  requests?: PendingRequestView[];
  runtimeStatus?: SessionRuntimeStatus | null;
  stopping?: boolean;
}): SessionActivityStatus | null {
  return sessionActivityStatus({
    turn: input.turn ?? null,
    requests: input.requests ?? [],
    runtimeStatus: input.runtimeStatus ?? null,
    stopping: input.stopping,
  });
}

function label(value: SessionActivityStatus | null, now?: number) {
  return value ? sessionActivityLabel(value, now) : null;
}

const shell = (command: string, state = "running", input: Record<string, JsonValue> = {}) =>
  tool("shell", state, { command, ...input });
const subagent = (description: string, input: Record<string, JsonValue> = {}) =>
  tool("task", "running", { description, prompt: "Go", subagent_type: "explore", ...input });
const read = (path: string) => tool("read", "running", { path });

describe("sessionActivityStatus", () => {
  it("is null when nothing runs and nothing waits on the user", () => {
    expect(status({})).toBeNull();
    expect(status({ turn: turn([], { status: "completed" }) })).toBeNull();
    expect(status({ runtimeStatus: { type: "idle" } })).toBeNull();
  });

  it("waits for approval with the request title, even while a tool runs", () => {
    const value = status({
      turn: turn([group([shell("bun test")], { currentAction: "Running 'bun test'" })]),
      requests: [request("question", "q1", "Which branch?"), request("permission", "p1", "bash")],
    });
    expect(value).toEqual({ kind: "approval", requestID: "p1", detail: "bash" });
    expect(label(value)).toEqual({ label: "Waiting for approval", detail: "bash" });
  });

  it("counts a subagent's request while the parent turn is not running", () => {
    expect(status({ requests: [request("permission", "child-p", "edit")] })).toMatchObject({
      kind: "approval",
      requestID: "child-p",
    });
  });

  it("waits for an answer to a question or form", () => {
    const value = status({ turn: turn([]), requests: [request("form", "f1", "Deploy target")] });
    expect(value).toEqual({ kind: "answer", requestID: "f1", detail: "Deploy target" });
    expect(label(value)).toEqual({ label: "Waiting for your answer", detail: "Deploy target" });
  });

  it("does not wait on undelivered prompts", () => {
    expect(status({ turn: turn([]), requests: [request("input", "i1", "Pending input")] })).toEqual(
      { kind: "working" },
    );
    expect(status({ requests: [request("input", "i1", "Pending input")] })).toBeNull();
  });

  it("names the retry attempt and the next try, but a pending request comes first", () => {
    const runtimeStatus: SessionRuntimeStatus = {
      type: "retry",
      attempt: 2,
      message: "Overloaded",
      next: 15_000,
    };
    const value = status({ turn: turn([]), runtimeStatus });
    expect(value).toEqual({ kind: "retry", attempt: 2, next: 15_000 });
    expect(label(value, 10_000)).toEqual({
      label: "Retrying",
      detail: "Attempt 2, next try in 5s",
    });
    expect(label(value)).toEqual({ label: "Retrying", detail: "Attempt 2" });
    expect(status({ runtimeStatus })).toMatchObject({ kind: "retry" });
    expect(
      status({ turn: turn([]), runtimeStatus, requests: [request("question", "q1", "Continue?")] }),
    ).toMatchObject({ kind: "answer" });
  });

  it("falls back to the transcript's retry marker only without a runtime status", () => {
    const retrying = turn([
      group(
        [
          {
            type: "timeline-boundary",
            id: "runtime:retry",
            name: "Retrying response, attempt 3",
            status: "running",
            data: { kind: "retry", tone: "progress", at: 9_000 },
          },
        ],
        { kind: "boundary" },
      ),
    ]);
    expect(status({ turn: retrying })).toEqual({ kind: "retry", attempt: null, next: 9_000 });
    expect(status({ turn: retrying, runtimeStatus: { type: "busy" } })).toEqual({
      kind: "working",
    });
  });

  it("reports running compaction", () => {
    const value = status({
      turn: turn([
        group([{ type: "compaction", id: "c1", status: "running" }], { kind: "compaction" }),
      ]),
    });
    expect(value).toEqual({ kind: "compacting" });
    expect(label(value)?.label).toBe("Compacting context");
  });

  it("waits for one subagent with its description", () => {
    const value = status({ turn: turn([group([subagent("Map the auth flow")])]) });
    expect(value).toEqual({ kind: "subagents", count: 1, detail: "Map the auth flow" });
    expect(label(value)).toEqual({ label: "Waiting for subagent", detail: "Map the auth flow" });
  });

  it("counts several subagents", () => {
    const value = status({
      turn: turn([group([subagent("Map the auth flow"), subagent("Find the tests")])]),
    });
    expect(value).toEqual({ kind: "subagents", count: 2, detail: null });
    expect(label(value)?.label).toBe("Waiting for 2 subagents");
  });

  it("ignores background subagents and treats a subagent beside other tools as tools", () => {
    expect(status({ turn: turn([group([subagent("Watch CI", { background: true })])]) })).toEqual({
      kind: "working",
    });
    expect(
      status({ turn: turn([group([subagent("Map the auth flow"), shell("bun test")])]) }),
    ).toEqual({ kind: "tools", title: "Running 2 tools" });
  });

  it("does not wait on a subagent launch that already returned (OpenCode after 2.2.7)", () => {
    const launched = tool(
      "subagent",
      "completed",
      { agent: "explore", description: "Map the auth flow", prompt: "Go" },
      { sessionID: "child", status: "running" },
    );
    expect(status({ turn: turn([group([launched, read("src/a.ts")])]) })).toEqual({
      kind: "tools",
      title: "Working",
    });
    expect(status({ turn: turn([group([launched])], { status: "working" }) })).toEqual({
      kind: "working",
    });
  });

  it("says Stopping after Stop while work runs, below pending requests", () => {
    const running = turn([group([shell("bun test")])]);
    expect(status({ turn: running, stopping: true })).toEqual({ kind: "stopping" });
    expect(label(status({ turn: running, stopping: true }))).toEqual({
      label: "Stopping",
      detail: null,
    });
    expect(
      status({
        runtimeStatus: { type: "retry", attempt: 2, next: 5_000, message: "" },
        stopping: true,
      }),
    ).toEqual({ kind: "stopping" });
    expect(
      status({ turn: running, requests: [request("permission", "p1", "bash")], stopping: true })
        ?.kind,
    ).toBe("approval");
    expect(status({ turn: turn([], { status: "interrupted" }), stopping: true })).toBeNull();
  });

  it("names one foreground command and lets it move to the background", () => {
    const value = status({
      turn: turn([group([shell("bun test")], { currentAction: "Running 'bun test'" })]),
    });
    expect(value).toEqual({
      kind: "command",
      title: "Running 'bun test'",
      canBackground: true,
      startedAt: null,
    });
    expect(label(value)).toEqual({ label: "Running 'bun test'", detail: null });
  });

  it("takes the command title from the transcript projection", () => {
    const projection = createSessionTranscriptProjector().project({
      messages: [
        {
          ...assistant(),
          id: "user-1",
          type: "user",
          createdAt: 1,
          completedAt: 1,
          text: "Run the tests",
        },
        assistant({ content: [shell("bun test")] }),
      ],
      execution: { status: "running", startedAt: 1, completedAt: null },
      policy: SESSION_PROJECTION_PRESETS.compact,
    });
    expect(status({ turn: projection.rows.at(-1)!.turn })).toEqual({
      kind: "command",
      title: "Running 'bun test'",
      canBackground: true,
      startedAt: null,
    });
  });

  it("does not count a background shell as a running command", () => {
    const launched = shell("bun run dev", "completed", { background: true });
    const starting = shell("bun run dev", "running", { background: true });
    expect(status({ turn: turn([group([launched], { status: "completed" })]) })).toEqual({
      kind: "working",
    });
    expect(status({ turn: turn([group([starting])]) })).toEqual({ kind: "working" });
  });

  it("names one other running tool", () => {
    expect(
      status({ turn: turn([group([read("src/app.ts")], { title: "Reading file 'app.ts'" })]) }),
    ).toEqual({ kind: "tools", title: "Reading file 'app.ts'" });
  });

  it("uses the parallel phrase for several running tools", () => {
    expect(status({ turn: turn([group([read("a.ts"), read("b.ts")])]) })).toEqual({
      kind: "tools",
      title: "Reading 2 files",
    });
  });

  it("says Finishing while the answer streams after tools", () => {
    const answer = assistant({ id: "assistant-2" });
    const value = status({
      turn: turn([group([tool("read", "completed", { path: "a.ts" })], { status: "completed" })], {
        final: { message: answer, part: { type: "text", text: "Done", streaming: true }, index: 0 },
      }),
    });
    expect(value).toEqual({ kind: "answering", finishing: true });
    expect(label(value)?.label).toBe("Finishing");
  });

  it("says Working while an answer without tools streams, Finishing once it settles", () => {
    const final = (finish: PalotMessage["finish"]) => ({
      message: assistant({ finish }),
      part: { type: "text", text: "Hello", streaming: finish === null },
      index: 0,
    });
    const streaming = status({ turn: turn([], { final: final(null) }) });
    expect(streaming).toEqual({ kind: "answering", finishing: false });
    expect(label(streaming)?.label).toBe("Working");
    expect(status({ turn: turn([], { final: final("stop") }) })).toEqual({
      kind: "answering",
      finishing: true,
    });
  });

  it("shows the latest thought while reasoning is open", () => {
    const reasoning: PalotMessageContent = {
      type: "reasoning",
      id: "r1",
      text: "**Checking retry timing**\n\nThe timer may race the assertion.",
      time: { created: 2 },
    };
    const value = status({ turn: turn([group([reasoning], { kind: "reasoning" })]) });
    expect(value).toEqual({ kind: "thinking", thought: "Checking retry timing" });
    expect(label(value)?.label).toBe("Checking retry timing");

    const hidden = status({
      turn: turn([group([reasoning], { kind: "reasoning", showReasoningSummaries: false })]),
    });
    expect(hidden).toEqual({ kind: "thinking", thought: null });
    expect(label(hidden)?.label).toBe("Working");
  });

  it("says Working otherwise, including a busy session without a turn", () => {
    const settledReasoning: PalotMessageContent = {
      type: "reasoning",
      id: "r1",
      text: "Planned.",
      time: { created: 2, completed: 3 },
    };
    expect(status({ turn: turn([group([settledReasoning], { kind: "reasoning" })]) })).toEqual({
      kind: "working",
    });
    expect(status({ runtimeStatus: { type: "busy" } })).toEqual({ kind: "working" });
    expect(label({ kind: "working" })).toEqual({ label: "Working", detail: null });
  });
});
