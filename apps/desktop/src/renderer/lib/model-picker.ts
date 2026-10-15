/** Model picker grouping, search, and display helpers shared by the composer and `/model`. */

import type { PalotModel, PalotProvider } from "../../shared";
import { modelPreferenceKey, type ModelPickerUsage } from "./model-preferences";
import { matchesPickerSearch, normalizePickerSearch } from "./picker-search";

/** Models released within this window carry a "New" badge. */
export const NEW_MODEL_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/** OpenCode reports release times in milliseconds; tolerate second-precision values. */
function releaseTime(model: Pick<PalotModel, "releasedAt">): number | null {
  const value = model.releasedAt;
  if (!Number.isFinite(value) || value <= 0) return null;
  return value < 1e12 ? value * 1000 : value;
}

export function isNewModel(model: Pick<PalotModel, "releasedAt">, now = Date.now()): boolean {
  const released = releaseTime(model);
  return released !== null && released <= now && now - released <= NEW_MODEL_WINDOW_MS;
}

/**
 * Models that carry "New": recent releases that are also the newest of their provider family,
 * so a family's older siblings released the same month don't all claim it. Ties share it.
 */
export function newModelKeys(models: readonly PalotModel[], now = Date.now()): Set<string> {
  const newest = new Map<string, number>();
  const familyOf = (model: PalotModel) => `${model.providerID}\u0000${model.family ?? model.id}`;
  for (const model of models) {
    const released = releaseTime(model);
    if (released === null) continue;
    const family = familyOf(model);
    newest.set(family, Math.max(newest.get(family) ?? 0, released));
  }
  const keys = new Set<string>();
  for (const model of models) {
    if (!isNewModel(model, now)) continue;
    if (releaseTime(model) === newest.get(familyOf(model))) keys.add(modelPreferenceKey(model));
  }
  return keys;
}

export function formatTokenLimit(tokens: number): string {
  if (!Number.isFinite(tokens) || tokens <= 0) return "—";
  if (tokens >= 1_000_000) {
    const millions = tokens / 1_000_000;
    return `${Number.isInteger(millions) ? millions : millions.toFixed(1).replace(/\.0$/, "")}M`;
  }
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K`;
  return String(tokens);
}

/** The untiered price, or the lowest tier when every price is tiered. */
export function baseModelCost(model: Pick<PalotModel, "cost">) {
  const tiers = model.cost ?? [];
  return (
    tiers.find((tier) => tier.contextOver === null) ??
    tiers.toSorted((left, right) => (left.contextOver ?? 0) - (right.contextOver ?? 0))[0] ??
    null
  );
}

const PRICE_FORMATTER = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 3,
});

export function formatModelPrice(usdPerMillion: number): string {
  return usdPerMillion === 0 ? "Free" : PRICE_FORMATTER.format(usdPerMillion);
}

export function sentenceCase(value: string): string {
  return value ? `${value[0]?.toUpperCase()}${value.slice(1)}` : value;
}

const INPUT_LABELS: Record<string, string> = { pdf: "PDF" };
export function formatModalities(values: readonly string[]): string {
  return values.length > 0
    ? values.map((value) => INPUT_LABELS[value] ?? sentenceCase(value)).join(", ")
    : "—";
}

/** The selected variant, treating OpenCode's canonical `default` and stale IDs as Auto. */
export function activeReasoningVariant(
  variants: readonly string[],
  variant: string | null | undefined,
): string | undefined {
  return variant && variant !== "default" && variants.includes(variant) ? variant : undefined;
}

/** Auto → first variant → … → last variant → Auto, like OpenCode's `model.variant.cycle`. */
export function nextReasoningVariant(
  variants: readonly string[],
  variant: string | null | undefined,
): string | undefined {
  const active = activeReasoningVariant(variants, variant);
  return variants[active ? variants.indexOf(active) + 1 : 0];
}

export function modelSearchValues(model: PalotModel, providerName?: string | null): string[] {
  return [
    model.name,
    model.id,
    model.providerID,
    `${model.providerID}/${model.id}`,
    providerName ?? null,
    model.family,
  ].filter((value): value is string => Boolean(value));
}

/**
 * Resolves a `/model <query>` argument: an exact ID, name or `provider/id` wins, then the
 * first model the picker's search would show for the same text.
 */
export function findModelForQuery(
  models: readonly PalotModel[],
  query: string,
  providerNames?: ReadonlyMap<string, string>,
): PalotModel | null {
  const normalized = normalizePickerSearch(query);
  if (!normalized) return null;
  const exact = models.find((model) =>
    [model.id, model.name, `${model.providerID}/${model.id}`].some(
      (value) => normalizePickerSearch(value) === normalized,
    ),
  );
  if (exact) return exact;
  return (
    models.find((model) =>
      matchesPickerSearch(query, modelSearchValues(model, providerNames?.get(model.providerID))),
    ) ?? null
  );
}

export interface ModelPickerGroups {
  favorites: PalotModel[];
  recent: PalotModel[];
  providers: { id: string; name: string; models: PalotModel[] }[];
}

/**
 * Favorites, then up to five recent models that aren't favorites, then every visible model
 * grouped by provider in the person's saved order. `models` is already ordered and filtered
 * by the hidden-model preference, so shortcuts never resurrect a hidden model.
 */
export function groupPickerModels(
  models: readonly PalotModel[],
  usage: ModelPickerUsage,
  providers: readonly PalotProvider[],
): ModelPickerGroups {
  const byKey = new Map(models.map((model) => [modelPreferenceKey(model), model]));
  const pick = (keys: readonly string[]) =>
    keys.flatMap((key) => {
      const model = byKey.get(key);
      return model ? [model] : [];
    });
  const favoriteKeys = new Set(usage.favorites);
  const providerNames = new Map(providers.map((provider) => [provider.id, provider.name]));
  const grouped = new Map<string, PalotModel[]>();
  for (const model of models) {
    const list = grouped.get(model.providerID);
    if (list) list.push(model);
    else grouped.set(model.providerID, [model]);
  }
  return {
    favorites: pick(usage.favorites),
    recent: pick(usage.recent.filter((key) => !favoriteKeys.has(key))),
    providers: [...grouped].map(([id, list]) => ({
      id,
      name: providerNames.get(id) ?? id,
      models: list,
    })),
  };
}
