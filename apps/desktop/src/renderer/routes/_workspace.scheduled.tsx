import { createFileRoute } from "@tanstack/react-router";
import { ScheduledPage } from "../components/scheduled/scheduled-page";
import { validateAutomationSearch } from "../lib/route-search";

export const Route = createFileRoute("/_workspace/scheduled")({
  validateSearch: validateAutomationSearch,
  component: ScheduledPage,
});
