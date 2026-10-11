import { createFileRoute } from "@tanstack/react-router";
import { validatePullRequestsSearch } from "../components/pull-requests/pull-request-ref";
import { PullRequestsPage } from "../components/pull-requests/pull-requests-page";

export const Route = createFileRoute("/_workspace/pull-requests")({
  validateSearch: validatePullRequestsSearch,
  component: PullRequestsPage,
});
