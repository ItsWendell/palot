import { Outlet, createFileRoute } from "@tanstack/react-router";
import { Workspace } from "../components/workspace";

export const Route = createFileRoute("/_workspace")({
  component: WorkspaceLayout,
});

function WorkspaceLayout() {
  return <Workspace content={<Outlet />} />;
}
