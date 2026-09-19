import type { WorktreeInfo } from "@opencode/client";
import type { PalotProjectDirectory } from "../../shared";
import { openCodeClient } from "./opencode-client";
import { openCodeRequestSignal } from "./opencode-request";

export async function refreshWorktrees(
  projectID: string,
  requestSignal?: AbortSignal,
  connectionID?: string,
): Promise<void> {
  await openCodeClient(connectionID).worktree.refresh(
    { projectID },
    { signal: openCodeRequestSignal(requestSignal) },
  );
}

export async function listWorktrees(
  projectID: string,
  requestSignal?: AbortSignal,
  connectionID?: string,
): Promise<PalotProjectDirectory[]> {
  return (
    await openCodeClient(connectionID).worktree.list(
      { projectID },
      { signal: openCodeRequestSignal(requestSignal) },
    )
  ).map((item) => ({
    directory: item.directory,
    strategy: item.strategy ?? null,
  }));
}

export async function createWorktree(
  projectID: string,
  branch?: string,
  requestSignal?: AbortSignal,
  connectionID?: string,
  sourceDirectory?: string,
): Promise<WorktreeInfo> {
  const client = openCodeClient(connectionID);
  // A directory can discover a project that was not in the cached project inventory.
  const resolvedProjectID = sourceDirectory
    ? (
        await client.location.get(
          { location: { directory: sourceDirectory } },
          { signal: openCodeRequestSignal(requestSignal) },
        )
      ).project.id
    : projectID;
  const worktree = await client.worktree.create(
    {
      projectID: resolvedProjectID,
      ...(sourceDirectory ? { from: sourceDirectory } : {}),
      ...(branch ? { branch } : {}),
    },
    // Creation runs the project's setup command before responding (often dependency installs).
    { signal: openCodeRequestSignal(requestSignal, 10 * 60_000) },
  );
  await client.location.get(
    { location: { directory: worktree.directory } },
    { signal: openCodeRequestSignal(requestSignal) },
  );
  return worktree;
}

export async function removeWorktree(
  projectID: string,
  directory: string,
  force = false,
  connectionID?: string,
): Promise<void> {
  await openCodeClient(connectionID).worktree.remove(
    { projectID, directory, force },
    { signal: openCodeRequestSignal() },
  );
}

export function worktreeRemovalRequiresForce(error: unknown, depth = 0): boolean {
  if (!error || typeof error !== "object" || depth > 5) return false;
  if ("forceRequired" in error && error.forceRequired === true) return true;
  if ("data" in error && worktreeRemovalRequiresForce(error.data, depth + 1)) return true;
  return "cause" in error && worktreeRemovalRequiresForce(error.cause, depth + 1);
}
