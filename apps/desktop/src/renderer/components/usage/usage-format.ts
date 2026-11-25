import type { TokenUsageInfo } from "@opencode/client";
import { modelTokens } from "../../lib/usage-analytics";

export const CURRENCY = new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" });
export const NUMBER = new Intl.NumberFormat(undefined);
export const COMPACT = new Intl.NumberFormat(undefined, {
  notation: "compact",
  maximumFractionDigits: 1,
});
export const PERCENT = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 0,
});

export function formatShare(value: number, total: number): string {
  return PERCENT.format(total > 0 ? value / total : 0);
}

export function formatRate(value: number | null): string {
  return value === null ? "–" : PERCENT.format(value);
}

/** Dollars per million tokens; cents below a dollar keep two significant digits. */
export function formatPerMillion(value: number | null): string {
  if (value === null) return "–";
  return value >= 1
    ? CURRENCY.format(value)
    : new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: "USD",
        maximumSignificantDigits: 2,
      }).format(value);
}

export function formatModelTokens(tokens: TokenUsageInfo): string {
  return COMPACT.format(modelTokens(tokens));
}
