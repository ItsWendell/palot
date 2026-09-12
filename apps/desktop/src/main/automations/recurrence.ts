import { RRule } from "rrule";
import type { AutomationSchedulePreview, AutomationTrigger } from "../../shared";

const PREVIEW_LIMIT = 5;
type RecurringTrigger = Extract<AutomationTrigger, { type: "recurring" }>;
interface RecurringRule {
  rule: RRule;
  until: number | null;
}
const timezoneFormatters = new Map<string, Intl.DateTimeFormat>();

// RRule's UTC fields represent wall-clock time, not an instant. Avoid its tzid
// conversion: rrule 2.8.1 incorporates the host timezone into returned dates.
function recurrenceDate(instant: number, timezone: string): Date {
  let formatter = timezoneFormatters.get(timezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      fractionalSecondDigits: 3,
      hourCycle: "h23",
    });
    timezoneFormatters.set(timezone, formatter);
  }
  const parts = Object.fromEntries(
    formatter.formatToParts(instant).map(({ type, value }) => [type, value]),
  );
  return new Date(
    `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}.${parts.fractionalSecond}Z`,
  );
}

function occurrenceTime(date: Date, timezone: string): number {
  const wallTime = date.getTime();
  const offsetAt = (instant: number) => recurrenceDate(instant, timezone).getTime() - instant;
  const offset = offsetAt(wallTime);
  const adjustedOffset = offsetAt(wallTime - offset);
  if (offset === adjustedOffset) return wallTime - offset;
  const finalOffset = offsetAt(wallTime - adjustedOffset);
  // Resolve an offset change without consulting host-local Date fields. For a
  // nonexistent spring-forward time, use the larger adjacent offset.
  return (
    wallTime -
    (adjustedOffset === finalOffset ? adjustedOffset : Math.max(adjustedOffset, finalOffset))
  );
}

function recurrenceBoundary(instant: number, timezone: string, lower: boolean): Date {
  const date = recurrenceDate(instant, timezone);
  // During a repeated DST hour, include the whole repeated interval before
  // filtering by real instants rather than ordering ambiguous wall times.
  const difference = occurrenceTime(date, timezone) - instant;
  return new Date(date.getTime() - (lower ? Math.max(0, difference) : Math.min(0, difference)));
}

function validTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(0);
    return true;
  } catch {
    return false;
  }
}

function recurringRule(trigger: RecurringTrigger): RecurringRule {
  if (!validTimezone(trigger.timezone)) throw new Error(`Unknown timezone: ${trigger.timezone}`);
  const value = trigger.rrule.trim().replace(/^RRULE:/i, "");
  const options = RRule.parseString(value);
  const until =
    options.until && /(?:^|;)UNTIL=\d+T\d+Z(?:;|$)/i.test(value) ? options.until.getTime() : null;
  return {
    until,
    rule: new RRule({
      ...options,
      dtstart: recurrenceDate(trigger.dtstart, trigger.timezone),
      until: until === null ? options.until : recurrenceBoundary(until, trigger.timezone, false),
      tzid: null,
    }),
  };
}

function occurrenceAfter(
  { rule, until }: RecurringRule,
  trigger: RecurringTrigger,
  after: number,
  inclusive = false,
): number | null {
  let next = rule.after(recurrenceBoundary(after, trigger.timezone, true), inclusive);
  while (next) {
    const instant = occurrenceTime(next, trigger.timezone);
    if (until !== null && instant > until) return null;
    if (instant > after || (inclusive && instant === after)) return instant;
    next = rule.after(next, false);
  }
  return null;
}

export function validateAutomationTrigger(trigger: AutomationTrigger): void {
  if (!validTimezone(trigger.timezone)) throw new Error(`Unknown timezone: ${trigger.timezone}`);
  if (trigger.type === "once") {
    if (!Number.isFinite(trigger.at)) throw new Error("The scheduled time is invalid");
    return;
  }
  const rule = recurringRule(trigger);
  if (occurrenceAfter(rule, trigger, trigger.dtstart - 1, true) === null) {
    throw new Error("The recurrence does not produce any occurrences");
  }
}

export function nextAutomationOccurrence(trigger: AutomationTrigger, after: number): number | null {
  validateAutomationTrigger(trigger);
  if (trigger.type === "once") return trigger.at > after ? trigger.at : null;
  return occurrenceAfter(recurringRule(trigger), trigger, after);
}

export function automationOccurrences(
  trigger: AutomationTrigger,
  after = Date.now() - 1,
  limit = PREVIEW_LIMIT,
): number[] {
  validateAutomationTrigger(trigger);
  if (trigger.type === "once") return trigger.at > after ? [trigger.at] : [];
  const rule = recurringRule(trigger);
  const values: number[] = [];
  let cursor = after;
  while (values.length < limit) {
    const next = occurrenceAfter(rule, trigger, cursor);
    if (next === null) break;
    values.push(next);
    cursor = next;
  }
  return values;
}

export function schedulePreview(
  trigger: AutomationTrigger,
  after = Date.now(),
): AutomationSchedulePreview {
  const occurrences = automationOccurrences(trigger, after - 1);
  return { summary: scheduleSummary(trigger), occurrences };
}

export function scheduleSummary(trigger: AutomationTrigger): string {
  if (trigger.type === "once") return `Once in ${trigger.timezone}`;
  return recurringRule(trigger).rule.toText() + ` · ${trigger.timezone}`;
}

export function initialNextRun(trigger: AutomationTrigger, now: number): number | null {
  if (trigger.type === "once") return trigger.at >= now ? trigger.at : trigger.at;
  const rule = recurringRule(trigger);
  return occurrenceAfter(rule, trigger, now, true);
}

export function advanceNextRun(trigger: AutomationTrigger, now: number): number | null {
  if (trigger.type === "once") return null;
  return occurrenceAfter(recurringRule(trigger), trigger, now);
}

export function overdueOccurrenceCount(
  trigger: AutomationTrigger,
  scheduledFor: number,
  now: number,
  limit = 10_000,
): number {
  if (scheduledFor > now) return 0;
  if (trigger.type === "once") return 1;
  const { rule, until } = recurringRule(trigger);
  return rule
    .between(
      recurrenceBoundary(scheduledFor - 1, trigger.timezone, true),
      recurrenceBoundary(now, trigger.timezone, false),
      true,
    )
    .filter((date) => {
      const instant = occurrenceTime(date, trigger.timezone);
      return instant >= scheduledFor && instant <= now && (until === null || instant <= until);
    })
    .slice(0, limit).length;
}

export function isMissedAutomationOccurrence(overdueAge: number, scanInterval: number): boolean {
  return overdueAge > scanInterval * 2;
}
