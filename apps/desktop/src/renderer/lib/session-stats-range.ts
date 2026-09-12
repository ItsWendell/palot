import { fromZonedTime, toZonedTime } from "date-fns-tz";
import type { UsageRangeDays } from "./route-search";

export interface UsageDateRange {
  days: UsageRangeDays;
  from: number;
  to: number;
  timezone: string;
}

export function usageDateRange(
  days: UsageRangeDays,
  now = Date.now(),
  timezone = Intl.DateTimeFormat().resolvedOptions().timeZone,
): UsageDateRange {
  const current = toZonedTime(now, timezone);
  const toDate = fromZonedTime(
    new Date(current.getFullYear(), current.getMonth(), current.getDate() + 1),
    timezone,
  );
  const zonedTo = toZonedTime(toDate, timezone);
  const fromDate = fromZonedTime(
    new Date(zonedTo.getFullYear(), zonedTo.getMonth(), zonedTo.getDate() - days),
    timezone,
  );
  return { days, from: fromDate.getTime(), to: toDate.getTime(), timezone };
}

export function formatUsageDateRange(
  range: Pick<UsageDateRange, "from" | "to" | "timezone">,
): string {
  const startYear = formatYear(range.from, range.timezone);
  const endYear = formatYear(Math.max(range.from, range.to - 1), range.timezone);
  const formatter = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: startYear === endYear ? undefined : "numeric",
    timeZone: range.timezone,
  });
  const inclusiveTo = Math.max(range.from, range.to - 1);
  return `${formatter.format(range.from)} to ${formatter.format(inclusiveTo)}`;
}

function formatYear(timestamp: number, timezone: string): string {
  return new Intl.DateTimeFormat("en", { year: "numeric", timeZone: timezone }).format(timestamp);
}
