import { isForbiddenError } from "@opencode/client";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import { useCallback, useMemo } from "react";
import type { OpenCodeRuntimeStatus, PalotProject, PalotSession } from "../../shared";
import { isMissingOpenCodeRoute } from "../../shared/opencode-missing-route";
import { runtimeAtom } from "../atoms/workspace";
import type { ConnectionOverview } from "../lib/connection-overview";
import {
  mergeOpenCodeAutomations,
  type OpenCodeAutomation,
  type OpenCodeAutomationEntry,
  type OpenCodeAutomationListResult,
} from "../lib/opencode-automations";
import { openCodeKeys } from "../lib/opencode-query";
import { canFetchOpenCode } from "../lib/opencode-runtime-query";
import { openCodeClient } from "../services/opencode-client";
import { useConnectionOverview } from "./use-connection-overview";
import { useProjectCatalog, useSessionCatalog } from "./use-session-catalog";

/** Slow enough to stay quiet; React Query pauses it while the window is hidden. */
export const OPENCODE_AUTOMATION_REFRESH_MS = 60_000;

const automationKeys = {
  all: (connectionID: string) => [...openCodeKeys.all(connectionID), "automations"] as const,
  list: (connectionID: string, directory: string) =>
    [...automationKeys.all(connectionID), directory] as const,
};

interface ListTarget {
  profileID: string;
  connectionID: string;
  serverName: string;
  directory: string;
}

/** One list call per project directory on every connected server, without repeats. */
export function openCodeAutomationTargets(
  focused: OpenCodeRuntimeStatus | null,
  focusedProjects: readonly PalotProject[],
  connections: readonly ConnectionOverview[],
): ListTarget[] {
  const targets = new Map<string, ListTarget>();
  const add = (
    runtime: OpenCodeRuntimeStatus,
    serverName: string,
    projects: readonly PalotProject[],
  ) => {
    for (const project of projects) {
      if (!project.canonical) continue;
      const key = `${runtime.connectionID}\n${project.canonical}`;
      if (!targets.has(key))
        targets.set(key, {
          profileID: runtime.profileID,
          connectionID: runtime.connectionID,
          serverName,
          directory: project.canonical,
        });
    }
  };
  const focusedName =
    connections.find((entry) => entry.profile.id === focused?.profileID)?.profile.name ??
    "OpenCode";
  if (focused && canFetchOpenCode(focused)) add(focused, focusedName, focusedProjects);
  for (const entry of connections) {
    if (!entry.runtime || entry.phase !== "ready" || !canFetchOpenCode(entry.runtime)) continue;
    add(entry.runtime, entry.profile.name, entry.projects);
  }
  return [...targets.values()];
}

type ListData = readonly OpenCodeAutomation[] | "unavailable";

/**
 * OpenCode's own automations for every project Palot knows, across connected servers.
 * A server that has automations turned off, or predates them, reports "unavailable" and
 * contributes nothing; the Scheduled page hides the section when no rows remain.
 */
export function useOpenCodeAutomations() {
  const queryClient = useQueryClient();
  const runtime = useAtomValue(runtimeAtom);
  const focusedProjects = useProjectCatalog();
  const focusedSessions = useSessionCatalog();
  const { connections } = useConnectionOverview();
  const targets = useMemo(
    () => openCodeAutomationTargets(runtime, focusedProjects, connections),
    [runtime, focusedProjects, connections],
  );
  const { entries, failedServers } = useQueries({
    queries: targets.map((target) => ({
      queryKey: automationKeys.list(target.connectionID, target.directory),
      queryFn: async ({ signal }: { signal: AbortSignal }): Promise<ListData> => {
        try {
          const automations = await openCodeClient(
            target.connectionID,
          ).experimental.automation.list({ directory: target.directory }, { signal });
          return automations as readonly OpenCodeAutomation[];
        } catch (error) {
          if (isForbiddenError(error) || isMissingOpenCodeRoute(error)) return "unavailable";
          throw error;
        }
      },
      staleTime: 5_000,
      refetchInterval: OPENCODE_AUTOMATION_REFRESH_MS,
      refetchOnWindowFocus: true,
      retry: false,
    })),
    combine: (results) => {
      const lists: OpenCodeAutomationListResult[] = [];
      const failed = new Set<string>();
      results.forEach((result, index) => {
        const target = targets[index];
        if (!target) return;
        if (result.isError) failed.add(target.serverName);
        if (!Array.isArray(result.data)) return;
        lists.push({ ...target, automations: result.data });
      });
      return { entries: mergeOpenCodeAutomations(lists), failedServers: [...failed] };
    },
  });

  const sessionTitles = useMemo(() => {
    const titles = new Map<string, string>();
    const add = (profileID: string, sessions: readonly PalotSession[]) => {
      for (const session of sessions)
        if (session.title) titles.set(`${profileID}:${session.id}`, session.title);
    };
    for (const entry of connections) add(entry.profile.id, entry.sessions);
    if (runtime) add(runtime.profileID, focusedSessions);
    return titles;
  }, [connections, focusedSessions, runtime]);
  const taskTitle = useCallback(
    (profileID: string, sessionID: string) => sessionTitles.get(`${profileID}:${sessionID}`),
    [sessionTitles],
  );

  const act = useCallback(
    async (entry: OpenCodeAutomationEntry, type: "pause" | "resume" | "delete") => {
      const client = openCodeClient(entry.connectionID);
      const input = { automationID: entry.automation.id };
      if (type === "pause") await client.experimental.automation.pause(input);
      else if (type === "resume") await client.experimental.automation.resume(input);
      else await client.experimental.automation.delete(input);
      await queryClient.invalidateQueries({ queryKey: automationKeys.all(entry.connectionID) });
    },
    [queryClient],
  );

  return { entries, failedServers, multipleServers: hasSeveralServers(entries), taskTitle, act };
}

function hasSeveralServers(entries: readonly OpenCodeAutomationEntry[]): boolean {
  return new Set(entries.map((entry) => entry.profileID)).size > 1;
}
