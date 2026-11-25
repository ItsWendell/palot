import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { SessionInfo } from "@opencode/client";
import { useAtomValue } from "jotai";
import { useEffect } from "react";
import type { PalotEvent } from "../../../shared";
import { runtimeAtom } from "../../atoms/workspace";
import { openCodeReconciler } from "../../lib/open-code-reconciler";
import { openCodeKeys } from "../../lib/opencode-query";
import { canFetchOpenCode } from "../../lib/opencode-runtime-query";
import {
  mostExpensiveTasks,
  rollUpTasks,
  usageSession,
  type UsageSession,
} from "../../lib/usage-analytics";
import { getSessionInfo } from "../../services/opencode-catalog";
import { openCodeClient } from "../../services/opencode-client";
import { openCodeRequestSignal } from "../../services/opencode-request";

/** Sessions per `session.list` page. */
export const USAGE_TASK_PAGE_SIZE = 100;
/** Stops paging here; the section says the list is partial. */
export const USAGE_TASK_MAX_SESSIONS = 2_000;
export const USAGE_TASK_LIMIT = 10;

export interface UsageTasksInput {
  from: number;
  project: string | null;
}

export interface UsageTasksData {
  sessions: UsageSession[];
  /** Paging stopped at `USAGE_TASK_MAX_SESSIONS` before reaching the start of the range. */
  truncated: boolean;
}

export const usageTaskKeys = {
  root: (connectionID: string) => [...openCodeKeys.all(connectionID), "usage-tasks"] as const,
  list: (connectionID: string, input: UsageTasksInput) =>
    [...usageTaskKeys.root(connectionID), input.from, input.project ?? ""] as const,
};

/**
 * Every session (subagents included) active since `from`, newest first. `session.list` orders by
 * `time.updated`, so paging stops at the first older session. Session records carry lifetime
 * `cost`/`tokens`; no messages are read. Roots of the costliest tasks that were last active
 * before the range are fetched one by one so their rows have a title and the root's own cost.
 */
export async function loadUsageSessions(
  connectionID: string,
  input: UsageTasksInput,
  signal?: AbortSignal,
): Promise<UsageTasksData> {
  const client = openCodeClient(connectionID);
  const sessions: UsageSession[] = [];
  const cursors = new Set<string>();
  let cursor: string | undefined;
  let truncated = false;
  paging: while (true) {
    const response = await client.session.list(
      {
        limit: USAGE_TASK_PAGE_SIZE,
        ...(input.project ? { project: input.project } : {}),
        ...(cursor ? { cursor } : { order: "desc" as const }),
      },
      { signal: openCodeRequestSignal(signal) },
    );
    for (const session of response.data) {
      if (session.time.updated < input.from) break paging;
      sessions.push(usageSession(session));
    }
    const next = response.cursor.next;
    if (!next || cursors.has(next) || response.data.length === 0) break;
    if (sessions.length >= USAGE_TASK_MAX_SESSIONS) {
      truncated = true;
      break;
    }
    cursors.add(next);
    cursor = next;
  }
  const missing = mostExpensiveTasks(rollUpTasks(sessions), USAGE_TASK_LIMIT).filter(
    (task) => task.rootMissing,
  );
  const roots = await Promise.all(
    missing.map((task) => getSessionInfo(task.id, signal, connectionID).catch(() => null)),
  );
  for (const root of roots) if (root) sessions.push(usageSession(root));
  return { sessions, truncated };
}

/**
 * Keeps loaded task lists current from `session.usage.updated`: the reconciler has already applied
 * the event, so its session record is read when it knows the session (new sessions join the list
 * that way), else the event's own totals patch a known row.
 */
export function applyUsageTaskEvents(
  queryClient: QueryClient,
  connectionID: string,
  events: readonly PalotEvent[],
  lookup: (sessionID: string) => SessionInfo | null,
): void {
  const updates = new Map<string, { cost: number; tokens: UsageSession["tokens"]; at: number }>();
  for (const event of events) {
    if (event.type !== "session.usage.updated") continue;
    updates.set(event.data.sessionID, {
      cost: event.data.cost,
      tokens: event.data.tokens,
      at: event.createdAt,
    });
  }
  if (!updates.size) return;
  for (const [key, data] of queryClient.getQueriesData<UsageTasksData>({
    queryKey: usageTaskKeys.root(connectionID),
  })) {
    if (!data) continue;
    const from = Number(key[3]);
    const project = typeof key[4] === "string" && key[4] ? key[4] : null;
    const pending = new Map(updates);
    let changed = false;
    const sessions = data.sessions.map((session) => {
      const update = pending.get(session.id);
      if (!update) return session;
      pending.delete(session.id);
      changed = true;
      return {
        ...session,
        cost: update.cost,
        tokens: update.tokens,
        updated: Math.max(session.updated, update.at),
      };
    });
    for (const [sessionID, update] of pending) {
      const known = lookup(sessionID);
      if (!known || (project && known.projectID !== project)) continue;
      if (update.at < from) continue;
      sessions.push({
        ...usageSession(known),
        cost: update.cost,
        tokens: update.tokens,
        updated: Math.max(known.time.updated, update.at),
      });
      changed = true;
    }
    if (changed) queryClient.setQueryData<UsageTasksData>(key, { ...data, sessions });
  }
}

export function useUsageTasks(input: UsageTasksInput, enabled: boolean) {
  const runtime = useAtomValue(runtimeAtom);
  const queryClient = useQueryClient();
  const connectionID = runtime?.connectionID ?? "disconnected";
  const query = useQuery({
    queryKey: usageTaskKeys.list(connectionID, input),
    queryFn: ({ signal }) => loadUsageSessions(connectionID, input, signal),
    enabled: enabled && canFetchOpenCode(runtime),
    staleTime: 15 * 60_000,
    gcTime: 24 * 60 * 60_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
    // A new range keeps the previous list on screen until its own list loads.
    placeholderData: (previous, query) =>
      query?.queryKey[1] === connectionID ? previous : undefined,
  });
  useEffect(() => {
    if (!enabled) return;
    const reconciler = openCodeReconciler(queryClient);
    return reconciler.subscribe(({ batch }) =>
      applyUsageTaskEvents(queryClient, batch.connectionID, batch.events, (sessionID) =>
        reconciler.session(batch.connectionID, sessionID),
      ),
    );
  }, [enabled, queryClient]);
  return query;
}
