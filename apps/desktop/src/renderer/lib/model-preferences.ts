import type { PalotModel } from "../../shared";

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
