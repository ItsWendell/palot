/** Resolves the effective OpenCode model shown for an open task. */

import type { ModelRef } from "@opencode/client";
import type { PalotModel } from "../../shared";

export interface ResolvedModelSelection {
  ref: ModelRef | null;
  model: PalotModel | null;
  usesDefault: boolean;
}

export function modelMatchesRef(model: PalotModel | null, ref: ModelRef | null): boolean {
  return Boolean(model && ref && model.id === ref.id && model.providerID === ref.providerID);
}

export function resolveModelSelection(
  models: PalotModel[],
  sessionModel: ModelRef | null,
  defaultModel: PalotModel | null,
): ResolvedModelSelection {
  const ref =
    sessionModel ??
    (defaultModel ? { id: defaultModel.id, providerID: defaultModel.providerID } : null);
  const model = models.find((item) => modelMatchesRef(item, ref)) ?? null;
  return {
    ref,
    model,
    usesDefault: sessionModel === null && modelMatchesRef(defaultModel, ref),
  };
}
