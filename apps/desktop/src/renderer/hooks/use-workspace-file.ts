import type { LocationRef } from "@opencode/client";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import { runtimeAtom } from "../atoms/workspace";
import { openCodeKeys } from "../lib/opencode-query";
import { canFetchOpenCode } from "../lib/opencode-runtime-query";
import { palot } from "../services/palot";

export function workspaceFileQueryOptions(
  connectionID: string,
  location: LocationRef,
  path: string,
) {
  return queryOptions({
    queryKey: openCodeKeys.file(connectionID, location, path),
    queryFn: ({ signal }) => palot.readWorkspaceFile({ ...location, path }, signal, connectionID),
    enabled: Boolean(location.directory && path),
    staleTime: 0,
    refetchOnMount: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
    retry: false,
    // A refresh that read the same bytes keeps the cached array, so previews built from it
    // (a PDF on page 5, a document's scroll position) don't reload.
    structuralSharing: (previous: unknown, next: unknown) =>
      previous instanceof Uint8Array && next instanceof Uint8Array && sameBytes(previous, next)
        ? previous
        : next,
  });
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index++) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

export function useWorkspaceFile(location: LocationRef, path: string, enabled = true) {
  const runtime = useAtomValue(runtimeAtom);
  return useQuery({
    ...workspaceFileQueryOptions(runtime?.connectionID ?? "disconnected", location, path),
    enabled: enabled && canFetchOpenCode(runtime) && Boolean(location.directory && path),
  });
}
