import { Outlet, createFileRoute } from "@tanstack/react-router";
import { useAtomValue, useStore } from "jotai";
import { useEffect } from "react";
import { attentionTargetAtom } from "../atoms/attention";
import { newTaskProjectIDAtom, runtimeAtom, selectedSessionIDAtom } from "../atoms/workspace";
import { SessionRoutePending } from "../components/session-route-pending";
import { Thread } from "../components/thread";
import {
  cacheSession,
  sessionCatalogInfo,
  sessionQueryOptions,
} from "../lib/session-catalog-query";
import { validateSessionSearch } from "../lib/route-search";
import { useAcknowledgeSessionView } from "../hooks/use-session-info";
import { palot } from "../services/palot";
import { registerOpenCodeRuntime } from "../services/opencode-client";

export const Route = createFileRoute("/_workspace/sessions/$sessionID")({
  validateSearch: validateSessionSearch,
  preloadStaleTime: 0,
  loaderDeps: ({ search }) => ({ profileID: search.profileID }),
  loader: async ({ context, params, deps }) => {
    let runtime = context.store.get(runtimeAtom);
    if (deps.profileID && runtime?.profileID !== deps.profileID) {
      // Preloading another connection must never change focus or fall back to this server.
      runtime =
        (await window.palot?.listOpenCodeRuntimes())?.find(
          (item) => item.profileID === deps.profileID,
        ) ?? null;
      if (!runtime?.connected) return;
    }
    // Initial navigation can precede workspace connection. Let the route mount:
    // useSessionInfo will fetch once connect completes, without caching a failed
    // loader result that replaces the workspace with the router error boundary.
    if (!runtime?.connected && !palot.isPreview()) return;
    if (runtime) registerOpenCodeRuntime(runtime);
    const connectionID = runtime?.connectionID ?? "disconnected";
    if (
      sessionCatalogInfo(context.queryClient, connectionID).some(
        (session) => session.id === params.sessionID,
      )
    ) {
      return;
    }
    if (connectionID !== "disconnected" && !palot.isPreview()) {
      await context.queryClient.fetchQuery(
        sessionQueryOptions(context.queryClient, connectionID, params.sessionID),
      );
      return;
    }
    const session = await palot.getSession(params.sessionID).catch(() => null);
    if (session) cacheSession(context.queryClient, connectionID, session);
  },
  pendingComponent: SessionRoutePending,
  component: SessionRoute,
});

function SessionRoute() {
  const { sessionID } = Route.useParams();
  const search = Route.useSearch();
  const runtime = useAtomValue(runtimeAtom);
  if (search.profileID && search.profileID !== runtime?.profileID) return <SessionRoutePending />;
  return (
    <FocusedSessionRoute
      key={`${runtime?.connectionID}:${sessionID}`}
      sessionID={sessionID}
      search={search}
    />
  );
}

function FocusedSessionRoute({
  sessionID,
  search,
}: {
  sessionID: string;
  search: ReturnType<typeof Route.useSearch>;
}) {
  const store = useStore();
  useAcknowledgeSessionView(sessionID);

  useEffect(() => {
    store.set(selectedSessionIDAtom, sessionID);
    store.set(newTaskProjectIDAtom, null);
  }, [sessionID, store]);

  useEffect(() => {
    if (search.focus === "request" && search.requestID && search.requestType) {
      const current = store.get(attentionTargetAtom);
      store.set(attentionTargetAtom, {
        sessionID,
        requestID: search.requestID,
        type: search.requestType,
        ...(current?.sessionID === sessionID &&
        current.requestID === search.requestID &&
        current.message
          ? { message: current.message }
          : {}),
      });
    }
  }, [search.focus, search.requestID, search.requestType, sessionID, store]);

  return (
    <>
      <Thread sessionID={sessionID} />
      <Outlet />
    </>
  );
}
