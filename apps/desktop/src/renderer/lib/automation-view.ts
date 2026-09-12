import { formatDistanceToNowStrict } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import type { AutomationRecord, AutomationRun, AutomationTrigger } from "../../shared";

export function automationScheduleLabel(trigger: AutomationTrigger): string {
  if (trigger.type === "once") {
    return formatInTimeZone(trigger.at, trigger.timezone, "MMM d, yyyy 'at' h:mm a zzz");
  }
  const rule = trigger.rrule.toUpperCase();
  const time = formatInTimeZone(trigger.dtstart, trigger.timezone, "h:mm a");
  if (rule.includes("FREQ=HOURLY")) return "Hourly";
  if (rule.includes("BYDAY=MO,TU,WE,TH,FR")) return `Weekdays at ${time}`;
  if (rule.includes("FREQ=DAILY")) return `Daily at ${time}`;
  if (rule.includes("FREQ=WEEKLY")) return `Weekly at ${time}`;
  if (rule.includes("FREQ=MONTHLY")) return `Monthly at ${time}`;
  return `Custom schedule · ${trigger.timezone}`;
}

export function nextRunLabel(automation: AutomationRecord): string {
  if (automation.status === "paused") return "Paused";
  if (automation.activeRunID) return "Running now";
  if (!automation.nextRunAt) return "No more runs";
  return `Next run ${formatDistanceToNowStrict(automation.nextRunAt, { addSuffix: true })} · ${automation.trigger.timezone}`;
}

export function runStateLabel(state: AutomationRun["state"]): string {
  if (state === "pending") return "Scheduled";
  if (state === "preparing") return "Starting";
  if (state === "queued") return "Waiting for task";
  if (state === "running") return "Running";
  if (state === "needs-attention") return "Needs input";
  if (state === "settling") return "Finishing";
  if (state === "succeeded") return "Ready";
  if (state === "failed") return "Failed";
  if (state === "interrupted") return "Interrupted";
  if (state === "cancelled") return "Cancelled";
  if (state === "skipped") return "Skipped";
  return "Outcome unknown";
}

export function automationRunStateLabel(run: AutomationRun): string {
  if (run.state === "needs-attention" && run.attention?.type === "configuration") {
    return "Setup required";
  }
  return runStateLabel(run.state);
}

export type AutomationRunOpenTarget =
  | {
      type: "request";
      sessionID: string;
      requestID: string;
      requestType: "permission" | "form" | "question";
    }
  | { type: "session"; sessionID: string }
  | { type: "details" };

export function automationRunOpenTarget(run: AutomationRun): AutomationRunOpenTarget {
  const attention = run.attention;
  if (
    attention?.sessionID &&
    attention.requestID &&
    (attention.type === "permission" || attention.type === "form" || attention.type === "question")
  ) {
    return {
      type: "request",
      sessionID: attention.sessionID,
      requestID: attention.requestID,
      requestType: attention.type,
    };
  }
  const sessionID = attention?.sessionID ?? run.rootSessionID;
  return sessionID ? { type: "session", sessionID } : { type: "details" };
}

export function latestAutomationRun(runs: AutomationRun[]): AutomationRun | null {
  return runs.reduce<AutomationRun | null>(
    (latest, run) => (!latest || run.createdAt > latest.createdAt ? run : latest),
    null,
  );
}

export function automationRunActionLabel(run: AutomationRun): string {
  if (run.state === "needs-attention") {
    return run.attention?.type === "configuration" ? "View setup issue" : "Resolve latest run";
  }
  if (runIsActive(run)) return "Open current run";
  return automationRunOpenTarget(run).type === "details" ? "View latest run" : "Open latest run";
}

export function runIsActive(run: AutomationRun): boolean {
  return ["pending", "preparing", "queued", "running", "needs-attention", "settling"].includes(
    run.state,
  );
}

export function runNeedsReview(run: AutomationRun): boolean {
  return ["needs-attention", "failed", "interrupted", "unknown"].includes(run.state);
}

export function runTimestamp(run: AutomationRun): string {
  return formatDistanceToNowStrict(run.completedAt ?? run.startedAt ?? run.createdAt, {
    addSuffix: true,
  });
}

export function runExecutionDuration(run: AutomationRun): string | null {
  if (run.executionStartedAt === null || run.executionCompletedAt === null) return null;
  const seconds = Math.max(
    0,
    Math.round((run.executionCompletedAt - run.executionStartedAt) / 1_000),
  );
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder === 0 ? `${minutes}m` : `${minutes}m ${remainder}s`;
}
