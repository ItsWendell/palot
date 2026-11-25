import type { UsageLimitsBudget, UsageLimitsInfo } from "@opencode/client";
import { describe, expect, it } from "vitest";
import type { PalotModel, PalotProvider } from "../../shared";
import {
  hasConsoleProvider,
  modelLimit,
  modelLimitDescription,
  modelLimitLabel,
} from "./model-limits";

const now = new Date(2026, 10, 24, 12, 0, 0).getTime();
const later = new Date(2026, 10, 24, 18, 0, 0).getTime();

const model = (id: string, providerID: string, input = 3): PalotModel =>
  ({
    id,
    modelID: id,
    providerID,
    name: id,
    cost: [{ contextOver: null, input, output: 15, cacheRead: 0, cacheWrite: 0 }],
  }) as PalotModel;
const provider = (id: string, integrationID: string | null = "opencode"): PalotProvider => ({
  id,
  name: id,
  integrationID,
  package: "",
  disabled: false,
});
const budget = (partial: Partial<UsageLimitsBudget>): UsageLimitsBudget => ({
  id: "b",
  limit: 100,
  spent: 38,
  scope: "each",
  per: "set",
  coverage: "all",
  models: [],
  vendors: [],
  picked: false,
  shared: false,
  resetsAt: later,
  ...partial,
});
const info = (partial: Partial<UsageLimitsInfo>): UsageLimitsInfo => ({
  workspace: { id: "wrk_1", usageURL: "https://opencode.ai/console/wrk_1/usage" },
  budgets: [],
  ...partial,
});

describe("model limits", () => {
  const consoleProvider = provider("opencode");

  it("shows what a budget on all spend leaves a model Console serves", () => {
    const limit = modelLimit(
      info({ budgets: [budget({})] }),
      model("gpt", "opencode"),
      consoleProvider,
    )!;
    expect(limit).toEqual({ percentLeft: 62, level: "plenty", resetsAt: later, source: "budget" });
    expect(modelLimitLabel(limit, now, "en-GB")).toBe("62% left · resets 18:00");
    expect(modelLimitDescription(limit, now, "en-GB")).toBe(
      "62% of the Console budget left; resets 18:00.",
    );
  });

  it("leaves free models, other providers and unlimited models alone", () => {
    const limits = info({ budgets: [budget({})] });
    expect(modelLimit(limits, model("free", "opencode", 0), consoleProvider)).toBeNull();
    expect(
      modelLimit(limits, model("claude", "anthropic"), provider("anthropic", null)),
    ).toBeNull();
    expect(modelLimit(info({}), model("gpt", "opencode"), consoleProvider)).toBeNull();
  });

  it("binds the budget with the least left, and per-model budgets count the model's own spend", () => {
    const limits = info({
      budgets: [
        budget({ id: "all", spent: 10 }),
        budget({
          id: "each",
          per: "model",
          coverage: "models",
          limit: 20,
          spent: 19,
          models: [
            { providerID: "opencode", modelID: "gpt", name: "GPT", spent: 18 },
            { providerID: "opencode", modelID: "other", name: "Other", spent: 19 },
          ],
        }),
      ],
    });
    expect(modelLimit(limits, model("gpt", "opencode"), consoleProvider)).toMatchObject({
      percentLeft: 10,
      level: "low",
    });
    const reached = modelLimit(
      info({ budgets: [budget({ spent: 100 })] }),
      model("gpt", "opencode"),
      consoleProvider,
    )!;
    expect(reached.level).toBe("reached");
    expect(modelLimitLabel(reached, now, "en-GB")).toBe("Limit reached · resets 18:00");
  });

  it("reads Go's models from the window closest to its limit", () => {
    const meter = (percent: number, limited = false) => ({ percent, limited, resetsAt: later });
    const go = info({ go: { rolling: meter(40), weekly: meter(90), monthly: meter(20) } });
    expect(modelLimit(go, model("kimi", "opencode-go"), provider("opencode-go"))).toMatchObject({
      percentLeft: 10,
      level: "low",
      source: "go",
    });
    const limited = info({
      go: { rolling: meter(60, true), weekly: meter(90), monthly: meter(20) },
    });
    expect(modelLimit(limited, model("kimi", "opencode-go"), provider("opencode-go"))?.level).toBe(
      "reached",
    );
    // Go bills its own allowance: a Console budget on all spend does not apply to it.
    expect(
      modelLimit(
        info({ budgets: [budget({})] }),
        model("kimi", "opencode-go"),
        provider("opencode-go"),
      ),
    ).toBeNull();
  });

  it("reads limits only when a provider comes through Console", () => {
    expect(hasConsoleProvider([provider("anthropic", null)])).toBe(false);
    expect(hasConsoleProvider([provider("anthropic", null), consoleProvider])).toBe(true);
  });
});
