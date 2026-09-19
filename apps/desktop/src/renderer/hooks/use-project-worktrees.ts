import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import { useEffect } from "react";
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
    // Events re-read saved inventory; discovery is a separate operation.
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
  const queryClient = useQueryClient();
  const connectionID = runtime?.connectionID ?? "disconnected";
  const available = Boolean(project && enabled && canFetchOpenCode(runtime));
  const discovery = useQuery({
    // Keep discovery outside the worktrees key: worktree.updated must only reload inventory.
    queryKey: [...openCodeKeys.all(connectionID), "worktree-discovery", resolved.id],
    queryFn: async ({ signal }) => {
      await palot.refreshProjectCopies(resolved.id, resolved.canonical, signal, connectionID);
      return true;
    },
    enabled: available,
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnMount: "always",
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  });
  useEffect(() => {
    if (!discovery.dataUpdatedAt) return;
    void queryClient.invalidateQueries({
      queryKey: openCodeKeys.worktrees(connectionID, resolved.id),
    });
  }, [connectionID, discovery.dataUpdatedAt, queryClient, resolved.id]);
  const inventory = useQuery(projectWorktreesQueryOptions(connectionID, resolved, available));
  return {
    ...inventory,
    error: discovery.error ?? inventory.error,
    isFetching: discovery.isFetching || inventory.isFetching,
    // Context menus open lazily with enabled=false; their explicit refresh is also
    // a discovery boundary, unlike server-driven inventory invalidations.
    refetch: async (options?: Parameters<typeof inventory.refetch>[0]) => {
      const refreshed = await discovery.refetch(options);
      const listed = await inventory.refetch(options);
      return { ...listed, error: refreshed.error ?? listed.error };
    },
  };
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
      return palot.removeProjectCopy(
        project.id,
        project.canonical,
        directory,
        force,
        runtime?.connectionID,
      );
    },
    onSuccess: async () => {
      if (!project) return;
      await queryClient.invalidateQueries({
        queryKey: openCodeKeys.worktrees(runtime?.connectionID ?? "disconnected", project.id),
      });
    },
  });
}
