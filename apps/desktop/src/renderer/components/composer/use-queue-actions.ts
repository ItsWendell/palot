import { useMemo } from "react";
import type { PalotMessage } from "../../../shared";
import type { ComposerDelivery } from "../../atoms/ui";
import { browserCommentsFromMessage, retainedComposerFiles } from "../../lib/browser-comments";
import { useTaskTitleLookup } from "../../hooks/use-session-catalog";
import { composerDraftWithRetainedFiles } from "../../lib/composer-restoration";
import { reviewCommentsFromMessage } from "../../lib/review-comments";
import type { PendingRequestView } from "../../lib/view-models";
import { palot } from "../../services/palot";
import { toast } from "../ui/toast";
import type { BlockedSteer } from "./use-blocked-steer";
import type { ComposerDraftState } from "./use-composer-draft";
import type { ComposerErrors } from "./use-composer-errors";
import type { ComposerFocus } from "./use-composer-focus";
import type { ComposerLive } from "./use-latest";

/**
 * Actions on the pending-message stack: edit (cancel into the composer), delete with undo, and
 * watching a message steered from the stack for blocking work.
 */
export function useQueueActions({
  sessionID,
  messages,
  live,
  contents,
  errors,
  focus,
  blockedSteer,
  canWatchSteer,
}: {
  sessionID: string;
  messages: PalotMessage[];
  live: ComposerLive;
  contents: ComposerDraftState;
  errors: ComposerErrors;
  focus: ComposerFocus;
  blockedSteer: BlockedSteer;
  /** A running turn in an existing root task, where a steer can wait behind subagent work. */
  canWatchSteer: boolean;
}) {
  const { store, stateAtom, setState, scope: draftScope } = contents;
  const taskTitle = useTaskTitleLookup();
  const filesByID = useMemo(
    () =>
      new Map(
        messages
          .filter((message) => message.type === "user")
          .map((message) => [message.id, message.files]),
      ),
    [messages],
  );

  function userMessage(id: string): PalotMessage | undefined {
    return live.current.messages.find(
      (candidate) => candidate.id === id && candidate.type === "user",
    );
  }

  /** Puts an already-canceled input back in the composer; resubmitting adds it to the end. */
  function openEdit(message: PalotMessage, delivery: ComposerDelivery) {
    const draft = composerDraftWithRetainedFiles(message, taskTitle);
    setState((current) => ({
      ...current,
      edit: {
        id: message.id,
        delivery,
        draft,
        files: retainedComposerFiles(message),
        comments: reviewCommentsFromMessage(message) ?? [],
        browserComments: browserCommentsFromMessage(message),
      },
    }));
    if (focus.isActive(draftScope)) {
      errors.clear();
      contents.setSelection({ start: draft.text.length, end: draft.text.length });
      focus.focus();
    }
  }

  async function edit(request: PendingRequestView) {
    const current = store.get(stateAtom);
    if (current.edit || current.cancelingID || current.sending) return;
    const message = userMessage(request.id);
    if (!message) throw new Error("The pending message is no longer available.");
    setState((value) => ({ ...value, cancelingID: request.id }));
    try {
      await palot.updatePending({ sessionID, inputID: request.id, action: "cancel" });
      openEdit(message, request.delivery ?? "queue");
    } finally {
      setState((value) => ({ ...value, cancelingID: null }));
    }
  }

  async function remove(request: PendingRequestView) {
    const message = userMessage(request.id);
    await palot.updatePending({ sessionID, inputID: request.id, action: "cancel" });
    if (!message) return;
    const delivery = request.delivery ?? "queue";
    // Re-admitting could wake a paused queue, so Undo returns the message to the composer.
    toast.add({
      type: "success",
      title: "Pending message deleted",
      actionProps: {
        children: "Undo",
        onClick: () => {
          const current = store.get(stateAtom);
          if (current.edit || current.cancelingID || current.sending) {
            toast.add({
              type: "error",
              title: "Could not restore the message",
              description: "Finish editing the other pending message first.",
            });
            return;
          }
          openEdit(message, delivery);
        },
      },
    });
  }

  return {
    /** Attachments of each pending message, for the stack's rows. */
    filesByID,
    edit,
    remove,
    /** Leaves the edit; the draft that was there before it comes back. */
    discardEdit() {
      if (!contents.edit) return;
      setState((current) => ({ ...current, edit: null }));
      errors.clear();
      focus.focus();
    },
    /** A queued input steered from the stack can be blocked by foreground work like a typed steer. */
    steered(request: PendingRequestView) {
      if (canWatchSteer) blockedSteer.track(request.id, Date.now());
    },
  };
}

export type QueueActions = ReturnType<typeof useQueueActions>;
