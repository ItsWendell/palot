import { queryOptions, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { openCodeKeys } from "../lib/opencode-query";
import { openCodeClient } from "../services/opencode-client";
import { openCodeRequestSignal } from "../services/opencode-request";

/** Refresh cadence for the loaded-location list; eviction, live work and connects refresh it early. */
export const LOADED_LOCATIONS_REFRESH_MS = 60_000;

/** The server's booted directories. A global route: listing them boots nothing. */
export function loadedLocationsQueryOptions(connectionID: string, enabled: boolean) {
  return queryOptions({
    queryKey: openCodeKeys.loadedLocations(connectionID),
    queryFn: async ({ signal }): Promise<readonly string[]> =>
      (
        await openCodeClient(connectionID).debug.location.list({
          signal: openCodeRequestSignal(signal),
        })
      ).map((location) => location.directory),
    enabled,
    staleTime: 30_000,
    refetchInterval: LOADED_LOCATIONS_REFRESH_MS,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
  });
}

/**
 * Directories the server has loaded, or undefined until the first list arrives. Any
 * location-scoped request boots its directory (MCP servers and all), so background reads
 * for directories the user is not looking at should wait until this includes them.
 */
export function useLoadedLocations(
  connectionID: string,
  enabled: boolean,
): ReadonlySet<string> | undefined {
  const { data } = useQuery(loadedLocationsQueryOptions(connectionID, enabled));
  return useMemo(() => (data ? new Set(data) : undefined), [data]);
}
