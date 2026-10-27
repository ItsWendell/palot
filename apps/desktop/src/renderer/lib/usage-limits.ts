import type { UsageLimitsBudget, UsageLimitsGo } from "@opencode/client";
import type { JsonValue, PalotMessage } from "../../shared";
import { usageLimitResetAt, usageLimitTitle } from "./usage-limit-reset";

export type GoWindow = keyof UsageLimitsGo;

export const GO_WINDOWS = [
  { id: "rolling", label: "Go · 5-hour" },
  { id: "weekly", label: "Weekly" },
  { id: "monthly", label: "Monthly" },
] as const;

const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;
const USD = new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" });

export function clampPercent(percent: number): number {
  return Math.max(0, Math.min(100, percent));
}

/** Monthly meters expose only the reset, so their pace uses the preceding calendar month. */
export function goWindowDuration(window: GoWindow, resetsAt: number): number {
  if (window === "rolling") return 5 * HOUR;
  if (window === "weekly") return 7 * DAY;
  const start = new Date(resetsAt);
  const day = start.getUTCDate();
  start.setUTCDate(1);
  start.setUTCMonth(start.getUTCMonth() - 1);
  const lastDay = new Date(
    Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0),
  ).getUTCDate();
  start.setUTCDate(Math.min(day, lastDay));
  return resetsAt - start.getTime();
}

export function usagePace(window: GoWindow, used: number, resetsAt: number, now = Date.now()) {
  const remaining = clampPercent(100 - used);
  const evenPaceRemaining = clampPercent(
    ((resetsAt - now) / goWindowDuration(window, resetsAt)) * 100,
  );
  const difference = evenPaceRemaining - remaining;
  const label = difference > 5 ? "Ahead of pace" : difference < -5 ? "Under pace" : "On pace";
  const explanation =
    difference > 5
      ? "Using allowance faster than an even pace."
      : difference < -5
        ? "Using allowance slower than an even pace."
        : "Usage is within 5% of an even pace.";
  return {
    remaining,
    evenPaceRemaining,
    label,
    hint: `${explanation} Even pace: ${Math.round(evenPaceRemaining)}% left by now.${window === "monthly" ? " Monthly pace is approximate." : ""}`,
  };
}

export function formatResetsIn(resetsAt: number, now = Date.now()): string {
  const minutes = Math.floor((resetsAt - now) / 60_000);
  if (minutes < 1) return "Resets momentarily";
  if (minutes >= 1_440)
    return `Resets in ${Math.floor(minutes / 1_440)}d ${Math.floor((minutes % 1_440) / 60)}h`;
  if (minutes >= 60) return `Resets in ${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  return `Resets in ${minutes}m`;
}

export function budgetSummary(budget: UsageLimitsBudget) {
  const coverage =
    budget.coverage === "all"
      ? "All models and services"
      : budget.vendors.length
        ? budget.vendors.join(", ")
        : budget.models.length
          ? budget.models.map((model) => model.name).join(", ")
          : "Selected models";
  return {
    amount: `${USD.format(budget.spent)} of ${USD.format(budget.limit)}`,
    percentUsed: budget.limit > 0 ? clampPercent((budget.spent / budget.limit) * 100) : 100,
    reached: budget.spent >= budget.limit,
    chips: [
      budget.scope === "each" ? "Per member" : "Combined spend",
      budget.per === "model" ? "Per model" : "Across models",
      coverage,
      ...(budget.inputPriceAtLeast === undefined
        ? []
        : [`Input ≥ ${USD.format(budget.inputPriceAtLeast)} / 1M tokens`]),
    ],
    shared: budget.shared ? "Shared by the workspace" : null,
  };
}

export function supportsUsageLimits(version: string | null | undefined): boolean {
  // Unknown versions probe the official endpoint; a missing route is unavailable.
  return usageLimitsRouteKnown(version) ?? true;
}

/** True or false when the version decides it; null when the version is unknown. */
export function usageLimitsRouteKnown(version: string | null | undefined): boolean | null {
  const match = version?.match(/^v?(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return Number(match[1]) > 2 || (Number(match[1]) === 2 && Number(match[2]) >= 2);
}

function record(value: JsonValue | undefined): Record<string, JsonValue> {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

/** The boundary retains its original message, including provider retry metadata. */
export function usageLimitFailure(
  message: Pick<PalotMessage, "data" | "createdAt" | "completedAt"> | undefined,
) {
  if (!message) return null;
  const error = record(record(message.data).error);
  const type =
    typeof error.type === "string"
      ? error.type
      : typeof error.name === "string"
        ? error.name
        : null;
  if (!usageLimitTitle(type)) return null;
  return {
    resetsAt: usageLimitResetAt(
      message.completedAt ?? message.createdAt,
      typeof error.retryAfterMs === "number" ? error.retryAfterMs : null,
    ),
  };
}
