import type { LocationRef } from "@opencode/client";
import { useQueries } from "@tanstack/react-query";
import { useMemo, useSyncExternalStore } from "react";
import {
  branchMemoryVersion,
  rememberedBranch,
  subscribeBranchMemory,
  type RememberedBranch,
} from "../lib/branch-memory";
import { inboxBranchKeys } from "../lib/opencode-query";
import { openCodeProfileID } from "../services/opencode-client";
import { getOpenCodeVcsInfo, type OpenCodeVcsInfo } from "../services/opencode-vcs";
import { loadedLocationsQueryOptions } from "./use-loaded-locations";

export interface InboxBranchOwner {
  connectionID: string;
  location: LocationRef;
}

export interface InboxBranch {
  vcs: OpenCodeVcsInfo;
  /** Set when the directory is not loaded and the label is the last branch Palot saw there. */
  lastSeen?: RememberedBranch;
}

export function inboxBranchOwnerKey({ connectionID, location }: InboxBranchOwner): string {
  return JSON.stringify(inboxBranchKeys.location(connectionID, location));
}

function connectable(connectionID: string): boolean {
  return Boolean(connectionID && connectionID !== "preview" && connectionID !== "disconnected");
}

// Stable per remembered entry, so rows only re-render when their own branch changes.
const branches = new WeakMap<RememberedBranch, { live?: InboxBranch; lastSeen?: InboxBranch }>();
function inboxBranch(entry: RememberedBranch, live: boolean): InboxBranch {
  const cached = branches.get(entry) ?? {};
  branches.set(entry, cached);
  const vcs = cached.live?.vcs ??
    cached.lastSeen?.vcs ?? { currentBranch: entry.branch, defaultBranch: null };
  if (live) return (cached.live ??= { vcs });
  return (cached.lastSeen ??= { vcs, lastSeen: entry });
}

/**
 * Branch labels for Inbox rows without booting their directories. Rows read `vcs.get` only for
 * directories the server has loaded; others show the last branch Palot saw there (any
 * `vcs.get` or `vcs.branch.updated` refreshes it), or nothing, so the row falls back to the
 * folder name. Connection-wide refreshes never re-read these rows.
 */
export function useInboxBranches(
  owners: readonly InboxBranchOwner[],
): ReadonlyMap<string, InboxBranch> {
  const unique = useMemo(
    () => [
      ...new Map(
        owners
          .filter((owner) => owner.location.directory && connectable(owner.connectionID))
          .map((owner) => [inboxBranchOwnerKey(owner), owner]),
      ).values(),
    ],
    [owners],
  );
  const connectionIDs = useMemo(
    () => [...new Set(unique.map((owner) => owner.connectionID))],
    [unique],
  );
  const loaded = useQueries({
    queries: connectionIDs.map((connectionID) => loadedLocationsQueryOptions(connectionID, true)),
    combine: (results) => results.map((result) => result.data),
  });
  const loadedByConnection = useMemo(
    () =>
      new Map(
        connectionIDs.map((connectionID, index) => [connectionID, new Set(loaded[index] ?? [])]),
      ),
    [connectionIDs, loaded],
  );
  const isLoaded = (owner: InboxBranchOwner) =>
    loadedByConnection.get(owner.connectionID)?.has(owner.location.directory) ?? false;
  useQueries({
    queries: unique.filter(isLoaded).map((owner) => ({
      queryKey: inboxBranchKeys.location(owner.connectionID, owner.location),
      // The read records the branch; rows render from that memory.
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        getOpenCodeVcsInfo(owner.location, signal, owner.connectionID),
      staleTime: Infinity,
      retry: false,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      notifyOnChangeProps: [] as const,
    })),
  });
  const memory = useSyncExternalStore(subscribeBranchMemory, branchMemoryVersion);
  return useMemo(() => {
    void memory;
    const byOwner = new Map<string, InboxBranch>();
    for (const owner of unique) {
      const profileID = openCodeProfileID(owner.connectionID);
      const entry = profileID ? rememberedBranch(profileID, owner.location.directory) : undefined;
      if (!entry) continue;
      byOwner.set(
        inboxBranchOwnerKey(owner),
        inboxBranch(
          entry,
          loadedByConnection.get(owner.connectionID)?.has(owner.location.directory) ?? false,
        ),
      );
    }
    return byOwner;
  }, [loadedByConnection, memory, unique]);
}
