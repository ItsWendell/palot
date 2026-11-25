import { useQueryClient } from "@tanstack/react-query";
import { useStore } from "jotai";
import { useCallback } from "react";
import type { LocationRef, ModelRef } from "@opencode/client";
import type { PalotSession } from "../../shared";
import { defaultModelsAtom } from "../atoms/ui";
import { runtimeAtom } from "../atoms/workspace";
import { modelProjectPreferenceKey } from "../lib/model-preferences";
import { textGenerationModel } from "../lib/model-selection";
import { canFetchOpenCode } from "../lib/opencode-runtime-query";
import { projectForSession } from "../lib/view-models";
import { modelCatalogQueryOptions } from "./use-model-catalog";
import { useProjectCatalog } from "./use-session-catalog";

export type TextGenerationTarget = Pick<PalotSession, "model" | "projectID"> & {
  location: LocationRef;
};

/**
 * Resolves the model task-free generation should use for a task (see `textGenerationModel`).
 * Resolved on demand so the model catalog is read, or loaded, only when something is generated.
 */
export function useTextGenerationModel(
  target: TextGenerationTarget | null,
): () => Promise<ModelRef | null> {
  const store = useStore();
  const queryClient = useQueryClient();
  const projects = useProjectCatalog();
  return useCallback(async () => {
    if (!target) return null;
    if (target.model) return target.model;
    const runtime = store.get(runtimeAtom);
    const project = projectForSession(projects, target);
    const projectDefault =
      store.get(defaultModelsAtom)[
        modelProjectPreferenceKey(
          runtime?.profileID ?? "disconnected",
          project?.id ?? target.projectID,
        )
      ];
    const options = modelCatalogQueryOptions(
      runtime?.connectionID ?? "disconnected",
      target.location,
    );
    // OpenCode applies the configured default model a moment after it starts, and the catalog
    // is cached until a model event. A cached catalog without a default is read again.
    const cached = queryClient.getQueryData(options.queryKey);
    const catalog = canFetchOpenCode(runtime)
      ? await queryClient
          .fetchQuery({ ...options, staleTime: cached?.defaultModel ? options.staleTime : 0 })
          .catch(() => null)
      : null;
    return textGenerationModel({ sessionModel: null, projectDefault, catalog });
  }, [projects, queryClient, store, target]);
}
