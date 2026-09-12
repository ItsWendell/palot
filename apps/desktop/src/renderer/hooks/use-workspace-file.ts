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
    queryFn: ({ signal }) => palot.readWorkspaceFile({ ...location, path }, signal),
    enabled: Boolean(location.directory && path),
    staleTime: 0,
    refetchOnMount: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
    retry: false,
  });
}

export function useWorkspaceFile(location: LocationRef, path: string) {
  const runtime = useAtomValue(runtimeAtom);
  return useQuery({
    ...workspaceFileQueryOptions(runtime?.connectionID ?? "disconnected", location, path),
    enabled: canFetchOpenCode(runtime) && Boolean(location.directory && path),
  });
}
