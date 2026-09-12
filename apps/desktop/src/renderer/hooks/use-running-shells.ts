import type { LocationRef } from "@opencode/client";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import { useMemo } from "react";
import type { PalotRunningShell } from "../../shared";
import { runtimeAtom } from "../atoms/workspace";
import { openCodeKeys } from "../lib/opencode-query";
import { palot } from "../services/palot";

export function runningShellsQueryOptions(
  connectionID: string,
  location: LocationRef,
  enabled: boolean,
) {
  return queryOptions({
    queryKey: openCodeKeys.runningShells(connectionID, location),
    queryFn: async ({ signal }): Promise<PalotRunningShell[]> =>
      palot.listRunningShells(location, signal),
    enabled,
    staleTime: 0,
    refetchOnMount: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
    notifyOnChangeProps: ["data"],
    refetchInterval: false,
    structuralSharing: (previous, next) =>
      reuseRunningShells(previous as PalotRunningShell[] | undefined, next as PalotRunningShell[]),
  });
}

export function useRunningShells(
  location: LocationRef,
  {
    enabled,
    sessionIDs,
  }: { enabled: boolean; shouldPoll: boolean; sessionIDs: ReadonlySet<string> },
) {
  const runtime = useAtomValue(runtimeAtom);
  const connectionID = runtime?.connectionID ?? "disconnected";
  const select = useMemo(
    () => (shells: PalotRunningShell[]) =>
      shells.filter((shell) => shell.sessionID !== null && sessionIDs.has(shell.sessionID)),
    [sessionIDs],
  );
  return useQuery({
    ...runningShellsQueryOptions(
      connectionID,
      location,
      Boolean(enabled && runtime?.connected && runtime.connectionID !== "preview"),
    ),
    select,
  });
}

export function reuseRunningShells(
  previous: PalotRunningShell[] | undefined,
  next: PalotRunningShell[],
): PalotRunningShell[] {
  if (
    previous?.length === next.length &&
    next.every(
      (shell, index) =>
        previous[index]?.id === shell.id &&
        previous[index]?.sessionID === shell.sessionID &&
        previous[index]?.command === shell.command &&
        previous[index]?.cwd === shell.cwd &&
        previous[index]?.startedAt === shell.startedAt &&
        previous[index]?.status === shell.status &&
        previous[index]?.exit === shell.exit,
    )
  ) {
    return previous;
  }
  return next;
}
