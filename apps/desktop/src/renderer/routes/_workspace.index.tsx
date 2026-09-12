import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useAtomValue } from "jotai";
import { useEffect } from "react";
import { newTaskProjectIDAtom, phaseAtom, selectedSessionIDAtom } from "../atoms/workspace";
import { NewTask } from "../components/new-task";
import { useSessionCatalog } from "../hooks/use-session-catalog";

export const Route = createFileRoute("/_workspace/")({
  component: WorkspaceIndex,
});

function WorkspaceIndex() {
  const navigate = useNavigate();
  const phase = useAtomValue(phaseAtom);
  const sessions = useSessionCatalog();
  const projectID = useAtomValue(newTaskProjectIDAtom);
  const selectedSessionID = useAtomValue(selectedSessionIDAtom);

  useEffect(() => {
    if (phase !== "ready") return;
    if (projectID) {
      void navigate({ to: "/new", search: { projectID }, replace: true });
      return;
    }
    const roots = sessions.filter((session) => !session.parentID);
    const sessionID =
      selectedSessionID && sessions.some((session) => session.id === selectedSessionID)
        ? selectedSessionID
        : roots[0]?.id;
    if (!sessionID) {
      void navigate({ to: "/new", search: {}, replace: true });
      return;
    }
    void navigate({
      to: "/sessions/$sessionID",
      params: { sessionID },
      search: {},
      replace: true,
    });
  }, [navigate, phase, projectID, selectedSessionID, sessions]);

  return <NewTask />;
}
