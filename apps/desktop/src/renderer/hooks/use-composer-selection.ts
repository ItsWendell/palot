import type { ModelRef } from "@opencode/client";
import { useAtom, useAtomValue, useStore } from "jotai";
import { useCallback, useMemo, useRef, useState } from "react";
import type { PalotAgent, PalotModel, PalotSession } from "../../shared";
import { runtimeAtom } from "../atoms/workspace";
import {
  availableModel,
  primaryAgents,
  recalledModel,
  rememberSelection,
  resolveAgentModel,
  selectionMemoriesAtom,
  selectionScope,
  type SelectionMemory,
} from "../lib/selection-memory";
import { palot } from "../services/palot";
import { useCacheSession } from "./use-session-catalog";

export function useComposerSelection({
  session,
  draft,
  draftScope,
  agents,
  models,
  projectDefault,
  catalogDefault,
  forceCatalogDefault = false,
  catalogsReady,
}: {
  session: PalotSession;
  draft: boolean;
  draftScope: string;
  agents: PalotAgent[];
  models: PalotModel[];
  projectDefault: ModelRef | null;
  catalogDefault: ModelRef | null;
  forceCatalogDefault?: boolean;
  catalogsReady: boolean;
}) {
  const store = useStore();
  const runtime = useAtomValue(runtimeAtom);
  const scope = runtime?.profileID ? selectionScope(runtime.profileID, session.projectID) : null;
  const identity = JSON.stringify([scope, runtime?.connectionID, draftScope]);
  const [memories, setMemories] = useAtom(selectionMemoriesAtom);
  // Draft exploration can restore A → B → A without persisting unapplied server choices.
  const [pending, setPending] = useState<{ identity: string; memory: SelectionMemory } | null>(
    null,
  );
  const [actionState, setActionState] = useState<{
    identity: string;
    busy: boolean;
    failed: boolean;
  } | null>(null);
  const inFlight = useRef(false);
  const cacheSession = useCacheSession();
  const memory =
    pending?.identity === identity ? pending.memory : scope ? memories[scope] : undefined;
  const availableAgents = useMemo(() => primaryAgents(agents), [agents]);
  const agent = draft
    ? (availableAgents.find((entry) => entry.id === memory?.agent)?.id ?? null)
    : session.agent;
  const creationModel = useMemo(
    () =>
      draft
        ? resolveAgentModel({
            memory,
            agent,
            agents: availableAgents,
            models,
            projectDefault,
            // The catalog default is global, not the default agent's configured model.
            // Only pin it when an explicit selection needs a fallback.
            catalogDefault: agent || projectDefault || forceCatalogDefault ? catalogDefault : null,
          })
        : session.model,
    [
      draft,
      memory,
      agent,
      availableAgents,
      models,
      projectDefault,
      catalogDefault,
      forceCatalogDefault,
      session.model,
    ],
  );
  const model = useMemo(
    () => (draft ? (creationModel ?? availableModel(models, catalogDefault)) : session.model),
    [draft, creationModel, models, catalogDefault, session.model],
  );
  const displayedSession = useMemo(
    () => (draft ? { ...session, agent, model } : session),
    [draft, session, agent, model],
  );

  const remember = useCallback(
    (selectedAgent: string | null, selectedModel?: ModelRef) => {
      if (!scope) return;
      setMemories((current) => {
        const next = { ...current };
        delete next[scope];
        next[scope] = rememberSelection(current[scope], selectedAgent, selectedModel);
        return Object.fromEntries(Object.entries(next).slice(-100));
      });
    },
    [scope, setMemories],
  );

  const assertConnection = useCallback(() => {
    const current = store.get(runtimeAtom);
    if (
      current?.connectionID !== runtime?.connectionID ||
      current?.profileID !== runtime?.profileID
    ) {
      throw new Error("The server connection changed. Select the model again before sending.");
    }
  }, [store, runtime?.connectionID, runtime?.profileID]);

  const applyModel = useCallback(
    async (next: ModelRef) => {
      if (inFlight.current) throw new Error("Wait for the current selection to finish.");
      const available = availableModel(models, next);
      if (!available) throw new Error("This model is no longer available.");
      next = available;
      if (draft) {
        if (!catalogsReady) throw new Error("Wait for available models and agents to load.");
        setPending({ identity, memory: rememberSelection(memory, agent, next) });
        return;
      }
      inFlight.current = true;
      setActionState({ identity, busy: true, failed: false });
      try {
        assertConnection();
        await palot.switchModel({ sessionID: session.id, model: next });
        cacheSession({ ...session, model: next });
        remember(agent, next);
        setActionState({ identity, busy: false, failed: false });
      } catch (error) {
        setActionState({ identity, busy: false, failed: true });
        throw error;
      } finally {
        inFlight.current = false;
      }
    },
    [
      models,
      draft,
      catalogsReady,
      identity,
      memory,
      agent,
      assertConnection,
      session,
      cacheSession,
      remember,
    ],
  );

  const selectModel = useCallback(
    async (next: ModelRef) => {
      const recalled = recalledModel(memory, agent, next, models);
      if (!recalled) throw new Error("This model is no longer available.");
      await applyModel(recalled);
    },
    [memory, agent, models, applyModel],
  );

  const selectAgent = useCallback(
    async (next: PalotAgent) => {
      if (inFlight.current) throw new Error("Wait for the current selection to finish.");
      if (!availableAgents.some((agent) => agent.id === next.id))
        throw new Error("This agent is no longer available.");
      const nextModel = resolveAgentModel({
        memory,
        agent: next.id,
        agents: availableAgents,
        models,
        projectDefault,
        catalogDefault,
      });
      if (!catalogsReady || !nextModel)
        throw new Error("Wait for available models and agents to load.");
      if (draft) {
        setPending({ identity, memory: rememberSelection(memory, next.id, nextModel) });
        return;
      }
      inFlight.current = true;
      setActionState({ identity, busy: true, failed: false });
      try {
        assertConnection();
        await palot.switchAgent({ sessionID: session.id, agent: next.id });
        // These API operations are separate. Keep the successful half if model selection fails.
        const switched = { ...session, agent: next.id };
        cacheSession(switched);
        remember(next.id);
        assertConnection();
        await palot.switchModel({ sessionID: session.id, model: nextModel });
        cacheSession({ ...switched, model: nextModel });
        remember(next.id, nextModel);
        setActionState({ identity, busy: false, failed: false });
      } catch (error) {
        setActionState({ identity, busy: false, failed: true });
        throw error;
      } finally {
        inFlight.current = false;
      }
    },
    [
      memory,
      availableAgents,
      models,
      projectDefault,
      catalogDefault,
      catalogsReady,
      draft,
      identity,
      assertConnection,
      session,
      cacheSession,
      remember,
    ],
  );

  return {
    session: displayedSession,
    creationModel,
    selectAgent,
    selectModel,
    selectVariant: applyModel,
    rememberCreated: () => {
      if (agent || creationModel) remember(agent, creationModel ?? undefined);
    },
    assertConnection,
    blocked:
      (draft && (!catalogsReady || !model)) ||
      (actionState?.identity === identity && (actionState.busy || actionState.failed)),
    busy: actionState?.identity === identity && actionState.busy,
    error:
      actionState?.identity === identity && actionState.failed
        ? "Selection was not completed. Select a model before sending."
        : null,
  };
}
