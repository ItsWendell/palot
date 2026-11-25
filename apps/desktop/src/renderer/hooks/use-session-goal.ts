import type { LocationRef } from "@opencode/client";
import { hashKey, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import { useEffect } from "react";
import { runtimeAtom } from "../atoms/workspace";
import { openCodeKeys } from "../lib/opencode-query";
import { canFetchOpenCode } from "../lib/opencode-runtime-query";
import {
  GOAL_RPC_ID,
  goalChangedEvent,
  parseSessionGoal,
  type SessionGoal,
} from "../lib/session-goal";
import { openCodeClient } from "../services/opencode-client";
import { palot } from "../services/palot";

export const sessionGoalKey = (connectionID: string, sessionID: string) =>
  [...openCodeKeys.all(connectionID), "session-goal", sessionID] as const;

/** How long a `/goal` sent before the task's goal has loaded waits for it. */
export const GOAL_SETTLE_TIMEOUT_MS = 2_000;

/**
 * The task's goal as its query last read it, for a decision that must not act on a goal that
 * has not loaded yet. A first read still in flight returns a promise that settles with it, or
 * with `undefined` after `timeoutMs`; `undefined` also means the read failed or never runs
 * (no goals on this server), so the caller keeps what it knew.
 */
export function settledSessionGoal(
  queryClient: QueryClient,
  connectionID: string,
  sessionID: string,
  timeoutMs = GOAL_SETTLE_TIMEOUT_MS,
): SessionGoal | null | undefined | Promise<SessionGoal | null | undefined> {
  const cache = queryClient.getQueryCache();
  const queryKey = sessionGoalKey(connectionID, sessionID);
  const read = (): { goal: SessionGoal | null | undefined } | null => {
    const query = cache.find<SessionGoal | null>({ queryKey, exact: true });
    if (!query || query.state.status === "error") return { goal: undefined };
    if (query.state.status === "success") return { goal: query.state.data ?? null };
    // Pending: wait only for a read that is running or about to run.
    return query.isDisabled() && query.state.fetchStatus === "idle" ? { goal: undefined } : null;
  };
  const now = read();
  if (now) return now.goal;
  return new Promise((resolve) => {
    const finish = (goal: SessionGoal | null | undefined) => {
      clearTimeout(timer);
      unsubscribe();
      resolve(goal);
    };
    const hash = hashKey(queryKey);
    const timer = setTimeout(() => finish(undefined), timeoutMs);
    const unsubscribe = cache.subscribe((event) => {
      if (event.query.queryHash !== hash) return;
      const settled = read();
      if (settled) finish(settled.goal);
    });
  });
}

/** OpenCode added the built-in `/goal` plugin in 2.2.1; older servers have no goal RPC. */
function supportsGoals(version: string | null | undefined): boolean {
  const match = version?.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return true;
  const [major, minor, patch] = match.slice(1).map(Number) as [number, number, number];
  return major > 2 || (major === 2 && (minor > 2 || (minor === 2 && patch >= 1)));
}

/**
 * The task's `/goal`, read through the plugin's RPC and kept current from its `changed`
 * event. Null when there is none, the server predates goals, or the read fails: a missing
 * goal indicator is the safe fallback, so errors never surface here.
 */
export function useSessionGoal(
  sessionID: string,
  location: LocationRef,
  options: { enabled?: boolean } = {},
): SessionGoal | null {
  const runtime = useAtomValue(runtimeAtom);
  const queryClient = useQueryClient();
  const connectionID = runtime?.connectionID;
  const enabled =
    (options.enabled ?? true) &&
    Boolean(connectionID) &&
    canFetchOpenCode(runtime) &&
    supportsGoals(runtime?.version);
  const key = sessionGoalKey(connectionID ?? "disconnected", sessionID);
  const directory = location.directory;

  const query = useQuery({
    queryKey: key,
    enabled,
    retry: false,
    staleTime: Infinity,
    queryFn: async ({ signal }) => {
      try {
        const result = await openCodeClient(connectionID!).rpc.call(
          { rpcID: GOAL_RPC_ID, method: "get", location: { directory }, input: { sessionID } },
          { signal },
        );
        return parseSessionGoal(result.output);
      } catch {
        return null;
      }
    },
  });

  useEffect(() => {
    if (!enabled || !connectionID) return;
    return palot.subscribe((batch) => {
      if (batch.connectionID !== connectionID) return;
      for (const event of batch.events) {
        // A new stream may have missed changes: read again.
        if (event.type === "server.connected") {
          void queryClient.invalidateQueries({ queryKey: key });
          continue;
        }
        const changed = goalChangedEvent(event);
        if (changed?.sessionID === sessionID) queryClient.setQueryData(key, changed.goal);
      }
    });
    // `key` is derived from connectionID and sessionID.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, connectionID, sessionID, queryClient]);

  return enabled ? (query.data ?? null) : null;
}
