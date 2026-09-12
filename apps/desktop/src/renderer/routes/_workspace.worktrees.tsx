import { createFileRoute } from "@tanstack/react-router";
import { WorktreesPage } from "../components/worktrees/worktrees-page";
import { validateProjectSearch } from "../lib/route-search";

export const Route = createFileRoute("/_workspace/worktrees")({
  validateSearch: validateProjectSearch,
  component: WorktreesPage,
});
