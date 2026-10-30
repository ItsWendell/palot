import { useAtomValue, useSetAtom, useStore } from "jotai";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  automaticWorktreeCleanupAtom,
  worktreeCleanupLogAtom,
} from "../atoms/worktree-preferences";
import { runtimeAtom } from "../atoms/workspace";
import { useProjectCatalog, useSessionCatalog } from "./use-session-catalog";
import { sourceControl } from "./use-source-control";
import { listWorktrees, removeWorktree } from "../services/opencode-worktrees";
import { cleanMergedWorktrees } from "../components/worktrees/worktree-cleanup";
import {
  attachedTasks,
  isWithinDirectory,
  readRetirementState,
} from "../components/worktrees/merged-worktree-retirement";

export function useWorktreeCleanup() {
  const runtime = useAtomValue(runtimeAtom);
  const projects = useProjectCatalog();
  const sessions = useSessionCatalog();
  const latest = useRef({ projects, sessions });
  latest.current = { projects, sessions };
  const store = useStore();
  const queryClient = useQueryClient();
  const log = useSetAtom(worktreeCleanupLogAtom);
  const [busy, setBusy] = useState(false);
  const run = useCallback(
    async (automatic = false) => {
      if (!runtime?.connected || runtime.capabilities?.localPathActions !== true)
        throw new Error("Cleanup requires a connected local server.");
      const { connectionID, profileID } = runtime;
      const valid = () =>
        store.get(runtimeAtom)?.connectionID === connectionID &&
        store.get(runtimeAtom)?.connected === true &&
        (!automatic || store.get(automaticWorktreeCleanupAtom));
      // One cleanup writer across all windows on this app origin. A missed automatic tick is fine.
      return navigator.locks.request(
        "palot-worktree-cleanup",
        { ifAvailable: true },
        async (lock) => {
          if (!lock) return { removed: 0, kept: 0 };
          setBusy(true);
          try {
            const links = await sourceControl.refreshPullRequests({ profileID });
            const total = { removed: 0, kept: 0 };
            for (const project of latest.current.projects) {
              if (!valid()) break;
              // Avoid Git work for projects without any merged linked tasks.
              if (
                !latest.current.sessions.some(
                  (task) =>
                    task.projectID === project.id &&
                    links.some(
                      (link) => link.sessionID === task.id && link.pullRequest.state === "merged",
                    ),
                )
              )
                continue;
              const [worktrees, main] = await Promise.all([
                listWorktrees(project.id, undefined, connectionID),
                sourceControl.gitStatus({ profileID, directory: project.canonical }),
              ]);
              const result = await cleanMergedWorktrees({
                projectID: project.id,
                canonical: main.root,
                worktrees,
                sessions: latest.current.sessions,
                links,
                valid,
                check: async (candidate) => {
                  const state = await readRetirementState({
                    directory: candidate.directory,
                    connectionID,
                    profileID,
                    pullRequest: candidate.pullRequest,
                    queryClient,
                  });
                  // Real Git roots protect aliases of the main checkout as well as normal paths.
                  if (!state.git?.root || isWithinDirectory(main.root, state.git.root))
                    throw new Error("Not an isolated worktree.");
                  return {
                    ...state,
                    attachedTasks: attachedTasks(
                      latest.current.sessions,
                      project.id,
                      candidate.directory,
                    ),
                  };
                },
                remove: (directory) => removeWorktree(project.id, directory, false, connectionID),
                cleaned: (candidate) =>
                  log((entries) =>
                    [
                      {
                        directory: candidate.directory,
                        at: Date.now(),
                        pullRequest: candidate.pullRequest.url,
                      },
                      ...entries,
                    ].slice(0, 100),
                  ),
              });
              total.removed += result.removed;
              total.kept += result.kept;
            }
            await queryClient.invalidateQueries({
              predicate: ({ queryKey }) => queryKey.includes("worktrees"),
            });
            return total;
          } finally {
            setBusy(false);
          }
        },
      );
    },
    [runtime, store, queryClient, log],
  );
  return { run, busy };
}

/** Runs while this workspace is open and local. No extra GitHub polling while disabled. */
export function useAutomaticWorktreeCleanup() {
  const enabled = useAtomValue(automaticWorktreeCleanupAtom);
  const { run } = useWorktreeCleanup();
  useEffect(() => {
    if (!enabled) return;
    const tick = () => void run(true).catch(() => undefined);
    tick();
    const timer = setInterval(tick, 60_000);
    return () => clearInterval(timer);
  }, [enabled, run]);
}
