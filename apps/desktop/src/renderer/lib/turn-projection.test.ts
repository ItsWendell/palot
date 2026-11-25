import { describe, expect, it } from "vitest";
import type { JsonValue, PalotMessage, PalotMessageContent } from "../../shared";
import type { PendingRequestView } from "./view-models";
import type { SessionExecutionState } from "../atoms/workspace";
import { mergeOptimisticMessages } from "./message-reconcile";
import {
  activityFailureCount,
  createSessionTranscriptProjector,
  createReasoningTitle,
  HEADERLESS_ACTIVITY_GROUP_MAX_ROWS,
  projectTranscriptTurns,
  sameTranscriptTurn,
  sameTurnActivityGroup,
} from "./turn-projection";
import {
  resolveSessionProjectionPreference,
  SESSION_PROJECTION_PRESETS,
} from "./session-projection-policy";
import { projectToolExecution } from "./tool-executions";

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

function idle(id: string, createdAt: number, outcome: "succeeded" | "failed" | "interrupted") {
  return message({
    id,
    type: "idle",
    createdAt,
    completedAt: createdAt,
    finish: outcome === "failed" ? "error" : null,
    data: { id, type: "idle", outcome, time: { created: createdAt } },
  });
}

function row(messages: PalotMessage[], id: string) {
  return projectTranscriptTurns(messages).find((item) => item.id === id);
}

/** The turn whose answer is the given message. */
function answered(messages: PalotMessage[], messageID: string) {
  return projectTranscriptTurns(messages).find((item) => item.final?.message.id === messageID);
}

describe("projectTranscriptTurns", () => {
  it("keeps adjacent plain reads together across files, but retains image, instruction, failed and running reads individually", () => {
    const read = (
      id: string,
      status = "completed",
      metadata = {},
      content: JsonValue[] = [],
    ): PalotMessageContent => ({
      type: "tool",
      id,
      name: "read",
      state: { status, input: { path: `${id}.ts` }, metadata, content },
    });
    const assistant = message({
      id: "reads",
      type: "assistant",
      completedAt: null,
      finish: "tool-calls",
      content: [
        read("first"),
        read("second"),
        read("instruction", "completed", { loaded: ["AGENTS.md"] }),
        read("image", "completed", {}, [
          { type: "file", mime: "image/png", uri: "data:image/png;base64,AAA" },
        ]),
        read("failed", "error"),
        read("running", "running"),
      ],
    });
    const turn = projectTranscriptTurns(
      [assistant],
      null,
      [],
      [],
      null,
      null,
      SESSION_PROJECTION_PRESETS.expanded,
    )[0]!;
    expect(turn.status).toBe("working");
    expect(turn.activity.map((group) => group.entries.map((entry) => entry.part.id))).toEqual([
      ["first", "second"],
      ["instruction"],
      ["image"],
      ["failed"],
      ["running"],
    ]);
    expect(turn.activity.at(-1)?.status).toBe("running");
    expect(turn.activity.at(-2)?.status).toBe("failed");
  });
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
          finish: "stop",
          content: [{ type: "text", text: "Answer" }],
        }),
        user,
      ],
    });
    expect(next.prompts[1]).toEqual({ ...first.prompts[0], rowIndex: 1 });
    expect(next.prompts).not.toBe(first.prompts);
  });

  it("indexes every admitted prompt, steers included, but not optimistic drafts", () => {
    const messages = [
      message({ id: "first", type: "user", createdAt: 1 }),
      message({ id: "steer", type: "user", createdAt: 2 }),
      message({ id: "answer", type: "assistant", createdAt: 3, finish: "stop" }),
      message({ id: "second", type: "user", createdAt: 5 }),
      message({ id: "draft", type: "user", createdAt: 6, optimistic: true }),
    ];
    const projection = createSessionTranscriptProjector().project({ messages });
    expect(
      projection.prompts.map(({ messageID, turnID, rowIndex }) => ({
        messageID,
        turnID,
        rowIndex,
      })),
    ).toEqual([
      { messageID: "first", turnID: "first", rowIndex: 0 },
      { messageID: "steer", turnID: "first", rowIndex: 0 },
      { messageID: "second", turnID: "second", rowIndex: 1 },
    ]);
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

    const rows = projector.project({ messages }).rows;
    expect(rows.map((row) => row.id)).toEqual(["compaction", "alpha"]);
    expect(rows[1]?.turn.users.map((user) => user.id)).toEqual(["alpha", "beta"]);
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
        title: "Changed a.ts, ran 1 command, and 2 other actions",
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

    expect(turn.activity).toMatchObject([{ title: "Changed a.ts", entries: [{}, {}] }]);
  });

  describe("completed group titles", () => {
    const call = (
      id: string,
      name: string,
      input: Record<string, JsonValue>,
      status = "completed",
    ) => ({ type: "tool", id, name, state: { status, input } }) satisfies PalotMessageContent;
    const edit = (path: string) => call(`edit-${path}`, "edit", { path, text: "next" });
    const title = (content: PalotMessageContent[]) =>
      projectTranscriptTurns([
        message({
          id: "assistant",
          type: "assistant",
          finish: "stop",
          content: [...content, { type: "text", id: "final", text: "Done" }],
        }),
      ])[0]!.activity[0]!.title;

    it("puts changes and commands before reading", () => {
      expect(
        title([
          call("read", "read", { path: "src/a.ts" }),
          call("test", "shell", { command: "bun test" }),
          edit("src/b.ts"),
        ]),
      ).toBe("Changed b.ts, ran 1 command, and read 1 file");
    });

    it("names up to three changed files and counts more", () => {
      expect(title([edit("Sources/App/app.swift")])).toBe("Changed app.swift");
      expect(title([edit("src/a.ts"), edit("src/b.ts"), edit("lib/c.ts")])).toBe(
        "Changed a.ts, b.ts and c.ts",
      );
      expect(title([edit("src/a.ts"), edit("src/b.ts"), edit("src/c.ts"), edit("src/d.ts")])).toBe(
        "Changed 4 files",
      );
    });

    it("adds the parent folder when two changed files share a name", () => {
      expect(title([edit("apps/web/src/index.ts"), edit("apps/web/lib/index.ts")])).toBe(
        "Changed src/index.ts and lib/index.ts",
      );
    });

    it("folds clauses after the second into other actions when there are more than three", () => {
      expect(
        title([
          edit("src/a.ts"),
          call("test", "shell", { command: "bun test" }),
          call("read-a", "read", { path: "src/a.ts" }),
          call("read-b", "read", { path: "src/b.ts" }),
          call("list", "list", { path: "src" }),
        ]),
      ).toBe("Changed a.ts, ran 1 command, and 3 other actions");
      expect(
        title([
          edit("src/a.ts"),
          call("test", "shell", { command: "bun test" }),
          call("read-a", "read", { path: "src/a.ts" }),
          call("list", "list", { path: "src" }),
        ]),
      ).toBe("Changed a.ts, ran 1 command, and 2 other actions");
    });

    it("keeps the counted title on a group whose last call failed", () => {
      const turn = projectTranscriptTurns([
        message({
          id: "assistant",
          type: "assistant",
          finish: "stop",
          content: [
            call("read", "read", { path: "src/a.ts" }),
            call("test", "shell", { command: "bun test" }, "error"),
            { type: "text", id: "final", text: "Tests fail" },
          ],
        }),
      ])[0]!;

      expect(turn.activity[0]).toMatchObject({
        status: "failed",
        title: "Ran 1 command and read 1 file",
      });
      expect(activityFailureCount(turn.activity[0]!)).toBe(1);
    });

    it("does not count calls the user stopped as failures", () => {
      const entry = (part: PalotMessageContent, index: number) => ({
        message: message({ id: "assistant", type: "assistant" }),
        part,
        index,
      });
      expect(
        activityFailureCount({
          id: "group",
          kind: "tools",
          title: "Ran 3 commands",
          status: "failed",
          entries: [
            entry(call("failed", "shell", { command: "bun test" }, "error"), 0),
            entry(
              {
                type: "tool",
                id: "stopped",
                name: "shell",
                state: { status: "error", input: {}, error: { type: "aborted" } },
              },
              1,
            ),
            entry(call("done", "shell", { command: "ls" }), 2),
          ],
        }),
      ).toBe(1);
    });

    it("treats a cancelled command as stopped and hides a call stopped before its input", () => {
      const turn = projectTranscriptTurns([
        message({ id: "prompt", type: "user", text: "Push it" }),
        message({
          id: "assistant",
          type: "assistant",
          finish: "stop",
          content: [
            {
              type: "tool",
              id: "cancelled",
              name: "shell",
              state: {
                status: "error",
                input: { command: "git push" },
                error: { type: "unknown", message: "Command cancelled" },
              },
            },
            {
              type: "tool",
              id: "unwritten",
              name: "shell",
              state: {
                status: "error",
                input: {},
                error: { type: "aborted", message: "Tool execution interrupted" },
              },
            },
            { type: "text", id: "final", text: "Stopped as asked" },
          ],
        }),
      ])[0]!;

      expect(turn.status).toBe("completed");
      expect(turn.activity[0]).toMatchObject({ status: "interrupted" });
      expect(turn.activity[0]!.entries.map((entry) => entry.part.id)).toEqual(["cancelled"]);
      expect(activityFailureCount(turn.activity[0]!)).toBe(0);
    });
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

  it("names published artifacts instead of counting them as other tools", () => {
    const artifactCall = (id: string, tool: string): PalotMessageContent => ({
      type: "tool",
      id,
      name: "execute",
      state: {
        status: "completed",
        input: { code: "..." },
        metadata: { toolCalls: [{ tool, status: "completed", input: { title: "Report" } }] },
      },
    });
    const assistant = message({
      id: "assistant",
      type: "assistant",
      finish: "stop",
      content: [
        artifactCall("publish", "opencode.artifact_create"),
        artifactCall("update", "opencode.artifact_update"),
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
      { title: "Published 1 artifact and updated 1 artifact", categories: ["other"] },
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

  it("groups adjacent delegations without losing their individual tool entries", () => {
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
        title: "Delegated 2 tasks",
        categories: ["delegation"],
        presentation: "grouped",
        pinned: false,
        entries: [{ part: { id: "first-task" } }, { part: { id: "second-task" } }],
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
      categories: { delegation: { presentation: "individual", foldedTurn: "inside" } },
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
  it("keeps a steer inside the turn it arrived in, visible when the work folds", () => {
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

    expect(rows.map((item) => item.id)).toEqual(["first"]);
    expect(rows[0]?.user).toBe(first);
    expect(rows[0]?.users).toEqual([first, steer]);
    expect(rows[0]?.final?.message).toBe(answer);
    expect(rows[0]?.activity).toMatchObject([
      { kind: "content", entries: [{ message: progress }] },
      { kind: "input", messages: [steer], pinned: true },
    ]);
    expect(rows[0]).toMatchObject({ status: "completed", canCollapse: true });
  });

  it("sorts out-of-order receipts by native message chronology", () => {
    const user = message({ id: "user", type: "user", createdAt: 10 });
    const assistant = message({
      id: "assistant",
      type: "assistant",
      createdAt: 20,
      content: [{ type: "text", text: "Done" }],
    });

    const [turn, ...rest] = projectTranscriptTurns([assistant, user]);
    expect(rest).toEqual([]);
    expect(turn?.user).toBe(user);
    expect(turn?.final?.message).toBe(assistant);
  });

  it("places equal-timestamp user input before assistant output", () => {
    const assistant = message({
      id: "assistant",
      type: "assistant",
      createdAt: 20,
      content: [{ type: "reasoning", text: "Working" }],
    });
    const user = message({ id: "user", type: "user", createdAt: 20 });

    const [turn, ...rest] = projectTranscriptTurns([assistant, user]);
    expect(rest).toEqual([]);
    expect(turn?.user).toBe(user);
    expect(turn?.activity[0]?.entries[0]?.message).toBe(assistant);
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

    const turns = projectTranscriptTurns([firstTool, user, secondTool, answer]);
    expect(turns.map((item) => item.id)).toEqual(["first-tool"]);
    expect(turns[0]?.activity.map((group) => group.kind)).toEqual(["tools", "input", "tools"]);
    expect(turns[0]?.final?.message).toBe(answer);
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

    const policy = resolveSessionProjectionPreference({
      version: 2,
      preset: "compact",
      categories: { delegation: { presentation: "individual", foldedTurn: "pinned" } },
    });

    expect(
      projectTranscriptTurns([assistant], null, [], [], null, null, policy)[0]?.activity,
    ).toMatchObject([
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
      rootBoundary: {
        kind: "boundary",
        title: "Finished 1 subagent",
        status: "completed",
        pinned: true,
        entries: [
          {
            part: {
              type: "subagent-response",
              name: "Map the sidebar",
              text: "**Finding**\n\nUse sparse metadata.",
              data: { childID: "child-1", agent: "Explore", state: "completed" },
            },
          },
        ],
      },
      activity: [],
    });
  });

  it("gives a generated video its own notice that plays it", () => {
    const notice = (id: string, state: string, text: string) =>
      message({
        id,
        type: "synthetic",
        createdAt: 10,
        text,
        data: {
          description: "Video generation",
          metadata: { source: "generate_video", jobID: "vid_1", state, path: "clips/cat.mp4" },
        },
      });
    const done = projectTranscriptTurns([
      notice(
        "done",
        "completed",
        '<background-result kind="video" id="vid_1" state="completed">\nVideo request finished. Saved video: clips/cat.mp4.\n</background-result>',
      ),
    ])[0]?.rootBoundary?.entries[0]?.part;
    expect(done).toMatchObject({
      name: "Generated video",
      text: "![Generated video](<clips/cat.mp4>)",
      data: { notice: "video", state: "completed", path: "clips/cat.mp4" },
    });
    const failed = projectTranscriptTurns([
      notice(
        "failed",
        "error",
        '<background-result kind="video" id="vid_1" state="error">\nProvider refused the prompt.\n</background-result>',
      ),
    ])[0]?.rootBoundary?.entries[0]?.part;
    expect(failed).toMatchObject({
      name: "Video generation failed",
      text: "Provider refused the prompt.",
      data: { notice: "video" },
    });
  });

  it('reads a 2.4 subagent report, <background-result kind="subagent">', () => {
    const report = message({
      id: "subagent-report",
      type: "synthetic",
      createdAt: 10,
      text: '<background-result kind="subagent" sessionID="child-1" state="running" description="Outbox inspection">\nStarted tests\n\nBackground work still running:\n- shell (sh_1): bun test\n</background-result>',
      data: {
        metadata: { source: "subagent", childID: "child-1", agent: "Explore", state: "completed" },
        description: "Outbox inspection",
      },
    });
    const part = projectTranscriptTurns([report])[0]?.rootBoundary?.entries[0]?.part;
    expect(part).toMatchObject({
      type: "subagent-response",
      text: "Started tests\n\nBackground work still running:\n- shell (sh_1): bun test",
      data: { backgroundWork: true },
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
    // OpenCode 2.4.0 (#64971) wraps it as a background result.
    const current = message({
      ...wrapped,
      id: "background-result-shell",
      data: {
        ...(wrapped.data as Record<string, JsonValue>),
        output: {
          output:
            '<background-result kind="shell" id="call-completed-shell" state="completed" command="exit 7">\nExited with code 7\n</background-result>',
        },
      },
    });
    expect(projectTranscriptTurns([current])[0]?.shell?.part.state).toMatchObject({
      content: [{ type: "text", text: "Exited with code 7" }],
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

    expect(rows.map((item) => [item.id, item.status])).toEqual([["user", "working"]]);
    expect(rows[0]?.users).toEqual([user, steer]);
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

  it("names a usage-limit retry, in the warning tone, with when the limit resets", () => {
    const scheduledAt = Date.now();
    const retrying = message({
      id: "assistant",
      type: "assistant",
      completedAt: null,
      finish: "error",
      data: {
        retry: {
          attempt: 2,
          at: scheduledAt + 900_000,
          scheduledAt,
          error: {
            type: "provider.quota",
            message: "5-hour limit reached",
            status: 429,
            retryAfterMs: 3_600_000,
          },
        },
      },
    });

    const boundary = projectTranscriptTurns([retrying])[0]!.activity[0]!;
    expect(boundary.title).toBe("Usage limit reached · retrying (attempt 2)");
    expect(boundary.entries[0]!.part).toMatchObject({
      status: "running",
      data: {
        kind: "retry",
        tone: "warning",
        limit: "Usage limit reached",
        attempt: 2,
        resetsAt: scheduledAt + 3_600_000,
      },
    });
    expect(boundary.entries[0]!.part.text).toMatch(/^5-hour limit reached\n\nResets at .+\.$/);
  });

  it("calls a 402 quota an empty balance, which never resets", () => {
    const now = Date.now();
    const retrying = message({
      id: "assistant",
      type: "assistant",
      completedAt: null,
      data: {
        retry: {
          attempt: 1,
          at: now + 2_000,
          scheduledAt: now,
          error: {
            type: "provider.quota",
            message: "Insufficient balance",
            status: 402,
            retryAfterMs: 60_000,
          },
        },
      },
    });
    const retry = projectTranscriptTurns([retrying])[0]!.activity[0]!;
    expect(retry.title).toBe("Out of credits · retrying (attempt 1)");
    expect(retry.entries[0]!.part.text).toBe("Insufficient balance");

    const failed = message({
      id: "assistant",
      type: "assistant",
      createdAt: now,
      completedAt: now,
      finish: "error",
      data: {
        error: {
          type: "provider.quota",
          message: "Insufficient balance",
          status: 402,
          retryAfterMs: 60_000,
        },
      },
    });
    const failure = projectTranscriptTurns([failed])[0]!.activity[0]!;
    expect(failure.title).toBe("Out of credits");
    expect(failure.entries[0]!.part.text).toBe("Insufficient balance");
  });

  it("names OpenCode 2.4's specific limit failures, with a budget's reset from its refusal", () => {
    const now = Date.now();
    const failed = (error: { [key: string]: JsonValue }) =>
      projectTranscriptTurns([
        message({
          id: "assistant",
          type: "assistant",
          createdAt: now,
          completedAt: now,
          finish: "error",
          data: { error },
        }),
      ])[0]!.activity[0]!;
    const go = failed({
      type: "provider.go-limit",
      message: "OpenCode Go 5 hour usage limit reached.",
      status: 429,
      response: {
        body: JSON.stringify({ metadata: { workspace: "wrk_go_limit", limitName: "5 hour" } }),
      },
      retryAfterMs: 3_600_000,
    });
    expect(go.title).toBe("OpenCode Go 5 hour limit reached");
    expect(go.entries[0]!.part.text).toMatch(
      /^OpenCode Go 5 hour usage limit reached\.\n\nTry again after .+\.$/,
    );
    const resetsAt = new Date(now + 3 * 86_400_000).toISOString();
    const budget = failed({
      type: "provider.budget-limit",
      message: "Workspace usage limit reached.",
      status: 429,
      response: { body: JSON.stringify({ metadata: { coverage: "all", resetsAt } }) },
    });
    expect(budget.title).toBe("Workspace usage limit reached");
    expect(budget.entries[0]!.part.text).toMatch(/\n\nTry again after .+\.$/);
    expect(
      failed({ type: "provider.chatgpt-workspace-limit", message: "Ask your admin." }).title,
    ).toBe("ChatGPT workspace limit reached");
  });

  it("names a usage-limit retry from the runtime status alone", () => {
    const user = message({ id: "user", type: "user", createdAt: 10 });
    const rows = projectTranscriptTurns(
      [user],
      { status: "running", startedAt: 11, completedAt: null },
      [],
      [],
      {
        type: "retry",
        attempt: 3,
        message: "Rate limit exceeded",
        next: 20,
        error: { type: "provider.rate-limit", status: 429 },
      },
    );
    expect(rows[0]?.activity.at(-1)).toMatchObject({
      title: "Rate limited · retrying (attempt 3)",
      status: "running",
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

    const rows = projectTranscriptTurns([
      interrupted,
      idle("interrupted-idle", 15, "interrupted"),
      recovered,
      idle("recovered-idle", 25, "succeeded"),
    ]);

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

  it("attaches terminal execution state and diffs to the open turn", () => {
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

    expect(rows).toHaveLength(1);
    expect(rows[0]?.users).toEqual([laterUser]);
    expect(rows[0]?.postFinal).toMatchObject([{ kind: "diff", name: "src/a.ts" }]);
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
    const assistant = message({
      id: "assistant",
      type: "assistant",
      createdAt: 10,
      finish: "stop",
    });
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

  it("counts output and reasoning tokens from the request when OpenCode recorded no first token", () => {
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

    // (30 output + 10 reasoning) / (3s − 1s). Palot's own first-delta estimate does not count.
    expect(projectTranscriptTurns([assistant])[0]?.tokensPerSecond).toBe(20);
  });

  it("measures from OpenCode's recorded first token when the step has one (after 2.2.7)", () => {
    const user = message({ id: "user", type: "user", createdAt: 500 });
    const toolStep = message({
      id: "tool-step",
      type: "assistant",
      createdAt: 1_000,
      firstTokenAt: 1_500,
      firstTokenRecordedAt: 1_500,
      streamedAt: 2_000,
      completedAt: 8_000,
      finish: "tool-calls",
      tokens: { input: 0, output: 20, reasoning: 30, cache: { read: 0, write: 0 } },
      content: [{ type: "tool", id: "tool", name: "read", state: { status: "completed" } }],
    });
    // A step recorded before the field existed counts from its request.
    const finalStep = message({
      id: "final-step",
      type: "assistant",
      createdAt: 3_000,
      streamedAt: 4_500,
      completedAt: 20_000,
      finish: "stop",
      tokens: { input: 0, output: 40, reasoning: 10, cache: { read: 0, write: 0 } },
      content: [{ type: "text", id: "answer", text: "Done" }],
    });

    // (50 + 50) tokens / (0.5s + 1.5s).
    expect(answered([user, toolStep, finalStep], "final-step")?.tokensPerSecond).toBe(50);
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

    // (20 + 80 + 90 + 40) tokens over 1s + 3s of streaming.
    expect(answered([user, toolStep, finalStep], "final-step")?.tokensPerSecond).toBe(57.5);
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

      expect(answered([earlier, boundary, displayed], "displayed")?.tokensPerSecond).toBe(15);
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

    expect(answered([missingTiming, displayed], "displayed")?.tokensPerSecond).toBeNull();
  });

  it("leaves out steps that arrived in a burst or with negative durations", () => {
    const negative = message({
      id: "negative",
      type: "assistant",
      createdAt: 2_000,
      streamedAt: 1_000,
      tokens: { input: 0, output: 10, reasoning: 0, cache: { read: 0, write: 0 } },
    });
    const streamed = message({
      id: "streamed",
      type: "assistant",
      createdAt: 3_000,
      firstTokenRecordedAt: 3_000,
      streamedAt: 5_000,
      tokens: { input: 0, output: 100, reasoning: 0, cache: { read: 0, write: 0 } },
    });
    // A provider that buffered the step and sent 2,000 tokens at once.
    const burst = message({
      id: "burst",
      type: "assistant",
      createdAt: 6_000,
      firstTokenRecordedAt: 9_000,
      streamedAt: 9_020,
      finish: "stop",
      tokens: { input: 0, output: 2_000, reasoning: 0, cache: { read: 0, write: 0 } },
      content: [{ type: "text", text: "Done" }],
    });

    // Only the streamed step counts: 100 tokens over 2s, not 2,110 over 2.02s.
    expect(answered([negative, streamed, burst], "burst")?.tokensPerSecond).toBe(50);
    // A turn that only arrived in bursts has no rate.
    expect(answered([burst], "burst")?.tokensPerSecond).toBeNull();
  });

  it("keeps a short step that streamed at a believable rate", () => {
    const quick = message({
      id: "quick",
      type: "assistant",
      createdAt: 1_000,
      firstTokenRecordedAt: 1_000,
      streamedAt: 1_100,
      finish: "stop",
      tokens: { input: 0, output: 20, reasoning: 0, cache: { read: 0, write: 0 } },
      content: [{ type: "text", text: "Yes" }],
    });
    // 20 tokens in 100 ms is 200 tok/s: short, but not a burst.
    expect(answered([quick], "quick")?.tokensPerSecond).toBe(200);
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
      expect(projectTranscriptTurns(ordered)).toHaveLength(1);
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

    expect(rows).toHaveLength(1);
    expect(rows[0]?.activity[0]?.entries).toHaveLength(4_000);
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

  it("reuses settled turns and caller slices while a later turn streams", () => {
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
    const settled = idle("settled", 3, "succeeded");
    const nextUser = message({ id: "next-user", type: "user", createdAt: 4 });
    const shell = {
      type: "tool" as const,
      id: "shell",
      name: "shell",
      state: { status: "running", input: { command: "bun test" } },
    };
    const active = message({
      id: "active",
      type: "assistant",
      createdAt: 5,
      completedAt: null,
      content: [shell, { type: "text", id: "active-text", text: "Working" }],
    });
    const first = projector.project({ messages: [user, completed, settled, nextUser, active] });
    const second = projector.project({
      messages: [
        user,
        completed,
        settled,
        nextUser,
        { ...active, content: [shell, { type: "text", id: "active-text", text: "Working now" }] },
      ],
    });

    expect(second.rows.map((row) => row.id)).toEqual([user.id, nextUser.id]);
    expect(second.rows[0]).toBe(first.rows[0]);
    expect(second.rows[0]?.turn).toBe(first.rows[0]?.turn);
    expect(second.rows[1]).not.toBe(first.rows[1]);
    expect(second.composerMessages).toBe(first.composerMessages);
    expect(second.background).toBe(first.background);
    const firstCompletedPresentation = first.presentationRows.filter(
      (row) => row.turnID === user.id,
    );
    const secondCompletedPresentation = second.presentationRows.filter(
      (row) => row.turnID === user.id,
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
    const semantic = projection.presentationRows.filter((row) => row.turnID === user.id);

    expect(semantic.map((row) => row.kind)).toEqual([
      "user-message",
      "activity",
      "requests",
      "assistant-message",
      "post-final",
    ]);
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

    expect(second.rows.map((row) => row.id)).toEqual([boundary.id, user.id]);
    expect(second.rows.find((row) => row.id === user.id)).toBe(
      first.rows.find((row) => row.id === user.id),
    );
  });

  it("invalidates only the row receiving a newly owned request", () => {
    const projector = createSessionTranscriptProjector();
    const earlier = message({ id: "earlier", type: "user", createdAt: 1 });
    const answer = message({ id: "answer", type: "assistant", createdAt: 2, finish: "stop" });
    const user = message({ id: "user", type: "user", createdAt: 4 });
    const assistant = message({ id: "assistant", type: "assistant", createdAt: 5 });
    const messages = [earlier, answer, idle("idle", 3, "succeeded"), user, assistant];
    const first = projector.project({ messages });
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
    const second = projector.project({ messages, requests: [request] });

    expect(second.rows[0]).toBe(first.rows[0]);
    expect(second.rows[1]).not.toBe(first.rows[1]);
    expect(second.rows[1]?.turn.blockingRequests).toEqual([request]);
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
    const settled = idle("settled", 2, "succeeded");
    const running = message({
      id: "compaction",
      type: "compaction",
      createdAt: 3,
      completedAt: null,
      content: [{ type: "compaction", id: "compaction", status: "running", reason: "auto" }],
    });
    const first = projector.project({ messages: [user, settled, running] });
    const completed = message({
      ...running,
      completedAt: 4,
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
    const second = projector.project({ messages: [user, settled, completed] });

    expect(first.rows[1]?.turn).toMatchObject({ kind: "compaction", status: "working" });
    expect(second.rows[0]).toBe(first.rows[0]);
    expect(second.rows[1]).not.toBe(first.rows[1]);
    expect(second.rows[1]?.turn).toMatchObject({ kind: "compaction", status: "completed" });
  });

  it("moves diff attachment when a later turn opens", () => {
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
    const settled = idle("settled", 2, "succeeded");
    const prompt = message({ id: "prompt", type: "user", createdAt: 3 });
    const first = projector.project({ messages: [firstAnswer, settled], diffs });
    const second = projector.project({
      messages: [firstAnswer, settled, prompt, secondAnswer],
      diffs,
    });

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

  it("forks before the prompt that opened the next turn, skipping turns without one", () => {
    const projector = createSessionTranscriptProjector();
    const answer = (id: string, createdAt: number) =>
      message({ id, type: "assistant", createdAt, finish: "stop" });
    const notice = message({
      id: "notice",
      type: "synthetic",
      createdAt: 5,
      data: { description: "Scheduled check" },
    });
    const projection = projector.project({
      messages: [
        message({ id: "user-1", type: "user", createdAt: 1 }),
        answer("answer-1", 2),
        notice,
        message({ id: "notice-work", type: "assistant", createdAt: 6, finish: "tool-calls" }),
        message({ id: "notice-steer", type: "user", createdAt: 7 }),
        answer("notice-answer", 8),
        message({ id: "user-2", type: "user", createdAt: 9 }),
        message({ id: "steer-2", type: "user", createdAt: 10 }),
        answer("answer-2", 11),
      ],
    });

    expect(projection.rows.map((row) => [row.id, row.forkBeforeMessageID])).toEqual([
      ["user-1", "user-2"],
      ["notice", "user-2"],
      ["user-2", undefined],
    ]);
  });
});

describe("headerless activity groups", () => {
  const shell = (id: string): PalotMessageContent => ({
    type: "tool",
    id,
    name: "shell",
    state: { status: "completed", input: { command: id }, output: "ok" },
  });
  const thought = (id: string, presentation?: "preamble"): PalotMessageContent => ({
    type: "reasoning",
    id,
    text: `Thinking about ${id}`,
    ...(presentation ? { presentation } : {}),
  });
  // Two process groups: a preamble thought starts the second.
  const turn = (first: PalotMessageContent[], second: PalotMessageContent[]) =>
    projectTranscriptTurns([
      message({ id: "user", type: "user", content: [{ type: "text", text: "Go" }] }),
      message({
        id: "work",
        type: "assistant",
        createdAt: 2,
        completedAt: 3,
        finish: "tool-calls",
        content: [...first, thought("second", "preamble"), ...second],
      }),
      message({
        id: "answer",
        type: "assistant",
        createdAt: 4,
        completedAt: 5,
        finish: "stop",
        content: [{ type: "text", text: "Done" }],
      }),
      idle("idle", 6, "succeeded"),
    ])[0]!;
  const process = (value: ReturnType<typeof turn>) =>
    value.activity.filter((group) => group.kind === "tools" || group.kind === "reasoning");

  it("drops the header of a group that shows at most the threshold's rows", () => {
    const large = ["l1", "l2", "l3", "l4", "l5"].map(shell);
    // Adjacent thoughts merge into one row, so this group shows three rows.
    const small = [thought("a"), thought("b"), shell("s1"), shell("s2")];
    expect(HEADERLESS_ACTIVITY_GROUP_MAX_ROWS).toBe(3);
    const groups = process(turn(small, large));
    expect(groups.map((group) => group.headerless ?? false)).toEqual([true, false]);
  });

  it("keeps the header of a group one row over the threshold when the turn has several", () => {
    const groups = process(
      turn(["s1", "s2", "s3", "s4"].map(shell), ["l1", "l2", "l3", "l4"].map(shell)),
    );
    expect(groups.map((group) => group.headerless ?? false)).toEqual([false, false]);
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

describe("activity grouping across asynchronous work", () => {
  it("keeps background delegations and surrounding tools in one chronological activity group", () => {
    const work = message({
      id: "work",
      type: "assistant",
      createdAt: 10,
      finish: "tool-calls",
      content: [
        { type: "reasoning", id: "plan", text: "Checking the implementation." },
        {
          type: "tool",
          id: "read",
          name: "read",
          state: { status: "completed", input: { path: "src/a.ts" } },
        },
        {
          type: "tool",
          id: "delegate-one",
          name: "subagent",
          state: {
            status: "completed",
            input: { description: "Inspect UI", agent: "explore", background: true },
            metadata: { sessionID: "child-one", background: true },
          },
        },
        {
          type: "tool",
          id: "delegate-two",
          name: "subagent",
          state: {
            status: "completed",
            input: { description: "Inspect tests", agent: "explore", background: true },
            metadata: { sessionID: "child-two", background: true },
          },
        },
        {
          type: "tool",
          id: "edit",
          name: "edit",
          state: { status: "completed", input: { path: "src/a.ts", text: "updated" } },
        },
        {
          type: "tool",
          id: "command",
          name: "shell",
          state: { status: "completed", input: { command: "bun run test" } },
        },
      ],
    });

    const groups = projectTranscriptTurns([work])[0]!.activity;
    expect(
      groups.map((group) => ({
        ids: group.entries.map((entry) => entry.part.id),
        presentation: group.presentation,
        pinned: group.pinned,
      })),
    ).toEqual([
      {
        ids: ["plan", "read", "delegate-one", "delegate-two", "edit", "command"],
        presentation: "grouped",
        pinned: false,
      },
    ]);
  });

  it("keeps an ordinary command in the same activity group when its tool state settles", () => {
    const projector = createSessionTranscriptProjector();
    const first = message({
      id: "first",
      type: "assistant",
      createdAt: 10,
      completedAt: 11,
      finish: "tool-calls",
      content: [
        { type: "reasoning", id: "plan", text: "Running the checks." },
        {
          type: "tool",
          id: "command",
          name: "shell",
          state: { status: "running", input: { command: "bun run test" } },
        },
      ],
    });
    const continued = message({
      id: "continued",
      type: "assistant",
      createdAt: 12,
      completedAt: null,
      content: [
        {
          type: "tool",
          id: "read",
          name: "read",
          state: { status: "completed", input: { path: "result.json" } },
        },
      ],
    });
    const running = projector.project({ messages: [first, continued] });
    const settled = projector.project({
      messages: [
        {
          ...first,
          content: first.content.map((part) =>
            part.id === "command"
              ? { ...part, state: { status: "completed", input: { command: "bun run test" } } }
              : part,
          ),
        },
        continued,
      ],
    });

    expect(running.rows).toHaveLength(1);
    expect(running.rows[0]?.turn.activity).toMatchObject([{ id: "plan", status: "running" }]);
    expect(settled.rows[0]?.turn.activity).toMatchObject([{ id: "plan", status: "completed" }]);
    expect(settled.rows[0]?.turn.activity[0]?.entries.map((entry) => entry.part.id)).toEqual([
      "plan",
      "command",
      "read",
    ]);
  });

  it("makes a first-class shell result a timeline boundary between assistant activity rows", () => {
    const before = message({
      id: "before",
      type: "assistant",
      createdAt: 10,
      completedAt: 12,
      finish: "tool-calls",
      content: [{ type: "tool", id: "edit", name: "edit", state: { status: "completed" } }],
    });
    const shell = message({
      id: "shell-result",
      type: "shell",
      createdAt: 13,
      completedAt: 20,
      data: {
        shellID: "shell-1",
        command: "bun run test",
        status: "exited",
        exit: 0,
        output: { output: "Tests passed" },
      },
    });
    const after = message({
      id: "after",
      type: "assistant",
      createdAt: 21,
      completedAt: 23,
      finish: "tool-calls",
      content: [
        {
          type: "tool",
          id: "read-result",
          name: "read",
          state: { status: "completed", input: { path: "result.json" } },
        },
      ],
    });

    const projection = createSessionTranscriptProjector().project({
      messages: [before, shell, after],
    });
    expect(projection.rows.map((row) => [row.id, row.turn.kind])).toEqual([
      ["before", "conversation"],
      ["shell-result", "shell"],
      ["after", "conversation"],
    ]);
    expect(projection.presentationRows.map((row) => row.kind)).toEqual([
      "activity",
      "shell",
      "activity",
    ]);
    expect(projection.rows[0]?.turn.activity[0]?.entries.map((entry) => entry.part.id)).toEqual([
      "edit",
    ]);
    expect(projection.rows[2]?.turn.activity[0]?.entries.map((entry) => entry.part.id)).toEqual([
      "read-result",
    ]);
  });

  it("keeps subagent returns inside the turn that waits for them, and alone after it ends", () => {
    const before = message({
      id: "before",
      type: "assistant",
      createdAt: 10,
      completedAt: 11,
      finish: "tool-calls",
      content: [{ type: "tool", id: "read", name: "read", state: { status: "completed" } }],
    });
    const returned = (id: string, createdAt: number) =>
      message({
        id,
        type: "synthetic",
        createdAt,
        completedAt: createdAt,
        text: `<subagent sessionID="${id}" state="completed">Done.</subagent>`,
        data: { metadata: { source: "subagent", childID: id, state: "completed" } },
      });
    const after = message({
      id: "after",
      type: "assistant",
      createdAt: 30,
      completedAt: 31,
      finish: "tool-calls",
      content: [{ type: "tool", id: "edit", name: "edit", state: { status: "completed" } }],
    });

    const inside = createSessionTranscriptProjector().project({
      messages: [before, returned("child-one", 20), returned("child-two", 25), after],
    });
    expect(inside.rows.map((row) => [row.id, row.turn.kind])).toEqual([["before", "conversation"]]);
    // Reports for subagents this turn did not launch merge into one row.
    expect(inside.rows[0]?.turn.activity.map((group) => [group.kind, group.title])).toEqual([
      ["tools", "Read 1 file"],
      ["boundary", "Finished 2 subagents"],
      ["tools", "Changed 1 file"],
    ]);

    const late = createSessionTranscriptProjector().project({
      messages: [
        before,
        idle("idle", 15, "succeeded"),
        returned("child-one", 20),
        returned("child-two", 25),
      ],
    });
    expect(late.rows.map((row) => [row.id, row.turn.kind])).toEqual([
      ["before", "conversation"],
      ["child-one", "subagent"],
    ]);
    expect(late.rows[1]?.turn).toMatchObject({
      status: "completed",
      startedAt: 20,
      completedAt: null,
      activity: [],
      rootBoundary: { title: "Finished 2 subagents", entries: [{}, {}] },
    });
  });
});

describe("background shell returns", () => {
  const command = (id: string) => ({
    type: "tool" as const,
    id: `tool-${id}`,
    name: "shell",
    time: { created: 11, completed: 12 },
    state: {
      status: "completed",
      input: { command: `python ${id}.py`, background: true },
      content: [{ type: "text", text: "Command running in background" }],
      metadata: { shellID: id, status: "running" },
    },
  });
  const returned = (id: string, createdAt: number, exit = 0) =>
    message({
      id: `returned-${id}`,
      type: "synthetic",
      createdAt,
      text: `<shell id="${id}" state="completed" command="python ${id}.py">\nResult from ${id}\n</shell>`,
      data: {
        description: `python ${id}.py`,
        metadata: {
          source: "shell",
          shellID: id,
          jobID: id,
          state: "completed",
          exit,
          truncated: false,
        },
      },
    });

  it("attaches a keyed return to its original command and keeps continuing activity together", () => {
    const before = message({
      id: "before",
      type: "assistant",
      createdAt: 10,
      completedAt: 12,
      finish: "tool-calls",
      content: [
        { type: "reasoning", id: "plan", text: "Reviewing the samples." },
        command("sample"),
      ],
    });
    const after = message({
      id: "after",
      type: "assistant",
      createdAt: 21,
      completedAt: null,
      content: [
        {
          type: "tool",
          id: "read-result",
          name: "read",
          state: { status: "completed", input: { path: "result.json" } },
        },
      ],
    });
    const projector = createSessionTranscriptProjector();
    const running = projector.project({ messages: [before] });
    const messages = [before, returned("sample", 20), after];
    const result = projector.project({ messages });
    const fromReload = createSessionTranscriptProjector().project({ messages });

    expect(running.rows.map((row) => row.id)).toEqual(["before"]);
    expect(result.rows.map((row) => row.id)).toEqual(["before"]);
    expect(result.presentationRows.map((row) => row.kind)).toEqual(["activity", "turn-status"]);
    expect(result.rows[0]?.turn.activity).toHaveLength(1);
    expect(result.rows[0]?.turn.activity[0]?.entries.map((entry) => entry.part.id)).toEqual([
      "plan",
      "tool-sample",
      "read-result",
    ]);
    const part = result.rows[0]?.turn.activity[0]?.entries[1]?.part;
    expect(part).toMatchObject({
      time: { created: 11, completed: 20 },
      state: {
        status: "completed",
        input: { command: "python sample.py", background: true },
        content: [{ type: "text", text: "Result from sample" }],
        metadata: { shellID: "sample", status: "completed", exit: 0 },
      },
    });
    expect(before.content[1]).toMatchObject({
      state: { content: [{ type: "text", text: "Command running in background" }] },
    });
    expect(fromReload.rows[0]?.turn.activity[0]?.entries[1]?.part).toEqual(part);
  });

  it("attaches the return of a foreground command OpenCode moved to the background", () => {
    // After 2.2.7 (`shell_timeout_background`, later the default): no `background` input, the
    // call returned at its timeout with the command still running.
    const timedOut = {
      type: "tool" as const,
      id: "tool-slow",
      name: "shell",
      time: { created: 11, completed: 12 },
      state: {
        status: "completed",
        input: { command: "python slow.py", timeout: 120_000 },
        content: [
          {
            type: "text",
            text: "Command moved to the background (shell ID: slow).\n\nThe command did not finish within its timeout of 120 seconds and was moved to the background.",
          },
        ],
        metadata: { shellID: "slow", status: "running", truncated: false, pid: 42 },
      },
    };
    const before = message({
      id: "before",
      type: "assistant",
      createdAt: 10,
      completedAt: 12,
      finish: "tool-calls",
      content: [timedOut],
    });
    const after = message({
      id: "after",
      type: "assistant",
      createdAt: 21,
      completedAt: null,
      content: [{ type: "text", text: "It finished." }],
    });
    const turns = projectTranscriptTurns([before, returned("slow", 20, 3), after]);

    expect(turns.map((turn) => turn.id)).toEqual(["before"]);
    const part = turns[0]?.activity[0]?.entries.find(
      (entry) => entry.part.id === "tool-slow",
    )?.part;
    expect(part).toMatchObject({
      time: { completed: 20 },
      state: {
        status: "error",
        content: [{ type: "text", text: "Result from slow" }],
        metadata: { shellID: "slow", status: "completed", exit: 3 },
      },
    });
    // The return joined its command instead of standing as a notice of its own.
    expect(
      turns[0]?.activity.some((group) =>
        group.entries.some((entry) => entry.message.id === "returned-slow"),
      ),
    ).toBe(false);
  });

  it("reads a background command its timeout or a kill stopped as stopped, not completed", () => {
    // OpenCode stops a background command when its explicit timeout expires; its return says
    // `timeout: true` (and the signal), or `killed` when something killed it.
    const stoppedReturn = (id: string, metadata: Record<string, JsonValue>) =>
      message({
        id: `returned-${id}`,
        type: "synthetic",
        createdAt: 20,
        text: `<shell id="${id}" state="completed" command="python ${id}.py">\nPartial ${id}\n</shell>`,
        data: {
          description: `python ${id}.py`,
          metadata: { source: "shell", shellID: id, jobID: id, state: "completed", ...metadata },
        },
      });
    const projected = (id: string, metadata: Record<string, JsonValue>) => {
      const turns = projectTranscriptTurns([
        message({
          id: "before",
          type: "assistant",
          createdAt: 10,
          completedAt: 12,
          finish: "tool-calls",
          content: [command(id)],
        }),
        stoppedReturn(id, metadata),
      ]);
      const part = turns[0]?.activity[0]?.entries.find(
        (entry) => entry.part.id === `tool-${id}`,
      )?.part;
      return { turn: turns[0], part, view: part ? projectToolExecution(part, 0) : null };
    };

    const timedOut = projected("slow", { timeout: true, signal: "SIGTERM", truncated: false });
    expect(timedOut.part).toMatchObject({
      state: {
        status: "completed",
        metadata: { shellID: "slow", status: "completed", timeout: true, signal: "SIGTERM" },
      },
    });
    expect(timedOut.part?.state).not.toHaveProperty("error");
    expect(timedOut.view).toMatchObject({ kind: "shell", status: "interrupted", timedOut: true });
    expect(timedOut.turn?.activity[0]?.status).toBe("interrupted");

    // A kill wins over the exit code it left behind.
    const killed = projected("hung", { killed: true, exit: 137, truncated: false });
    expect(killed.part).toMatchObject({
      state: { status: "completed", metadata: { killed: true, exit: 137 } },
    });
    expect(killed.view).toMatchObject({
      kind: "shell",
      status: "interrupted",
      killed: true,
      timedOut: false,
    });
  });

  it("leaves a foreground command that ran to completion unpaired", () => {
    const finished = {
      type: "tool" as const,
      id: "tool-done",
      name: "shell",
      time: { created: 11, completed: 12 },
      state: {
        status: "completed",
        input: { command: "python done.py" },
        metadata: { shellID: "done", status: "completed", exit: 0 },
      },
    };
    const turns = projectTranscriptTurns([
      message({
        id: "before",
        type: "assistant",
        createdAt: 10,
        completedAt: 12,
        finish: "tool-calls",
        content: [finished],
      }),
      returned("done", 20),
    ]);
    const entries = turns.flatMap((turn) => [
      ...(turn.rootBoundary?.entries ?? []),
      ...turn.activity.flatMap((group) => group.entries),
    ]);
    expect(entries.some((entry) => entry.message.id === "returned-done")).toBe(true);
  });

  it("links concurrent returns by shell ID even when they finish out of order", () => {
    const before = message({
      id: "before",
      type: "assistant",
      createdAt: 10,
      completedAt: 12,
      finish: "tool-calls",
      content: [command("first"), command("second")],
    });
    const after = message({
      id: "after",
      type: "assistant",
      createdAt: 30,
      completedAt: 31,
      finish: "tool-calls",
      content: [{ type: "tool", id: "edit", name: "edit", state: { status: "completed" } }],
    });
    const projection = createSessionTranscriptProjector().project({
      messages: [before, returned("second", 20), returned("first", 25), after],
    });

    expect(projection.rows.map((row) => row.id)).toEqual(["before"]);
    expect(projection.rows[0]?.turn.activity[0]?.entries.map((entry) => entry.part.id)).toEqual([
      "tool-first",
      "tool-second",
      "edit",
    ]);
    expect(
      projection.rows[0]?.turn.activity[0]?.entries.slice(0, 2).map((entry) => entry.part.state),
    ).toMatchObject([
      { content: [{ text: "Result from first" }] },
      { content: [{ text: "Result from second" }] },
    ]);
  });

  it("retains a failed return's output and failed state on the command", () => {
    const before = message({
      id: "before",
      type: "assistant",
      createdAt: 10,
      completedAt: 12,
      finish: "tool-calls",
      content: [command("failure")],
    });
    const result = createSessionTranscriptProjector().project({
      messages: [before, returned("failure", 20, 2)],
    });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.turn.status).toBe("failed");
    expect(result.rows[0]?.turn.activity[0]?.entries[0]?.part.state).toMatchObject({
      status: "error",
      content: [{ text: "Result from failure" }],
      metadata: { exit: 2 },
      error: { message: "Shell command exited with code 2" },
    });
  });

  it("replaces the background launch notice when the completed command has no output", () => {
    const before = message({
      id: "before",
      type: "assistant",
      createdAt: 10,
      completedAt: 12,
      finish: "tool-calls",
      content: [command("quiet")],
    });
    const quiet = {
      ...returned("quiet", 20),
      text: '<shell id="quiet" state="completed" command="python quiet.py">\n</shell>',
    };
    const result = createSessionTranscriptProjector().project({ messages: [before, quiet] });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.turn.activity[0]?.entries[0]?.part.state).toMatchObject({
      status: "completed",
      content: [{ type: "text", text: "" }],
    });
  });

  it("links a return across a steer in its turn and leaves an unmatched return as a notice", () => {
    const before = message({
      id: "before",
      type: "assistant",
      createdAt: 10,
      completedAt: 12,
      finish: "tool-calls",
      content: [command("sample")],
    });
    const steer = message({ id: "steer", type: "user", createdAt: 15, text: "Change the plan" });
    const later = returned("sample", 20);
    const unlinked = returned("different", 25);
    const result = createSessionTranscriptProjector().project({
      messages: [before, steer, later, unlinked],
    });

    expect(result.rows.map((row) => row.id)).toEqual(["before"]);
    const activity = result.rows[0]?.turn.activity;
    expect(activity?.map((group) => group.kind)).toEqual(["tools", "input", "boundary"]);
    expect(activity?.[0]?.entries[0]?.part.state).toMatchObject({
      content: [{ text: "Result from sample" }],
    });
    expect(activity?.[2]).toMatchObject({ title: "Finished 1 command", pinned: false });
    expect(activity?.[2]?.entries[0]?.part.name).toBe("python different.py");
  });

  it("does not pull a return into a turn that already ended", () => {
    const before = message({
      id: "before",
      type: "assistant",
      createdAt: 10,
      completedAt: 12,
      finish: "tool-calls",
      content: [command("sample")],
    });
    const notice = message({
      id: "restart-notice",
      type: "synthetic",
      createdAt: 15,
      data: { description: "Continuing after restart" },
    });
    const final = message({
      id: "final",
      type: "assistant",
      createdAt: 17,
      completedAt: 18,
      finish: "stop",
      content: [{ type: "text", text: "Summary" }],
    });
    const result = createSessionTranscriptProjector().project({
      messages: [before, notice, final, idle("idle", 19, "succeeded"), returned("sample", 20)],
    });

    expect(result.rows.map((row) => row.id)).toEqual(["before", "returned-sample"]);
    expect(result.rows[1]?.turn.rootBoundary?.title).toBe("Finished 1 command");
    expect(result.rows[0]?.turn.activity[0]?.entries[0]?.part.state).toMatchObject({
      content: [{ text: "Command running in background" }],
    });
  });
});

describe("model and agent switch markers", () => {
  const prompt = (id: string, createdAt: number) =>
    message({ id, type: "user", createdAt, text: `Prompt ${id}` });
  const reply = (
    id: string,
    createdAt: number,
    model: PalotMessage["model"] = { id: "gpt-5", providerID: "openai" },
  ) =>
    message({
      id,
      type: "assistant",
      createdAt,
      completedAt: createdAt + 1,
      finish: "stop",
      model,
      content: [{ type: "text", text: `Reply ${id}` }],
    });
  const modelSwitch = (
    id: string,
    createdAt: number,
    model: { id: string; providerID: string; variant?: string },
    previous?: { id: string; providerID: string; variant?: string },
  ) =>
    message({
      id,
      type: "model-switched",
      createdAt,
      completedAt: createdAt,
      model,
      data: { model, ...(previous ? { previous } : {}) },
    });
  const agentSwitch = (id: string, createdAt: number, agent: string, previous?: string) =>
    message({
      id,
      type: "agent-switched",
      createdAt,
      completedAt: createdAt,
      agent,
      data: { agent, ...(previous ? { previous } : {}) },
    });
  const markers = (messages: PalotMessage[]) =>
    projectTranscriptTurns(messages).flatMap((turn) =>
      turn.rootBoundary
        ? [
            {
              id: turn.id,
              title: turn.rootBoundary.title,
              kind: (turn.rootBoundary.entries[0]!.part.data as Record<string, JsonValue>).kind,
            },
          ]
        : [],
    );

  it("marks a model change between turns with the new model and its variant", () => {
    const turns = projectTranscriptTurns([
      prompt("first", 1),
      reply("first-reply", 2),
      modelSwitch("switch", 4, { id: "claude", providerID: "anthropic", variant: "max" }),
      prompt("second", 5),
    ]);

    expect(turns.map((turn) => turn.id)).toEqual(["first", "switch", "second"]);
    expect(turns[1]).toMatchObject({ kind: "boundary", activity: [] });
    expect(turns[1]?.rootBoundary).toMatchObject({
      kind: "boundary",
      title: "Switched to claude · max",
      entries: [
        {
          part: {
            type: "timeline-boundary",
            data: {
              kind: "model-switch",
              tone: "neutral",
              model: { id: "claude", providerID: "anthropic", variant: "max" },
              previous: { id: "gpt-5", providerID: "openai" },
            },
          },
        },
      ],
    });
  });

  it("names a variant-only change after the composer's reasoning effort", () => {
    expect(
      markers([
        prompt("first", 1),
        reply("first-reply", 2, { id: "gpt-5", providerID: "openai", variant: "low" }),
        modelSwitch("high", 4, { id: "gpt-5", providerID: "openai", variant: "high" }),
        prompt("second", 5),
        reply("second-reply", 6, { id: "gpt-5", providerID: "openai", variant: "high" }),
        modelSwitch("auto", 8, { id: "gpt-5", providerID: "openai" }),
      ]),
    ).toEqual([
      { id: "high", title: "Switched reasoning effort to high", kind: "model-switch" },
      { id: "auto", title: "Switched reasoning effort to Auto", kind: "model-switch" },
    ]);
  });

  it("marks an agent change", () => {
    expect(
      markers([
        prompt("first", 1),
        reply("first-reply", 2),
        agentSwitch("plan", 4, "plan", "build"),
        prompt("second", 5),
      ]),
    ).toEqual([{ id: "plan", title: "Switched to Plan agent", kind: "agent-switch" }]);
  });

  it("does not mark the switches that set up the task before its first prompt", () => {
    expect(
      markers([
        agentSwitch("agent", 1, "plan", "build"),
        modelSwitch("model", 2, { id: "claude", providerID: "anthropic" }),
        prompt("first", 3),
        reply("reply", 4, { id: "claude", providerID: "anthropic" }),
      ]),
    ).toEqual([]);
  });

  it("keeps only the last switch of each kind when nothing happened between them", () => {
    expect(
      markers([
        prompt("first", 1),
        reply("reply", 2),
        modelSwitch("claude", 4, { id: "claude", providerID: "anthropic" }),
        agentSwitch("plan", 5, "plan", "build"),
        modelSwitch("gemini", 6, { id: "gemini", providerID: "google" }),
        agentSwitch("explore", 7, "explore", "plan"),
        prompt("second", 8),
      ]),
    ).toEqual([
      { id: "gemini", title: "Switched to gemini", kind: "model-switch" },
      { id: "explore", title: "Switched to Explore agent", kind: "agent-switch" },
    ]);
  });

  it("does not mark switches that leave the effective model or agent unchanged", () => {
    expect(
      markers([
        prompt("first", 1),
        reply("reply", 3),
        modelSwitch("away", 4, { id: "claude", providerID: "anthropic" }),
        agentSwitch("plan", 5, "plan", "build"),
        modelSwitch("back", 6, { id: "gpt-5", providerID: "openai" }),
        agentSwitch("build", 7, "build", "plan"),
        prompt("second", 8),
      ]),
    ).toEqual([]);
  });

  it("keeps the marker turn stable across projections", () => {
    const projector = createSessionTranscriptProjector();
    const messages = [
      prompt("first", 1),
      reply("reply", 2),
      modelSwitch("switch", 4, { id: "claude", providerID: "anthropic" }),
    ];
    const first = projector.project({ messages });
    const next = projector.project({ messages: [...messages, prompt("second", 5)] });
    expect(next.rows[1]?.turn.id).toBe("switch");
    expect(next.rows[1]?.turn).toBe(first.rows[1]?.turn);
  });
});

describe("pending approvals on tool rows", () => {
  it("reveals the activity group holding the tool a permission request names", () => {
    const assistant = message({
      id: "assistant",
      type: "assistant",
      completedAt: null,
      finish: "tool-calls",
      content: [
        {
          type: "tool",
          id: "read",
          name: "read",
          state: { status: "completed", input: { path: "a.ts" } },
        },
        {
          type: "tool",
          id: "shell",
          name: "shell",
          state: { status: "running", input: { command: "rm -rf build" } },
        },
      ],
    });
    const permission: PendingRequestView = {
      id: "permission",
      type: "permission",
      title: "Run command",
      resources: [],
      savePatterns: [],
      questions: [],
      fields: [],
      ownerMessageID: assistant.id,
      toolPartID: "shell",
    };
    const turn = projectTranscriptTurns([assistant], null, [permission])[0]!;
    const group = turn.activity.find((item) =>
      item.entries.some((entry) => entry.part.id === "shell"),
    );
    expect(group).toMatchObject({ forceOpen: true, presentation: "individual" });
    expect(turn.shouldAutoCollapse).toBe(false);
  });
});

describe("prompt-level turns", () => {
  const prompt = (id: string, createdAt: number, extra: Partial<PalotMessage> = {}) =>
    message({ id, type: "user", createdAt, completedAt: createdAt, text: id, ...extra });
  const tool = (id: string, status = "completed") => ({
    type: "tool" as const,
    id,
    name: "read",
    state: { status, input: { path: `src/${id}.ts` } },
  });
  const step = (
    id: string,
    createdAt: number,
    content: PalotMessageContent[],
    extra: Partial<PalotMessage> = {},
  ) =>
    message({
      id,
      type: "assistant",
      createdAt,
      completedAt: createdAt + 1,
      finish: content.some((part) => part.type === "tool") ? "tool-calls" : "stop",
      content,
      ...extra,
    });
  const text = (id: string, value: string, phase?: "commentary" | "final_answer") => ({
    type: "text" as const,
    id,
    text: value,
    ...(phase ? { native: { phase } } : {}),
  });

  it("projects a prompt, its tool steps and its answer as one turn with one duration", () => {
    const turns = projectTranscriptTurns([
      prompt("prompt", 10),
      step("explore", 11, [text("checking", "Checking the file."), tool("read")]),
      step("edit", 13, [tool("edit")]),
      step("answer", 15, [text("answer", "Fixed it.")]),
      idle("idle", 20, "succeeded"),
    ]);

    expect(turns).toHaveLength(1);
    expect(turns[0]).toMatchObject({
      id: "prompt",
      kind: "conversation",
      status: "completed",
      startedAt: 10,
      completedAt: 20,
      canCollapse: true,
      shouldAutoCollapse: true,
      final: { part: { id: "answer" } },
    });
    expect(turns[0]?.activity.map((group) => group.kind)).toEqual(["content", "tools"]);
    expect(turns[0]?.activity[0]?.entries[0]?.part.id).toBe("checking");
  });

  it("starts a turn at each prompt after an idle marker", () => {
    const turns = projectTranscriptTurns([
      prompt("first", 1),
      step("first-answer", 2, [text("a1", "One")]),
      idle("first-idle", 4, "succeeded"),
      prompt("second", 5),
      step("second-answer", 6, [text("a2", "Two")], { completedAt: null, finish: null }),
    ]);

    expect(turns.map((turn) => [turn.id, turn.status])).toEqual([
      ["first", "completed"],
      ["second", "working"],
    ]);
    expect(turns[0]?.completedAt).toBe(4);
  });

  it("starts a turn at a prompt delivered after a settled step, with one idle marker for the run", () => {
    const turns = projectTranscriptTurns([
      prompt("earlier", 1),
      step("earlier-answer", 2, [text("a0", "Zero")]),
      idle("earlier-idle", 3, "succeeded"),
      prompt("first", 4),
      step("first-answer", 5, [text("a1", "One")]),
      prompt("queued", 7),
      step("queued-answer", 8, [text("a2", "Two")]),
      idle("idle", 10, "succeeded"),
    ]);

    expect(
      turns.map((turn) => [turn.id, turn.status, turn.completedAt, turn.final?.part.id]),
    ).toEqual([
      ["earlier", "completed", 3, "a0"],
      ["first", "completed", 6, "a1"],
      ["queued", "completed", 10, "a2"],
    ]);
  });

  it("splits at a prompt after a settled answer whether or not a marker is in view", () => {
    const run = [
      prompt("first", 1),
      step("first-answer", 2, [text("a1", "One")]),
      prompt("second", 5),
      step("second-answer", 6, [text("a2", "Two")]),
    ];
    const shape = (messages: PalotMessage[]) =>
      projectTranscriptTurns(messages).map((turn) => [turn.id, turn.final?.part.id]);

    expect(shape(run)).toEqual([
      ["first", "a1"],
      ["second", "a2"],
    ]);
    expect(shape([...run, idle("idle", 8, "succeeded")])).toEqual(shape(run));
  });

  it("keeps a steer sent before the first step inside the turn of a new session", () => {
    const turns = projectTranscriptTurns([
      prompt("prompt", 1),
      prompt("steer", 2),
      step("explore", 3, [tool("read")]),
      step("answer", 5, [text("answer", "Done.")]),
    ]);

    expect(turns.map((turn) => turn.id)).toEqual(["prompt"]);
    expect(turns[0]?.users.map((user) => user.id)).toEqual(["prompt", "steer"]);
    expect(turns[0]?.final?.part.id).toBe("answer");
  });

  it("joins steers on a page that starts inside a long run with no marker in view", () => {
    const page = [
      step("explore", 1, [tool("read")]),
      prompt("steer-1", 3),
      step("edit", 4, [tool("edit")]),
      prompt("steer-2", 6),
      step("answer", 7, [text("answer", "Done.")]),
    ];
    const turns = projectTranscriptTurns(page);

    expect(turns.map((turn) => turn.id)).toEqual(["explore"]);
    expect(turns[0]?.users.map((user) => user.id)).toEqual(["steer-1", "steer-2"]);
    expect(turns[0]?.final?.part.id).toBe("answer");
    expect(
      projectTranscriptTurns([...page, idle("idle", 9, "succeeded")]).map((t) => t.id),
    ).toEqual(["explore"]);
  });

  it("opens a turn at a subagent report delivered after a settled step in the same run", () => {
    const report = message({
      id: "report",
      type: "synthetic",
      createdAt: 5,
      text: '<subagent sessionID="child" state="completed">Done.</subagent>',
      data: { metadata: { source: "subagent", childID: "child", state: "completed" } },
    });
    const turns = projectTranscriptTurns([
      prompt("prompt", 1),
      step("answer", 2, [text("a1", "Started a subagent.")]),
      report,
      step("follow-up", 6, [text("a2", "The subagent finished.")]),
      idle("idle", 8, "succeeded"),
    ]);

    expect(turns.map((turn) => [turn.id, turn.kind, turn.completedAt])).toEqual([
      ["prompt", "conversation", 3],
      ["report", "conversation", 8],
    ]);
  });

  describe("live and reloaded views of the same run", () => {
    const shape = (messages: PalotMessage[], execution: SessionExecutionState | null = null) =>
      projectTranscriptTurns(messages, execution).map((turn) => ({
        id: turn.id,
        users: turn.users.map((user) => user.id),
        activity: turn.activity.map((group) => group.kind),
        final: turn.final?.part.id ?? null,
        status: turn.status,
        completedAt: turn.completedAt,
      }));

    it("agree on a prompt queued mid-step and delivered after the first answer", () => {
      const first = prompt("first", 1);
      const firstAnswer = step("first-answer", 2, [text("a1", "One")], { completedAt: 4 });
      const queuedAnswer = step("queued-answer", 5, [text("a2", "Two")], { completedAt: 6 });
      const marker = idle("idle", 7, "succeeded");
      const sent = prompt("queued", 3, { optimistic: true, timelineAt: 3, delivery: "queue" });

      // Before delivery the prompt waits as a turn of its own after the running one.
      const waiting = shape([first, { ...firstAnswer, completedAt: null, finish: null }, sent], {
        status: "running",
        startedAt: 1,
        completedAt: null,
      });
      expect(waiting.map(({ id, status }) => [id, status])).toEqual([
        ["first", "working"],
        ["queued", "completed"],
      ]);

      const live = shape([first, firstAnswer, { ...sent, promotedAt: 5 }, queuedAnswer, marker]);
      const reloaded = shape([first, firstAnswer, prompt("queued", 5), queuedAnswer, marker]);
      expect(live).toEqual(reloaded);
      expect(reloaded).toEqual([
        {
          id: "first",
          users: ["first"],
          activity: [],
          final: "a1",
          status: "completed",
          completedAt: 4,
        },
        {
          id: "queued",
          users: ["queued"],
          activity: [],
          final: "a2",
          status: "completed",
          completedAt: 7,
        },
      ]);
    });

    it("agree on a steer sent mid-tool-loop", () => {
      const first = prompt("first", 1);
      const explore = step("explore", 2, [tool("read")], { completedAt: 4 });
      const answer = step("answer", 4, [text("answer", "Done.")]);
      const marker = idle("idle", 7, "succeeded");
      const sent = prompt("steer", 3, { optimistic: true, timelineAt: 3, delivery: "steer" });

      const live = shape([first, explore, { ...sent, promotedAt: 4 }, answer, marker]);
      const reloaded = shape([first, explore, prompt("steer", 4), answer, marker]);
      expect(live).toEqual(reloaded);
      expect(reloaded).toEqual([
        {
          id: "first",
          users: ["first", "steer"],
          activity: ["tools", "input"],
          final: "answer",
          status: "completed",
          completedAt: 7,
        },
      ]);
    });
  });

  it("gives a marker that ties with the next prompt to the turn the run ended", () => {
    const turns = projectTranscriptTurns(
      [
        prompt("first", 1),
        step("first-answer", 2, [text("a1", "One")]),
        prompt("second", 5),
        idle("idle", 5, "failed"),
        step("second-answer", 6, [text("a2", "Two")], { completedAt: null, finish: null }),
      ],
      { status: "running", startedAt: 5, completedAt: null },
    );

    expect(turns.map((turn) => [turn.id, turn.status, turn.completedAt])).toEqual([
      ["first", "failed", 5],
      ["second", "working", null],
    ]);
    expect(turns[1]?.final?.part.id).toBe("a2");
  });

  it("chooses the answer after the last tool call and steer, honouring commentary", () => {
    const byPhase = projectTranscriptTurns([
      prompt("prompt", 1),
      step("first", 2, [text("early", "Here is the answer.", "final_answer"), tool("read")]),
      step("second", 4, [text("answer", "It reads fine."), text("note", "Checked.", "commentary")]),
      idle("idle", 6, "succeeded"),
    ])[0];
    expect(byPhase?.final?.part.id).toBe("answer");
    expect(
      byPhase?.activity.flatMap((group) => group.entries.map((entry) => entry.part.id)),
    ).toEqual(["early", "read", "note"]);

    const steered = projectTranscriptTurns([
      prompt("prompt", 1),
      step("first", 2, [text("done", "Done.", "final_answer"), tool("read")]),
      prompt("steer", 4),
      step("again", 5, [tool("edit")]),
      step("updated", 7, [text("updated", "Updated it.")]),
      idle("idle", 9, "succeeded"),
    ]);
    expect(steered.map((turn) => [turn.id, turn.final?.part.id])).toEqual([["prompt", "updated"]]);

    const steeredMidRun = projectTranscriptTurns([
      prompt("prompt", 1),
      step("first", 2, [text("done", "Done.", "final_answer"), tool("read")]),
      prompt("steer", 4),
      step("again", 5, [tool("edit")]),
      idle("idle", 9, "succeeded"),
    ])[0];
    expect(steeredMidRun?.users.map((user) => user.id)).toEqual(["prompt", "steer"]);
    expect(steeredMidRun?.final).toBeNull();
    expect(steeredMidRun?.activity[0]).toMatchObject({
      kind: "content",
      entries: [{ part: { id: "done" } }],
    });
  });

  it("moves trailing text into the work once a tool call follows it", () => {
    const user = prompt("prompt", 1);
    const streaming = (content: PalotMessageContent[]) =>
      step("step", 2, content, { completedAt: null, finish: null });
    const live = { status: "running" as const, startedAt: 1, completedAt: null };

    const answering = projectTranscriptTurns(
      [user, streaming([text("text", "Let me look.")])],
      live,
    )[0];
    expect(answering?.final?.part.id).toBe("text");

    const working = projectTranscriptTurns(
      [user, streaming([text("text", "Let me look."), tool("read", "running")])],
      live,
    )[0];
    expect(working?.final).toBeNull();
    expect(working?.activity[0]).toMatchObject({ kind: "content" });

    const commentary = projectTranscriptTurns(
      [user, streaming([text("text", "Looking around.", "commentary")])],
      live,
    )[0];
    expect(commentary?.final).toBeNull();
  });

  it("ends an interrupted turn on its work, with no answer and the whole run as its duration", () => {
    const turn = projectTranscriptTurns([
      prompt("prompt", 10),
      step("explore", 11, [text("plan", "Checking the parser."), tool("read")]),
      step("edit", 13, [tool("edit", "running")], { finish: "error" }),
      idle("idle", 40, "interrupted"),
    ])[0];

    expect(turn).toMatchObject({
      status: "interrupted",
      final: null,
      startedAt: 10,
      workCompletedAt: null,
      completedAt: 40,
      canCollapse: false,
      shouldAutoCollapse: false,
    });
    expect(turn?.activity[0]).toMatchObject({
      kind: "content",
      entries: [{ part: { id: "plan" } }],
    });
    expect(turn?.activity.slice(1).some((group) => group.kind === "tools")).toBe(true);
  });

  it("folds a completed turn that ended on its work", () => {
    const projection = createSessionTranscriptProjector().project({
      messages: [
        prompt("prompt", 1),
        step("explore", 2, [text("plan", "Checking."), tool("read")]),
        idle("idle", 5, "succeeded"),
      ],
    });

    expect(projection.rows[0]?.turn).toMatchObject({
      status: "completed",
      final: null,
      canCollapse: true,
      shouldAutoCollapse: true,
    });
    expect(projection.presentationRows.map((row) => row.kind)).toEqual([
      "user-message",
      "activity",
    ]);
  });

  it.each([
    ["succeeded", "completed", true],
    ["failed", "failed", false],
    ["interrupted", "interrupted", false],
  ] as const)(
    "takes a %s turn's status and end time from its idle marker after reload",
    (outcome, status, folds) => {
      const turn = projectTranscriptTurns([
        prompt("prompt", 10),
        step("work", 11, [tool("read", "error")]),
        step("answer", 13, [text("answer", "Done.")]),
        idle("idle", 30, outcome),
      ])[0];

      expect(turn).toMatchObject({
        status,
        startedAt: 10,
        completedAt: 30,
        canCollapse: folds,
        shouldAutoCollapse: folds,
      });
    },
  );

  it("prefers live execution state while the turn runs", () => {
    const turn = projectTranscriptTurns(
      [prompt("prompt", 10, { runStartedAt: 12 }), step("work", 13, [tool("read")])],
      { status: "running", startedAt: 11, completedAt: null },
    )[0];
    expect(turn).toMatchObject({ status: "working", startedAt: 11, completedAt: null });

    const reloaded = projectTranscriptTurns([
      prompt("prompt", 10, { runStartedAt: 12 }),
      step("work", 13, [tool("read")]),
      idle("idle", 20, "succeeded"),
    ])[0];
    expect(reloaded).toMatchObject({ status: "completed", startedAt: 12, completedAt: 20 });
  });

  it("opens a turn at the notice that started work without a prompt", () => {
    const report = message({
      id: "report",
      type: "synthetic",
      createdAt: 10,
      text: '<subagent sessionID="child" state="completed">Done.</subagent>',
      data: { metadata: { source: "subagent", childID: "child", state: "completed" } },
    });
    const notice = message({
      id: "notice",
      type: "synthetic",
      createdAt: 20,
      data: { description: "Scheduled check" },
    });
    const turns = projectTranscriptTurns([
      prompt("prompt", 1),
      step("answer", 2, [text("a1", "Started a subagent.")]),
      idle("idle", 4, "succeeded"),
      report,
      step("follow-up", 11, [text("a2", "The subagent finished.")]),
      idle("report-idle", 13, "succeeded"),
      notice,
      step("check", 21, [tool("read"), text("a3", "All good.")]),
      idle("notice-idle", 23, "succeeded"),
    ]);

    expect(turns.map((turn) => [turn.id, turn.kind, turn.final?.part.id])).toEqual([
      ["prompt", "conversation", "a1"],
      ["report", "conversation", "a2"],
      ["notice", "conversation", "a3"],
    ]);
    expect(turns[1]?.rootBoundary?.title).toBe("Finished 1 subagent");
    expect(turns[1]).toMatchObject({ startedAt: 10, completedAt: 13 });
    expect(turns[2]?.rootBoundary?.title).toBe("Scheduled check");
    expect(turns[2]).toMatchObject({ status: "completed", canCollapse: true });
  });

  it("shows a run that a notice started as working before its first step", () => {
    const report = message({
      id: "report",
      type: "synthetic",
      createdAt: 10,
      text: '<subagent sessionID="child" state="completed">Done.</subagent>',
      data: { metadata: { source: "subagent", childID: "child", state: "completed" } },
    });
    const turns = projectTranscriptTurns(
      [
        prompt("prompt", 1),
        step("answer", 2, [text("a1", "Started a subagent.")]),
        idle("idle", 4, "succeeded"),
        report,
      ],
      { status: "running", startedAt: 11, completedAt: null },
    );

    expect(turns.map((turn) => [turn.id, turn.status])).toEqual([
      ["prompt", "completed"],
      ["report", "working"],
    ]);
  });

  it("shows the working row for a run a notice started", () => {
    const notice = message({
      id: "notice",
      type: "synthetic",
      createdAt: 10,
      data: { description: "Scheduled check" },
    });
    const projection = createSessionTranscriptProjector().project({
      messages: [
        prompt("prompt", 1),
        step("answer", 2, [text("a1", "One")]),
        idle("idle", 4, "succeeded"),
        notice,
      ],
      execution: { status: "running", startedAt: 11, completedAt: null },
    });

    expect(projection.rows[1]?.turn).toMatchObject({ kind: "boundary", status: "working" });
    expect(
      projection.presentationRows.filter((row) => row.turnID === "notice").map((row) => row.kind),
    ).toEqual(["boundary", "turn-status"]);
  });

  it("keeps a notice with no work after it as its own turn", () => {
    const notice = message({
      id: "notice",
      type: "synthetic",
      createdAt: 5,
      data: { description: "Moved to a worktree" },
    });
    const turns = projectTranscriptTurns([
      prompt("first", 1),
      step("first-answer", 2, [text("a1", "One")]),
      idle("idle", 4, "succeeded"),
      notice,
      prompt("second", 6),
    ]);

    expect(turns.map((turn) => [turn.id, turn.kind])).toEqual([
      ["first", "conversation"],
      ["notice", "boundary"],
      ["second", "conversation"],
    ]);
    expect(turns[1]?.rootBoundary?.title).toBe("Moved to a worktree");
  });

  it("keeps a user shell command as its own turn between prompts", () => {
    const shell = message({
      id: "shell",
      type: "shell",
      createdAt: 5,
      completedAt: 6,
      data: { shellID: "shell", command: "ls", status: "exited", exit: 0 },
    });
    const between = projectTranscriptTurns([
      prompt("first", 1),
      step("first-answer", 2, [text("a1", "One")]),
      idle("idle", 4, "succeeded"),
      shell,
      prompt("second", 7),
      step("second-answer", 8, [text("a2", "Two")]),
      idle("second-idle", 10, "succeeded"),
    ]);
    expect(between.map((turn) => [turn.id, turn.kind])).toEqual([
      ["first", "conversation"],
      ["shell", "shell"],
      ["second", "conversation"],
    ]);

    // A shell command ends the open turn; the run's later steps continue in a turn of their own.
    const during = projectTranscriptTurns([
      prompt("first", 1),
      step("explore", 2, [tool("read")]),
      shell,
      step("answer", 7, [text("a1", "Done.")]),
      idle("idle", 9, "succeeded"),
    ]);
    expect(during.map((turn) => [turn.id, turn.kind, turn.completedAt])).toEqual([
      ["first", "conversation", 3],
      ["shell", "shell", 6],
      ["answer", "conversation", 9],
    ]);

    // With no step after the command, the idle marker still ends the turn it interrupted.
    const ended = projectTranscriptTurns([
      prompt("first", 1),
      step("explore", 2, [tool("read")]),
      shell,
      idle("idle", 9, "failed"),
    ]);
    expect(ended.map((turn) => [turn.id, turn.status, turn.completedAt])).toEqual([
      ["first", "failed", 9],
      ["shell", "completed", 6],
    ]);
  });

  it("keeps compaction and a model switch inside the running turn", () => {
    const compaction = message({
      id: "compaction",
      type: "compaction",
      createdAt: 4,
      completedAt: 5,
      content: [{ type: "compaction", id: "compaction", status: "completed", text: "Summary" }],
    });
    const modelSwitch = message({
      id: "switch",
      type: "model-switched",
      createdAt: 6,
      completedAt: 6,
      data: { model: { id: "claude", providerID: "anthropic" } },
    });
    const turns = projectTranscriptTurns(
      [
        prompt("prompt", 1),
        step("explore", 2, [tool("read")], { model: { id: "gpt-5", providerID: "openai" } }),
        compaction,
        modelSwitch,
        step("continue", 7, [tool("grep", "running")], {
          completedAt: null,
          finish: null,
          model: { id: "claude", providerID: "anthropic" },
        }),
      ],
      { status: "running", startedAt: 1, completedAt: null },
    );

    expect(turns.map((turn) => [turn.id, turn.status])).toEqual([["prompt", "working"]]);
    expect(turns[0]?.activity.map((group) => [group.kind, group.title])).toEqual([
      ["tools", expect.any(String)],
      ["compaction", "Compacting context"],
      ["boundary", "Switched to claude"],
      ["tools", expect.any(String)],
    ]);
  });
});

describe("notices and background reports", () => {
  const notice = (
    id: string,
    data: Record<string, JsonValue>,
    type: "synthetic" | "system" = "synthetic",
  ) => message({ id, type, createdAt: 10, completedAt: 10, text: "body", data });
  // A system notice has no turn of its own to lead, so it stays in the activity.
  const boundary = (value: PalotMessage) => {
    const turn = projectTranscriptTurns([value])[0]!;
    return turn.rootBoundary ?? turn.activity[0];
  };
  const subagentReport = (id: string, createdAt: number, state = "completed") =>
    message({
      id,
      type: "synthetic",
      createdAt,
      completedAt: createdAt,
      text: `<subagent sessionID="${id}" state="${state}">Done.</subagent>`,
      data: {
        description: `Inspect ${id}`,
        metadata: { source: "subagent", childID: id, agent: "explore", state },
      },
    });
  const shellReport = (id: string, createdAt: number, state = "completed", exit = 0) =>
    message({
      id,
      type: "synthetic",
      createdAt,
      completedAt: createdAt,
      text: `<shell id="${id}" state="${state}" command="make ${id}">\nout\n</shell>`,
      data: {
        description: `make ${id}`,
        metadata: { source: "shell", shellID: id, state, exit },
      },
    });

  it("gives each notice kind OpenCode writes its own wording and detail", () => {
    expect(
      boundary(
        notice("goal", { description: "Goal: Ship it", metadata: { source: "goal", goalID: "g" } }),
      ),
    ).toMatchObject({ title: "Goal: Ship it", entries: [{ part: { data: { notice: "goal" } } }] });
    expect(
      boundary(
        notice("restart", {
          description: "Continuing after restart",
          metadata: { notice: "restart" },
        }),
      ),
    ).toMatchObject({
      title: "OpenCode restarted",
      entries: [{ part: { text: "Continuing after restart", data: { notice: "restart" } } }],
    });
    expect(
      boundary(
        notice(
          "instructions",
          {
            description: "Instructions updated: AGENTS.md, docs/AGENTS.md",
            userVisible: true,
            metadata: {
              notice: "instructions",
              instructionSources: ["AGENTS.md", "docs/AGENTS.md"],
            },
          },
          "system",
        ),
      ),
    ).toMatchObject({
      title: "Loaded instructions",
      entries: [{ part: { text: "AGENTS.md, docs/AGENTS.md", data: { notice: "instructions" } } }],
    });
    expect(
      boundary(
        notice("loaded", {
          description: "Loaded AGENTS.md, apps/AGENTS.md",
          metadata: { instruction: { paths: ["/repo/AGENTS.md", "/repo/apps/AGENTS.md"] } },
        }),
      ),
    ).toMatchObject({
      title: "Loaded instructions",
      entries: [{ part: { text: "AGENTS.md, apps/AGENTS.md" } }],
    });
    expect(
      boundary(
        notice("image", {
          description: "Image generation",
          metadata: {
            source: "experimental_image_generate",
            jobID: "j",
            state: "completed",
            path: "a.png",
          },
        }),
      ),
    ).toMatchObject({
      title: "Image generation",
      entries: [{ part: { data: { notice: "image" } } }],
    });
    expect(
      boundary(
        notice("watch", {
          description: "CI failed on main",
          metadata: { source: "console.watch" },
        }),
      ),
    ).toMatchObject({
      title: "CI failed on main",
      entries: [{ part: { data: { notice: "console-watch" } } }],
    });
    expect(boundary(notice("other", { description: "Moved to a worktree" }))).toMatchObject({
      title: "Moved to a worktree",
      entries: [{ part: { data: { kind: "synthetic", tone: "neutral" } } }],
    });
  });

  it("keeps hiding system notices that are not marked for the user", () => {
    expect(
      projectTranscriptTurns([
        notice(
          "instructions",
          { description: "Instructions updated: AGENTS.md", metadata: { notice: "instructions" } },
          "system",
        ),
      ]),
    ).toEqual([]);
  });

  it("merges adjacent reports with the same kind and outcome and keeps others apart", () => {
    const turns = projectTranscriptTurns([
      subagentReport("one", 10),
      subagentReport("two", 11),
      subagentReport("three", 12, "error"),
      shellReport("build", 13, "completed", 2),
      shellReport("lint", 14, "cancelled"),
      shellReport("test", 15, "cancelled"),
    ]);

    expect(turns.map((turn) => [turn.rootBoundary?.title, turn.rootBoundary?.pinned])).toEqual([
      ["Finished 2 subagents", true],
      ["1 subagent failed", true],
      ["1 command failed", true],
      ["Stopped 2 commands", false],
    ]);
    expect(turns[0]?.rootBoundary?.entries.map((entry) => entry.message.id)).toEqual([
      "one",
      "two",
    ]);
  });

  it("makes reports from a subagent the turn launched that launch row's result", () => {
    const launch = message({
      id: "launch",
      type: "assistant",
      createdAt: 5,
      completedAt: 6,
      finish: "tool-calls",
      content: [
        {
          type: "tool",
          id: "task",
          name: "task",
          state: {
            status: "completed",
            input: { description: "Inspect one", subagent_type: "explore", background: true },
            metadata: { sessionID: "one" },
          },
        },
      ],
    });
    const turn = projectTranscriptTurns([
      launch,
      subagentReport("one", 10),
      subagentReport("two", 11),
      // OpenCode after 2.2.7 reports again each time the child goes idle.
      subagentReport("one", 12),
    ])[0]!;

    expect(turn.activity.map((group) => [group.kind, group.title])).toEqual([
      ["tools", "Delegated 1 task"],
      ["boundary", "Finished 1 subagent"],
    ]);
  });

  it("counts a subagent that reported several times after the turn once", () => {
    const turns = projectTranscriptTurns([
      message({ id: "prompt", type: "user", createdAt: 1, completedAt: 1, text: "Go" }),
      message({
        id: "answer",
        type: "assistant",
        createdAt: 2,
        completedAt: 3,
        finish: "stop",
        content: [{ type: "text", text: "Launched." }],
      }),
      idle("idle", 4, "succeeded"),
      subagentReport("one", 10),
      subagentReport("one", 11),
    ]);

    // A report opens a turn of its own; it is never a prompt.
    expect(turns.map((turn) => [turn.kind, turn.user?.id ?? null])).toEqual([
      ["conversation", "prompt"],
      ["subagent", null],
    ]);
    expect(turns[1]?.rootBoundary).toMatchObject({
      title: "Finished 1 subagent",
      entries: [{}, {}],
    });
  });

  it("does not call a report finished while the subagent's own work still runs", () => {
    // OpenCode 2.3.0: the coordinator went idle while its own subagent waited for the user.
    const waiting = (id: string, createdAt: number, listed: string) =>
      message({
        id: `${id}-${createdAt}`,
        type: "synthetic",
        createdAt,
        completedAt: createdAt,
        text:
          `<subagent sessionID="${id}" state="running" description="Inspect ${id}">\n` +
          `Waiting for the collector.\n\nBackground work still running:\n${listed}\n</subagent>`,
        data: {
          description: `Inspect ${id}`,
          metadata: { source: "subagent", childID: id, agent: "general", state: "completed" },
        },
      });
    const turns = projectTranscriptTurns([
      waiting("one", 10, "- subagent (General, sessionID: grand): Collect the decision"),
      message({
        id: "parent-waits",
        type: "assistant",
        createdAt: 11,
        completedAt: 12,
        finish: "stop",
        content: [{ type: "text", text: "Waiting for the coordinator." }],
      }),
      idle("idle", 13, "succeeded"),
      waiting("two", 20, "- subagent (General, sessionID: a): A\n- shell (sh_1): bun test"),
      waiting("three", 21, "- subagent (General, sessionID: b): B"),
      subagentReport("one", 30),
    ]);

    expect(turns.map((turn) => turn.rootBoundary?.title)).toEqual([
      "1 subagent waiting for its subagent",
      "2 subagents waiting for background work",
      "Finished 1 subagent",
    ]);
  });

  it("calls a completed report finished even when its answer quotes the still-running heading", () => {
    const turns = projectTranscriptTurns([
      message({
        id: "quoted",
        type: "synthetic",
        createdAt: 10,
        completedAt: 10,
        text:
          '<subagent sessionID="one" state="completed" description="Inspect one">\n' +
          "OpenCode appends:\n\nBackground work still running:\n- shell (sh_1): bun test\n</subagent>",
        data: {
          description: "Inspect one",
          metadata: { source: "subagent", childID: "one", agent: "general", state: "completed" },
        },
      }),
    ]);
    expect(turns.map((turn) => turn.rootBoundary?.title)).toEqual(["Finished 1 subagent"]);
  });
});
