import type { AutomationInfo, AutomationTrigger } from "@opencode/client";
import { formatDistanceStrict } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";

/**
 * OpenCode's own automations (`experimental.automation.*`) as the Scheduled page shows them,
 * read-only beside Palot's scheduler. OpenCode runs them inside the server, so they keep
 * running when Palot is closed.
 */

/** OpenCode 2.4 adds a fixed shell command; older clients do not type it yet. */
export type OpenCodeAutomationAction =
  | AutomationInfo["action"]
  | { type: "shell"; command: string };

export type OpenCodeAutomation = Omit<AutomationInfo, "action"> & {
  action: OpenCodeAutomationAction;
};

/** One automation on one server. IDs are unique per server, not across servers. */
export interface OpenCodeAutomationEntry {
  key: string;
  profileID: string;
  connectionID: string;
  serverName: string;
  automation: OpenCodeAutomation;
}

export interface OpenCodeAutomationListResult {
  profileID: string;
  connectionID: string;
  serverName: string;
  automations: readonly OpenCodeAutomation[];
}

/**
 * Merges per-project list results. Several projects (or a project and its worktree) can return
 * the same automation, so rows are keyed by server and ID. Active ones come first, then by
 * the next due time, then by name.
 */
export function mergeOpenCodeAutomations(
  results: readonly OpenCodeAutomationListResult[],
): OpenCodeAutomationEntry[] {
  const entries = new Map<string, OpenCodeAutomationEntry>();
  for (const result of results) {
    for (const automation of result.automations) {
      const key = `${result.profileID}:${automation.id}`;
      const existing = entries.get(key);
      if (existing && existing.automation.time.updated >= automation.time.updated) continue;
      entries.set(key, {
        key,
        profileID: result.profileID,
        connectionID: result.connectionID,
        serverName: result.serverName,
        automation,
      });
    }
  }
  return [...entries.values()].toSorted(
    (left, right) =>
      statusRank(left.automation.status) - statusRank(right.automation.status) ||
      (left.automation.nextDueAt ?? Number.MAX_SAFE_INTEGER) -
        (right.automation.nextDueAt ?? Number.MAX_SAFE_INTEGER) ||
      left.automation.name.localeCompare(right.automation.name),
  );
}

function statusRank(status: AutomationInfo["status"]): number {
  return status === "active" ? 0 : status === "paused" ? 1 : 2;
}

export function openCodeAutomationStatusLabel(status: AutomationInfo["status"]): string {
  if (status === "active") return "Active";
  if (status === "paused") return "Paused";
  return "Finished";
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** When it runs, in plain words. Unrecognised cron expressions are shown as written. */
export function openCodeTriggerLabel(
  trigger: AutomationTrigger,
  zone: string,
  localZone = Intl.DateTimeFormat().resolvedOptions().timeZone,
): string {
  const tz = trigger.type === "event" ? undefined : (trigger.tz ?? zone);
  const suffix = tz && tz !== localZone ? ` · ${tz}` : "";
  if (trigger.type === "event") return `When ${trigger.server} sends ${trigger.event}`;
  if (trigger.type === "every") return `Every ${trigger.every}`;
  if (trigger.type === "at") return `Once · ${onceLabel(trigger.at, tz ?? localZone)}${suffix}`;
  const described = describeCron(trigger.cron);
  return described ? `${described}${suffix}` : `Cron ${trigger.cron}${suffix}`;
}

function onceLabel(at: string, zone: string): string {
  // Relative values ("in 10 minutes") and wall-clock times without an offset stay as written.
  if (!/[zZ]$|[+-]\d\d:?\d\d$/.test(at)) return at.replace("T", " ");
  const time = Date.parse(at);
  return Number.isNaN(time) ? at : formatInTimeZone(time, zone, "MMM d, yyyy 'at' h:mm a");
}

/** Common five-field cron shapes; anything else returns null. */
export function describeCron(expression: string): string | null {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) return null;
  const [minute, hour, day, month, weekday] = fields as [string, string, string, string, string];
  if (month !== "*") return null;
  if (minute === "*" && hour === "*" && day === "*" && weekday === "*") return "Every minute";
  const stepMinutes = /^\*\/(\d+)$/.exec(minute);
  if (stepMinutes && hour === "*" && day === "*" && weekday === "*")
    return `Every ${stepMinutes[1]} minutes`;
  if (/^\d+$/.test(minute) && hour === "*" && day === "*" && weekday === "*")
    return Number(minute) === 0 ? "Hourly" : `Hourly at :${minute.padStart(2, "0")}`;
  const stepHours = /^\*\/(\d+)$/.exec(hour);
  if (/^\d+$/.test(minute) && stepHours && day === "*" && weekday === "*")
    return `Every ${stepHours[1]} hours`;
  if (!/^\d+$/.test(minute) || !/^\d+$/.test(hour)) return null;
  const time = clockLabel(Number(hour), Number(minute));
  if (time === null) return null;
  if (day === "*" && weekday === "*") return `Daily at ${time}`;
  if (day === "*" && (weekday === "1-5" || weekday === "MON-FRI")) return `Weekdays at ${time}`;
  if (day === "*" && /^[0-7]$/.test(weekday)) return `${WEEKDAYS[Number(weekday) % 7]}s at ${time}`;
  if (/^\d+$/.test(day) && weekday === "*") return `Monthly on day ${day} at ${time}`;
  return null;
}

function clockLabel(hour: number, minute: number): string | null {
  if (hour > 23 || minute > 59) return null;
  const period = hour < 12 ? "AM" : "PM";
  return `${hour % 12 === 0 ? 12 : hour % 12}:${String(minute).padStart(2, "0")} ${period}`;
}

export type OpenCodeActionSummary =
  | { type: "session"; sessionID: string; prompt: string }
  | { type: "subagent"; agent: string; prompt: string }
  | { type: "code" }
  | { type: "shell"; command: string };

export function openCodeActionSummary(action: OpenCodeAutomationAction): OpenCodeActionSummary {
  if (action.type === "shell") return { type: "shell", command: action.command };
  if (action.type === "code") return { type: "code" };
  if (action.to.session !== undefined)
    return { type: "session", sessionID: action.to.session, prompt: action.prompt };
  return { type: "subagent", agent: action.to.subagent ?? "agent", prompt: action.prompt };
}

/** Next and last run in one line, or null when the server reported neither. */
export function openCodeRunLabel(automation: OpenCodeAutomation, now = Date.now()): string | null {
  const parts: string[] = [];
  if (automation.status === "active" && automation.nextDueAt !== undefined)
    parts.push(
      automation.nextDueAt <= now
        ? "Due now"
        : `Next run ${formatDistanceStrict(automation.nextDueAt, now, { addSuffix: true })}`,
    );
  if (automation.lastRunAt !== undefined) {
    const outcome = automation.lastOutcome ? outcomeLabel(automation.lastOutcome) : null;
    parts.push(
      `Last ran ${formatDistanceStrict(automation.lastRunAt, now, { addSuffix: true })}${
        outcome ? ` · ${outcome}` : ""
      }`,
    );
  }
  return parts.length ? parts.join(" · ") : null;
}

function outcomeLabel(outcome: NonNullable<AutomationInfo["lastOutcome"]>): string | null {
  if (outcome === "fired") return null;
  if (outcome === "late") return "ran late";
  if (outcome === "skipped") return "skipped";
  if (outcome === "disabled") return "automations off";
  if (outcome === "failed") return "failed";
  return "expired";
}
