/**
 * The single status vocabulary. One ranked kind per task drives the sort, the mark in the
 * trailing slot, the title weight and the sentence on line 2; nothing else invents its own.
 */

import type { Task, TaskRequest } from "../types";
import { formatClockTime, formatDuration, formatQuiet, plural } from "./format";

export type StatusKind =
  | "approval"
  | "question"
  | "failed"
  | "unseen"
  | "working"
  | "stale"
  | "stopped"
  | "idle";

export const STATUS_RANK: Record<StatusKind, number> = {
  approval: 1,
  question: 2,
  failed: 3,
  unseen: 4,
  working: 5,
  stale: 6,
  stopped: 7,
  idle: 8,
};

/** A working task with no event for this long reads as stale. */
export const STALE_AFTER_MS = 10 * 60_000;

/** How the live part of a sentence ticks: elapsed run time, or minutes of silence. */
export type StatusClock = { since: number; format: "elapsed" | "quiet" };

export interface TaskStatus {
  kind: StatusKind;
  rank: number;
  /** The sentence on line 2, without its live clock. Null for idle tasks. */
  text: string | null;
  /**
   * What the request is about ("bun test", "Which branch?", "From explore subagent"). A row
   * whose third line already shows the command leaves the command out.
   */
  detail: string | null;
  /** Appended to `text` on the shared clock, so the row itself never re-renders per second. */
  clock: StatusClock | null;
}

export interface StatusContext {
  now: number;
  /** Whether rows know what a running task is doing (the "Live detail" setting). */
  liveDetail: boolean;
  serverOnline: boolean;
  serverLastSeenAt: number | null;
}

export function needsYou(kind: StatusKind): boolean {
  return STATUS_RANK[kind] <= 3;
}

/** Colour is reserved for ranks 1-4; everything else stays neutral. */
export function statusTone(kind: StatusKind): "attention" | "failed" | "unseen" | "neutral" {
  if (kind === "approval" || kind === "question") return "attention";
  if (kind === "failed") return "failed";
  if (kind === "unseen") return "unseen";
  return "neutral";
}

export function currentRequest(task: Pick<Task, "requests" | "requestIndex">): TaskRequest | null {
  if (task.requests.length === 0) return null;
  return task.requests[Math.min(task.requestIndex, task.requests.length - 1)] ?? null;
}

export function taskStatus(task: Task, context: StatusContext): TaskStatus {
  const request = currentRequest(task);
  if (request) {
    // A subagent's request names its source; the command or question is on line 3 anyway.
    const what = request.kind === "permission" ? request.summary : request.question;
    const detail =
      request.from === null
        ? what
        : request.from
          ? `From ${request.from} subagent`
          : "From a subagent";
    return request.kind === "permission"
      ? status("approval", "Waiting for approval", null, detail)
      : status("question", "Waiting for your answer", null, detail);
  }
  if (task.failure) return status("failed", `Failed · ${task.failure}`);
  if (task.run && !context.serverOnline) {
    const seen = context.serverLastSeenAt ?? task.run.lastUpdateAt;
    return status("stale", `Offline · last seen ${formatClockTime(seen)}`);
  }
  if (task.run && context.now - task.run.lastUpdateAt >= STALE_AFTER_MS) {
    return status("stale", "No update for", { since: task.run.lastUpdateAt, format: "quiet" });
  }
  if (task.run) {
    const doing = context.liveDetail && task.run.detail ? task.run.detail : "Working";
    return status("working", doing, { since: task.run.startedAt, format: "elapsed" });
  }
  // A run the user stopped did not finish: it reads Stopped even while still unread, like a
  // failure ranks above unseen. `task.unread` stays set for Mark as read and the unread filter.
  if (task.stopped) return status("stopped", "Stopped");
  if (task.unread) return status("unseen", finishedSentence(task));
  return status("idle", null);
}

function status(
  kind: StatusKind,
  text: string | null,
  clock: StatusClock | null = null,
  detail: string | null = null,
): TaskStatus {
  return { kind, rank: STATUS_RANK[kind], text, detail, clock };
}

/** The whole sentence at a moment, as screen readers and tests read it. */
export function statusSentence(status: TaskStatus, now: number): string | null {
  if (!status.text) return null;
  const base = status.detail ? `${status.text} · ${status.detail}` : status.text;
  if (!status.clock) return base;
  return status.clock.format === "elapsed"
    ? `${base} · ${formatDuration(now - status.clock.since)}`
    : `${base} ${formatQuiet(now - status.clock.since)}`;
}

function finishedSentence(task: Task): string {
  if (!task.summary) return "Finished";
  const parts = [`Worked for ${formatDuration(task.summary.durationMs)}`];
  if (task.summary.filesChanged > 0)
    parts.push(`changed ${plural(task.summary.filesChanged, "file")}`);
  else if (task.summary.commands > 0) parts.push(`ran ${plural(task.summary.commands, "command")}`);
  return parts.join(" · ");
}

/** Two statuses render the same; lets a recompute keep the old object and skip a render. */
export function sameStatus(a: TaskStatus, b: TaskStatus): boolean {
  return (
    a.kind === b.kind &&
    a.text === b.text &&
    a.detail === b.detail &&
    a.clock?.since === b.clock?.since &&
    a.clock?.format === b.clock?.format
  );
}

export type RowAction = "settle" | "snooze" | "stop" | "wake" | "unsettle" | "unpin";

/** Where a row sits decides its one triage step; status decides whether it may settle. */
export type Placement = "needs-you" | "pinned" | "inbox" | "working" | "snoozed" | "settled";

export function canSettle(task: Task): boolean {
  return task.run === null && task.requests.length === 0;
}

/**
 * The hover/focus actions, and nothing else (the rest lives in the context menu). Needs-you
 * rows act through their own third line instead.
 */
export function rowActions(task: Task, kind: StatusKind, placement: Placement): RowAction[] {
  if (placement === "snoozed") return ["wake"];
  if (placement === "settled") return ["unsettle"];
  if (kind === "approval" || kind === "question") return [];
  if (task.run) return placement === "pinned" ? ["unpin", "stop"] : ["stop"];
  if (placement === "pinned") return ["unpin"];
  return canSettle(task) ? ["settle", "snooze"] : [];
}
