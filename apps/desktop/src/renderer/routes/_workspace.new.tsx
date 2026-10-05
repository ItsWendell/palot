import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useAtomValue, useStore } from "jotai";
import { useEffect } from "react";
import {
  newTaskDestinationAtom,
  newTaskProjectIDAtom,
  runtimeAtom,
  selectedSessionIDAtom,
} from "../atoms/workspace";
import { NewTask } from "../components/new-task";
import { validateProjectSearch } from "../lib/route-search";

export const Route = createFileRoute("/_workspace/new")({
  validateSearch: validateProjectSearch,
  component: NewTaskRoute,
});

function NewTaskRoute() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const store = useStore();
  const runtime = useAtomValue(runtimeAtom);

  useEffect(() => {
    if (search.profileID && search.profileID !== runtime?.profileID) return;
    store.set(selectedSessionIDAtom, null);
    store.set(newTaskProjectIDAtom, search.projectID ?? null);
    const profileID = store.get(runtimeAtom)?.profileID;
    if (profileID && (!search.profileID || profileID === search.profileID)) {
      store.set(newTaskDestinationAtom, { profileID, projectID: search.projectID ?? null });
    }
  }, [runtime?.profileID, search.profileID, search.projectID, store]);

  return (
    <NewTask
      key={search.profileID}
      profileID={search.profileID}
      projectID={search.projectID}
      onDestinationChange={({ profileID, projectID }) =>
        void navigate({
          to: "/new",
          search: { profileID, projectID: projectID ?? undefined },
          replace: true,
        })
      }
      onProjectChange={(projectID) =>
        void navigate({
          to: "/new",
          search: {
            projectID: projectID || undefined,
            profileID: search.profileID ?? store.get(runtimeAtom)?.profileID,
          },
          replace: true,
        })
      }
      onSessionCreated={(sessionID) =>
        void navigate({
          to: "/sessions/$sessionID",
          params: { sessionID },
          search: { profileID: search.profileID ?? store.get(runtimeAtom)?.profileID },
          replace: true,
        })
      }
    />
  );
}
