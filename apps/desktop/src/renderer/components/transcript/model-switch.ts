import type { ModelRef } from "@opencode/client";
import { createContext, useContext } from "react";
import type { JsonValue, PalotMessageContent, PalotModel } from "../../../shared";
import { describeModelSwitch, TRANSCRIPT_MODEL_SWITCH_WORDING } from "../../lib/context-usage";

/** The composer's model catalog, so switch markers can name models the way the picker does. */
export const TranscriptModelsContext = createContext<readonly PalotModel[]>([]);

function record(value: JsonValue | undefined): Record<string, JsonValue> {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function modelRef(value: JsonValue | undefined): ModelRef | null {
  const data = record(value);
  if (typeof data.id !== "string" || typeof data.providerID !== "string") return null;
  return {
    id: data.id,
    providerID: data.providerID,
    ...(typeof data.variant === "string" ? { variant: data.variant } : {}),
  };
}

/** A model-switch marker's text with the catalog's model name, falling back to the projected ID text. */
export function modelSwitchLabel(
  part: PalotMessageContent,
  models: readonly PalotModel[],
): string | undefined {
  const data = record(part.data);
  const model = modelRef(data.model);
  if (!model) return part.name;
  const name = models.find(
    (candidate) => candidate.id === model.id && candidate.providerID === model.providerID,
  )?.name;
  return describeModelSwitch(model, modelRef(data.previous), {
    ...TRANSCRIPT_MODEL_SWITCH_WORDING,
    ...(name ? { modelName: name } : {}),
  });
}

export function useModelSwitchLabel(part: PalotMessageContent): string | undefined {
  return modelSwitchLabel(part, useContext(TranscriptModelsContext));
}
