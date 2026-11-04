import { queryOptions, useQueries, useQuery } from "@tanstack/react-query";
import { useAtom, useAtomValue } from "jotai";
import { reviewBaseChoiceAtom, reviewBaseScope } from "../atoms/review-base";
import { useMemo } from "react";
import type { LocationRef, VcsFileStatus } from "@opencode/client";
import { runtimeAtom } from "../atoms/workspace";
import { locationKey, openCodeKeys } from "../lib/opencode-query";
import {
  getOpenCodeVcsInfo,
  getOpenCodeVcsBase,
  getOpenCodeVcsStatus,
  listOpenCodeVcsBranches,
} from "../services/opencode-vcs";

export function vcsLocationKey(location: LocationRef): string {
  return locationKey(location);
}

export function vcsQueryRoot(connectionID: string) {
  return openCodeKeys.vcs(connectionID);
}

export function vcsQueryKey(connectionID: string, location: LocationRef) {
  return openCodeKeys.vcsLocation(connectionID, location);
}

function vcsQueryOptions(connectionID: string, location: LocationRef, enabled: boolean) {
  return queryOptions({
    queryKey: vcsQueryKey(connectionID, location),
    queryFn: ({ signal }) => getOpenCodeVcsInfo(location, signal, connectionID),
    enabled,
    // Branch events invalidate immediately; remounts need not re-read Git after five seconds.
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}

export function useVcsInfo(location: LocationRef | null) {
  const runtime = useAtomValue(runtimeAtom);
  const connectionID = runtime?.connectionID ?? "disconnected";
  const resolvedLocation = location ?? { directory: "" };
  return useQuery(
    vcsQueryOptions(
      connectionID,
      resolvedLocation,
      Boolean(location && runtime?.connected && runtime.connectionID !== "preview"),
    ),
  );
}

export function useVcsBranches(location: LocationRef | null, search = "") {
  const runtime = useAtomValue(runtimeAtom);
  const connectionID = runtime?.connectionID ?? "disconnected";
  const resolvedLocation = location ?? { directory: "" };
  return useQuery({
    queryKey: openCodeKeys.vcsBranchSearch(connectionID, resolvedLocation, search.trim()),
    queryFn: ({ signal }) =>
      listOpenCodeVcsBranches(resolvedLocation, search, signal, connectionID),
    enabled: Boolean(location && runtime?.connected && runtime.connectionID !== "preview"),
    staleTime: 5_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}

export function useReviewBase(location: LocationRef, enabled = true) {
  const runtime = useAtomValue(runtimeAtom);
  const connectionID = runtime?.connectionID ?? "disconnected";
  const scope = reviewBaseScope(connectionID, location);
  const [choices, setChoice] = useAtom(reviewBaseChoiceAtom);
  const manual = choices(scope);
  const inferred = useQuery({
    queryKey: openCodeKeys.vcsBase(connectionID, location),
    queryFn: ({ signal }) => getOpenCodeVcsBase(location, signal, connectionID),
    enabled: Boolean(
      enabled && location.directory && runtime?.connected && connectionID !== "preview",
    ),
    staleTime: 5_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  return {
    manual,
    ref: manual ?? inferred.data?.ref ?? null,
    inferred,
    setManual: (value: string | null) => setChoice(scope, value),
  };
}

export function useVcsStatusMap(
  locations: LocationRef[],
  requested = true,
): ReadonlyMap<string, VcsFileStatus[]> {
  const runtime = useAtomValue(runtimeAtom);
  const connectionID = runtime?.connectionID ?? "disconnected";
  const enabled = Boolean(requested && runtime?.connected && runtime.connectionID !== "preview");
  const values = useQueries({
    queries: locations.map((location) => ({
      queryKey: openCodeKeys.vcsStatus(connectionID, location),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        getOpenCodeVcsStatus(location, signal, connectionID),
      enabled,
      staleTime: 5_000,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    })),
    combine: (results) => results.map((result) => result.data),
  });
  return useMemo(() => {
    const byLocation = new Map<string, VcsFileStatus[]>();
    values.forEach((value, index) => {
      const location = locations[index];
      if (location && value) byLocation.set(vcsLocationKey(location), value);
    });
    return byLocation;
  }, [locations, values]);
}
