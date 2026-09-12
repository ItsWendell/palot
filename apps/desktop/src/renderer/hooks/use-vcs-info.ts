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
  type OpenCodeVcsInfo,
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

function vcsQueryOptions(
  connectionID: string,
  location: LocationRef,
  enabled: boolean,
  ownerConnectionID?: string,
) {
  return queryOptions({
    queryKey: vcsQueryKey(connectionID, location),
    queryFn: ({ signal }) => getOpenCodeVcsInfo(location, signal, ownerConnectionID),
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
    queryFn: ({ signal }) => listOpenCodeVcsBranches(resolvedLocation, search, signal),
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
    queryFn: ({ signal }) => getOpenCodeVcsBase(location, signal),
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

export function useVcsInfoMap(locations: LocationRef[]): ReadonlyMap<string, OpenCodeVcsInfo> {
  const runtime = useAtomValue(runtimeAtom);
  const connectionID = runtime?.connectionID ?? "disconnected";
  const enabled = Boolean(runtime?.connected && runtime.connectionID !== "preview");
  const values = useQueries({
    queries: locations.map((location) => ({
      ...vcsQueryOptions(connectionID, location, enabled),
      notifyOnChangeProps: ["data"] as const,
    })),
    combine: (results) => results.map((result) => result.data),
  });
  return useMemo(() => {
    const byLocation = new Map<string, OpenCodeVcsInfo>();
    values.forEach((value, index) => {
      const location = locations[index];
      if (location && value) byLocation.set(vcsLocationKey(location), value);
    });
    return byLocation;
  }, [locations, values]);
}

export interface OwnedVcsLocation {
  connectionID: string;
  location: LocationRef;
}

export function ownedVcsLocationKey({ connectionID, location }: OwnedVcsLocation): string {
  return JSON.stringify(vcsQueryKey(connectionID, location));
}

/** Only pass mounted/visible card locations. No discovery or polling is performed. */
export function useOwnedVcsInfoMap(
  locations: readonly OwnedVcsLocation[],
): ReadonlyMap<string, OpenCodeVcsInfo> {
  const unique = useMemo(
    () => [...new Map(locations.map((owner) => [ownedVcsLocationKey(owner), owner])).values()],
    [locations],
  );
  const values = useQueries({
    queries: unique.map(({ connectionID, location }) => ({
      ...vcsQueryOptions(
        connectionID,
        location,
        Boolean(
          location.directory &&
          connectionID &&
          connectionID !== "preview" &&
          connectionID !== "disconnected",
        ),
        connectionID,
      ),
      notifyOnChangeProps: ["data"] as const,
    })),
    combine: (results) => results.map((result) => result.data),
  });
  return useMemo(() => {
    const byOwner = new Map<string, OpenCodeVcsInfo>();
    values.forEach((value, index) => {
      const owner = unique[index];
      if (owner && value) byOwner.set(ownedVcsLocationKey(owner), value);
    });
    return byOwner;
  }, [unique, values]);
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
      queryFn: ({ signal }: { signal: AbortSignal }) => getOpenCodeVcsStatus(location, signal),
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
