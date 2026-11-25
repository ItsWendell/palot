import { useAtomValue } from "jotai";
import { useCallback, useEffect, useMemo } from "react";
import type {
  PalotAgent,
  PalotModel,
  PalotModelCatalog,
  PalotProject,
  PalotSession,
} from "../../../shared";
import { defaultModelsAtom, modelPickerPreferencesAtom } from "../../atoms/ui";
import { useComposerSelection } from "../../hooks/use-composer-selection";
import { useModelCatalog } from "../../hooks/use-model-catalog";
import { useSettingsSnapshot } from "../../hooks/use-settings-snapshot";
import {
  applyModelPreference,
  modelPreferenceKey,
  modelProjectPreferenceKey,
  reconcileModelPreference,
} from "../../lib/model-preferences";
import { primaryAgents } from "../../lib/selection-memory";
import { projectForSession } from "../../lib/view-models";

const EMPTY_MODEL_CATALOG: PalotModelCatalog = {
  models: [],
  defaultModel: null,
  providers: [],
  errors: [],
};
const EMPTY_AGENTS: PalotAgent[] = [];

/**
 * The model and agent catalogs, the project's model-picker preference, and the agent and model
 * selection resolved against them.
 */
export function useComposerCatalogs({
  session,
  newTask,
  draftScope,
  profileID,
  projects,
  agentsWanted,
  onModelsChange,
}: {
  session: PalotSession;
  newTask: boolean;
  draftScope: string;
  profileID: string | undefined;
  projects: PalotProject[];
  /** The agent menu is open or a shortcut is waiting to cycle agents. */
  agentsWanted: boolean;
  onModelsChange?(models: PalotModel[]): void;
}) {
  const modelCatalogQuery = useModelCatalog(session.location);
  const agentCatalogQuery = useSettingsSnapshot(
    { ...session.location, projectID: session.projectID, capabilities: ["agents"] },
    newTask || agentsWanted,
  );
  const catalog = modelCatalogQuery.data ?? EMPTY_MODEL_CATALOG;
  const preferenceScope = modelProjectPreferenceKey(
    profileID ?? "disconnected",
    projectForSession(projects, session)?.id ?? session.projectID,
  );
  const storedPickerPreference = useAtomValue(modelPickerPreferencesAtom)[preferenceScope];
  const projectDefault = useAtomValue(defaultModelsAtom)[preferenceScope] ?? null;
  const pickerPreference = useMemo(
    () => reconcileModelPreference(catalog.models, storedPickerPreference),
    [catalog.models, storedPickerPreference],
  );
  const pickerModels = useMemo(
    () => applyModelPreference(catalog.models, pickerPreference),
    [catalog.models, pickerPreference],
  );
  const ready = Boolean(
    modelCatalogQuery.data &&
    agentCatalogQuery.data &&
    !modelCatalogQuery.error &&
    !agentCatalogQuery.error &&
    !agentCatalogQuery.data.errors.some((error) => error.capability === "agents"),
  );
  const agents = agentCatalogQuery.data?.agents ?? EMPTY_AGENTS;
  const defaultHidden = Boolean(
    catalog.defaultModel &&
    pickerPreference.hidden.includes(modelPreferenceKey(catalog.defaultModel)),
  );
  const selection = useComposerSelection({
    session,
    draft: newTask,
    draftScope,
    agents,
    models: catalog.models,
    projectDefault,
    forceCatalogDefault: defaultHidden,
    catalogDefault: defaultHidden
      ? (pickerModels[0] ?? null)
      : (catalog.defaultModel ?? pickerModels[0] ?? null),
    catalogsReady: ready,
  });
  const projectOf = useCallback(
    (candidate: PalotSession) => projectForSession(projects, candidate)?.id ?? candidate.projectID,
    [projects],
  );
  // OpenCode lists its resolved default agent first.
  const defaultAgent = useMemo(() => primaryAgents(agents)[0] ?? null, [agents]);

  useEffect(() => {
    // Composer owns model discovery; Thread consumes the catalog to label completed turns.
    // eslint-disable-next-line react-doctor/no-pass-data-to-parent
    onModelsChange?.(catalog.models);
  }, [catalog.models, onModelsChange]);

  return {
    catalog,
    pickerModels,
    preferenceScope,
    agents,
    defaultAgent,
    /** Both catalogs loaded without errors; a new task cannot send before. */
    ready,
    agentsLoading: agentCatalogQuery.isFetching,
    failed: Boolean(agentCatalogQuery.error || modelCatalogQuery.error),
    selection,
    /** The project a task belongs to, for recent outputs across the project's tasks. */
    projectOf,
  };
}

export type ComposerCatalogs = ReturnType<typeof useComposerCatalogs>;
