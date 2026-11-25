/** Resolves the effective OpenCode model shown for an open task. */

import type { ModelRef } from "@opencode/client";
import type { PalotModel, PalotModelCatalog } from "../../shared";
import { availableModel } from "./selection-memory";

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

/**
 * The model for task-free text generation (commit messages, pull request drafts, review
 * guides). OpenCode's `generate.text` runs at the server's base configuration, not the task's
 * project, so without a model it may pick a model the user never chose there (OpenCode 2.4 falls
 * back to its hosted free models). Pick what a task here would use instead: the task's model,
 * then the project default set in Palot, then OpenCode's default for the task's location. Only
 * when none is known does OpenCode choose.
 */
export function textGenerationModel(input: {
  sessionModel: ModelRef | null;
  projectDefault: ModelRef | null | undefined;
  catalog: Pick<PalotModelCatalog, "models" | "defaultModel"> | null | undefined;
}): ModelRef | null {
  if (input.sessionModel) return input.sessionModel;
  const models = input.catalog?.models ?? [];
  const projectDefault = availableModel(models, input.projectDefault);
  if (projectDefault) return projectDefault;
  const fallback = input.catalog?.defaultModel;
  return fallback ? { id: fallback.id, providerID: fallback.providerID } : null;
}
