import { Outlet, createFileRoute, useRouterState } from "@tanstack/react-router";
import { Workspace } from "../components/workspace";
import { E2ERenderFailure, RenderErrorBoundary } from "../components/render-error-boundary";

export const Route = createFileRoute("/_workspace")({
  component: WorkspaceLayout,
});

function WorkspaceLayout() {
  const path = useRouterState({ select: (state) => state.location.pathname });
  return (
    <Workspace
      content={
        <RenderErrorBoundary key={path}>
          <E2ERenderFailure />
          <Outlet />
        </RenderErrorBoundary>
      }
    />
  );
}
