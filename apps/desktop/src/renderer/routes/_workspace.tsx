import { Outlet, createFileRoute, useRouterState } from "@tanstack/react-router";
import { Workspace } from "../components/workspace";
import { E2ERenderFailure, RenderErrorBoundary } from "../components/render-error-boundary";
import { useFocusRegions } from "../hooks/use-focus-regions";
import { useClearUnreadMarkOnOpen } from "../hooks/use-task-unread";

export const Route = createFileRoute("/_workspace")({
  component: WorkspaceLayout,
});

/** The task a workspace location shows, from `/sessions/<id>` and its child routes. */
function openTaskID(pathname: string): string | null {
  const id = /^\/sessions\/([^/]+)/.exec(pathname)?.[1];
  return id ? decodeURIComponent(id) : null;
}

function WorkspaceLayout() {
  const path = useRouterState({ select: (state) => state.location.pathname });
  useFocusRegions();
  useClearUnreadMarkOnOpen(openTaskID(path));
  return (
    <Workspace
      content={
        <RenderErrorBoundary resetKey={path}>
          <E2ERenderFailure />
          <Outlet />
        </RenderErrorBoundary>
      }
    />
  );
}
