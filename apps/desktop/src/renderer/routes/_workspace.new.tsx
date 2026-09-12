import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useStore } from "jotai";
import { useEffect } from "react";
import { newTaskProjectIDAtom, selectedSessionIDAtom } from "../atoms/workspace";
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

  useEffect(() => {
    store.set(selectedSessionIDAtom, null);
    store.set(newTaskProjectIDAtom, search.projectID ?? null);
  }, [search.projectID, store]);

  return (
    <NewTask
      projectID={search.projectID}
      onProjectChange={(projectID) =>
        void navigate({
          to: "/new",
          search: { projectID: projectID || undefined, profileID: search.profileID },
          replace: true,
        })
      }
      onSessionCreated={(sessionID) =>
        void navigate({
          to: "/sessions/$sessionID",
          params: { sessionID },
          search: { profileID: search.profileID },
          replace: true,
        })
      }
    />
  );
}
