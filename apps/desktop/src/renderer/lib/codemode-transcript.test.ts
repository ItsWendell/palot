import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { SessionMessageInfo } from "@opencode/client";
import type { JsonValue, PalotMessage, PalotMessageContent } from "../../shared";
import { mapMessage } from "../services/opencode-mappers";
import { SESSION_PROJECTION_PRESETS } from "./session-projection-policy";
import { createSessionTranscriptProjector, type TranscriptTurn } from "./turn-projection";
import { projectToolExecution, scriptCallOrigin } from "./tool-executions";
import { activityFailureCount, scriptCallDiffTarget } from "./turn-projection";
import { turnWorkSummary, turnWorkSummaryClauses } from "./turn-work-summary";
import { isTool } from "./view-models";

/**
 * A trimmed OpenCode 2.3.2 session captured with `full_codemode`: reads (one PNG), two edits and
 * two commands in one script, a script that went to the background and its notice, and a
 * backgrounded web search.
 */
const captured = (
  JSON.parse(
    readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "__fixtures__/codemode/session-messages.json"),
      "utf8",
    ),
  ) as SessionMessageInfo[]
).map(mapMessage);

function project(messages: PalotMessage[], running = false, all = false): TranscriptTurn[] {
  const last = messages.at(-1)!;
  return createSessionTranscriptProjector()
    .project({
      messages,
      execution: running
        ? { status: "running", startedAt: messages[0]!.createdAt, completedAt: null }
        : {
            status: "succeeded",
            startedAt: messages[0]!.createdAt,
            completedAt: last.completedAt ?? last.createdAt,
          },
      policy: SESSION_PROJECTION_PRESETS.compact,
    })
    .rows.map((row) => row.turn)
    .filter((turn) => all || turn.user !== null);
}

/** The captured turn whose prompt starts with `prompt`. */
function capturedTurn(prompt: string): TranscriptTurn {
  const turn = project(captured).find((candidate) => candidate.user?.text?.startsWith(prompt));
  if (!turn) throw new Error(`No captured turn for "${prompt}"`);
  return turn;
}

function tools(turn: TranscriptTurn): PalotMessageContent[] {
  return turn.activity.flatMap((group) =>
    group.entries.filter((entry) => isTool(entry.part)).map((entry) => entry.part),
  );
}

function rendered(turn: TranscriptTurn): string[] {
  return turn.activity.map((group) => group.title);
}

describe("Code Mode scripts in the transcript", () => {
  it("shows a script's calls as the rows of the same calls made directly", () => {
    const edits = tools(capturedTurn("In one script: change Status"));
    // The script that ran to the end has no row of its own; each call names its script.
    expect(edits.map((part) => part.name)).toEqual(["edit", "edit", "shell", "shell"]);
    expect(edits.every((part) => scriptCallOrigin(part)?.script.name === "execute")).toBe(true);
    expect(edits.map((part) => projectToolExecution(part, 0).kind)).toEqual([
      "file-change",
      "file-change",
      "shell",
      "shell",
    ]);

    const reads = tools(capturedTurn("Read notes.md")).map((part) => projectToolExecution(part, 0));
    expect(reads.map((view) => view.kind)).toEqual(["read", "read", "read"]);
    // OpenCode attaches the PNG to the script's result; it shows on the read that loaded it.
    expect(reads.map((view) => view.images.length)).toEqual([0, 0, 1]);
  });

  it("gives each file a script changed the turn's diff once, on its last change", () => {
    const turn = capturedTurn("In one script: change Status");
    const [notes, app] = tools(turn);
    expect(scriptCallDiffTarget(notes!)).toEqual({
      userMessageID: turn.user!.id,
      files: ["notes.md"],
    });
    expect(scriptCallDiffTarget(app!)).toEqual({ userMessageID: turn.user!.id, files: ["app.js"] });

    const [again] = project([
      user,
      step([
        script("completed", [
          {
            tool: "edit",
            status: "completed",
            input: { path: "a.ts", oldString: "a", newString: "b" },
          },
          {
            tool: "edit",
            status: "completed",
            input: { path: "a.ts", oldString: "b", newString: "c" },
          },
        ]),
      ]),
    ]);
    const [first, second] = tools(again!);
    expect(scriptCallDiffTarget(first!)).toBeNull();
    expect(scriptCallDiffTarget(second!)?.files).toEqual(["a.ts"]);
  });

  it("counts a script's edits and commands in the turn summary", () => {
    const turn = capturedTurn("In one script: change Status");
    const summary = turnWorkSummary(turn);
    // The script's edits report no line counts, so there is no total; `ls missing-dir` exited 2
    // but OpenCode records the call as completed, so it is not a failure here.
    expect(summary).toMatchObject({
      changedFiles: 2,
      additions: null,
      deletions: null,
      commands: 2,
      failed: 0,
    });
    expect(turnWorkSummaryClauses(summary)).toEqual(["changed 2 files", "ran 2 commands"]);
  });

  it("names a script's calls in its activity group title", () => {
    expect(rendered(capturedTurn("In one script: change Status"))).toContain(
      "Changed notes.md and app.js and ran 2 commands",
    );
    expect(rendered(capturedTurn("Read notes.md"))).toContain("Read 3 files");
  });

  it("says a script went to the background, and its notice how it ended and with what", () => {
    // OpenCode posts the notice after the run went idle, so it opens a turn of its own.
    const turns = project(captured, false, true);
    expect(rendered(capturedTurn("Run ./slow.sh"))).toEqual(["Started 1 background script"]);
    const notice = turns.find(
      (turn) => turn.rootBoundary?.entries[0]?.message.type === "synthetic",
    );
    const part = notice?.rootBoundary?.entries[0]?.part;
    expect(part?.name).toBe("Background script finished");
    expect(part?.data).toMatchObject({ notice: "codemode", state: "completed" });
    expect(part?.text).toBe(
      '```json\n{"exitCode":0,"output":"slow-done\\n","wallTimeSeconds":25.005}\n```',
    );
  });

  it('reads the 2.4 notice form, <background-result kind="codemode">', () => {
    const upgraded = captured.map((message) =>
      message.type === "synthetic" && message.text
        ? {
            ...message,
            text: message.text
              .replace(/^<codemode /, '<background-result kind="codemode" ')
              .replace(/<\/codemode>$/, "</background-result>"),
          }
        : message,
    );
    const notice = project(upgraded, false, true).find(
      (turn) => turn.rootBoundary?.entries[0]?.message.type === "synthetic",
    );
    expect(notice?.rootBoundary?.entries[0]?.part.text).toBe(
      '```json\n{"exitCode":0,"output":"slow-done\\n","wallTimeSeconds":25.005}\n```',
    );
  });

  it("folds a notice that arrives within the script's turn into its card", () => {
    const start = captured.findIndex((message) => message.text?.startsWith("Run ./slow.sh"));
    const notice = captured.find((message) => message.type === "synthetic")!;
    // The script's prompt and step, then the notice while the agent still works (it had not
    // answered yet), so the notice lands inside the turn.
    const messages = [
      ...captured.slice(start, start + 2),
      notice,
      captured.find((message) => message.id === "msg_1ee1d52f30015G057Mv3qOymdw")!,
    ];
    const [turn] = project(messages);
    expect(turn!.activity.filter((group) => group.kind === "boundary")).toEqual([]);
    const [script] = tools(turn!);
    const view = projectToolExecution(script!, 0);
    expect(view).toMatchObject({
      kind: "execute",
      status: "complete",
      background: { state: "completed" },
    });
    expect(view.rawOutput).toBe('{"exitCode":0,"output":"slow-done\\n","wallTimeSeconds":25.005}');
  });
});

let id = 0;

function step(content: PalotMessageContent[], completed = true): PalotMessage {
  id += 1;
  return {
    id: `assistant-${id}`,
    type: "assistant",
    createdAt: 2 + id,
    completedAt: completed ? 2 + id : null,
    text: null,
    agent: "build",
    model: null,
    tokens: null,
    finish: completed ? "tool-calls" : null,
    content,
    data: null,
  };
}

function script(
  status: string,
  toolCalls: Array<{ tool: string; status: string; input: JsonValue }>,
  metadata: Record<string, JsonValue> = {},
): PalotMessageContent {
  return {
    type: "tool",
    id: `script-${id}`,
    name: "execute",
    state: { status, input: { code: "…" }, metadata: { toolCalls, ...metadata } },
  };
}

const user: PalotMessage = {
  id: "user-1",
  type: "user",
  createdAt: 1,
  completedAt: 1,
  text: "Do it",
  agent: null,
  model: null,
  tokens: null,
  finish: null,
  content: [],
  data: null,
};

describe("Code Mode script failures and live titles", () => {
  it("ends a script that threw with a failed row of its own, after its calls", () => {
    const [turn] = project([
      user,
      step([
        script("completed", [{ tool: "read", status: "completed", input: { path: "a.ts" } }], {
          error: true,
        }),
      ]),
    ]);
    const parts = tools(turn!);
    expect(parts.map((part) => part.name)).toEqual(["read", "execute"]);
    expect(projectToolExecution(parts[1]!, 0)).toMatchObject({
      status: "error",
      runtimeError: true,
    });
    expect(activityFailureCount(turn!.activity.find((group) => group.kind === "tools")!)).toBe(1);
  });

  it("keeps a running script out of view while its calls show live", () => {
    const [turn] = project(
      [
        user,
        step(
          [
            script("running", [
              { tool: "shell", status: "running", input: { command: "bun test" } },
            ]),
          ],
          false,
        ),
      ],
      true,
    );
    const parts = tools(turn!);
    expect(parts.map((part) => part.name)).toEqual(["shell"]);
    expect(projectToolExecution(parts[0]!, 0).status).toBe("running");
  });

  it("keeps the calls of a script that went to the background, then settles them with its job", () => {
    const toolCalls = [{ tool: "shell", status: "running", input: { command: "./slow.sh" } }];
    const background = step([script("completed", toolCalls, { jobID: "cm_1" })]);
    const [running] = project([user, background]);
    const before = tools(running!);
    expect(before.map((part) => part.name)).toEqual(["shell", "execute"]);
    expect(projectToolExecution(before[0]!, 0).status).toBe("running");
    // The job still runs after the turn ends, and so does the command it is running.
    expect(running).toMatchObject({ status: "completed", canCollapse: true });
    expect(rendered(running!)).toEqual(["Running './slow.sh'"]);

    const captureNotice = captured.find((message) => message.type === "synthetic")!;
    const notice: PalotMessage = {
      ...captureNotice,
      id: "notice-1",
      createdAt: background.createdAt + 0.5,
      text: '<codemode id="cm_1" state="completed">\n{"ok":true}\n</codemode>',
      data: {
        ...(captureNotice.data as Record<string, JsonValue>),
        metadata: { source: "codemode", jobID: "cm_1", state: "completed" },
      },
    };
    // The notice lands in the script's turn while the agent still works, as in the capture.
    const [done] = project([user, background, notice, step([{ type: "text", text: "Done" }])]);
    const after = tools(done!);
    expect(after.map((part) => part.name)).toEqual(["shell", "execute"]);
    expect(projectToolExecution(after[0]!, 0).status).toBe("complete");
    expect(projectToolExecution(after[1]!, 0)).toMatchObject({
      background: { state: "completed" },
    });

    // The usual case: the notice arrives after the turn ended and opens a turn of its own.
    const answered: PalotMessage = {
      ...step([{ type: "text", text: "It runs in the background." }]),
      finish: "stop",
    };
    const idle: PalotMessage = {
      ...user,
      id: "idle-1",
      type: "idle",
      createdAt: answered.createdAt + 0.5,
    };
    const later = { ...notice, createdAt: answered.createdAt + 1 };
    const [scriptTurn, noticeTurn] = project(
      [user, background, answered, idle, later],
      false,
      true,
    );
    expect(noticeTurn?.rootBoundary?.entries[0]?.part.name).toBe("Background script finished");
    expect(tools(scriptTurn!).map((part) => projectToolExecution(part, 0).status)).toEqual([
      "complete",
      "complete",
    ]);
  });

  it("counts a script that threw as one failure", () => {
    const [turn] = project([
      user,
      step([
        script("completed", [{ tool: "read", status: "completed", input: { path: "a.ts" } }], {
          error: true,
        }),
      ]),
    ]);
    expect(turnWorkSummary(turn!).failed).toBe(1);
  });

  it("counts the failed calls of a script that threw, not the script again", () => {
    const [turn] = project([
      user,
      step([
        script(
          "completed",
          [
            { tool: "read", status: "error", input: { path: "missing.md" } },
            { tool: "shell", status: "error", input: { command: "false" } },
          ],
          { error: true },
        ),
      ]),
    ]);
    expect(turnWorkSummary(turn!)).toMatchObject({ failed: 2, commands: 1 });
    const failures = turn!.activity.map((group) => activityFailureCount(group));
    expect(failures.reduce((sum, count) => sum + count, 0)).toBe(2);
  });

  it("names the call a running script is making", () => {
    // The progress OpenCode sent while the captured web-search script ran.
    const [turn] = project(
      [
        user,
        step(
          [
            script("running", [
              { tool: "edit", status: "completed", input: { path: "src/a.ts" } },
              { tool: "shell", status: "running", input: { command: "bun test" } },
            ]),
          ],
          false,
        ),
      ],
      true,
    );
    const group = turn!.activity.find((candidate) => candidate.kind === "tools");
    expect(group?.currentAction ?? group?.title).toBe("Running 'bun test'");
  });
});
