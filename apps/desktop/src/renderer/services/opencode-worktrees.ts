import type { WorktreeInfo } from "@opencode/client";
import type { PalotProjectDirectory } from "../../shared";
import { openCodeClient } from "./opencode-client";
import { openCodeRequestSignal } from "./opencode-request";

export async function refreshWorktrees(
  sourceDirectory: string,
  requestSignal?: AbortSignal,
): Promise<void> {
  await openCodeClient().worktree.refresh(
    { location: { directory: sourceDirectory } },
    { signal: openCodeRequestSignal(requestSignal) },
  );
}

export async function listWorktrees(
  sourceDirectory: string,
  requestSignal?: AbortSignal,
  connectionID?: string,
): Promise<PalotProjectDirectory[]> {
  return (
    await openCodeClient(connectionID).worktree.list(
      { location: { directory: sourceDirectory } },
      { signal: openCodeRequestSignal(requestSignal) },
    )
  ).map((item) => ({
    directory: item.directory,
    strategy: item.strategy ?? null,
  }));
}

export async function createWorktree(
  sourceDirectory: string,
  branch?: string,
  requestSignal?: AbortSignal,
  connectionID?: string,
): Promise<WorktreeInfo> {
  const client = openCodeClient(connectionID);
  const worktree = await client.worktree.create(
    { location: { directory: sourceDirectory }, ...(branch ? { branch } : {}) },
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
  sourceDirectory: string,
  directory: string,
  force = false,
): Promise<void> {
  await openCodeClient().worktree.remove(
    { location: { directory: sourceDirectory }, directory, force },
    { signal: openCodeRequestSignal() },
  );
}

export function worktreeRemovalRequiresForce(error: unknown, depth = 0): boolean {
  if (!error || typeof error !== "object" || depth > 5) return false;
  if ("forceRequired" in error && error.forceRequired === true) return true;
  if ("data" in error && worktreeRemovalRequiresForce(error.data, depth + 1)) return true;
  return "cause" in error && worktreeRemovalRequiresForce(error.cause, depth + 1);
}
