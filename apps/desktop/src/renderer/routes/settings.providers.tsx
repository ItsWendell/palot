import { createFileRoute } from "@tanstack/react-router";

export interface ProvidersRouteSearch {
  /** Open this integration's connect dialog (`#/settings/providers?connect=claude-agent`). */
  connect?: string;
}

function validateProvidersSearch(search: Record<string, unknown>): ProvidersRouteSearch {
  const connect = search.connect;
  return typeof connect === "string" && connect.length > 0 && connect.length <= 256
    ? { connect }
    : {};
}

export const Route = createFileRoute("/settings/providers")({
  validateSearch: validateProvidersSearch,
});
