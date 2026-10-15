import { describe, expect, it } from "vitest";
import type { PalotModel } from "../../shared";
import {
  findModelForQuery,
  formatTokenLimit,
  groupPickerModels,
  isNewModel,
  newModelKeys,
  nextReasoningVariant,
} from "./model-picker";
import { rememberRecentModel, toggleFavoriteModel } from "./model-preferences";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 11);

function model(providerID: string, id: string, name: string): PalotModel {
  return {
    id,
    modelID: id,
    providerID,
    name,
    family: null,
    variants: [],
    inputLimit: null,
    contextLimit: 100_000,
    outputLimit: 10_000,
    releasedAt: 0,
    capabilities: { tools: true, input: ["text"], output: ["text"] },
    status: "active",
  };
}

describe("model picker helpers", () => {
  it("marks models released in the last 30 days as new", () => {
    expect(isNewModel({ releasedAt: NOW - 29 * DAY }, NOW)).toBe(true);
    expect(isNewModel({ releasedAt: (NOW - 2 * DAY) / 1000 }, NOW)).toBe(true);
    expect(isNewModel({ releasedAt: NOW - 31 * DAY }, NOW)).toBe(false);
    expect(isNewModel({ releasedAt: 0 }, NOW)).toBe(false);
  });

  it("marks only the newest recent release in each provider family as new", () => {
    const at = (base: PalotModel, family: string | null, releasedAt: number) => ({
      ...base,
      family,
      releasedAt,
    });
    const keys = newModelKeys(
      [
        at(model("anthropic", "opus-5-5", "Opus 5.5"), "opus", NOW - 2 * DAY),
        at(model("anthropic", "opus-5-5-fast", "Opus 5.5 Fast"), "opus", NOW - 2 * DAY),
        at(model("anthropic", "opus-5", "Opus 5"), "opus", NOW - 20 * DAY),
        at(model("anthropic", "haiku-5-5", "Haiku 5.5"), "haiku", NOW - 5 * DAY),
        at(model("openai", "opus-5", "Other Opus"), "opus", NOW - 20 * DAY),
        at(model("openai", "legacy", "Legacy"), null, NOW - 90 * DAY),
      ],
      NOW,
    );
    expect([...keys].sort()).toEqual([
      "anthropic/haiku-5-5",
      "anthropic/opus-5-5",
      "anthropic/opus-5-5-fast",
      "openai/opus-5",
    ]);
  });

  it("formats context sizes compactly", () => {
    expect(formatTokenLimit(200_000)).toBe("200K");
    expect(formatTokenLimit(1_000_000)).toBe("1M");
    expect(formatTokenLimit(1_048_576)).toBe("1M");
    expect(formatTokenLimit(2_500_000)).toBe("2.5M");
  });

  it("resolves /model arguments like the picker search, preferring exact matches", () => {
    const models = [
      model("openai", "gpt-5.1-codex", "GPT-5.1 Codex"),
      model("openai", "gpt-5.1", "GPT-5.1"),
      model("anthropic", "claude-sonnet-4-5", "Claude Sonnet 4.5"),
    ];
    expect(findModelForQuery(models, "gpt-5.1")?.id).toBe("gpt-5.1");
    expect(findModelForQuery(models, "openai/gpt-5.1-codex")?.id).toBe("gpt-5.1-codex");
    expect(findModelForQuery(models, "sonnet 4.5")?.id).toBe("claude-sonnet-4-5");
    expect(findModelForQuery(models, "Anthropic", new Map([["anthropic", "Anthropic"]]))?.id).toBe(
      "claude-sonnet-4-5",
    );
    expect(findModelForQuery(models, "llama")).toBeNull();
  });

  it("cycles reasoning from Auto through each variant and back", () => {
    const variants = ["low", "medium", "high"];
    expect(nextReasoningVariant(variants, undefined)).toBe("low");
    expect(nextReasoningVariant(variants, "default")).toBe("low");
    expect(nextReasoningVariant(variants, "medium")).toBe("high");
    expect(nextReasoningVariant(variants, "high")).toBeUndefined();
    expect(nextReasoningVariant(variants, "retired")).toBe("low");
  });

  it("builds shortcut sections only from visible models", () => {
    const visible = [model("openai", "fast", "Fast"), model("anthropic", "sonnet", "Sonnet")];
    let usages = toggleFavoriteModel({}, "scope", "openai/hidden");
    usages = toggleFavoriteModel(usages, "scope", "anthropic/sonnet");
    for (const key of ["openai/fast", "anthropic/sonnet", "openai/hidden"]) {
      usages = rememberRecentModel(usages, "scope", key);
    }
    const groups = groupPickerModels(visible, usages.scope!, []);
    expect(groups.favorites.map(({ id }) => id)).toEqual(["sonnet"]);
    expect(groups.recent.map(({ id }) => id)).toEqual(["fast"]);
    expect(groups.providers.map(({ id, models }) => [id, models.length])).toEqual([
      ["openai", 1],
      ["anthropic", 1],
    ]);
  });

  it("keeps the five most recent models and toggles favorites", () => {
    let usages = {};
    for (const key of ["a", "b", "c", "d", "e", "f", "b"]) {
      usages = rememberRecentModel(usages, "scope", key);
    }
    expect(usages).toEqual({ scope: { favorites: [], recent: ["b", "f", "e", "d", "c"] } });
    usages = toggleFavoriteModel(usages, "scope", "a");
    usages = toggleFavoriteModel(usages, "scope", "a");
    expect(usages).toEqual({ scope: { favorites: [], recent: ["b", "f", "e", "d", "c"] } });
  });
});
