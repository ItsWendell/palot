import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import type { OpenCodeRuntimeStatus, PalotProject } from "../../shared";
import { runtimeAtom } from "../atoms/workspace";
import { openCodeKeys } from "../lib/opencode-query";
import { canFetchOpenCode } from "../lib/opencode-runtime-query";
import { palot } from "../services/palot";

export function projectWorktreesQueryOptions(
  connectionID: string,
  project: Pick<PalotProject, "id" | "canonical">,
  enabled = true,
) {
  return queryOptions({
    queryKey: openCodeKeys.worktrees(connectionID, project.id),
    // Listing refreshes discovery on the server before returning stored directories.
    queryFn: ({ signal }) =>
      palot.listProjectDirectories(project.id, project.canonical, signal, connectionID),
    enabled,
    staleTime: Number.POSITIVE_INFINITY,
    // A creation can invalidate the list while its menu/page is closed.
    refetchOnMount: true,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  });
}

export function useProjectWorktrees(
  project: PalotProject | null | undefined,
  enabled = true,
  owner?: OpenCodeRuntimeStatus | null,
) {
  const activeRuntime = useAtomValue(runtimeAtom);
  const runtime = owner === undefined ? activeRuntime : owner;
  const resolved = project ?? { id: "", canonical: "" };
  return useQuery(
    projectWorktreesQueryOptions(
      runtime?.connectionID ?? "disconnected",
      resolved,
      Boolean(project && enabled && canFetchOpenCode(runtime)),
    ),
  );
}

export function useCreateProjectCopy(
  project: PalotProject | null | undefined,
  owner?: OpenCodeRuntimeStatus | null,
) {
  const activeRuntime = useAtomValue(runtimeAtom);
  const runtime = owner === undefined ? activeRuntime : owner;
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (sourceDirectory: string) => {
      if (!project) throw new Error("Project is unavailable");
      if (!canFetchOpenCode(runtime)) throw new Error("OpenCode is disconnected");
      if (runtime?.capabilities?.worktreeCreate === false)
        throw new Error("Creating worktrees is unavailable on this connection");
      return palot.createProjectCopy(project.id, sourceDirectory, undefined, runtime?.connectionID);
    },
    // A timed-out setup may still have registered a worktree. Reconcile before the user retries.
    onSettled: async () => {
      if (!project) return;
      await queryClient.invalidateQueries({
        queryKey: openCodeKeys.worktrees(runtime?.connectionID ?? "disconnected", project.id),
      });
    },
  });
}

export function useRemoveProjectCopy(project: PalotProject | null | undefined) {
  const runtime = useAtomValue(runtimeAtom);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ directory, force = false }: { directory: string; force?: boolean }) => {
      if (!project) throw new Error("Project is unavailable");
      if (!canFetchOpenCode(runtime)) throw new Error("OpenCode is disconnected");
      return palot.removeProjectCopy(project.id, project.canonical, directory, force);
    },
    onSuccess: async () => {
      if (!project) return;
      await queryClient.invalidateQueries({
        queryKey: openCodeKeys.worktrees(runtime?.connectionID ?? "disconnected", project.id),
      });
    },
  });
}
