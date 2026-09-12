import type { ModelRef } from "@opencode/client";
import type { PalotAgent, PalotModel } from "../../shared";
import { persistedAtom } from "../atoms/persisted";

interface AgentSelectionMemory {
  model?: ModelRef;
  variants: Record<string, string | null>;
}
export interface SelectionMemory {
  agent?: string | null;
  agents: Record<string, AgentSelectionMemory>;
}

export const selectionScope = (profileID: string, projectID: string) =>
  JSON.stringify([profileID, projectID]);
const agentKey = (agent: string | null) => JSON.stringify(agent);
const modelKey = (model: ModelRef) => JSON.stringify([model.providerID, model.id]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function isModel(value: unknown): value is ModelRef {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.providerID === "string" &&
    (value.variant === undefined || typeof value.variant === "string")
  );
}
export function isSelectionMemories(value: unknown): value is Record<string, SelectionMemory> {
  return (
    isRecord(value) &&
    Object.values(value).every(
      (memory) =>
        isRecord(memory) &&
        (memory.agent === undefined || memory.agent === null || typeof memory.agent === "string") &&
        isRecord(memory.agents) &&
        Object.values(memory.agents).every(
          (entry) =>
            isRecord(entry) &&
            (entry.model === undefined || isModel(entry.model)) &&
            isRecord(entry.variants) &&
            Object.values(entry.variants).every(
              (variant) => variant === null || typeof variant === "string",
            ),
        ),
    )
  );
}

export const selectionMemoriesAtom = persistedAtom({
  key: "composer.selection-memory",
  initialValue: {} as Record<string, SelectionMemory>,
  validate: isSelectionMemories,
});

export function rememberSelection(
  memory: SelectionMemory | undefined,
  agent: string | null,
  model?: ModelRef,
): SelectionMemory {
  const previous = memory?.agents[agentKey(agent)];
  return {
    ...memory,
    agent,
    agents: {
      ...memory?.agents,
      ...(model
        ? {
            [agentKey(agent)]: {
              model: { id: model.id, providerID: model.providerID },
              variants: { ...previous?.variants, [modelKey(model)]: model.variant ?? null },
            },
          }
        : {}),
    },
  };
}

export function primaryAgents(agents: PalotAgent[]) {
  return agents.filter(
    (agent) => !agent.hidden && (agent.mode === "primary" || agent.mode === "all"),
  );
}

export function availableModel(
  models: PalotModel[],
  ref: ModelRef | null | undefined,
): ModelRef | null {
  const model =
    ref && models.find((model) => model.id === ref.id && model.providerID === ref.providerID);
  return model
    ? {
        id: model.id,
        providerID: model.providerID,
        ...(ref.variant && model.variants.includes(ref.variant) ? { variant: ref.variant } : {}),
      }
    : null;
}

export function recalledModel(
  memory: SelectionMemory | undefined,
  agent: string | null,
  model: ModelRef,
  models: PalotModel[],
): ModelRef | null {
  const variants = memory?.agents[agentKey(agent)]?.variants;
  const variant = variants?.[modelKey(model)];
  return availableModel(
    models,
    variant === undefined
      ? model
      : {
          id: model.id,
          providerID: model.providerID,
          ...(variant ? { variant } : {}),
        },
  );
}

export function resolveAgentModel({
  memory,
  agent,
  agents,
  models,
  projectDefault,
  catalogDefault,
}: {
  memory: SelectionMemory | undefined;
  agent: string | null;
  agents: PalotAgent[];
  models: PalotModel[];
  projectDefault: ModelRef | null;
  catalogDefault: ModelRef | null;
}): ModelRef | null {
  const candidates = [
    memory?.agents[agentKey(agent)]?.model,
    agents.find((entry) => entry.id === agent)?.model,
    projectDefault,
    catalogDefault,
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const resolved = recalledModel(memory, agent, candidate, models);
    if (resolved) return resolved;
  }
  return null;
}
