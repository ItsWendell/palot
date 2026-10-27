import type { UsageLimitsBudget } from "@opencode/client";
import { describe, expect, it } from "vitest";
import {
  budgetSummary,
  formatResetsIn,
  goWindowDuration,
  supportsUsageLimits,
  usageLimitFailure,
  usagePace,
} from "./usage-limits";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

describe("usage limits", () => {
  it("formats resets without claiming a stale reset is in the future", () => {
    expect(formatResetsIn(2 * DAY + 3 * HOUR, 0)).toBe("Resets in 2d 3h");
    expect(formatResetsIn(2 * HOUR + 14 * 60_000, 0)).toBe("Resets in 2h 14m");
    expect(formatResetsIn(12 * 60_000, 0)).toBe("Resets in 12m");
    expect(formatResetsIn(59_999, 0)).toBe("Resets momentarily");
    expect(formatResetsIn(0, 1)).toBe("Resets momentarily");
  });

  it("uses five-hour, weekly, and calendar-month windows, including leap years", () => {
    expect(goWindowDuration("rolling", 0)).toBe(5 * HOUR);
    expect(goWindowDuration("weekly", 0)).toBe(7 * DAY);
    expect(goWindowDuration("monthly", Date.UTC(2026, 2, 1))).toBe(28 * DAY);
    expect(goWindowDuration("monthly", Date.UTC(2024, 2, 1))).toBe(29 * DAY);
    expect(goWindowDuration("monthly", Date.UTC(2026, 2, 31))).toBe(31 * DAY);
  });

  it("compares usage with elapsed time with an inclusive five-point on-pace band", () => {
    const reset = 5 * HOUR;
    expect(usagePace("rolling", 50, reset, 2.5 * HOUR)).toMatchObject({
      remaining: 50,
      evenPaceRemaining: 50,
      label: "On pace",
    });
    expect(usagePace("rolling", 55, reset, 2.5 * HOUR).label).toBe("On pace");
    expect(usagePace("rolling", 45, reset, 2.5 * HOUR).label).toBe("On pace");
    expect(usagePace("rolling", 56, reset, 2.5 * HOUR).label).toBe("Ahead of pace");
    expect(usagePace("rolling", 44, reset, 2.5 * HOUR).label).toBe("Under pace");
    expect(usagePace("weekly", 120, 7 * DAY, -DAY)).toMatchObject({
      remaining: 0,
      evenPaceRemaining: 100,
    });
    expect(usagePace("weekly", -10, 7 * DAY, 8 * DAY)).toMatchObject({
      remaining: 100,
      evenPaceRemaining: 0,
    });
  });

  it("summarizes pooled and per-model budgets without adding independent model counters", () => {
    const budget: UsageLimitsBudget = {
      id: "budget",
      limit: 100,
      spent: 25,
      scope: "combined",
      per: "model",
      coverage: "models",
      models: [
        { providerID: "opencode", modelID: "one", name: "One", spent: 25 },
        { providerID: "opencode", modelID: "two", name: "Two", spent: 10 },
      ],
      vendors: [],
      picked: true,
      shared: true,
      resetsAt: 1,
    };
    expect(budgetSummary(budget)).toEqual({
      amount: "$25.00 of $100.00",
      percentUsed: 25,
      reached: false,
      chips: ["Combined spend", "Per model", "One, Two"],
      shared: "Shared by the workspace",
    });
    expect(
      budgetSummary({ ...budget, vendors: ["Anthropic"], inputPriceAtLeast: 3 }).chips,
    ).toEqual(["Combined spend", "Per model", "Anthropic", "Input ≥ $3.00 / 1M tokens"]);
    expect(
      budgetSummary({
        ...budget,
        spent: 150,
        coverage: "all",
        scope: "each",
        per: "set",
        shared: false,
      }),
    ).toMatchObject({
      percentUsed: 100,
      reached: true,
      chips: ["Per member", "Across models", "All models and services"],
      shared: null,
    });
    expect(budgetSummary({ ...budget, limit: 0, spent: 0 }).percentUsed).toBe(100);
  });

  it("gates known old servers and probes unknown versions", () => {
    expect(supportsUsageLimits("2.0.7")).toBe(false);
    expect(supportsUsageLimits("2.1.9")).toBe(false);
    expect(supportsUsageLimits("v2.2.0")).toBe(true);
    expect(supportsUsageLimits("3.0.0")).toBe(true);
    expect(supportsUsageLimits(null)).toBe(true);
  });

  it("recognizes only limit failures and uses the failure timestamp for the reset", () => {
    const message = {
      createdAt: 10,
      completedAt: 20,
      data: { error: { type: "provider.quota", retryAfterMs: 100 } },
    };
    expect(usageLimitFailure(message)).toEqual({ resetsAt: 120 });
    expect(
      usageLimitFailure({ ...message, data: { error: { name: "provider.rate-limit" } } }),
    ).toEqual({ resetsAt: null });
    expect(
      usageLimitFailure({
        ...message,
        data: { error: { type: "provider.error", retryAfterMs: 100 } },
      }),
    ).toBeNull();
  });
});
