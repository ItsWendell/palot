import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useAtomValue } from "jotai";
import { useEffect } from "react";
import { runtimeAtom } from "../atoms/workspace";
import { useWorkbenchCommands } from "../atoms/workbench";
import { useCatalogSession } from "../hooks/use-session-catalog";
import { validateChangesSearch } from "../lib/route-search";

export const Route = createFileRoute("/_workspace/sessions/$sessionID/changes")({
  validateSearch: validateChangesSearch,
  component: ChangesRouteBridge,
});

function ChangesRouteBridge() {
  const { sessionID } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate();
  const runtime = useAtomValue(runtimeAtom);
  const session = useCatalogSession(sessionID);
  const scope = runtime ? { profileID: runtime.profileID, sessionID } : null;
  const commands = useWorkbenchCommands(scope);

  useEffect(() => {
    if (!session || !runtime) return;
    if (search.file) {
      commands.openTab({
        kind: "file-diff",
        location: session.location,
        path: search.file,
        mode: search.mode ?? "working",
        sourceSessionID: sessionID,
      });
    } else {
      commands.openTab({
        kind: "changes",
        location: session.location,
        mode: search.mode ?? "working",
        sourceSessionID: sessionID,
      });
    }
    void navigate({
      to: "/sessions/$sessionID",
      params: { sessionID },
      search: {},
      replace: true,
    });
  }, [commands, navigate, runtime, search.file, search.mode, session, sessionID]);

  return null;
}
