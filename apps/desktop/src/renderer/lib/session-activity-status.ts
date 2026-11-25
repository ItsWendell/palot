/** What a task is doing or waiting on right now, for status lines, voice and Inbox rows. */

import type { JsonValue } from "../../shared";
import type { SessionRuntimeStatus } from "../atoms/workspace";
import { latestTurnThought } from "./live-thought";
import { parallelActivityLabel } from "./parallel-activity";
import { projectToolExecution, type ToolExecutionView } from "./tool-executions";
import {
  turnHasToolActivity,
  type TranscriptTurn,
  type TurnActivityGroup,
  type TurnPart,
} from "./turn-projection";
import { isTool, type PendingRequestView } from "./view-models";

export type SessionActivityStatus =
  /** A permission request blocks the task. */
  | { kind: "approval"; requestID: string; detail: string | null }
  /** A question or form blocks the task. */
  | { kind: "answer"; requestID: string; detail: string | null }
  /** The user pressed Stop and the run has not ended yet. */
  | { kind: "stopping" }
  /** The provider failed and OpenCode tries again at `next` (epoch ms) when known. */
  | { kind: "retry"; attempt: number | null; next: number | null }
  | { kind: "compacting" }
  /** Only foreground subagent calls are running. */
  | { kind: "subagents"; count: number; detail: string | null }
  /** One foreground shell command is the only running tool; `startedAt` is when it began running. */
  | { kind: "command"; title: string; canBackground: boolean; startedAt: number | null }
  /** One other tool, or the phrase for several running together. */
  | { kind: "tools"; title: string }
  /** The answer is being written; `finishing` once the turn used tools or the answer settled. */
  | { kind: "answering"; finishing: boolean }
  /** A reasoning part is still open; `thought` is null when summaries are hidden. */
  | { kind: "thinking"; thought: string | null }
  | { kind: "working" };

export interface SessionActivityInput {
  /** The working turn, or null when no turn is running. */
  turn: TranscriptTurn | null;
  /** Pending requests for the session and its subagents. */
  requests: readonly PendingRequestView[];
  /** OpenCode's session status; null when the caller does not track it. */
  runtimeStatus: SessionRuntimeStatus | null;
  /** The user pressed Stop for the running work; omitted when the caller does not track it. */
  stopping?: boolean;
}

interface RunningTool {
  view: ToolExecutionView;
  group: TurnActivityGroup | null;
}

function backgroundTool(view: ToolExecutionView): boolean {
  if (view.kind === "subagent" || view.kind === "image-generation") return view.background;
  if (view.kind !== "shell") return false;
  const input = view.rawInput;
  return Boolean(
    input &&
    typeof input === "object" &&
    !Array.isArray(input) &&
    (input as { background?: unknown }).background === true,
  );
}

/** Foreground tool calls still running or waiting to run, in timeline order. */
function runningTools(turn: TranscriptTurn): RunningTool[] {
  const tools: RunningTool[] = [];
  const seen = new Set<object>();
  const visit = (entry: TurnPart, group: TurnActivityGroup | null) => {
    if (!isTool(entry.part) || seen.has(entry.part)) return;
    seen.add(entry.part);
    const view = projectToolExecution(entry.part, entry.index);
    if (view.status !== "running" && view.status !== "pending") return;
    if (backgroundTool(view)) return;
    tools.push({ view, group });
  };
  for (const group of turn.activity) {
    for (const entry of group.entries) visit(entry, group);
  }
  if (turn.shell) visit(turn.shell, null);
  return tools;
}

/**
 * A lone running tool's present-tense title. The projection names the group's running tool in
 * `currentAction`, and drops it when the group title already says the same thing.
 */
function toolTitle(tool: RunningTool): string {
  const title = tool.group?.currentAction ?? tool.group?.title;
  if (title?.trim()) return title.trim();
  if (tool.view.kind === "shell" && tool.view.command) return `Running '${tool.view.command}'`;
  return "Running a tool";
}

function entries(turn: TranscriptTurn): TurnPart[] {
  return turn.activity.flatMap((group) => group.entries);
}

function record(value: JsonValue | undefined): Record<string, JsonValue> {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function turnRetry(turn: TranscriptTurn): SessionActivityStatus | null {
  const boundary = entries(turn).findLast(
    (entry) =>
      entry.part.type === "timeline-boundary" &&
      entry.part.status === "running" &&
      record(entry.part.data).kind === "retry",
  );
  if (!boundary) return null;
  const at = record(boundary.part.data).at;
  return { kind: "retry", attempt: null, next: typeof at === "number" ? at : null };
}

function reasoningOpen(turn: TranscriptTurn): boolean {
  return entries(turn).some(
    (entry) =>
      entry.part.type === "reasoning" &&
      entry.part.time?.completed === undefined &&
      entry.message.completedAt === null,
  );
}

/**
 * What the task is doing or waiting on, first match wins: a pending approval, a pending question
 * or form, a requested stop, a retry, compaction, subagents, one running tool, several running tools, the answer,
 * an open thought, else working. Null when nothing runs and nothing waits on the user.
 */
export function sessionActivityStatus(input: SessionActivityInput): SessionActivityStatus | null {
  const permission = input.requests.find((request) => request.type === "permission");
  if (permission) {
    return { kind: "approval", requestID: permission.id, detail: permission.title || null };
  }
  // Undelivered prompts wait on the agent, not on the user.
  const question = input.requests.find((request) => request.type !== "input");
  if (question) return { kind: "answer", requestID: question.id, detail: question.title || null };

  const runtime = input.runtimeStatus;
  const turn = input.turn?.status === "working" ? input.turn : null;
  if (!turn && runtime?.type !== "busy" && runtime?.type !== "retry") return null;
  if (input.stopping) return { kind: "stopping" };

  if (runtime?.type === "retry") {
    return { kind: "retry", attempt: runtime.attempt, next: runtime.next };
  }
  if (!turn) return { kind: "working" };
  // Without a runtime status, the projection's retry marker is the only signal.
  if (runtime === null) {
    const retry = turnRetry(turn);
    if (retry) return retry;
  }

  if (
    entries(turn).some(
      (entry) => entry.part.type === "compaction" && entry.part.status === "running",
    )
  ) {
    return { kind: "compacting" };
  }

  const tools = runningTools(turn);
  const subagents = tools.flatMap((tool) => (tool.view.kind === "subagent" ? [tool.view] : []));
  if (subagents.length > 0 && subagents.length === tools.length) {
    return {
      kind: "subagents",
      count: subagents.length,
      detail: subagents.length === 1 ? subagents[0]!.description : null,
    };
  }
  if (tools.length === 1) {
    const tool = tools[0]!;
    return tool.view.kind === "shell"
      ? {
          kind: "command",
          title: toolTitle(tool),
          canBackground: tool.view.status === "running",
          startedAt: tool.view.startedAt,
        }
      : { kind: "tools", title: toolTitle(tool) };
  }
  if (tools.length > 1) {
    return { kind: "tools", title: parallelActivityLabel(turn) ?? `Running ${tools.length} tools` };
  }

  if (turn.final) {
    const finish = turn.final.message.finish;
    return {
      kind: "answering",
      finishing: turnHasToolActivity(turn) || (finish !== null && finish !== "tool-calls"),
    };
  }
  if (reasoningOpen(turn)) return { kind: "thinking", thought: latestTurnThought(turn) };
  return { kind: "working" };
}

function untilNextTry(next: number, now: number): string {
  const seconds = Math.max(0, Math.ceil((next - now) / 1_000));
  if (seconds === 0) return "retrying now";
  if (seconds < 60) return `next try in ${seconds}s`;
  return `next try in ${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
}

/**
 * Words for a status: a short label and an optional detail shown after it. Pass `now` to say
 * when a retry happens next.
 */
export function sessionActivityLabel(
  status: SessionActivityStatus,
  now?: number,
): { label: string; detail: string | null } {
  switch (status.kind) {
    case "approval":
      return { label: "Waiting for approval", detail: status.detail };
    case "answer":
      return { label: "Waiting for your answer", detail: status.detail };
    case "stopping":
      return { label: "Stopping", detail: null };
    case "retry": {
      const parts = [
        ...(status.attempt !== null ? [`Attempt ${status.attempt}`] : []),
        ...(status.next !== null && now !== undefined ? [untilNextTry(status.next, now)] : []),
      ];
      return { label: "Retrying", detail: parts.length ? parts.join(", ") : null };
    }
    case "compacting":
      return { label: "Compacting context", detail: null };
    case "subagents":
      return {
        label:
          status.count === 1 ? "Waiting for subagent" : `Waiting for ${status.count} subagents`,
        detail: status.detail,
      };
    case "command":
    case "tools":
      return { label: status.title, detail: null };
    case "answering":
      return { label: status.finishing ? "Finishing" : "Working", detail: null };
    case "thinking":
      return { label: status.thought ?? "Working", detail: null };
    case "working":
      return { label: "Working", detail: null };
  }
}
