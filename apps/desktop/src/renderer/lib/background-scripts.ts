import type { JobCodeMode, JobInfo } from "@opencode/client";
import type { PalotMessage } from "../../shared";
import { isTool } from "./view-models";
import { projectToolExecution } from "./tool-executions";

/** Code Mode's own catalog lookup is not work worth naming. */
const INTERNAL_CALLS = new Set(["search"]);

/** A `job.list` read, with when it was asked for: events after that may be missing from it. */
export interface ScriptJobList {
  jobs: JobCodeMode[];
  requestedAt: number;
}

/** The latest `experimental.job.updated` seen for a script, and when it arrived. */
export interface ScriptJobEvent {
  info: JobCodeMode;
  receivedAt: number;
}

export function isScriptJob(info: JobInfo): info is JobCodeMode {
  return info.kind === "codemode";
}

/**
 * Folds a script job's update into what is known. A job only moves from running to an end, so an
 * end is never undone by a late "running".
 */
export function recordScriptJobEvent(
  events: ReadonlyMap<string, ScriptJobEvent>,
  info: JobCodeMode,
  receivedAt: number,
): ReadonlyMap<string, ScriptJobEvent> {
  const known = events.get(info.id);
  if (known && known.info.status !== "running" && info.status === "running") return events;
  return new Map(events).set(info.id, { info, receivedAt });
}

/**
 * The family's running scripts: the list, updated by events. An ended script leaves; one that
 * started after the list was asked for stays even though the list doesn't have it (events that
 * arrive while the list loads are kept). A running event older than the request is trusted to the
 * list, which may have seen it end.
 */
export function runningScriptJobs(
  list: ScriptJobList | undefined,
  events: ReadonlyMap<string, ScriptJobEvent>,
): JobCodeMode[] {
  const jobs = new Map((list?.jobs ?? []).map((job) => [job.id, job]));
  for (const { info, receivedAt } of events.values()) {
    if (info.status !== "running") jobs.delete(info.id);
    else if (jobs.has(info.id) || !list || receivedAt >= list.requestedAt) jobs.set(info.id, info);
  }
  return [...jobs.values()].filter((job) => job.status === "running");
}

/**
 * What a background script is doing, from the calls its `execute` part recorded: "Shell
 * ./slow.sh", "Read app.ts and 2 more calls". Null when the part isn't loaded or made no call.
 */
export function scriptJobTitle(jobID: string, messages: readonly PalotMessage[]): string | null {
  for (const message of messages.toReversed()) {
    for (const [index, part] of message.content.entries()) {
      if (!isTool(part)) continue;
      const execution = projectToolExecution(part, index);
      if (execution.kind !== "execute" || execution.background?.jobID !== jobID) continue;
      const calls = execution.calls.filter((call) => !INTERNAL_CALLS.has(call.tool));
      const first = calls[0];
      if (!first) return null;
      const name = [first.title, first.args[0]].filter(Boolean).join(" ");
      const more = calls.length - 1;
      return more > 0 ? `${name} and ${more} more ${more === 1 ? "call" : "calls"}` : name;
    }
  }
  return null;
}
