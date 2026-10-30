import { queryOptions, useQuery } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import { isMissingOpenCodeRoute } from "../../shared/opencode-missing-route";
import { runtimeAtom } from "../atoms/workspace";
import { openCodeKeys } from "../lib/opencode-query";
import { canFetchOpenCode } from "../lib/opencode-runtime-query";
import { supportsUsageLimits, usageLimitsRouteKnown } from "../lib/usage-limits";
import { openCodeClient } from "../services/opencode-client";

export const USAGE_LIMITS_STALE_TIME = 5 * 60_000;

export function usageLimitsQueryOptions(
  connectionID: string,
  directory: string,
  enabled = true,
  /** The server is known to have the route; then a non-JSON reply is an error, not an old server. */
  routeKnown = false,
) {
  return queryOptions({
    queryKey: openCodeKeys.usageLimits(connectionID, directory),
    queryFn: async ({ signal }) => {
      try {
        const result = await openCodeClient(connectionID).experimental.usage.limits(
          { location: { directory } },
          { signal },
        );
        return result.data;
      } catch (error) {
        if (!routeKnown && isMissingOpenCodeRoute(error)) return "unavailable" as const;
        throw error;
      }
    },
    enabled: enabled && Boolean(directory),
    staleTime: USAGE_LIMITS_STALE_TIME,
    refetchOnWindowFocus: (query) =>
      Date.now() - Math.max(query.state.dataUpdatedAt, query.state.errorUpdatedAt) >=
      USAGE_LIMITS_STALE_TIME,
    retry: false,
  });
}

export function useUsageLimits(directory: string) {
  const runtime = useAtomValue(runtimeAtom);
  const supported = supportsUsageLimits(runtime?.version);
  const query = useQuery(
    usageLimitsQueryOptions(
      runtime?.connectionID ?? "disconnected",
      directory,
      supported && canFetchOpenCode(runtime),
      usageLimitsRouteKnown(runtime?.version) === true,
    ),
  );
  return { ...query, unavailable: !supported || query.data === "unavailable" };
}
