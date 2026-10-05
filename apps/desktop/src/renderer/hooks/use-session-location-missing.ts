import { isLocationNotFoundError } from "@opencode/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import type { OpenCodeRuntimeStatus, PalotProject, PalotSession } from "../../shared";
import { openCodeKeys } from "../lib/opencode-query";
import { openCodeClient } from "../services/opencode-client";
import { mapSession } from "../services/opencode-mappers";
import { createWorktree } from "../services/opencode-worktrees";
import { palot } from "../services/palot";

export function isMissingSessionLocation(
  error: unknown,
  directory: string,
  healthy: boolean,
): boolean {
  return healthy && isLocationNotFoundError(error) && error.location?.directory === directory;
}

export interface SessionLocationMissingOptions {
  session: PalotSession;
  project: PalotProject | null;
  /** The session's owner, not an arbitrary focused runtime. */
  owner: OpenCodeRuntimeStatus | null;
  /** Optional typed error from a failed composer operation. */
  error?: unknown;
  enabled?: boolean;
  onRecovered?(session: PalotSession): void;
}

export function useSessionLocationMissing(options: SessionLocationMissingOptions) {
  const { session, project, owner, error, onRecovered } = options;
  const connectionID = owner?.connectionID ?? "disconnected";
  const directory = session.location.directory;
  const healthy = Boolean(
    options.enabled !== false &&
    owner?.connected &&
    owner.phase === "connected" &&
    connectionID !== "preview",
  );
  const identity = JSON.stringify([connectionID, owner?.profileID, session.id, directory]);
  const latest = useRef({ identity, healthy, onRecovered });
  latest.current = { identity, healthy, onRecovered };
  const queryClient = useQueryClient();
  const location = useQuery({
    queryKey: [...openCodeKeys.all(connectionID), "session-location-check", session.id, directory],
    queryFn: ({ signal }) =>
      openCodeClient(connectionID).location.get({ location: { directory } }, { signal }),
    enabled: healthy,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const [state, setState] = useState<{
    identity: string;
    pending: boolean;
    error: string | null;
    recovered: boolean;
  } | null>(null);
  const current = state?.identity === identity ? state : null;
  const missing =
    !current?.recovered &&
    (isMissingSessionLocation(location.error, directory, healthy) ||
      isMissingSessionLocation(error, directory, healthy));
  const inventory = useQuery({
    queryKey: [
      ...openCodeKeys.all(connectionID),
      "session-recovery-directories",
      project?.id,
      project?.canonical,
    ],
    queryFn: ({ signal }) =>
      palot.listProjectDirectories(project!.id, project!.canonical, signal, connectionID),
    enabled: Boolean(missing && project),
    retry: false,
    refetchOnWindowFocus: false,
  });
  const pending = useRef<AbortController | null>(null);
  const cancel = useCallback(() => {
    pending.current?.abort();
    pending.current = null;
    setState(null);
  }, []);
  useEffect(() => {
    // Changing task, directory, owner, or health invalidates every pending result.
    return () => {
      pending.current?.abort();
      pending.current = null;
    };
  }, [identity, healthy]);

  const recover = useCallback(
    async (selection: { type: "existing"; directory: string } | { type: "create" }) => {
      if (!missing || !healthy || !owner || pending.current) return;
      const controller = new AbortController();
      pending.current = controller;
      setState({ identity, pending: true, error: null, recovered: false });
      const assertCurrent = () => {
        controller.signal.throwIfAborted();
        if (latest.current.identity !== identity || !latest.current.healthy)
          throw new Error("The task's connection changed. Try again on its owning server.");
      };
      try {
        assertCurrent();
        const client = openCodeClient(connectionID);
        let target: string;
        if (selection.type === "create") {
          if (!project?.canonical || project.canonical === directory)
            throw new Error(
              "The project's saved checkout is unavailable. Choose an existing directory.",
            );
          if (owner.capabilities?.worktreeCreate === false)
            throw new Error("Creating worktrees is unavailable on this connection.");
          // Never discover or create from the deleted session directory.
          target = (
            await createWorktree(
              project.id,
              undefined,
              controller.signal,
              connectionID,
              project.canonical,
            )
          ).directory;
        } else {
          target = selection.directory.trim();
          if (!target || target === directory)
            throw new Error("Choose another existing directory.");
        }
        assertCurrent();
        await client.location.get(
          { location: { directory: target } },
          { signal: controller.signal },
        );
        assertCurrent();
        await client.session.move(
          { sessionID: session.id, directory: target },
          { signal: controller.signal },
        );
        assertCurrent();
        const moved = mapSession(
          await client.session.get({ sessionID: session.id }, { signal: controller.signal }),
        );
        assertCurrent();
        setState({ identity, pending: false, error: null, recovered: true });
        latest.current.onRecovered?.(moved);
        await queryClient.invalidateQueries({ queryKey: openCodeKeys.all(connectionID) });
      } catch (cause) {
        if (
          !controller.signal.aborted &&
          latest.current.identity === identity &&
          latest.current.healthy
        ) {
          setState({
            identity,
            pending: false,
            error:
              cause instanceof Error
                ? cause.message
                : typeof cause === "object" && cause && "message" in cause
                  ? String(cause.message)
                  : "Could not recover this workspace.",
            recovered: false,
          });
        }
      } finally {
        if (pending.current === controller) pending.current = null;
      }
    },
    [connectionID, directory, healthy, identity, missing, owner, project, queryClient, session.id],
  );

  return {
    missing,
    pending: Boolean(current?.pending && healthy && pending.current),
    error: current?.error ?? null,
    directories: (inventory.data ?? []).filter((entry) => entry.directory !== directory),
    directoriesError: inventory.error,
    loadingDirectories: inventory.isFetching,
    canCreate: Boolean(
      project?.canonical &&
      project.canonical !== directory &&
      owner?.capabilities?.worktreeCreate !== false,
    ),
    recover,
    cancel,
  };
}
