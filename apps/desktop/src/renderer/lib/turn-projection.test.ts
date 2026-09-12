import { describe, expect, it } from "vitest";
import type { PalotMessage } from "../../shared";
import type { PendingRequestView } from "./view-models";
import { mergeOptimisticMessages } from "./message-reconcile";
import {
  createSessionTranscriptProjector,
  createReasoningTitle,
  projectTranscriptTurns,
  sameTranscriptTurn,
  sameTurnActivityGroup,
} from "./turn-projection";
import {
  resolveSessionProjectionPreference,
  SESSION_PROJECTION_PRESETS,
} from "./session-projection-policy";

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

function row(messages: PalotMessage[], id: string) {
  return projectTranscriptTurns(messages).find((item) => item.id === id);
}

describe("projectTranscriptTurns", () => {
  it("retains prompt entries and array while assistant content streams", () => {
    const projector = createSessionTranscriptProjector();
    const user = message({ id: "prompt", type: "user", text: "Inspect the code" });
    const assistant = message({
      id: "answer",
      type: "assistant",
      createdAt: 3,
      completedAt: null,
      content: [{ type: "text", text: "Starting" }],
    });
    const first = projector.project({ messages: [user, assistant] });
    const next = projector.project({
      messages: [
        user,
        {
          ...assistant,
          content: [{ type: "text", text: "Starting the inspection" }],
        },
      ],
    });
    expect(next.prompts).toBe(first.prompts);
    expect(next.prompts[0]).toBe(first.prompts[0]);
    expect(next.prompts[0]).toEqual({
      messageID: "prompt",
      turnID: "prompt",
      rowIndex: 0,
      label: "Inspect the code",
    });
  });

  it("updates prepended prompt row positions without changing destination IDs", () => {
    const projector = createSessionTranscriptProjector();
    const user = message({ id: "recent", type: "user", createdAt: 10, text: "Recent" });
    const first = projector.project({ messages: [user] });
    const next = projector.project({
      messages: [
        message({ id: "older", type: "user", createdAt: 1, text: "Older" }),
        message({
          id: "older-answer",
          type: "assistant",
          createdAt: 2,
          content: [{ type: "text", text: "Answer" }],
        }),
        user,
      ],
    });
    expect(next.prompts[1]).toEqual({ ...first.prompts[0], rowIndex: 2 });
    expect(next.prompts).not.toBe(first.prompts);
  });

  it("indexes exactly the presented admitted users, not optimistic drafts", () => {
    const messages = [
      message({ id: "first", type: "user", createdAt: 1 }),
      message({ id: "second", type: "user", createdAt: 2 }),
      message({ id: "draft", type: "user", createdAt: 3, optimistic: true }),
    ];
    const projection = createSessionTranscriptProjector().project({ messages });
    expect(projection.prompts.map((prompt) => prompt.messageID)).toEqual(["first", "second"]);
    expect(projection.prompts.map((prompt) => prompt.messageID)).toEqual(
      projection.presentationRows.flatMap((row) =>
        row.kind === "user-message" && !row.message.optimistic ? [row.message.id] : [],
      ),
    );
  });

  it("uses bounded review display text and attachment labels", () => {
    const projection = createSessionTranscriptProjector().project({
      messages: [
        message({
          id: "review",
          type: "user",
          createdAt: 1,
          text: "RAW SERIALIZED CONTEXT",
          data: { metadata: { displayText: " Review\n  this change ", comments: [] } },
        }),
        message({
          id: "file",
          type: "user",
          createdAt: 2,
          files: [
            { name: "diagram.png", mime: "image/png", uri: "file:///diagram.png", size: null },
          ],
        }),
        message({ id: "empty", type: "user", createdAt: 3 }),
        message({ id: "long", type: "user", createdAt: 4, text: "a".repeat(10000) }),
        message({
          id: "invalid",
          type: "user",
          createdAt: 5,
          text: "Actual prompt",
          data: { metadata: { displayText: { bad: true } } },
        }),
      ],
    });
    expect(projection.prompts.map((prompt) => prompt.label)).toEqual([
      "Review this change",
      "diagram.png",
      "Prompt",
      "a".repeat(240),
      "Actual prompt",
    ]);
  });

  it("places hydrated steers after compaction even when they were enqueued before it", () => {
    const steers = ["alpha", "beta"].map((id, index) =>
      message({
        id,
        type: "user",
        optimistic: true,
        createdAt: 10 + index,
        timelineAt: 10 + index,
        delivery: "steer",
        text: id,
      }),
    );
    const compaction = message({
      id: "compaction",
      type: "compaction",
      createdAt: 20,
      content: [{ type: "compaction", status: "completed", text: "Summary" }],
    });
    const projector = createSessionTranscriptProjector();
    projector.project({ messages: steers });
    const messages = mergeOptimisticMessages(
      [
        compaction,
        ...steers.map((steer, index) => ({
          ...steer,
          optimistic: undefined,
          timelineAt: undefined,
          createdAt: 30 + index,
        })),
      ],
      steers,
    );

    expect(projector.project({ messages }).rows.map((row) => row.id)).toEqual([
      "compaction",
      "alpha",
      "beta",
    ]);
  });

  it("projects focused activity as one compact summary", () => {
    const assistant = message({
      id: "assistant",
      type: "assistant",
      finish: "stop",
      content: [
        { type: "reasoning", id: "reasoning", text: "Inspecting." },
        {
          type: "tool",
          id: "read",
          name: "read",
          state: { status: "completed", input: { path: "src/a.ts" } },
        },
        {
          type: "tool",
          id: "search",
          name: "shell",
          state: { status: "completed", input: { command: "rg TODO src" } },
        },
        {
          type: "tool",
          id: "edit",
          name: "edit",
          state: { status: "completed", input: { path: "src/a.ts", text: "next" } },
        },
        {
          type: "tool",
          id: "command",
          name: "shell",
          state: { status: "completed", input: { command: "bun run test" } },
        },
        { type: "text", id: "final", text: "Done" },
      ],
    });

    const turn = projectTranscriptTurns(
      [assistant],
      null,
      [],
      [],
      null,
      null,
      SESSION_PROJECTION_PRESETS["code-focus"],
    )[0]!;

    expect(turn.activity).toMatchObject([
      {
        title: "Read 1 file, searched code 1 time, changed 1 file, and ran 1 command",
        presentation: "grouped",
        defaultOpen: false,
        showReasoningSummaries: false,
      },
    ]);
    expect(turn.shouldAutoCollapse).toBe(true);
  });

  it("deduplicates changed files in semantic group summaries", () => {
    const assistant = message({
      id: "assistant",
      type: "assistant",
      finish: "stop",
      content: [
        {
          type: "tool",
          id: "first",
          name: "edit",
          state: { status: "completed", input: { path: "src/a.ts", text: "first" } },
        },
        {
          type: "tool",
          id: "second",
          name: "edit",
          state: { status: "completed", input: { path: "src/a.ts", text: "second" } },
        },
        { type: "text", id: "final", text: "Done" },
      ],
    });

    const turn = projectTranscriptTurns(
      [assistant],
      null,
      [],
      [],
      null,
      null,
      SESSION_PROJECTION_PRESETS.compact,
    )[0]!;

    expect(turn.activity).toMatchObject([{ title: "Changed 1 file", entries: [{}, {}] }]);
  });

  it("deduplicates read paths and describes directory listings separately", () => {
    const assistant = message({
      id: "assistant",
      type: "assistant",
      finish: "stop",
      content: [
        {
          type: "tool",
          id: "first-read",
          name: "read",
          state: { status: "completed", input: { path: "src/a.ts" } },
        },
        {
          type: "tool",
          id: "second-read",
          name: "read",
          state: { status: "completed", input: { path: "src/a.ts" } },
        },
        {
          type: "tool",
          id: "list",
          name: "list",
          state: { status: "completed", input: { path: "src" } },
        },
        { type: "text", id: "final", text: "Done" },
      ],
    });

    const turn = projectTranscriptTurns(
      [assistant],
      null,
      [],
      [],
      null,
      null,
      SESSION_PROJECTION_PRESETS.compact,
    )[0]!;

    expect(turn.activity).toMatchObject([
      { title: "Read 1 file and listed 1 directory", entries: [{}, {}, {}] },
    ]);
  });

  it("groups skill loads with reads instead of delegation", () => {
    const assistant = message({
      id: "assistant",
      type: "assistant",
      finish: "stop",
      content: [
        {
          type: "tool",
          id: "skill",
          name: "skill",
          state: { status: "completed", input: { name: "diagnosing-bugs" } },
        },
        {
          type: "tool",
          id: "read",
          name: "read",
          state: { status: "completed", input: { path: "src/a.ts" } },
        },
        { type: "text", id: "final", text: "Done" },
      ],
    });

    const turn = projectTranscriptTurns(
      [assistant],
      null,
      [],
      [],
      null,
      null,
      SESSION_PROJECTION_PRESETS["code-focus"],
    )[0]!;

    expect(turn.activity).toMatchObject([
      {
        title: "Read 1 file and loaded 1 skill",
        categories: ["read"],
        presentation: "grouped",
        pinned: false,
        entries: [{ part: { id: "skill" } }, { part: { id: "read" } }],
      },
    ]);
  });

  it("uses the latest reasoning title for completed groups when configured", () => {
    const assistant = message({
      id: "assistant",
      type: "assistant",
      finish: "stop",
      content: [
        { type: "reasoning", id: "reasoning", text: "**Tracing the projection settings**" },
        {
          type: "tool",
          id: "read",
          name: "read",
          state: { status: "completed", input: { path: "src/a.ts" } },
        },
        { type: "text", id: "final", text: "Done" },
      ],
    });
    const policy = resolveSessionProjectionPreference({
      version: 2,
      preset: "compact",
      groupTitle: "latest-reasoning",
    });

    const turn = projectTranscriptTurns([assistant], null, [], [], null, null, policy)[0]!;

    expect(turn.activity).toMatchObject([
      { title: "Tracing the projection settings", presentation: "grouped" },
    ]);
  });

  it("projects the repeated read grouping preference onto activity groups", () => {
    const assistant = message({
      id: "assistant",
      type: "assistant",
      finish: "stop",
      content: [
        {
          type: "tool",
          id: "first-read",
          name: "read",
          state: { status: "completed", input: { path: "src/a.ts", offset: 1 } },
        },
        {
          type: "tool",
          id: "second-read",
          name: "read",
          state: { status: "completed", input: { path: "src/a.ts", offset: 100 } },
        },
        { type: "text", id: "final", text: "Done" },
      ],
    });
    const policy = resolveSessionProjectionPreference({
      version: 2,
      preset: "expanded",
      groupSameFileReads: true,
    });

    const turn = projectTranscriptTurns([assistant], null, [], [], null, null, policy)[0]!;

    expect(turn.activity).toMatchObject([
      {
        presentation: "individual",
        groupSameFileReads: true,
        entries: [{}, {}],
      },
    ]);
  });

  it("keeps adjacent delegation individually identifiable and pinned", () => {
    const assistant = message({
      id: "assistant",
      type: "assistant",
      finish: "stop",
      content: [
        {
          type: "tool",
          id: "first-task",
          name: "task",
          state: { status: "completed", input: { description: "Inspect one" } },
        },
        {
          type: "tool",
          id: "second-task",
          name: "task",
          state: { status: "completed", input: { description: "Inspect two" } },
        },
        { type: "text", id: "final", text: "Done" },
      ],
    });

    const turn = projectTranscriptTurns(
      [assistant],
      null,
      [],
      [],
      null,
      null,
      SESSION_PROJECTION_PRESETS.compact,
    )[0]!;

    expect(turn.activity).toMatchObject([
      {
        title: "Delegating 'Inspect one'",
        categories: ["delegation"],
        presentation: "individual",
        pinned: true,
        entries: [{}],
      },
      {
        title: "Delegating 'Inspect two'",
        categories: ["delegation"],
        presentation: "individual",
        pinned: true,
        entries: [{}],
      },
    ]);
  });

  it("keeps failed tool calls inside their grouped activity", () => {
    const assistant = message({
      id: "assistant",
      type: "assistant",
      finish: "stop",
      content: [
        {
          type: "tool",
          id: "read",
          name: "read",
          state: { status: "completed", input: { path: "src/a.ts" } },
        },
        {
          type: "tool",
          id: "shell-failed",
          name: "shell",
          state: { status: "error", input: { command: "bun test" }, error: "Tests failed" },
        },
        {
          type: "tool",
          id: "read-after-failure",
          name: "read",
          state: { status: "completed", input: { path: "src/b.ts" } },
        },
        { type: "text", id: "final", text: "Done" },
      ],
    });

    const turn = projectTranscriptTurns(
      [assistant],
      null,
      [],
      [],
      null,
      null,
      SESSION_PROJECTION_PRESETS["code-focus"],
    )[0]!;

    expect(turn.activity).toMatchObject([
      {
        status: "failed",
        presentation: "grouped",
        defaultOpen: true,
        entries: [{ part: { id: "read" } }, { part: { id: "shell-failed" } }],
      },
      {
        status: "completed",
        presentation: "grouped",
        entries: [{ part: { id: "read-after-failure" } }],
      },
    ]);
  });

  it("hides only completed successful activity", () => {
    const policy = resolveSessionProjectionPreference({
      version: 2,
      preset: "code-focus",
      categories: { read: { presentation: "hidden" } },
    });
    const completed = message({
      id: "completed",
      type: "assistant",
      content: [{ type: "tool", id: "read", name: "read", state: { status: "completed" } }],
    });
    const failed = message({
      id: "failed",
      type: "assistant",
      content: [
        {
          type: "tool",
          id: "read-failed",
          name: "read",
          state: { status: "error", error: "Denied" },
        },
      ],
    });

    expect(
      projectTranscriptTurns([completed], null, [], [], null, null, policy)[0]?.activity,
    ).toEqual([]);
    expect(
      projectTranscriptTurns([failed], null, [], [], null, null, policy)[0]?.activity,
    ).toMatchObject([{ status: "failed", presentation: "individual", defaultOpen: false }]);
  });

  it("keeps hidden-category activity visible when its turn is interrupted", () => {
    const policy = resolveSessionProjectionPreference({
      version: 2,
      preset: "code-focus",
      categories: { read: { presentation: "hidden" } },
    });
    const interrupted = message({
      id: "interrupted",
      type: "assistant",
      finish: "error",
      content: [
        {
          type: "tool",
          id: "read",
          name: "read",
          state: { status: "completed", input: { path: "src/a.ts" } },
        },
      ],
      data: { error: { type: "MessageAbortedError", message: "Stopped by the user" } },
    });

    expect(
      projectTranscriptTurns([interrupted], null, [], [], null, null, policy)[0],
    ).toMatchObject({
      status: "interrupted",
      activity: expect.arrayContaining([
        expect.objectContaining({ categories: ["read"], presentation: "individual" }),
      ]),
    });
  });

  it("keeps blocking-request activity visible, expanded, and outside groups", () => {
    const policy = resolveSessionProjectionPreference({
      version: 2,
      preset: "code-focus",
      categories: { read: { presentation: "hidden" } },
    });
    const assistant = message({
      id: "assistant",
      type: "assistant",
      content: [
        {
          type: "tool",
          id: "read",
          name: "read",
          state: { status: "completed", input: { path: "src/a.ts" } },
        },
      ],
    });
    const permission: PendingRequestView = {
      id: "permission",
      type: "permission",
      title: "Read file",
      resources: [],
      savePatterns: [],
      questions: [],
      fields: [],
      ownerMessageID: assistant.id,
    };

    expect(
      projectTranscriptTurns([assistant], null, [permission], [], null, null, policy)[0]?.activity,
    ).toMatchObject([
      {
        categories: ["read"],
        presentation: "individual",
        defaultOpen: true,
        pinned: true,
      },
    ]);
  });

  it("does not group visible activity across a hidden chronological row", () => {
    const policy = resolveSessionProjectionPreference({
      version: 2,
      preset: "compact",
      categories: { command: { presentation: "hidden" } },
    });
    const assistant = message({
      id: "assistant",
      type: "assistant",
      content: [
        {
          type: "tool",
          id: "first-read",
          name: "read",
          state: { status: "completed", input: { path: "src/a.ts" } },
        },
        {
          type: "tool",
          id: "command",
          name: "shell",
          state: { status: "completed", input: { command: "bun run test" } },
        },
        {
          type: "tool",
          id: "second-read",
          name: "read",
          state: { status: "completed", input: { path: "src/b.ts" } },
        },
      ],
    });

    expect(
      projectTranscriptTurns([assistant], null, [], [], null, null, policy)[0]?.activity,
    ).toMatchObject([
      { title: "Read 1 file", entries: [{ part: { id: "first-read" } }] },
      { title: "Read 1 file", entries: [{ part: { id: "second-read" } }] },
    ]);
  });

  it("keeps individual subagent launches between surrounding grouped activity", () => {
    const policy = resolveSessionProjectionPreference({
      version: 2,
      preset: "compact",
      categories: { delegation: { foldedTurn: "inside" } },
    });
    const assistant = message({
      id: "assistant",
      type: "assistant",
      content: [
        {
          type: "tool",
          id: "read",
          name: "read",
          state: { status: "completed", input: { path: "src/a.ts" } },
        },
        {
          type: "tool",
          id: "first-task",
          name: "task",
          state: { status: "completed", input: { description: "Inspect one" } },
        },
        {
          type: "tool",
          id: "second-task",
          name: "task",
          state: { status: "completed", input: { description: "Inspect two" } },
        },
        {
          type: "tool",
          id: "search",
          name: "grep",
          state: { status: "completed", input: { pattern: "TODO" } },
        },
      ],
    });

    expect(
      projectTranscriptTurns([assistant], null, [], [], null, null, policy)[0]?.activity,
    ).toMatchObject([
      { categories: ["read"] },
      { title: "Delegating 'Inspect one'", categories: ["delegation"], entries: [{}] },
      { title: "Delegating 'Inspect two'", categories: ["delegation"], entries: [{}] },
      { categories: ["code-search"] },
    ]);
  });

  it("isolates the active entry when a turn becomes interrupted", () => {
    const assistant = message({
      id: "assistant",
      type: "assistant",
      content: [
        {
          type: "tool",
          id: "completed-read",
          name: "read",
          state: { status: "completed", input: { path: "src/a.ts" } },
        },
        {
          type: "tool",
          id: "running-read",
          name: "read",
          state: { status: "running", input: { path: "src/b.ts" } },
        },
      ],
    });

    expect(
      projectTranscriptTurns(
        [assistant],
        { status: "interrupted", startedAt: 1, completedAt: 2 },
        [],
        [],
        null,
        null,
        SESSION_PROJECTION_PRESETS.compact,
      )[0]?.activity,
    ).toMatchObject([
      { status: "completed", entries: [{ part: { id: "completed-read" } }] },
      { status: "interrupted", entries: [{ part: { id: "running-read" } }] },
    ]);
  });
  it("projects each native message as a chronological row without inferring ownership", () => {
    const first = message({ id: "first", type: "user", createdAt: 10, text: "Start" });
    const progress = message({
      id: "progress",
      type: "assistant",
      createdAt: 12,
      finish: "tool-calls",
      content: [{ type: "text", text: "I am implementing this now." }],
    });
    const steer = message({
      id: "steer",
      type: "user",
      createdAt: 20,
      delivery: "steer",
      text: "Change direction",
    });
    const answer = message({
      id: "answer",
      type: "assistant",
      createdAt: 21,
      finish: "stop",
      content: [{ type: "text", text: "Done" }],
    });

    const rows = projectTranscriptTurns([first, progress, steer, answer]);

    expect(rows.map((item) => item.id)).toEqual(["first", "progress", "steer", "answer"]);
    expect(rows[0]?.user).toBe(first);
    expect(rows[1]?.activity[0]?.entries[0]?.message).toBe(progress);
    expect(rows[1]?.final).toBeNull();
    expect(rows[2]?.user).toBe(steer);
    expect(rows[3]?.final?.message).toBe(answer);
  });

  it("sorts out-of-order receipts by native message chronology", () => {
    const user = message({ id: "user", type: "user", createdAt: 10 });
    const assistant = message({
      id: "assistant",
      type: "assistant",
      createdAt: 20,
      content: [{ type: "text", text: "Done" }],
    });

    expect(projectTranscriptTurns([assistant, user]).map((item) => item.id)).toEqual([
      "user",
      "assistant",
    ]);
  });

  it("places equal-timestamp user input before assistant output", () => {
    const assistant = message({
      id: "assistant",
      type: "assistant",
      createdAt: 20,
      content: [{ type: "reasoning", text: "Working" }],
    });
    const user = message({ id: "user", type: "user", createdAt: 20 });

    expect(projectTranscriptTurns([assistant, user]).map((item) => item.id)).toEqual([
      "user",
      "assistant",
    ]);
  });

  it("carries native agent, model, and location state forward", () => {
    const rows = projectTranscriptTurns(
      [
        message({
          id: "agent",
          type: "agent-switched",
          createdAt: 1,
          data: { agent: "build" },
        }),
        message({
          id: "model",
          type: "model-switched",
          createdAt: 2,
          data: { model: { id: "gpt-5", providerID: "openai", variant: "high" } },
        }),
        message({
          id: "location",
          type: "location-switched",
          createdAt: 3,
          data: { location: { directory: "/tmp/worktree", workspaceID: "workspace" } },
        }),
        message({ id: "user", type: "user", createdAt: 4 }),
      ],
      null,
      [],
      [],
      null,
      { directory: "/repo" },
    );

    expect(rows.at(-1)?.context).toEqual({
      agent: "build",
      model: { id: "gpt-5", providerID: "openai", variant: "high" },
      location: { directory: "/tmp/worktree", workspaceID: "workspace" },
    });
    expect(rows.map((turn) => turn.id)).toEqual(["user"]);
  });

  it("uses hydrated assistant agent and model on the assistant row", () => {
    const assistant = message({
      id: "assistant",
      type: "assistant",
      agent: "build",
      model: { id: "gpt-5", providerID: "openai" },
      content: [{ type: "text", text: "Done" }],
    });

    expect(projectTranscriptTurns([assistant])[0]?.context).toMatchObject({
      agent: "build",
      model: { id: "gpt-5", providerID: "openai" },
    });
  });

  it("preserves native assistant part order while exposing the last text as final", () => {
    const assistant = message({
      id: "assistant",
      type: "assistant",
      createdAt: 10,
      finish: "stop",
      content: [
        {
          type: "reasoning",
          id: "reasoning",
          text: "Clarifying client stack terminology",
          time: { created: 30, completed: 31 },
        },
        {
          type: "text",
          id: "answer",
          text: "No, Palot does not use TanStack Query.",
          time: { created: 20, completed: 21 },
        },
      ],
    });

    const projected = row([assistant], assistant.id);

    expect(projected?.activity[0]?.entries[0]?.part).toMatchObject({ id: "reasoning" });
    expect(projected?.final?.part).toMatchObject({ id: "answer" });
  });

  it("keeps intermediate assistant commentary in source order", () => {
    const assistant = message({
      id: "assistant",
      type: "assistant",
      finish: "stop",
      content: [
        { type: "text", id: "commentary", text: "I am checking the mapper." },
        {
          type: "tool",
          id: "read",
          name: "read",
          state: { status: "completed", input: { path: "src/mapper.ts" } },
        },
        { type: "text", id: "answer", text: "The mapper is correct." },
      ],
    });

    const projected = row([assistant], assistant.id);

    expect(projected?.activity.map((group) => group.kind)).toEqual(["content", "tools"]);
    expect(projected?.activity[0]?.entries[0]?.part).toMatchObject({ id: "commentary" });
    expect(projected?.final?.part).toMatchObject({ id: "answer" });
  });

  it("groups contiguous reasoning and tools without moving their entries", () => {
    const assistant = message({
      id: "assistant",
      type: "assistant",
      content: [
        { type: "reasoning", id: "reasoning", text: "Inspecting." },
        { type: "tool", id: "read", name: "read", state: { status: "completed" } },
        { type: "tool", id: "grep", name: "grep", state: { status: "completed" } },
      ],
    });

    const activity = row([assistant], assistant.id)?.activity;

    expect(activity).toHaveLength(1);
    expect(activity?.[0]).toMatchObject({ kind: "tools", status: "completed" });
    expect(activity?.[0]?.entries.map((entry) => entry.part.id)).toEqual([
      "reasoning",
      "read",
      "grep",
    ]);
  });

  it("recognizes OpenCode's complete tool status as completed", () => {
    const assistant = message({
      id: "assistant",
      type: "assistant",
      content: [{ type: "tool", id: "read", name: "read", state: { status: "complete" } }],
    });

    expect(row([assistant], assistant.id)?.activity).toMatchObject([
      { kind: "tools", status: "completed" },
    ]);
  });

  it("coalesces consecutive completed and running assistant activity messages", () => {
    const reasoning = message({
      id: "reasoning",
      type: "assistant",
      createdAt: 10,
      completedAt: 12,
      finish: "tool-calls",
      content: [{ type: "reasoning", id: "thought", text: "Inspecting." }],
    });
    const read = message({
      id: "read-message",
      type: "assistant",
      createdAt: 13,
      completedAt: 15,
      finish: "tool-calls",
      content: [{ type: "tool", id: "read", name: "read", state: { status: "completed" } }],
    });
    const grep = message({
      id: "grep-message",
      type: "assistant",
      createdAt: 16,
      completedAt: null,
      content: [{ type: "tool", id: "grep", name: "grep", state: { status: "running" } }],
    });

    const rows = projectTranscriptTurns([reasoning, read, grep]);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.activity).toHaveLength(1);
    expect(rows[0]?.activity[0]?.entries.map((entry) => entry.message.id)).toEqual([
      "reasoning",
      "read-message",
      "grep-message",
    ]);
    expect(rows[0]).toMatchObject({ status: "working", activity: [{ status: "running" }] });
  });

  it("keeps balanced active work open with a stable phase title and parallel status", () => {
    const assistant = message({
      id: "assistant",
      type: "assistant",
      completedAt: null,
      content: [
        {
          type: "reasoning",
          id: "reasoning",
          text: "**Tracing authentication failures**\n\nThe refresh path looks suspicious.",
          time: { created: 1, completed: 2 },
        },
        {
          type: "tool",
          id: "read",
          name: "read",
          state: { status: "running", input: { path: "src/auth.ts" } },
        },
        {
          type: "tool",
          id: "test",
          name: "shell",
          state: { status: "running", input: { command: "bun test auth" } },
        },
      ],
    });

    expect(row([assistant], assistant.id)?.activity).toMatchObject([
      {
        id: "reasoning",
        title: "Tracing authentication failures",
        currentAction: "Reading file 'auth.ts' and 1 more",
        status: "running",
        defaultOpen: true,
        detailsDefaultOpen: false,
        showReasoningSummaries: true,
      },
    ]);
  });

  it("uses the running command as the sole title without a meaningful phase title", () => {
    const assistant = message({
      id: "assistant",
      type: "assistant",
      completedAt: null,
      content: [
        {
          type: "tool",
          id: "install",
          name: "shell",
          state: {
            status: "running",
            input: { command: "bun run install:nightly:mac" },
          },
        },
      ],
    });

    const group = row([assistant], assistant.id)?.activity[0];
    expect(group).toMatchObject({
      title: "Running 'bun run install:nightly:mac'",
      status: "running",
    });
    expect(group?.currentAction).toBeUndefined();
  });

  it("keeps the last balanced phase open while the final response streams", () => {
    const assistant = message({
      id: "assistant",
      type: "assistant",
      completedAt: null,
      content: [
        {
          type: "reasoning",
          id: "reasoning",
          text: "**Validating the result**\n\nThe checks are complete.",
          time: { created: 1, completed: 2 },
        },
        {
          type: "tool",
          id: "test",
          name: "shell",
          state: { status: "completed", input: { command: "bun test" } },
        },
        { type: "text", id: "final", text: "The change is ready." },
      ],
    });

    expect(row([assistant], assistant.id)).toMatchObject({
      status: "working",
      canCollapse: true,
      shouldAutoCollapse: false,
      activity: [{ status: "completed", defaultOpen: true }],
    });
  });

  it("lets focused activity collapse when the final response starts streaming", () => {
    const assistant = message({
      id: "assistant",
      type: "assistant",
      completedAt: null,
      content: [
        {
          type: "reasoning",
          id: "reasoning",
          text: "**Validating the result**\n\nThe checks are complete.",
          time: { created: 1, completed: 2 },
        },
        {
          type: "tool",
          id: "test",
          name: "shell",
          state: { status: "completed", input: { command: "bun test" } },
        },
        { type: "text", id: "final", text: "The change is ready." },
      ],
    });
    const turn = projectTranscriptTurns(
      [assistant],
      null,
      [],
      [],
      null,
      null,
      SESSION_PROJECTION_PRESETS["code-focus"],
    )[0]!;

    expect(turn).toMatchObject({
      status: "working",
      canCollapse: true,
      shouldAutoCollapse: true,
    });
  });

  it("uses an explicit preamble as the next phase title after reasoning", () => {
    const assistant = message({
      id: "assistant",
      type: "assistant",
      completedAt: null,
      content: [
        {
          type: "reasoning",
          id: "discovery",
          text: "Inspecting the existing architecture.",
          time: { created: 1, completed: 2 },
        },
        {
          type: "reasoning",
          id: "implementation",
          text: "**Implementing the fix**",
          presentation: "preamble",
          time: { created: 3, completed: 4 },
        },
        { type: "tool", id: "edit", name: "edit", state: { status: "running" } },
      ],
    });

    expect(row([assistant], assistant.id)?.activity).toMatchObject([
      { id: "discovery", title: "Inspecting the existing architecture." },
      { id: "implementation", title: "Implementing the fix", status: "running" },
    ]);
  });

  it("uses explicit preambles and recaps as phase boundaries", () => {
    const assistant = message({
      id: "assistant",
      type: "assistant",
      completedAt: null,
      content: [
        { type: "tool", id: "read", name: "read", state: { status: "completed" } },
        {
          type: "reasoning",
          id: "preamble",
          text: "**Implementing the fix**",
          presentation: "preamble",
          time: { created: 2, completed: 3 },
        },
        { type: "tool", id: "edit", name: "edit", state: { status: "completed" } },
        {
          type: "reasoning",
          id: "recap",
          text: "The implementation is ready to validate.",
          presentation: "recap",
          time: { created: 4, completed: 5 },
        },
        {
          type: "tool",
          id: "command",
          name: "shell",
          state: { status: "running", input: { command: "bun test" } },
        },
      ],
    });

    expect(row([assistant], assistant.id)?.activity).toMatchObject([
      { id: "read", entries: [{ part: { id: "read" } }] },
      {
        id: "preamble",
        entries: [
          { part: { id: "preamble" } },
          { part: { id: "edit" } },
          { part: { id: "recap" } },
        ],
      },
      { id: "command", entries: [{ part: { id: "command" } }], status: "running" },
    ]);
  });

  it("keeps detailed activity rows visible without opening raw tool payloads", () => {
    expect(SESSION_PROJECTION_PRESETS.expanded).toMatchObject({
      foldCompletedTurns: false,
      showReasoningSummaries: true,
      keepCurrentActivityExpanded: true,
      categories: {
        reasoning: { presentation: "individual", details: "expanded" },
        read: { presentation: "individual", details: "collapsed" },
        edit: { presentation: "individual", details: "collapsed" },
        command: { presentation: "individual", details: "collapsed" },
      },
    });
  });

  it("breaks assistant activity groups at user input and terminal responses", () => {
    const firstTool = message({
      id: "first-tool",
      type: "assistant",
      createdAt: 10,
      finish: "tool-calls",
      content: [{ type: "tool", id: "read", name: "read", state: { status: "completed" } }],
    });
    const user = message({ id: "user", type: "user", createdAt: 20 });
    const secondTool = message({
      id: "second-tool",
      type: "assistant",
      createdAt: 30,
      finish: "tool-calls",
      content: [{ type: "tool", id: "grep", name: "grep", state: { status: "completed" } }],
    });
    const answer = message({
      id: "answer",
      type: "assistant",
      createdAt: 40,
      finish: "stop",
      content: [{ type: "text", text: "Done" }],
    });

    expect(
      projectTranscriptTurns([firstTool, user, secondTool, answer]).map((item) => item.id),
    ).toEqual(["first-tool", "user", "second-tool", "answer"]);
  });

  it("keeps delegation pinning from leaking into surrounding grouped work", () => {
    const assistant = message({
      id: "assistant",
      type: "assistant",
      content: [
        { type: "tool", id: "read", name: "read", state: { status: "completed" } },
        {
          type: "tool",
          id: "task",
          name: "task",
          state: {
            status: "completed",
            input: { description: "Inspect timeline", subagent_type: "explore" },
          },
        },
        { type: "tool", id: "grep", name: "grep", state: { status: "completed" } },
      ],
    });

    expect(row([assistant], assistant.id)?.activity).toMatchObject([
      { categories: ["read"], pinned: false },
      { categories: ["delegation"], pinned: true },
      { categories: ["code-search"], pinned: false },
    ]);
  });

  it("projects completed background subagents as standalone rows", () => {
    const response = message({
      id: "subagent-response",
      type: "synthetic",
      createdAt: 10,
      text: '<subagent sessionID="child-1" state="completed">\n**Finding**\n\nUse sparse metadata.\n</subagent>',
      data: {
        metadata: {
          source: "subagent",
          childID: "child-1",
          agent: "Explore",
          state: "completed",
        },
        description: "Map the sidebar",
      },
    });

    expect(projectTranscriptTurns([response])[0]).toMatchObject({
      id: "subagent-response",
      kind: "subagent",
      rootBoundary: null,
      activity: [
        {
          kind: "subagent",
          title: "Map the sidebar",
          status: "completed",
          entries: [
            {
              part: {
                type: "subagent-response",
                text: "**Finding**\n\nUse sparse metadata.",
                data: { childID: "child-1", agent: "Explore", state: "completed" },
              },
            },
          ],
        },
      ],
    });
  });

  it("projects described synthetic updates and hides internal system messages", () => {
    const restart = message({
      id: "restart",
      type: "synthetic",
      createdAt: 10,
      text: "The server restarted while you were working.",
      data: { description: "Continuing after restart" },
    });
    const internal = message({
      id: "internal",
      type: "system",
      createdAt: 11,
      text: "Internal context",
      data: { description: "Instructions updated" },
    });

    const rows = projectTranscriptTurns([restart, internal]);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.rootBoundary).toMatchObject({ title: "Continuing after restart" });
    expect(rows[0]?.rootBoundary?.entries[0]?.part.text).toBeUndefined();
  });

  it("shows explicitly user-visible system notices without exposing their payload", () => {
    const notice = message({
      id: "system-notice",
      type: "system",
      text: "Private implementation context",
      data: {
        description: "Session permissions changed",
        metadata: { userVisible: true },
      },
    });

    const boundary = projectTranscriptTurns([notice])[0]?.activity[0];
    expect(boundary).toMatchObject({
      title: "Session permissions changed",
    });
    expect(boundary?.entries[0]?.part).not.toHaveProperty("text");
  });

  it("projects first-class shell messages as command rows", () => {
    const shell = message({
      id: "shell-message",
      type: "shell",
      createdAt: 10,
      completedAt: 20,
      data: {
        shellID: "shell-1",
        command: "bun test",
        status: "exited",
        exit: 0,
        output: { output: "3 tests passed", cursor: 14, size: 14, truncated: false },
      },
    });

    const turn = projectTranscriptTurns([shell])[0];
    expect(turn).toMatchObject({
      kind: "shell",
      user: null,
      shell: {
        part: {
          state: {
            metadata: { exit: 0, standalone: true, truncated: false, cursor: 14, size: 14 },
          },
        },
      },
      activity: [{ kind: "tools", status: "completed" }],
    });
    expect(
      createSessionTranscriptProjector().project({ messages: [shell] }).presentationRows,
    ).toMatchObject([{ kind: "shell", turnID: "shell-message" }]);
  });

  it("unwraps only complete first-class shell transport envelopes", () => {
    const wrapped = message({
      id: "wrapped-shell",
      type: "shell",
      createdAt: 10,
      completedAt: 20,
      data: {
        shellID: "shell-1",
        command: "bun test",
        status: "exited",
        exit: 0,
        output: {
          output:
            '<shell id="shell-1" state="completed" command="bun test">\n3 tests passed\n</shell>',
        },
      },
    });
    const ordinary = message({
      id: "ordinary-shell",
      type: "shell",
      createdAt: 10,
      completedAt: 20,
      data: {
        shellID: "shell-1",
        command: "bun test",
        status: "exited",
        exit: 0,
        output: { output: "prefix <shell>literal output</shell>" },
      },
    });

    expect(projectTranscriptTurns([wrapped])[0]?.shell?.part.state).toMatchObject({
      content: [{ type: "text", text: "3 tests passed" }],
    });
    expect(projectTranscriptTurns([ordinary])[0]?.shell?.part.state).toMatchObject({
      content: [{ type: "text", text: "prefix <shell>literal output</shell>" }],
    });
  });

  it("projects persisted compaction as its own row", () => {
    const compaction = message({
      id: "compaction",
      type: "compaction",
      content: [
        {
          type: "compaction",
          id: "compaction",
          status: "completed",
          reason: "auto",
          text: "Full compacted summary",
          recent: "Recent context",
        },
      ],
    });

    expect(projectTranscriptTurns([compaction])[0]).toMatchObject({
      kind: "compaction",
      status: "completed",
      activity: [{ kind: "compaction", title: "Compacting context" }],
    });
  });

  it("projects failed compaction as failed", () => {
    const compaction = message({
      id: "compaction",
      type: "compaction",
      content: [
        {
          type: "compaction",
          id: "compaction",
          status: "failed",
          reason: "auto",
          error: "Context is too large",
        },
      ],
    });

    expect(projectTranscriptTurns([compaction])[0]).toMatchObject({
      status: "failed",
      activity: [{ kind: "compaction", status: "failed" }],
    });
  });

  it("attaches busy state only to the latest conversation row", () => {
    const oldAnswer = message({
      id: "old-answer",
      type: "assistant",
      createdAt: 2,
      finish: "stop",
      content: [{ type: "text", text: "Old" }],
    });
    const activeUser = message({ id: "active-user", type: "user", createdAt: 10 });

    const rows = projectTranscriptTurns(
      [oldAnswer, activeUser],
      { status: "running", startedAt: 11, completedAt: null },
      [],
      [],
      { type: "busy" },
    );

    expect(rows[0]?.status).toBe("completed");
    expect(rows[1]).toMatchObject({ status: "working", startedAt: 11, completedAt: null });
  });

  it("keeps one working row while an optimistic steer waits for the active assistant", () => {
    const user = message({ id: "user", type: "user", createdAt: 10, text: "Start" });
    const assistant = message({
      id: "assistant",
      type: "assistant",
      createdAt: 11,
      completedAt: null,
      finish: "tool-calls",
      content: [{ type: "reasoning", text: "Working" }],
    });
    const steer = message({
      id: "steer",
      type: "user",
      createdAt: 20,
      completedAt: 20,
      optimistic: true,
      delivery: "steer",
      runStartedAt: 10,
      text: "Continue",
    });

    const rows = projectTranscriptTurns(
      [user, assistant, steer],
      { status: "running", startedAt: 10, completedAt: null },
      [],
      [],
      { type: "busy" },
    );

    expect(rows.filter((item) => item.status === "working")).toHaveLength(1);
    expect(rows.find((item) => item.id === "assistant")?.status).toBe("working");
    expect(rows.find((item) => item.id === "steer")?.status).toBe("completed");
  });

  it("keeps one working row while steers wait behind a running shell", () => {
    const shell = message({
      id: "shell",
      type: "shell",
      createdAt: 10,
      completedAt: null,
      data: {
        shellID: "shell-1",
        command: "sleep 30",
        status: "running",
        output: { output: "", cursor: 0, size: 0, truncated: false },
      },
    });
    const firstSteer = message({
      id: "steer-1",
      type: "user",
      createdAt: 20,
      completedAt: 20,
      delivery: "steer",
      runStartedAt: 10,
      text: "Also check the tests",
    });
    const secondSteer = message({
      id: "steer-2",
      type: "user",
      createdAt: 30,
      completedAt: 30,
      delivery: "steer",
      runStartedAt: 10,
      text: "And update the docs",
    });

    const rows = projectTranscriptTurns(
      [shell, firstSteer, secondSteer],
      { status: "running", startedAt: 10, completedAt: null },
      [],
      [],
      { type: "busy" },
    );

    expect(rows.filter((item) => item.status === "working")).toHaveLength(1);
    expect(rows.find((item) => item.id === "shell")?.status).toBe("completed");
    expect(rows.at(-1)?.status).toBe("working");
  });

  it("attaches transient retry only to the latest conversation row", () => {
    const oldAnswer = message({
      id: "old-answer",
      type: "assistant",
      createdAt: 2,
      finish: "stop",
      content: [{ type: "text", text: "Old" }],
    });
    const activeUser = message({ id: "active-user", type: "user", createdAt: 10 });

    const rows = projectTranscriptTurns(
      [oldAnswer, activeUser],
      { status: "running", startedAt: 11, completedAt: null },
      [],
      [],
      { type: "retry", attempt: 2, message: "Rate limited", next: 20 },
    );

    expect(rows[0]?.activity).toEqual([]);
    expect(rows[1]?.activity.at(-1)).toMatchObject({
      kind: "boundary",
      title: "Retrying response, attempt 2",
      status: "running",
    });
  });

  it("uses assistant retry state instead of a terminal error", () => {
    const retrying = message({
      id: "assistant",
      type: "assistant",
      completedAt: null,
      finish: "error",
      data: {
        retry: {
          attempt: 2,
          at: 15,
          error: { type: "ProviderError", message: "Rate limited" },
        },
      },
    });

    expect(projectTranscriptTurns([retrying])[0]).toMatchObject({
      status: "working",
      activity: [
        {
          kind: "boundary",
          title: "Retrying response, attempt 2",
          status: "running",
        },
      ],
    });
  });

  it("keeps interrupted and recovered assistant messages as separate rows", () => {
    const interrupted = message({
      id: "interrupted",
      type: "assistant",
      createdAt: 10,
      finish: "error",
      content: [{ type: "text", text: "Partial answer" }],
      data: { error: { type: "MessageAbortedError", message: "Stopped by the user" } },
    });
    const recovered = message({
      id: "recovered",
      type: "assistant",
      createdAt: 20,
      finish: "stop",
      content: [{ type: "text", text: "Continued" }],
    });

    const rows = projectTranscriptTurns([interrupted, recovered]);

    expect(rows[0]).toMatchObject({
      id: "interrupted",
      status: "interrupted",
      activity: [expect.objectContaining({ title: "Response interrupted" })],
    });
    expect(rows[1]).toMatchObject({ id: "recovered", status: "completed" });
  });

  it("treats the server's generic step interruption as an interruption", () => {
    const interrupted = message({
      id: "interrupted",
      type: "assistant",
      createdAt: 10,
      finish: "error",
      data: { error: { type: "UnknownError", message: "Step interrupted" } },
    });

    expect(projectTranscriptTurns([interrupted])[0]).toMatchObject({
      status: "interrupted",
      activity: [
        {
          kind: "boundary",
          title: "Response interrupted",
          status: "interrupted",
          entries: [
            {
              part: {
                text: "The active step stopped before a response was completed.",
              },
            },
          ],
        },
      ],
    });
  });

  it("lets a response interruption define the turn even after failed activity", () => {
    const interrupted = message({
      id: "interrupted",
      type: "assistant",
      createdAt: 10,
      finish: "error",
      content: [
        {
          type: "tool",
          id: "subagent",
          name: "subagent",
          state: {
            status: "error",
            input: { agent: "general", description: "Wait one minute" },
            error: "Subagent stopped",
          },
        },
      ],
      data: { error: { type: "UnknownError", message: "Step interrupted" } },
    });

    expect(projectTranscriptTurns([interrupted])[0]?.status).toBe("interrupted");
  });

  it("projects an execution-only failure on one active row", () => {
    const user = message({ id: "user", type: "user", createdAt: 10 });

    const projected = projectTranscriptTurns([user], {
      status: "failed",
      startedAt: 11,
      completedAt: 12,
      error: { type: "ProviderError", message: "Provider unavailable" },
    })[0];

    expect(projected).toMatchObject({
      status: "failed",
      activity: [{ kind: "boundary", title: "Response failed", status: "failed" }],
    });
  });

  it("does not add a redundant boundary for an execution-only interruption", () => {
    const user = message({ id: "user", type: "user", createdAt: 10 });

    const projected = projectTranscriptTurns([user], {
      status: "interrupted",
      startedAt: 11,
      completedAt: 12,
    })[0];

    expect(projected).toMatchObject({
      status: "interrupted",
      activity: [],
    });
  });

  it("attaches terminal execution state and diffs to the latest assistant row", () => {
    const assistant = message({
      id: "assistant",
      type: "assistant",
      createdAt: 12,
      completedAt: 20,
      finish: "tool-calls",
      content: [{ type: "tool", id: "patch", name: "patch", state: { status: "completed" } }],
    });
    const laterUser = message({ id: "later-user", type: "user", createdAt: 21 });

    const rows = projectTranscriptTurns(
      [assistant, laterUser],
      { status: "succeeded", startedAt: 11, completedAt: 22 },
      [],
      [{ file: "src/a.ts", patch: "", additions: 1, deletions: 0, status: "modified" }],
    );

    expect(rows[0]?.postFinal).toMatchObject([{ kind: "diff", name: "src/a.ts" }]);
    expect(rows[1]?.postFinal).toEqual([]);
  });

  it("does not expose working diffs before execution is terminal", () => {
    const assistant = message({
      id: "assistant",
      type: "assistant",
      completedAt: null,
      content: [{ type: "tool", id: "patch", name: "patch", state: { status: "running" } }],
    });

    const projected = projectTranscriptTurns(
      [assistant],
      { status: "running", startedAt: 1, completedAt: null },
      [],
      [{ file: "src/a.ts", patch: "", additions: 1, deletions: 0, status: "modified" }],
    )[0];

    expect(projected?.postFinal).toEqual([]);
  });

  it("attaches owned requests to their exact message row and ignores queued input", () => {
    const assistant = message({ id: "assistant", type: "assistant", createdAt: 10 });
    const user = message({ id: "user", type: "user", createdAt: 20 });
    const permission: PendingRequestView = {
      id: "permission",
      type: "permission",
      title: "Run command",
      resources: [],
      savePatterns: [],
      questions: [],
      fields: [],
      ownerMessageID: assistant.id,
    };
    const queued: PendingRequestView = {
      id: "queued",
      type: "input",
      title: "Queued prompt",
      resources: [],
      savePatterns: [],
      questions: [],
      fields: [],
      delivery: "queue",
    };

    const rows = projectTranscriptTurns([assistant, user], null, [permission, queued]);

    expect(rows[0]?.blockingRequests).toEqual([permission]);
    expect(rows[1]?.blockingRequests).toEqual([]);
  });

  it("collapses settled activity when a final response exists in the same message", () => {
    const assistant = message({
      id: "assistant",
      type: "assistant",
      finish: "stop",
      content: [
        { type: "tool", id: "read", name: "read", state: { status: "completed" } },
        { type: "text", id: "answer", text: "Done" },
      ],
    });

    expect(projectTranscriptTurns([assistant])[0]).toMatchObject({
      canCollapse: true,
      shouldAutoCollapse: true,
      final: { part: { id: "answer" } },
    });
  });

  it("keeps failed activity expanded even when partial answer text exists", () => {
    const assistant = message({
      id: "assistant",
      type: "assistant",
      finish: "error",
      content: [
        { type: "tool", id: "shell", name: "shell", state: { status: "error" } },
        { type: "text", id: "answer", text: "Partial answer" },
      ],
      data: { error: { type: "ProviderError", message: "Command failed" } },
    });

    expect(projectTranscriptTurns([assistant])[0]).toMatchObject({
      status: "failed",
      canCollapse: false,
      shouldAutoCollapse: false,
    });
  });

  it("calculates output tokens per provider-stream second from hydrated fields", () => {
    const assistant = message({
      id: "assistant",
      type: "assistant",
      createdAt: 1_000,
      firstTokenAt: 2_000,
      streamedAt: 3_000,
      completedAt: 9_000,
      finish: "stop",
      tokens: { input: 10, output: 30, reasoning: 10, cache: { read: 0, write: 0 } },
      content: [{ type: "text", text: "Done" }],
    });

    expect(projectTranscriptTurns([assistant])[0]?.tokensPerSecond).toBe(15);
  });

  it("aggregates assistant steps through the displayed response", () => {
    const user = message({ id: "user", type: "user", createdAt: 500 });
    const toolStep = message({
      id: "tool-step",
      type: "assistant",
      createdAt: 1_000,
      streamedAt: 2_000,
      completedAt: 8_000,
      finish: "tool-calls",
      tokens: { input: 0, output: 20, reasoning: 80, cache: { read: 0, write: 0 } },
      content: [{ type: "tool", id: "tool", name: "read", state: { status: "completed" } }],
    });
    const finalStep = message({
      id: "final-step",
      type: "assistant",
      createdAt: 3_000,
      streamedAt: 6_000,
      completedAt: 20_000,
      finish: "stop",
      tokens: { input: 0, output: 90, reasoning: 40, cache: { read: 0, write: 0 } },
      content: [{ type: "text", id: "answer", text: "Done" }],
    });

    expect(row([user, toolStep, finalStep], "final-step")?.tokensPerSecond).toBe(27.5);
  });

  it.each(["user", "synthetic"] as const)(
    "resets assistant aggregation at the latest %s boundary",
    (boundaryType) => {
      const earlier = message({
        id: "earlier",
        type: "assistant",
        createdAt: 0,
        streamedAt: 1_000,
        tokens: { input: 0, output: 1_000, reasoning: 0, cache: { read: 0, write: 0 } },
      });
      const boundary = message({ id: "boundary", type: boundaryType, createdAt: 2_000 });
      const displayed = message({
        id: "displayed",
        type: "assistant",
        createdAt: 3_000,
        streamedAt: 5_000,
        finish: "stop",
        tokens: { input: 0, output: 30, reasoning: 0, cache: { read: 0, write: 0 } },
        content: [{ type: "text", text: "Done" }],
      });

      expect(row([earlier, boundary, displayed], "displayed")?.tokensPerSecond).toBe(15);
    },
  );

  it("requires streamed timing on every assistant in the current boundary window", () => {
    const missingTiming = message({
      id: "missing",
      type: "assistant",
      createdAt: 1_000,
      tokens: { input: 0, output: 20, reasoning: 0, cache: { read: 0, write: 0 } },
    });
    const displayed = message({
      id: "displayed",
      type: "assistant",
      createdAt: 2_000,
      streamedAt: 3_000,
      finish: "stop",
      tokens: { input: 0, output: 20, reasoning: 0, cache: { read: 0, write: 0 } },
      content: [{ type: "text", text: "Done" }],
    });

    expect(row([missingTiming, displayed], "displayed")?.tokensPerSecond).toBeNull();
  });

  it("clamps negative step durations and has no minimum duration", () => {
    const negative = message({
      id: "negative",
      type: "assistant",
      createdAt: 2_000,
      streamedAt: 1_000,
      tokens: { input: 0, output: 10, reasoning: 0, cache: { read: 0, write: 0 } },
    });
    const short = message({
      id: "short",
      type: "assistant",
      createdAt: 3_000,
      streamedAt: 3_100,
      finish: "stop",
      tokens: { input: 0, output: 10, reasoning: 0, cache: { read: 0, write: 0 } },
      content: [{ type: "text", text: "Done" }],
    });

    expect(row([negative, short], "short")?.tokensPerSecond).toBe(200);
  });

  it.each([
    { output: 0, createdAt: 1_000, streamedAt: 2_000 },
    { output: 10, createdAt: 1_000, streamedAt: 1_000 },
    { output: Number.POSITIVE_INFINITY, createdAt: 1_000, streamedAt: 2_000 },
    { output: 10, createdAt: 1_000, streamedAt: Number.POSITIVE_INFINITY },
  ])("omits non-positive or non-finite TPS inputs %#", ({ output, createdAt, streamedAt }) => {
    const assistant = message({
      id: "assistant",
      type: "assistant",
      createdAt,
      streamedAt,
      finish: "stop",
      tokens: { input: 0, output, reasoning: 0, cache: { read: 0, write: 0 } },
      content: [{ type: "text", text: "Done" }],
    });

    expect(projectTranscriptTurns([assistant])[0]?.tokensPerSecond).toBeNull();
  });

  it("omits empty reasoning parts", () => {
    const assistant = message({
      id: "assistant",
      type: "assistant",
      content: [
        { type: "reasoning", id: "empty", text: " \n\t " },
        { type: "text", id: "answer", text: "Done" },
      ],
    });

    expect(projectTranscriptTurns([assistant])[0]).toMatchObject({
      activity: [],
      final: { part: { id: "answer" } },
    });
  });

  it("does not copy and sort an already ordered transcript", () => {
    const ordered = [
      message({ id: "user", type: "user", createdAt: 1 }),
      message({ id: "assistant", type: "assistant", createdAt: 2 }),
    ];
    const original = Array.prototype.toSorted;
    Array.prototype.toSorted = () => {
      throw new Error("Already ordered transcripts should not be copied and sorted");
    };

    try {
      expect(projectTranscriptTurns(ordered)).toHaveLength(2);
    } finally {
      Array.prototype.toSorted = original;
    }
  });

  it("projects a large transcript without quadratic ownership grouping", () => {
    const messages = [
      message({ id: "user", type: "user", createdAt: 1 }),
      ...Array.from({ length: 4_000 }, (_, index) =>
        message({
          id: `assistant-${index}`,
          type: "assistant",
          createdAt: index + 2,
          finish: "tool-calls",
          content: [
            {
              type: "tool",
              id: `tool-${index}`,
              name: "shell",
              state: { status: "completed", input: { command: "true" } },
            },
          ],
        }),
      ),
    ];

    const startedAt = performance.now();
    const rows = projectTranscriptTurns(messages);
    const durationMs = performance.now() - startedAt;

    expect(rows).toHaveLength(2);
    expect(rows.at(-1)?.activity[0]?.entries).toHaveLength(4_000);
    expect(durationMs).toBeLessThan(5_000);
  });

  it("preserves structural equality for unchanged rows", () => {
    const assistant = message({
      id: "assistant",
      type: "assistant",
      content: [{ type: "text", text: "Done" }],
    });
    const first = projectTranscriptTurns([assistant])[0]!;
    const second = projectTranscriptTurns([assistant])[0]!;

    expect(sameTranscriptTurn(first, second)).toBe(true);
    expect(sameTranscriptTurn(first, { ...second, startedAt: second.startedAt + 1 })).toBe(false);
  });

  it("preserves memo equality for completed activity when the next assistant step starts", () => {
    const user = message({ id: "user", type: "user", createdAt: 1 });
    const completed = message({
      id: "assistant-completed",
      type: "assistant",
      createdAt: 2,
      completedAt: 3,
      finish: "tool-calls",
      content: [
        { type: "text", id: "completed-text", text: "Searching the codebase." },
        {
          type: "tool",
          id: "grep",
          name: "grep",
          state: { status: "completed", input: { pattern: "render" } },
        },
      ],
    });
    const next = message({
      id: "assistant-next",
      type: "assistant",
      createdAt: 4,
      completedAt: null,
      finish: "tool-calls",
      content: [
        { type: "text", id: "next-text", text: "Inspecting the result." },
        {
          type: "tool",
          id: "shell",
          name: "shell",
          state: { status: "running", input: { command: "rg render" } },
        },
      ],
    });
    const before = projectTranscriptTurns([user, completed]).at(-1)!;
    const after = projectTranscriptTurns([user, completed, next]).at(-1)!;
    const beforeGroup = before.activity.find((group) =>
      group.entries.some((entry) => entry.message === completed),
    )!;
    const afterGroup = after.activity.find((group) => group.id === beforeGroup.id)!;

    expect(afterGroup).not.toBe(beforeGroup);
    expect(sameTurnActivityGroup(beforeGroup, afterGroup)).toBe(true);
  });

  it("invalidates activity memo equality when visible phase metadata changes", () => {
    const assistant = message({
      id: "assistant",
      type: "assistant",
      completedAt: null,
      content: [
        {
          type: "tool",
          id: "shell",
          name: "shell",
          state: { status: "running", input: { command: "bun test" } },
        },
      ],
    });
    const group = row([assistant], assistant.id)!.activity[0]!;

    expect(sameTurnActivityGroup(group, { ...group, currentAction: "Running another test" })).toBe(
      false,
    );
    expect(sameTurnActivityGroup(group, { ...group, forceOpen: true })).toBe(false);
    expect(sameTurnActivityGroup(group, { ...group, showReasoningSummaries: false })).toBe(false);
    expect(sameTurnActivityGroup(group, { ...group, detailsDefaultOpen: true })).toBe(false);
  });

  it("reuses unchanged turns and caller slices while the active message streams", () => {
    const projector = createSessionTranscriptProjector();
    const user = message({ id: "user", type: "user", createdAt: 1 });
    const completed = message({
      id: "completed",
      type: "assistant",
      createdAt: 2,
      completedAt: 3,
      finish: "stop",
      content: [{ type: "text", id: "completed-text", text: "First answer" }],
    });
    const shell = {
      type: "tool" as const,
      id: "shell",
      name: "shell",
      state: { status: "running", input: { command: "bun test" } },
    };
    const active = message({
      id: "active",
      type: "assistant",
      createdAt: 4,
      completedAt: null,
      content: [shell, { type: "text", id: "active-text", text: "Working" }],
    });
    const first = projector.project({ messages: [user, completed, active] });
    const second = projector.project({
      messages: [
        user,
        completed,
        { ...active, content: [shell, { type: "text", id: "active-text", text: "Working now" }] },
      ],
    });

    expect(second.rows.find((row) => row.id === user.id)).toBe(
      first.rows.find((row) => row.id === user.id),
    );
    expect(second.rows.find((row) => row.id === completed.id)).toBe(
      first.rows.find((row) => row.id === completed.id),
    );
    expect(second.rows.find((row) => row.id === active.id)).not.toBe(
      first.rows.find((row) => row.id === active.id),
    );
    expect(second.composerMessages).toBe(first.composerMessages);
    expect(second.background).toBe(first.background);
    const firstCompletedPresentation = first.presentationRows.filter(
      (row) => row.turnID === completed.id,
    );
    const secondCompletedPresentation = second.presentationRows.filter(
      (row) => row.turnID === completed.id,
    );
    expect(secondCompletedPresentation).toEqual(firstCompletedPresentation);
    expect(
      secondCompletedPresentation.every((row, index) => row === firstCompletedPresentation[index]),
    ).toBe(true);
  });

  it("projects stable semantic presentation rows below grouped turns", () => {
    const projector = createSessionTranscriptProjector();
    const user = message({ id: "user", type: "user", createdAt: 1 });
    const tool = {
      type: "tool" as const,
      id: "read",
      name: "read",
      state: { status: "completed", input: { filePath: "src/app.ts" } },
    };
    const assistant = message({
      id: "assistant",
      type: "assistant",
      createdAt: 2,
      completedAt: 3,
      finish: "stop",
      content: [tool, { type: "text", id: "answer", text: "Done" }],
    });
    const request: PendingRequestView = {
      id: "permission",
      type: "permission",
      title: "Read file",
      resources: [],
      savePatterns: [],
      questions: [],
      fields: [],
      ownerMessageID: assistant.id,
    };
    const diffs = [
      { file: "src/app.ts", patch: "", additions: 1, deletions: 0, status: "modified" as const },
    ];

    const projection = projector.project({
      messages: [user, assistant],
      requests: [request],
      diffs,
    });
    const userRows = projection.presentationRows.filter((row) => row.turnID === user.id);
    const semantic = projection.presentationRows.filter((row) => row.turnID === assistant.id);

    expect(semantic.map((row) => row.kind)).toEqual([
      "activity",
      "requests",
      "assistant-message",
      "post-final",
    ]);
    expect(userRows.map((row) => row.kind)).toEqual(["user-message"]);
    expect(new Set(semantic.map((row) => row.id)).size).toBe(semantic.length);
    expect(semantic[0]).toMatchObject({ firstInTurn: true, lastInTurn: false });
    expect(semantic.at(-1)).toMatchObject({ firstInTurn: false, lastInTurn: true });

    const repeated = projector.project({
      messages: [user, assistant],
      requests: [request],
      diffs,
    });
    expect(repeated.presentationRows).toBe(projection.presentationRows);
  });

  it("reuses unchanged semantic rows inside an actively streaming native message", () => {
    const projector = createSessionTranscriptProjector();
    const tool = {
      type: "tool" as const,
      id: "shell",
      name: "shell",
      state: { status: "running", input: { command: "bun test" } },
    };
    const active = message({
      id: "active",
      type: "assistant",
      createdAt: 1,
      completedAt: null,
      content: [tool, { type: "text", id: "answer", text: "Working" }],
    });
    const request: PendingRequestView = {
      id: "permission",
      type: "permission",
      title: "Run tests",
      resources: [],
      savePatterns: [],
      questions: [],
      fields: [],
      ownerMessageID: active.id,
    };
    const first = projector.project({ messages: [active], requests: [request] });
    const second = projector.project({
      messages: [
        { ...active, content: [tool, { type: "text", id: "answer", text: "Working now" }] },
      ],
      requests: [request],
    });

    const firstRequest = first.presentationRows.find((row) => row.kind === "requests");
    const secondRequest = second.presentationRows.find((row) => row.kind === "requests");
    expect(secondRequest).toBe(firstRequest);
    expect(second.presentationRows.find((row) => row.kind === "assistant-message")).not.toBe(
      first.presentationRows.find((row) => row.kind === "assistant-message"),
    );
  });

  it("replans prepended chronology while reusing unaffected rows", () => {
    const projector = createSessionTranscriptProjector();
    const user = message({ id: "user", type: "user", createdAt: 2 });
    const assistant = message({
      id: "assistant",
      type: "assistant",
      createdAt: 3,
      content: [{ type: "text", text: "Done" }],
    });
    const first = projector.project({ messages: [user, assistant] });
    const boundary = message({
      id: "boundary",
      type: "synthetic",
      createdAt: 1,
      data: { description: "Earlier work" },
    });
    const second = projector.project({ messages: [assistant, boundary, user] });

    expect(second.rows.map((row) => row.id)).toEqual([boundary.id, user.id, assistant.id]);
    expect(second.rows.find((row) => row.id === user.id)).toBe(
      first.rows.find((row) => row.id === user.id),
    );
    expect(second.rows.find((row) => row.id === assistant.id)).toBe(
      first.rows.find((row) => row.id === assistant.id),
    );
  });

  it("invalidates only the row receiving a newly owned request", () => {
    const projector = createSessionTranscriptProjector();
    const user = message({ id: "user", type: "user", createdAt: 1 });
    const assistant = message({ id: "assistant", type: "assistant", createdAt: 2 });
    const first = projector.project({ messages: [user, assistant] });
    const request: PendingRequestView = {
      id: "permission",
      type: "permission",
      title: "Run command",
      resources: [],
      savePatterns: [],
      questions: [],
      fields: [],
      ownerMessageID: assistant.id,
    };
    const second = projector.project({ messages: [user, assistant], requests: [request] });

    expect(second.rows.find((row) => row.id === user.id)).toBe(
      first.rows.find((row) => row.id === user.id),
    );
    expect(second.rows.find((row) => row.id === assistant.id)).not.toBe(
      first.rows.find((row) => row.id === assistant.id),
    );
    expect(second.inlineRequestIDs).toEqual(new Set([request.id]));
  });

  it("invalidates the active row when execution state changes", () => {
    const projector = createSessionTranscriptProjector();
    const user = message({ id: "user", type: "user", createdAt: 10 });
    const first = projector.project({ messages: [user] });
    const running = projector.project({
      messages: [user],
      execution: { status: "running", startedAt: 11, completedAt: null },
    });
    const failed = projector.project({
      messages: [user],
      execution: {
        status: "failed",
        startedAt: 11,
        completedAt: 12,
        error: { type: "ProviderError", message: "Provider unavailable" },
      },
    });

    expect(running.rows[0]).not.toBe(first.rows[0]);
    expect(running.rows[0]?.turn.status).toBe("working");
    expect(failed.rows[0]).not.toBe(running.rows[0]);
    expect(failed.rows[0]?.turn).toMatchObject({
      status: "failed",
      activity: [{ title: "Response failed", status: "failed" }],
    });
  });

  it("invalidates only the row receiving transient runtime status", () => {
    const projector = createSessionTranscriptProjector();
    const completed = message({
      id: "completed",
      type: "assistant",
      createdAt: 2,
      completedAt: 3,
      finish: "stop",
      content: [{ type: "text", text: "Done" }],
    });
    const activeUser = message({ id: "active-user", type: "user", createdAt: 10 });
    const first = projector.project({ messages: [completed, activeUser] });
    const retrying = projector.project({
      messages: [completed, activeUser],
      runtimeStatus: { type: "retry", attempt: 2, message: "Rate limited", next: 20 },
    });

    expect(retrying.rows[0]).toBe(first.rows[0]);
    expect(retrying.rows[1]).not.toBe(first.rows[1]);
    expect(retrying.rows[1]?.turn.activity.at(-1)).toMatchObject({
      title: "Retrying response, attempt 2",
      status: "running",
    });
  });

  it("invalidates an updated compaction row without rebuilding prior rows", () => {
    const projector = createSessionTranscriptProjector();
    const user = message({ id: "user", type: "user", createdAt: 1 });
    const running = message({
      id: "compaction",
      type: "compaction",
      createdAt: 2,
      completedAt: null,
      content: [{ type: "compaction", id: "compaction", status: "running", reason: "auto" }],
    });
    const first = projector.project({ messages: [user, running] });
    const completed = message({
      ...running,
      completedAt: 3,
      content: [
        {
          type: "compaction",
          id: "compaction",
          status: "completed",
          reason: "auto",
          text: "Compacted summary",
        },
      ],
    });
    const second = projector.project({ messages: [user, completed] });

    expect(second.rows[0]).toBe(first.rows[0]);
    expect(second.rows[1]).not.toBe(first.rows[1]);
    expect(second.rows[1]?.turn).toMatchObject({ kind: "compaction", status: "completed" });
  });

  it("moves diff attachment when a later assistant row arrives", () => {
    const projector = createSessionTranscriptProjector();
    const firstAnswer = message({
      id: "answer-1",
      type: "assistant",
      createdAt: 1,
      completedAt: 2,
      finish: "stop",
      content: [{ type: "text", text: "First" }],
    });
    const secondAnswer = message({
      id: "answer-2",
      type: "assistant",
      createdAt: 3,
      completedAt: 4,
      finish: "stop",
      content: [{ type: "text", text: "Second" }],
    });
    const diffs = [
      { file: "src/a.ts", patch: "", additions: 1, deletions: 0, status: "modified" as const },
    ];
    const first = projector.project({ messages: [firstAnswer], diffs });
    const second = projector.project({ messages: [firstAnswer, secondAnswer], diffs });

    expect(first.rows[0]?.turn.postFinal).toMatchObject([{ kind: "diff", name: "src/a.ts" }]);
    expect(second.rows[0]).not.toBe(first.rows[0]);
    expect(second.rows[0]?.turn.postFinal).toEqual([]);
    expect(second.rows[1]?.turn.postFinal).toMatchObject([{ kind: "diff", name: "src/a.ts" }]);
  });

  it("invalidates cached turns when chronological context changes", () => {
    const projector = createSessionTranscriptProjector();
    const user = message({ id: "user", type: "user", createdAt: 10 });
    const first = projector.project({
      messages: [user],
      initialLocation: { directory: "/repo" },
    });
    const switches = [
      message({ id: "agent", type: "agent-switched", createdAt: 1, data: { agent: "build" } }),
      message({
        id: "model",
        type: "model-switched",
        createdAt: 2,
        data: { model: { id: "gpt-5", providerID: "openai" } },
      }),
      message({
        id: "location",
        type: "location-switched",
        createdAt: 3,
        data: { location: { directory: "/tmp/worktree", workspaceID: "workspace" } },
      }),
    ];
    const second = projector.project({
      messages: [...switches, user],
      initialLocation: { directory: "/repo" },
    });
    const firstUserRow = first.rows.find((row) => row.id === user.id);
    const secondUserRow = second.rows.find((row) => row.id === user.id);

    expect(secondUserRow).not.toBe(firstUserRow);
    expect(secondUserRow?.turn.context).toEqual({
      agent: "build",
      model: { id: "gpt-5", providerID: "openai" },
      location: { directory: "/tmp/worktree", workspaceID: "workspace" },
    });
  });

  it("precomputes the next native user boundary for each row", () => {
    const projector = createSessionTranscriptProjector();
    const firstUser = message({ id: "user-1", type: "user", createdAt: 1 });
    const firstAnswer = message({ id: "answer-1", type: "assistant", createdAt: 2 });
    const secondUser = message({ id: "user-2", type: "user", createdAt: 3 });
    const secondAnswer = message({ id: "answer-2", type: "assistant", createdAt: 4 });
    const projection = projector.project({
      messages: [firstUser, firstAnswer, secondUser, secondAnswer],
    });

    expect(projection.rows.find((row) => row.id === firstUser.id)?.forkBeforeMessageID).toBe(
      secondUser.id,
    );
    expect(projection.rows.find((row) => row.id === firstAnswer.id)?.forkBeforeMessageID).toBe(
      secondUser.id,
    );
    expect(projection.rows.find((row) => row.id === secondAnswer.id)?.forkBeforeMessageID).toBe(
      undefined,
    );
  });
});

describe("createReasoningTitle", () => {
  it("prefers the latest completed sentence", () => {
    expect(createReasoningTitle("Inspecting the project. Comparing the files now.")).toBe(
      "Comparing the files now.",
    );
  });

  it("uses incomplete progress text as a concise fallback", () => {
    expect(createReasoningTitle("Planning lightweight animated lightbox component")).toBe(
      "Planning lightweight animated lightbox component",
    );
  });
});
