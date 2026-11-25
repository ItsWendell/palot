/**
 * When a task's work is finished: the task (root session) and every subagent under it are idle.
 *
 * OpenCode 2.2.7 lets a parent wait for a foreground subagent; later releases run every subagent
 * in the background. The parent ends its turn while children run, and each child reports back
 * to its parent every time it goes idle, which wakes the parent for another run. Announcing the
 * parent's first idle, or every report-woken run, would say "finished" too early and too often.
 *
 * The rule: one family busy period, from the first run of any member until no member runs, ends
 * in one result, the outcome of the task's own latest run. A period with no run of the task
 * itself (the user chatting with a subagent, no report reaching the task) has no result.
 *
 * A subagent's idle is followed by its report: the idle and the report commit together, and the
 * report reaches the parent's inbox a moment later. It joins the parent's run if that is still
 * going, or wakes the parent for a new one. So a member's end keeps the period open until its
 * parent has the report (delivered into its run, or a new run started), or for `graceMs` when
 * neither happens (a reverted or deleted parent, a lost report, a 2.2.7 foreground child).
 *
 * A subagent can go idle while work it started still runs (its own background command or
 * subagent). Its report then lists that work (`subagentReportHasBackgroundWork`), and the period
 * stays open until a later report from it no longer does: that work wakes it, and it reports
 * again when it goes idle. Stopping the task's own run ends that wait.
 */

import { providerLimit, providerLimitError, providerLimitSummary } from "./provider-limit";
import { backgroundResultTag } from "./background-result";

export interface FamilyEvent {
  id: string;
  type: string;
  data?: unknown;
  /** Epoch ms when OpenCode recorded the event, when the caller knows it. */
  createdAt?: number;
}

export interface FamilyCompletion {
  rootID: string;
  outcome: "succeeded" | "failed" | "interrupted";
  error: string | null;
  /** The task's terminal event that ended its latest run. */
  eventID: string;
  eventCreatedAt: number | null;
}

export interface FamilyCompletionTrackerOptions {
  /** A session's parent: null for a task, undefined while unknown (treated as a task). */
  parentOf(sessionID: string): string | null | undefined;
  onFinished(completion: FamilyCompletion): void;
  setTimer?(callback: () => void, ms: number): unknown;
  clearTimer?(handle: unknown): void;
  graceMs?: number;
}

export interface FamilyCompletionTracker {
  handle(event: FamilyEvent): void;
  /** Sessions known to be running, for example from `session.active()` after a reconnect. */
  seedActive(sessionIDs: Iterable<string>): void;
  /** The task a session belongs to. */
  rootOf(sessionID: string): string;
  /** Whether any member of the task's family is running or about to be woken. */
  busy(rootID: string): boolean;
  reset(): void;
}

/**
 * OpenCode (`SubagentCompletion.formatBody`) appends this list to a subagent's report when it went
 * idle with work of its own still running. 2.3.0 tags such a report `state="running"` (#63675);
 * from #64026 the tag says `running` exactly when the server's outstanding-work list is non-empty,
 * and the server appends the list at delivery, after the subagent's own answer. The message
 * metadata keeps `state: "completed"` either way.
 */
const BACKGROUND_WORK_HEADING = "Background work still running:\n";

/** Whether the text is just a report's opening tag and its newline (either tag form). */
function isSubagentOpeningLine(text: string): boolean {
  return text.endsWith("\n") && backgroundResultTag(text, "subagent")?.opening === text;
}

/** Where the server's list starts: its last heading, at the start or after a blank line. */
function backgroundWorkListStart(text: string): number | null {
  let index = text.lastIndexOf(BACKGROUND_WORK_HEADING);
  while (index >= 0) {
    const before = text.slice(0, index);
    if (/(?:^|\n\n)$/.test(before) || isSubagentOpeningLine(before)) {
      return index + BACKGROUND_WORK_HEADING.length;
    }
    index = index === 0 ? -1 : text.lastIndexOf(BACKGROUND_WORK_HEADING, index - 1);
  }
  return null;
}

/**
 * Whether a subagent report (the `<subagent>` or `<background-result kind="subagent">` text, or its body) says the subagent still has
 * background work running, so the subagent is not finished yet.
 *
 * A tagged report's `state` decides: `running` waits, `completed` does not, whatever the body
 * says (the subagent's answer may quote the heading). Untagged text, and an `error` report (whose
 * state says nothing about outstanding work), fall back to the heading.
 */
export function subagentReportHasBackgroundWork(text: string): boolean {
  const state = backgroundResultTag(text, "subagent")?.attributes.state;
  if (state === "running") return true;
  if (state === "completed") return false;
  return backgroundWorkListStart(text) !== null;
}

/**
 * Whether everything a report lists as still running is the subagent's own subagents
 * (`- subagent (…)` lines), so it is waiting for a subagent rather than a command or image.
 * The server's list follows the last heading; an earlier one belongs to the subagent's answer.
 */
export function subagentReportWaitsOnlyForSubagents(text: string): boolean {
  const start = backgroundWorkListStart(text);
  if (start === null) return false;
  const items = text
    .slice(start)
    .split("\n")
    .filter((line) => line.startsWith("- "));
  return items.length > 0 && items.every((line) => line.startsWith("- subagent ("));
}

/** How long a subagent's report may take to wake its idle parent. */
export const FAMILY_REPORT_GRACE_MS = 3_000;
/** Deeper than any family OpenCode allows (`experimental.subagent_depth`); guards cycles. */
const MAX_FAMILY_DEPTH = 16;

interface Episode {
  outcome: Omit<FamilyCompletion, "rootID"> | null;
  /** Parents a member's report has not reached yet. */
  expected: Set<string>;
  timer: unknown;
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function string(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

/** What failed the task: a provider limit by its name and reset, else OpenCode's message. */
function failureText(error: unknown, failedAt: number | undefined): string | null {
  const limit = providerLimit(providerLimitError(error), failedAt ?? Number.NaN);
  return limit ? `${providerLimitSummary(limit)}.` : string(record(error).message);
}

function terminalOutcome(event: FamilyEvent): FamilyCompletion["outcome"] | null {
  if (event.type === "session.execution.succeeded") return "succeeded";
  if (event.type === "session.execution.interrupted") return "interrupted";
  if (event.type !== "session.execution.failed") return null;
  // Stopping a run is the user's own action, not a failure.
  return record(record(event.data).error).type === "MessageAbortedError" ? "interrupted" : "failed";
}

export function createFamilyCompletionTracker(
  options: FamilyCompletionTrackerOptions,
): FamilyCompletionTracker {
  const graceMs = options.graceMs ?? FAMILY_REPORT_GRACE_MS;
  const setTimer = options.setTimer ?? ((callback, ms) => setTimeout(callback, ms));
  const clearTimer =
    options.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  const active = new Set<string>();
  const episodes = new Map<string, Episode>();
  /** Undelivered subagent reports: inbox ID to the parent they are for. */
  const reports = new Map<string, string>();
  /** Subagents whose latest report lists background work still running, to their task. */
  const waiting = new Map<string, string>();

  const rootOf = (sessionID: string): string => {
    let current = sessionID;
    const seen = new Set([current]);
    for (let depth = 0; depth < MAX_FAMILY_DEPTH; depth++) {
      const parent = options.parentOf(current);
      if (!parent || seen.has(parent)) return current;
      seen.add(parent);
      current = parent;
    }
    return current;
  };

  const episode = (rootID: string): Episode => {
    let value = episodes.get(rootID);
    if (!value) {
      value = { outcome: null, expected: new Set(), timer: null };
      episodes.set(rootID, value);
    }
    return value;
  };

  const stopTimer = (value: Episode) => {
    if (value.timer === null) return;
    clearTimer(value.timer);
    value.timer = null;
  };

  const memberRunning = (rootID: string) => {
    for (const sessionID of active) if (rootOf(sessionID) === rootID) return true;
    return false;
  };

  const memberWaiting = (rootID: string) => {
    for (const root of waiting.values()) if (root === rootID) return true;
    return false;
  };

  const busy = (rootID: string) =>
    memberRunning(rootID) ||
    (episodes.get(rootID)?.expected.size ?? 0) > 0 ||
    memberWaiting(rootID);

  const settle = (rootID: string) => {
    const value = episodes.get(rootID);
    if (!value || busy(rootID)) return;
    stopTimer(value);
    episodes.delete(rootID);
    if (value.outcome) options.onFinished({ rootID, ...value.outcome });
  };

  const expectWake = (rootID: string, value: Episode) => {
    stopTimer(value);
    value.timer = setTimer(() => {
      value.timer = null;
      value.expected.clear();
      settle(rootID);
    }, graceMs);
  };

  return {
    handle(event) {
      const data = record(event.data);
      const sessionID = string(data.sessionID);
      if (!sessionID) return;
      if (event.type === "session.execution.started") {
        active.add(sessionID);
        const value = episode(rootOf(sessionID));
        value.expected.delete(sessionID);
        if (value.expected.size === 0) stopTimer(value);
        return;
      }
      if (event.type === "session.inbox.enqueued") {
        const item = record(data.item);
        const payload = record(item.payload);
        const metadata = record(payload.metadata);
        const inboxID = string(data.inboxID);
        if (item.type !== "synthetic" || metadata.source !== "subagent") return;
        if (inboxID) reports.set(inboxID, sessionID);
        // The report is in the parent's inbox; its delivery or wake follows.
        const rootID = rootOf(sessionID);
        const childID = string(metadata.childID);
        if (childID) {
          const text = typeof payload.text === "string" ? payload.text : "";
          if (subagentReportHasBackgroundWork(text)) waiting.set(childID, rootID);
          else waiting.delete(childID);
        }
        const value = episodes.get(rootID);
        if (value?.expected.has(sessionID)) expectWake(rootID, value);
        return;
      }
      if (event.type === "session.inbox.delivered") {
        const inboxID = string(data.inboxID);
        const parent = inboxID ? reports.get(inboxID) : undefined;
        if (!inboxID || !parent) return;
        reports.delete(inboxID);
        // Delivered into a run that is still going: that run now has the report.
        if (!active.has(parent)) return;
        const rootID = rootOf(parent);
        const value = episodes.get(rootID);
        if (!value?.expected.delete(parent)) return;
        if (value.expected.size === 0) stopTimer(value);
        settle(rootID);
        return;
      }
      const outcome = terminalOutcome(event);
      if (!outcome) return;
      active.delete(sessionID);
      const rootID = rootOf(sessionID);
      const value = episode(rootID);
      if (sessionID === rootID) {
        // Stopping the task stops what it waited on; no report may follow.
        if (outcome === "interrupted") {
          for (const [childID, root] of waiting) if (root === rootID) waiting.delete(childID);
        }
        value.outcome = {
          outcome,
          error: outcome === "failed" ? failureText(data.error, event.createdAt) : null,
          eventID: event.id,
          eventCreatedAt: event.createdAt ?? null,
        };
      } else {
        const parent = options.parentOf(sessionID);
        if (parent) {
          value.expected.add(parent);
          expectWake(rootID, value);
        }
      }
      settle(rootID);
    },
    seedActive(sessionIDs) {
      for (const sessionID of sessionIDs) {
        active.add(sessionID);
        episode(rootOf(sessionID));
      }
    },
    rootOf,
    busy,
    reset() {
      for (const value of episodes.values()) stopTimer(value);
      episodes.clear();
      active.clear();
      reports.clear();
      waiting.clear();
    },
  };
}
