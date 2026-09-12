import { defineChart, lineY } from "@tanstack/charts";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import { scalePoint } from "@tanstack/charts/scales/point";
import type { SessionStatsActivity } from "@opencode/client";
import { fromZonedTime, toZonedTime } from "date-fns-tz";
import { useMemo } from "react";
import { Chart, chartTheme } from "../ui/chart";

interface UsageActivityRow {
  date: string;
  label: string;
  steps: number;
  series: "Steps";
}

export function UsageActivityChart({
  activity,
  from,
  to,
  timezone,
}: {
  activity: readonly SessionStatsActivity[];
  from: number;
  to: number;
  timezone: string;
}) {
  const rows = useMemo(
    () => usageActivityRows(activity, from, to, timezone),
    [activity, from, timezone, to],
  );
  const maximum = Math.max(1, ...rows.map((row) => row.steps));
  const definition = defineChart({
    marks: [
      lineY(rows, {
        id: "usage-daily-steps",
        x: "date",
        y: "steps",
        key: "date",
        color: "series",
        strokeWidth: 2,
      }),
    ],
    x: { scale: scalePoint, axis: false },
    y: { scale: scaleLinear().domain([0, maximum]), axis: false, grid: true },
    color: { domain: ["Steps"], range: ["var(--info)"] },
    margin: { top: 10, right: 8, bottom: 10, left: 8 },
    theme: chartTheme,
    focus: "group-x",
    focusRing: false,
    svgAnimation: false,
  });

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <Chart
        definition={definition}
        height={220}
        initialWidth={620}
        ariaLabel="Daily OpenCode steps"
      />
      <div className="flex items-center justify-between text-meta text-muted-foreground">
        <span>{rows[0]?.label ?? ""}</span>
        <span>{rows.at(-1)?.label ?? ""}</span>
      </div>
    </div>
  );
}

export function usageActivityRows(
  activity: readonly SessionStatsActivity[],
  from: number,
  to: number,
  timezone: string,
): UsageActivityRow[] {
  const values = new Map(activity.map((item) => [item.date, item.steps]));
  const rows: UsageActivityRow[] = [];
  const labelFormatter = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    timeZone: timezone,
  });
  for (let cursor = toZonedTime(from, timezone); ;) {
    const timestamp = fromZonedTime(cursor, timezone).getTime();
    if (timestamp >= to) break;
    const date = dateKey(timestamp, timezone);
    rows.push({
      date,
      label: labelFormatter.format(timestamp),
      steps: values.get(date) ?? 0,
      series: "Steps",
    });
    cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1);
  }
  return rows;
}

function dateKey(timestamp: number, timezone: string): string {
  const values = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      timeZone: timezone,
    })
      .formatToParts(timestamp)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
}
