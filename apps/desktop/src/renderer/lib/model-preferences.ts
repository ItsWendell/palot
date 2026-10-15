import type { PalotModel } from "../../shared";
import { persistedAtom } from "../atoms/persisted";

export interface ModelPickerPreference {
  hidden: string[];
  order: string[];
}

export type ModelPickerPreferences = Record<string, ModelPickerPreference>;

export function modelPreferenceKey(model: Pick<PalotModel, "id" | "providerID">): string {
  return `${model.providerID}/${model.id}`;
}

export function reconcileModelPreference(
  models: PalotModel[],
  preference: ModelPickerPreference | undefined,
): ModelPickerPreference {
  const available = new Set(models.map(modelPreferenceKey));
  return {
    // Keys identify configured connections, never canonical branding. Missing
    // connections may return, so visibility edits must retain their keys.
    hidden: [...new Set(preference?.hidden ?? [])],
    order: [
      ...new Set([...(preference?.order ?? []).filter((key) => available.has(key)), ...available]),
    ],
  };
}

export function reconcileModelOrder(
  models: PalotModel[],
  preference: ModelPickerPreference | undefined,
): string[] {
  return reconcileModelPreference(models, preference).order;
}

export function applyModelPreference(
  models: PalotModel[],
  preference: ModelPickerPreference | undefined,
  includeHidden = false,
): PalotModel[] {
  const byKey = new Map(models.map((model) => [modelPreferenceKey(model), model]));
  const reconciled = reconcileModelPreference(models, preference);
  const hidden = new Set(reconciled.hidden);
  return reconciled.order.flatMap((key) => {
    const model = byKey.get(key);
    return model && (includeHidden || !hidden.has(key)) ? [model] : [];
  });
}
/** Project IDs are local to their OpenCode server. */
export function modelProjectPreferenceKey(profileID: string, projectID: string): string {
  return JSON.stringify([profileID, projectID]);
}

/**
 * Picker shortcuts per preference scope, kept apart from visibility and order so Settings
 * edits of `ModelPickerPreference` never drop them. Keys are `modelPreferenceKey` values.
 */
export interface ModelPickerUsage {
  favorites: string[];
  /** Most recent first. */
  recent: string[];
}

export type ModelPickerUsages = Record<string, ModelPickerUsage>;

export const RECENT_MODEL_LIMIT = 5;
const USAGE_SCOPE_LIMIT = 100;
const EMPTY_USAGE: ModelPickerUsage = { favorites: [], recent: [] };

function isKeyList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((key) => typeof key === "string");
}

export function isModelPickerUsages(value: unknown): value is ModelPickerUsages {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.values(value).every(
    (usage) =>
      Boolean(usage) &&
      typeof usage === "object" &&
      isKeyList((usage as ModelPickerUsage).favorites) &&
      isKeyList((usage as ModelPickerUsage).recent),
  );
}

export const modelPickerUsageAtom = persistedAtom({
  key: "models.picker-usage",
  initialValue: {} as ModelPickerUsages,
  validate: isModelPickerUsages,
});

export function modelPickerUsage(usages: ModelPickerUsages, scope: string): ModelPickerUsage {
  return usages[scope] ?? EMPTY_USAGE;
}

function updateUsage(
  usages: ModelPickerUsages,
  scope: string,
  update: (usage: ModelPickerUsage) => ModelPickerUsage,
): ModelPickerUsages {
  const next = { ...usages };
  delete next[scope];
  next[scope] = update(usages[scope] ?? EMPTY_USAGE);
  // The most recently touched scopes win; older projects age out.
  return Object.fromEntries(Object.entries(next).slice(-USAGE_SCOPE_LIMIT));
}

export function toggleFavoriteModel(
  usages: ModelPickerUsages,
  scope: string,
  key: string,
): ModelPickerUsages {
  return updateUsage(usages, scope, (usage) => ({
    ...usage,
    favorites: usage.favorites.includes(key)
      ? usage.favorites.filter((entry) => entry !== key)
      : [...usage.favorites, key],
  }));
}

export function rememberRecentModel(
  usages: ModelPickerUsages,
  scope: string,
  key: string,
): ModelPickerUsages {
  return updateUsage(usages, scope, (usage) => ({
    ...usage,
    recent: [key, ...usage.recent.filter((entry) => entry !== key)].slice(0, RECENT_MODEL_LIMIT),
  }));
}
