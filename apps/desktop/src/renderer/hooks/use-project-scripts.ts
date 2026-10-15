import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useEffectEvent } from "react";
import type {
  PalotProjectScriptsApi,
  ProjectScriptDraft,
  ProjectScriptRun,
  ProjectScriptsState,
  ProjectScriptsTarget,
} from "../../shared/project-scripts-contract";

function bridge(): PalotProjectScriptsApi {
  const api = typeof window === "undefined" ? undefined : window.palot?.projectScripts;
  if (!api) throw new Error("Project scripts are only available in the Palot desktop app.");
  return api;
}

export const projectScriptsKey = (target: ProjectScriptsTarget) =>
  ["project-scripts", target.profileID, target.projectID] as const;

/** Scripts for one project on one connection profile, and whether this connection can run them. */
export function useProjectScripts(target: ProjectScriptsTarget | null) {
  return useQuery({
    queryKey: projectScriptsKey(target ?? { profileID: "", projectID: "" }),
    queryFn: () => bridge().load(target!),
    enabled: target !== null,
  });
}

export function useSaveProjectScript(target: ProjectScriptsTarget) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (script: ProjectScriptDraft) => bridge().save({ ...target, script }),
    onSuccess: (state: ProjectScriptsState) =>
      client.setQueryData(projectScriptsKey(target), state),
  });
}

export function useRemoveProjectScript(target: ProjectScriptsTarget) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (scriptID: string) => bridge().remove({ ...target, scriptID }),
    onSuccess: (state: ProjectScriptsState) =>
      client.setQueryData(projectScriptsKey(target), state),
  });
}

export function useProjectScriptRuns(listener: (run: ProjectScriptRun) => void) {
  const onRun = useEffectEvent(listener);
  useEffect(() => {
    const api = typeof window === "undefined" ? undefined : window.palot?.projectScripts;
    return api ? api.onRunFinished((run) => onRun(run)) : undefined;
  }, []);
}
