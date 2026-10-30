import { createContext, useContext, useState, type ReactNode } from "react";
import { useAtomValue, useStore } from "jotai";
import { Pencil } from "lucide-react";
import type { PalotMessage, PalotSession } from "../../../shared";
import { runtimeAtom, selectedSessionIDAtom } from "../../atoms/workspace";
import { composerStateAtomFamily } from "../../atoms/composer-state";
import { composerDraftAtomFamily } from "../../atoms/ui";
import { composerScope } from "../../lib/composer-scope";
import { composerDraftFromMessage } from "../../lib/composer-restoration";
import { retainedComposerFiles, browserCommentsFromMessage } from "../../lib/browser-comments";
import { reviewCommentsFromMessage } from "../../lib/review-comments";
import { showErrorToast } from "../../lib/toast-error";
import { useCacheSession } from "../../hooks/use-session-catalog";
import { palot } from "../../services/palot";
import { Button } from "../ui/button";

const EditContext = createContext<{
  disabled: boolean;
  edit(message: PalotMessage): Promise<void>;
} | null>(null);

export function EditFromHereProvider({
  session,
  running,
  children,
}: {
  session: PalotSession;
  running: boolean;
  children: ReactNode;
}) {
  const runtime = useAtomValue(runtimeAtom);
  const cache = useCacheSession(runtime);
  const store = useStore();
  const [pending, setPending] = useState(false);
  const scope = composerScope(runtime?.profileID ?? "", `session:${session.id}`);
  const stateAtom = composerStateAtomFamily(scope);
  const composer = useAtomValue(stateAtom);
  const disabled = running || pending || composer.sending || !runtime?.connected;
  const edit = async (message: PalotMessage) => {
    if (disabled || store.get(stateAtom).sending) return;
    if (
      !window.confirm(
        "Edit from here? This rewinds files and hides this message and everything after it. Sending the edited message discards that later history and replaces your composer draft. You can restore the history before sending.",
      )
    )
      return;
    setPending(true);
    store.set(stateAtom, (current) => ({ ...current, sending: true }));
    try {
      const updated = await palot.stageSessionRevert(
        { sessionID: session.id, messageID: message.id, files: true },
        runtime.connectionID,
      );
      if (!updated) throw new Error("The task could not be rewound");
      cache(updated);
      const data = message.data;
      store.set(
        composerDraftAtomFamily(scope),
        composerDraftFromMessage({
          ...message,
          files: [],
          data:
            data && typeof data === "object" && !Array.isArray(data)
              ? { ...data, files: [] }
              : null,
        }),
      );
      store.set(stateAtom, (current) => ({
        ...current,
        edit: null,
        files: retainedComposerFiles(message),
        comments: reviewCommentsFromMessage(message) ?? [],
        browserComments: browserCommentsFromMessage(message),
      }));
      if (
        store.get(selectedSessionIDAtom) === session.id &&
        store.get(runtimeAtom)?.connectionID === runtime.connectionID
      )
        document.querySelector<HTMLElement>("[data-palot-composer-input]")?.focus();
    } catch (error) {
      showErrorToast("Could not edit from here", error);
    } finally {
      store.set(stateAtom, (current) => ({ ...current, sending: false }));
      setPending(false);
    }
  };
  return <EditContext.Provider value={{ disabled, edit }}>{children}</EditContext.Provider>;
}

export function EditFromHereButton({ message }: { message: PalotMessage }) {
  const context = useContext(EditContext);
  if (!context) return null;
  return (
    <Button
      size="xs"
      variant="ghost"
      // Hidden until the message is hovered or focused. Button's own `disabled:opacity-50` would
      // otherwise show it on every message while the task runs; then it shows dimmed on hover.
      className="self-end opacity-0 group-hover/message:opacity-100 group-focus-within/message:opacity-100 disabled:opacity-0 group-hover/message:disabled:opacity-50 group-focus-within/message:disabled:opacity-50"
      disabled={context.disabled}
      title={
        context.disabled ? "Available when the task is idle" : "Rewind files and edit this message"
      }
      onClick={() => void context.edit(message)}
    >
      <Pencil aria-hidden="true" />
      Edit from here
    </Button>
  );
}
