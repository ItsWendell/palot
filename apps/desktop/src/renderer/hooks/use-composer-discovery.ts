/**
 * The query options `/`, `$`, `@`, the launcher and the command palette share, so the composer's
 * idle prefetch and every reader hit one cache entry per location and query.
 */

import { queryOptions } from "@tanstack/react-query";
import type { LocationRef } from "@opencode/client";
import { openCodeKeys } from "../lib/opencode-query";
import { palot } from "../services/palot";

export function composerCatalogQueryOptions(
  connectionID: string,
  location: LocationRef,
  enabled = true,
) {
  return queryOptions({
    queryKey: openCodeKeys.composerCatalog(connectionID, location),
    queryFn: ({ signal }) => palot.loadComposerCatalog(location, signal, connectionID),
    enabled: enabled && Boolean(location.directory),
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnMount: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  });
}

/** Consuming `signal` lets React Query cancel a search once a newer query replaces it. */
export function workspaceFileSearchQueryOptions(
  connectionID: string,
  location: LocationRef,
  query: string,
  enabled = true,
) {
  return queryOptions({
    queryKey: openCodeKeys.fileSearch(connectionID, location, query),
    queryFn: ({ signal }) =>
      palot.findWorkspaceFiles({ ...location, query, limit: 20 }, signal, connectionID),
    enabled: enabled && Boolean(location.directory),
    retry: false,
  });
}
