/**
 * What OpenCode Console leaves a paid model, for the model picker and the low-limit warnings:
 * the member's budgets for models Console serves, and the OpenCode Go windows for Go's models.
 * The same rules as OpenCode's own clients, which read `experimental.usage.limits` too.
 */

import type { UsageLimitsInfo } from "@opencode/client";
import type { PalotModel, PalotProvider } from "../../shared";
import { formatLimitReset } from "../../shared/provider-limit";

/** Below this share left, a model reads as running low and warns once per window. */
export const LOW_LIMIT_PERCENT = 15;

export type ModelLimitLevel = "plenty" | "low" | "reached";

export interface ModelLimit {
  /** Share of the binding limit left, 0–100. */
  percentLeft: number;
  level: ModelLimitLevel;
  /** When the binding limit resets. */
  resetsAt: number;
  /** Which allowance binds: a Console budget, or an OpenCode Go window. */
  source: "budget" | "go";
}

const GO_PROVIDER = "opencode-go";
const CONSOLE_INTEGRATION = "opencode";

function isGo(provider: PalotProvider | undefined, model: PalotModel): boolean {
  return (provider?.canonicalID ?? provider?.id ?? model.providerID) === GO_PROVIDER;
}

/** Console serves the model, so the workspace's budgets can apply; Go bills its own allowance. */
function servedByConsole(provider: PalotProvider | undefined, model: PalotModel): boolean {
  return provider?.integrationID === CONSOLE_INTEGRATION && !isGo(provider, model);
}

/** Free models stay usable whatever is spent. */
function isFree(model: PalotModel): boolean {
  return Boolean(model.cost?.length) && model.cost!.every((cost) => cost.input === 0);
}

/** Whether any provider can have Console limits, so reading them is worth a request. */
export function hasConsoleProvider(providers: readonly PalotProvider[]): boolean {
  return providers.some((provider) => provider.integrationID === CONSOLE_INTEGRATION);
}

function level(percentLeft: number, reached: boolean): ModelLimitLevel {
  if (reached || percentLeft <= 0) return "reached";
  return percentLeft < LOW_LIMIT_PERCENT ? "low" : "plenty";
}

/**
 * The limit closest to stopping a paid model, or null when none applies. Any limit that runs
 * out stops the model, so the one with the smallest share left binds.
 */
export function modelLimit(
  info: UsageLimitsInfo,
  model: PalotModel,
  provider: PalotProvider | undefined,
): ModelLimit | null {
  if (isFree(model)) return null;
  if (isGo(provider, model)) {
    if (!info.go) return null;
    const windows = [info.go.rolling, info.go.weekly, info.go.monthly];
    const binding = windows.toSorted(
      (a, b) => Number(b.limited) - Number(a.limited) || b.percent - a.percent,
    )[0]!;
    const percentLeft = Math.max(0, Math.min(100, 100 - binding.percent));
    return {
      percentLeft,
      level: level(percentLeft, binding.limited),
      resetsAt: binding.resetsAt,
      source: "go",
    };
  }
  const limits = info.budgets.flatMap((budget) => {
    let spent: number;
    if (budget.coverage === "all") {
      if (!servedByConsole(provider, model)) return [];
      spent = budget.spent;
    } else {
      const entry = budget.models.find(
        (item) => item.providerID === model.providerID && item.modelID === model.id,
      );
      if (!entry) return [];
      spent = budget.per === "model" ? (entry.spent ?? 0) : budget.spent;
    }
    const percentLeft =
      budget.limit > 0
        ? Math.max(0, Math.min(100, ((budget.limit - spent) / budget.limit) * 100))
        : 0;
    return [{ percentLeft, reached: spent >= budget.limit, resetsAt: budget.resetsAt }];
  });
  if (limits.length === 0) return null;
  const binding = limits.toSorted(
    (a, b) => Number(b.reached) - Number(a.reached) || a.percentLeft - b.percentLeft,
  )[0]!;
  return {
    percentLeft: binding.percentLeft,
    level: level(binding.percentLeft, binding.reached),
    resetsAt: binding.resetsAt,
    source: "budget",
  };
}

function percentText(percent: number): string {
  if (percent > 0 && percent < 1) return "<1%";
  return `${Math.floor(percent)}%`;
}

/** The picker row's label: "62% left · resets 18:00", or "Limit reached · resets Dec 1, 00:00". */
export function modelLimitLabel(limit: ModelLimit, now = Date.now(), locale?: string): string {
  const head =
    limit.level === "reached" ? "Limit reached" : `${percentText(limit.percentLeft)} left`;
  return limit.resetsAt > now
    ? `${head} · resets ${formatLimitReset(limit.resetsAt, now, locale)}`
    : head;
}

/** The full sentence for a tooltip or screen reader. */
export function modelLimitDescription(limit: ModelLimit, now = Date.now(), locale?: string) {
  const allowance = limit.source === "go" ? "OpenCode Go allowance" : "Console budget";
  const head =
    limit.level === "reached"
      ? `${allowance} reached`
      : `${percentText(limit.percentLeft)} of the ${allowance} left`;
  return limit.resetsAt > now
    ? `${head}; resets ${formatLimitReset(limit.resetsAt, now, locale)}.`
    : `${head}.`;
}
