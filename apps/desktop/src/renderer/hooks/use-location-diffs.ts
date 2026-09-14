import type { LocationRef } from "@opencode/client";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import { runtimeAtom } from "../atoms/workspace";
import { openCodeKeys } from "../lib/opencode-query";
import { palot } from "../services/palot";
import type { WorkbenchReviewMode } from "../lib/workbench-tabs";
import { useReviewBase } from "./use-vcs-info";

export function locationDiffsQueryOptions(
  connectionID: string,
  location: LocationRef,
  mode: WorkbenchReviewMode = "working",
  context: number | null = 3,
  base?: string | null,
) {
  return queryOptions({
    queryKey: [
      ...openCodeKeys.locationDiffs(connectionID, location, mode),
      context,
      ...(mode === "branch" ? [base ?? null] : []),
    ],
    queryFn: ({ signal }) =>
      palot.listDiffs(
        {
          directory: location.directory,
          ...(location.workspaceID ? { workspaceID: location.workspaceID } : {}),
          mode,
          ...(mode === "branch" && base ? { base } : {}),
          ...(context !== null ? { context } : {}),
        },
        signal,
        connectionID,
      ),
    staleTime: 0,
    refetchOnMount: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  });
}

export function useLocationDiffs(
  location: LocationRef,
  enabled = true,
  mode: WorkbenchReviewMode = "working",
  context: number | null = 3,
) {
  const runtime = useAtomValue(runtimeAtom);
  const reviewBase = useReviewBase(location, enabled && mode === "branch");
  const query = useQuery({
    ...locationDiffsQueryOptions(
      runtime?.connectionID ?? "disconnected",
      location,
      mode,
      context,
      reviewBase.ref,
    ),
    enabled: Boolean(
      runtime?.connected && enabled && location.directory && (mode !== "branch" || reviewBase.ref),
    ),
  });
  return { ...query, reviewBase };
}
