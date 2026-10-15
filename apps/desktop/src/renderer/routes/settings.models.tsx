import { createFileRoute } from "@tanstack/react-router";

export interface ModelsRouteSearch {
  /** Expand and scroll to this provider's models (a provider or integration ID). */
  provider?: string;
}

function validateModelsSearch(search: Record<string, unknown>): ModelsRouteSearch {
  const provider = search.provider;
  return typeof provider === "string" && provider.length > 0 && provider.length <= 256
    ? { provider }
    : {};
}

export const Route = createFileRoute("/settings/models")({
  validateSearch: validateModelsSearch,
});
