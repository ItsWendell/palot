import { queryOptions, useQuery } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import type { LocationRef } from "@opencode/client";
import { runtimeAtom } from "../atoms/workspace";
import { openCodeKeys } from "../lib/opencode-query";
import { canFetchOpenCode } from "../lib/opencode-runtime-query";
import { palot } from "../services/palot";

export const MODEL_CATALOG_EVENTS = new Set([
  "models-dev.refreshed",
  "catalog.updated",
  "integration.updated",
]);

export function modelCatalogQueryRoot(connectionID: string) {
  return openCodeKeys.models(connectionID);
}

export function modelCatalogQueryKey(connectionID: string, location: LocationRef) {
  return openCodeKeys.modelsLocation(connectionID, location);
}

function modelCatalogQueryOptions(connectionID: string, location: LocationRef, enabled = true) {
  return queryOptions({
    queryKey: modelCatalogQueryKey(connectionID, location),
    queryFn: ({ signal }) => palot.listModels(location, signal, connectionID),
    enabled: enabled && Boolean(location.directory),
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnMount: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  });
}

export function useModelCatalog(location: LocationRef, enabled = true) {
  const runtime = useAtomValue(runtimeAtom);
  return useQuery(
    modelCatalogQueryOptions(
      runtime?.connectionID ?? "disconnected",
      location,
      enabled && canFetchOpenCode(runtime),
    ),
  );
}
