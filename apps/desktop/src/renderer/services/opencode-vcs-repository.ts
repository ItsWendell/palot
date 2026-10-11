import type { LocationRef } from "@opencode/client";
import { openCodeClient } from "./opencode-client";
import { openCodeRequestSignal } from "./opencode-request";

function vcsLocation(location: LocationRef) {
  return {
    directory: location.directory,
    ...(location.workspaceID ? { workspace: location.workspaceID } : {}),
  };
}

/** The location's version-control provider, or null when OpenCode finds none. */
export async function getOpenCodeVcsProvider(
  location: LocationRef,
  requestSignal?: AbortSignal,
  connectionID?: string,
): Promise<string | null> {
  const response = await openCodeClient(connectionID).vcs.get(
    { location: vcsLocation(location) },
    { signal: openCodeRequestSignal(requestSignal) },
  );
  return response.data.provider ?? null;
}

/** Creates a Git repository for the location's project directory through OpenCode. */
export async function initializeOpenCodeGit(
  location: LocationRef,
  connectionID?: string,
): Promise<void> {
  await openCodeClient(connectionID).vcs.init(
    { location: vcsLocation(location), provider: "git" },
    { signal: openCodeRequestSignal(undefined, 60_000) },
  );
}
