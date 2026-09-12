import { queryOptions, useQuery } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import type { LocationRef } from "@opencode/client";
import { runtimeAtom } from "../atoms/workspace";
import { openCodeKeys } from "../lib/opencode-query";
import { canFetchOpenCode } from "../lib/opencode-runtime-query";
import { palot } from "../services/palot";

export function composerCatalogQueryOptions(
  connectionID: string,
  location: LocationRef,
  enabled = true,
) {
  return queryOptions({
    queryKey: openCodeKeys.composerCatalog(connectionID, location),
    queryFn: ({ signal }) => palot.loadComposerCatalog(location, signal),
    enabled: enabled && Boolean(location.directory),
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnMount: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  });
}

export function useComposerCatalog(location: LocationRef, enabled = true) {
  const runtime = useAtomValue(runtimeAtom);
  return useQuery(
    composerCatalogQueryOptions(
      runtime?.connectionID ?? "disconnected",
      location,
      enabled && canFetchOpenCode(runtime),
    ),
  );
}

export function workspaceFileSearchQueryOptions(
  connectionID: string,
  location: LocationRef,
  query: string,
  enabled = true,
) {
  return queryOptions({
    queryKey: openCodeKeys.fileSearch(connectionID, location, query),
    queryFn: ({ signal }) => palot.findWorkspaceFiles({ ...location, query, limit: 20 }, signal),
    enabled: enabled && Boolean(location.directory),
    retry: false,
  });
}

export function useWorkspaceFileSearch(location: LocationRef, query: string, enabled = true) {
  const runtime = useAtomValue(runtimeAtom);
  return useQuery(
    workspaceFileSearchQueryOptions(
      runtime?.connectionID ?? "disconnected",
      location,
      query,
      enabled && canFetchOpenCode(runtime),
    ),
  );
}
