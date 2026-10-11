import type { LocationRef } from "@opencode/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import { runtimeAtom } from "../atoms/workspace";
import { openCodeKeys } from "../lib/opencode-query";
import { getOpenCodeVcsProvider, initializeOpenCodeGit } from "../services/opencode-vcs-repository";

export function vcsProviderQueryKey(connectionID: string, location: LocationRef) {
  return [...openCodeKeys.vcsLocation(connectionID, location), "provider"] as const;
}

/**
 * Whether the location has version control. Callers enable it only where the answer
 * changes what they show, such as an empty Changes tab.
 */
export function useVcsProvider(location: LocationRef, enabled: boolean) {
  const runtime = useAtomValue(runtimeAtom);
  const connectionID = runtime?.connectionID ?? "disconnected";
  return useQuery({
    queryKey: vcsProviderQueryKey(connectionID, location),
    queryFn: ({ signal }) => getOpenCodeVcsProvider(location, signal, connectionID),
    enabled: Boolean(
      enabled && location.directory && runtime?.connected && connectionID !== "preview",
    ),
    staleTime: 5_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}

/**
 * Runs OpenCode `vcs.init` with Git for the location, then refreshes everything that
 * reads version control for that connection: VCS info, status, base and branches,
 * diffs, and projects (initializing changes the project identity).
 */
export function useInitializeGit(location: LocationRef) {
  const runtime = useAtomValue(runtimeAtom);
  const queryClient = useQueryClient();
  const connectionID = runtime?.connectionID ?? "disconnected";
  return useMutation({
    mutationFn: () => initializeOpenCodeGit(location, connectionID),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: openCodeKeys.vcs(connectionID) }),
        queryClient.invalidateQueries({
          queryKey: openCodeKeys.diffsLocation(connectionID, location),
        }),
        queryClient.invalidateQueries({ queryKey: openCodeKeys.projects(connectionID) }),
      ]),
  });
}
