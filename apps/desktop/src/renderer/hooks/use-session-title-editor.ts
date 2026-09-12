import { useQueryClient } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import { useRef, useState } from "react";
import type { PalotSession } from "../../shared";
import { runtimeAtom } from "../atoms/workspace";
import { patchSession } from "../lib/session-catalog-query";
import { palot } from "../services/palot";
import { toast } from "../components/ui/toast";

export function useSessionTitleEditor(session: PalotSession) {
  const runtime = useAtomValue(runtimeAtom);
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(session.title ?? "");
  const suppressBlur = useRef(false);

  function start() {
    suppressBlur.current = false;
    setDraft(session.title ?? "");
    setEditing(true);
  }

  function cancel() {
    suppressBlur.current = true;
    setEditing(false);
  }

  async function commit() {
    if (suppressBlur.current) {
      suppressBlur.current = false;
      return;
    }

    const title = draft.trim();
    const previousTitle = session.title;
    setEditing(false);
    if (!title) {
      toast.add({ type: "warning", title: "Task title cannot be empty" });
      return;
    }
    if (title === previousTitle) return;

    if (runtime?.connectionID) {
      patchSession(queryClient, runtime.connectionID, session.id, (item) => ({ ...item, title }));
    }
    try {
      await palot.renameSession(session.id, title);
    } catch (error) {
      if (runtime?.connectionID) {
        patchSession(queryClient, runtime.connectionID, session.id, (item) =>
          item.title === title
            ? { ...item, ...(previousTitle ? { title: previousTitle } : { title: undefined }) }
            : item,
        );
      }
      toast.add({
        type: "error",
        title: "Could not rename task",
        description: error instanceof Error ? error.message : "OpenCode rejected the new title.",
      });
    }
  }

  return {
    editing,
    draft: editing ? draft : (session.title ?? ""),
    setDraft,
    start,
    cancel,
    commit,
  };
}
