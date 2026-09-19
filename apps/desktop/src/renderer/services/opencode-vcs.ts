import type { LocationRef, VcsFileStatus } from "@opencode/client";
import { openCodeClient } from "./opencode-client";
import { openCodeRequestSignal } from "./opencode-request";

export interface OpenCodeVcsInfo {
  currentBranch: string | null;
  defaultBranch: string | null;
}

export async function getOpenCodeVcsBase(
  location: LocationRef,
  requestSignal?: AbortSignal,
  connectionID?: string,
) {
  const response = await openCodeClient(connectionID).vcs.base(
    {
      location: {
        directory: location.directory,
        ...(location.workspaceID ? { workspace: location.workspaceID } : {}),
      },
    },
    { signal: openCodeRequestSignal(requestSignal) },
  );
  return response.data;
}

export async function getOpenCodeVcsInfo(
  location: LocationRef,
  requestSignal?: AbortSignal,
  connectionID?: string,
): Promise<OpenCodeVcsInfo> {
  const response = await openCodeClient(connectionID).vcs.get(
    {
      location: {
        directory: location.directory,
        ...(location.workspaceID ? { workspace: location.workspaceID } : {}),
      },
    },
    { signal: openCodeRequestSignal(requestSignal) },
  );
  return {
    currentBranch: response.data.branch.current ?? null,
    defaultBranch: response.data.branch.default ?? null,
  };
}

export async function getOpenCodeVcsStatus(
  location: LocationRef,
  requestSignal?: AbortSignal,
  connectionID?: string,
): Promise<VcsFileStatus[]> {
  const response = await openCodeClient(connectionID).vcs.status(
    {
      location: {
        directory: location.directory,
        ...(location.workspaceID ? { workspace: location.workspaceID } : {}),
      },
    },
    { signal: openCodeRequestSignal(requestSignal) },
  );
  return response.data;
}

export async function listOpenCodeVcsBranches(
  location: LocationRef,
  search = "",
  requestSignal?: AbortSignal,
  connectionID?: string,
): Promise<string[]> {
  const response = await openCodeClient(connectionID).vcs.branch.list(
    {
      location: {
        directory: location.directory,
        ...(location.workspaceID ? { workspace: location.workspaceID } : {}),
      },
      ...(search.trim() ? { search: search.trim() } : {}),
      limit: 100,
    },
    { signal: openCodeRequestSignal(requestSignal) },
  );
  return response.data;
}
