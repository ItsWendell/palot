import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useAtomValue, useStore } from "jotai";
import { useEffect } from "react";
import {
  newTaskDestinationAtom,
  newTaskProjectIDAtom,
  phaseAtom,
  selectedSessionIDAtom,
} from "../atoms/workspace";
import { disabledProfileIDsAtom } from "../atoms/connections";
import { connectionOverview } from "../lib/connection-overview";
import { resolveNewTaskDestination } from "../lib/new-task-destination";
import { showErrorToast } from "../lib/toast-error";
import { useSessionCatalog } from "../hooks/use-session-catalog";

export const Route = createFileRoute("/_workspace/")({
  component: WorkspaceIndex,
});

function WorkspaceIndex() {
  const navigate = useNavigate();
  const store = useStore();
  const queryClient = useQueryClient();
  const phase = useAtomValue(phaseAtom);
  const sessions = useSessionCatalog();
  const projectID = useAtomValue(newTaskProjectIDAtom);
  const selectedSessionID = useAtomValue(selectedSessionIDAtom);

  useEffect(() => {
    if (phase !== "ready") return;
    let cancelled = false;
    const openDraft = async () => {
      const overview = connectionOverview(queryClient);
      if (overview.getSnapshot().length === 0) await overview.refreshRegistry();
      if (cancelled) return;
      await navigate({
        to: "/new",
        search: resolveNewTaskDestination({
          remembered: store.get(newTaskDestinationAtom),
          profiles: overview.getSnapshot().map((entry) => entry.profile),
          disabledProfileIDs: store.get(disabledProfileIDsAtom),
        }),
        replace: true,
      });
    };
    if (projectID) {
      void openDraft().catch((error) => showErrorToast("Could not open new task", error));
      return () => {
        cancelled = true;
      };
    }
    const roots = sessions.filter((session) => !session.parentID);
    const sessionID =
      selectedSessionID && sessions.some((session) => session.id === selectedSessionID)
        ? selectedSessionID
        : roots[0]?.id;
    if (!sessionID) {
      void openDraft().catch((error) => showErrorToast("Could not open new task", error));
      return () => {
        cancelled = true;
      };
    }
    void navigate({
      to: "/sessions/$sessionID",
      params: { sessionID },
      search: {},
      replace: true,
    });
  }, [navigate, phase, projectID, queryClient, selectedSessionID, sessions, store]);

  // Do not expose a draft on the focused (possibly remote) server before the
  // remembered/local destination has been resolved and its route committed.
  return (
    <main
      className="palot-main-surface h-full min-h-0 bg-background"
      aria-label="Loading task destination"
      aria-busy="true"
    />
  );
}
