import { keepPreviousData, queryOptions, useQuery } from "@tanstack/react-query";
import type { SessionStatsInput } from "@opencode/client";
import { useAtomValue } from "jotai";
import { runtimeAtom } from "../atoms/workspace";
import { openCodeKeys } from "../lib/opencode-query";
import { canFetchOpenCode } from "../lib/opencode-runtime-query";
import { palot } from "../services/palot";

export const SESSION_STATS_STALE_TIME = 15 * 60_000;
export const SESSION_STATS_GC_TIME = 24 * 60 * 60_000;

export interface SessionStatsQueryInput extends SessionStatsInput {
  from: number;
  to: number;
  timezone: string;
  tools: "none" | "summary" | "detail";
}

export function sessionStatsQueryOptions(
  connectionID: string,
  input: SessionStatsQueryInput,
  enabled = true,
) {
  return queryOptions({
    queryKey: openCodeKeys.sessionStats(connectionID, input),
    queryFn: ({ signal }) => palot.sessionStats(input, signal),
    enabled,
    staleTime: SESSION_STATS_STALE_TIME,
    gcTime: SESSION_STATS_GC_TIME,
    refetchOnMount: true,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchInterval: false,
    retry: false,
    placeholderData: keepPreviousData,
  });
}

export function useSessionStats(input: SessionStatsQueryInput, enabled = true) {
  const runtime = useAtomValue(runtimeAtom);
  return useQuery(
    sessionStatsQueryOptions(
      runtime?.connectionID ?? "disconnected",
      input,
      enabled && canFetchOpenCode(runtime),
    ),
  );
}
