import { createFileRoute } from "@tanstack/react-router";
import { UsagePage } from "../components/usage/usage-page";
import { validateUsageSearch } from "../lib/route-search";

export const Route = createFileRoute("/_workspace/usage")({
  validateSearch: validateUsageSearch,
  component: UsagePage,
});
