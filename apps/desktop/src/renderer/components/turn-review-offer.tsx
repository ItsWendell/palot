import { atom, useAtom } from "jotai";
import { MessageSquareText, X } from "lucide-react";
import { memo, useState } from "react";
import { showErrorToast } from "../lib/toast-error";
import { ASK_FOR_REVIEW_PROMPT } from "../lib/turn-review-offer";
import { palot } from "../services/palot";
import { Button } from "./ui/button";

const dismissedReviewOffersAtom = atom<ReadonlySet<string>>(new Set<string>());

/**
 * The latest settled turn's follow-ups on its changed-files card: ask the agent to review its
 * own changes, or dismiss the suggestion. Dismissing hides these controls, not the card.
 */
export const TurnReviewActions = memo(function TurnReviewActions({
  connectionID,
  sessionID,
  userMessageID,
  onAsked,
}: {
  connectionID: string;
  sessionID: string;
  userMessageID: string;
  onAsked?(): void;
}) {
  const key = `${connectionID}\0${sessionID}\0${userMessageID}`;
  const [dismissed, setDismissed] = useAtom(dismissedReviewOffersAtom);
  const [asking, setAsking] = useState(false);
  if (dismissed.has(key)) return null;

  const dismiss = () => setDismissed((current) => new Set(current).add(key));

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="text-meta"
        disabled={asking}
        onClick={() => {
          setAsking(true);
          void palot
            .sendComposerPrompt({ sessionID, text: ASK_FOR_REVIEW_PROMPT, delivery: "steer" })
            .then(() => {
              dismiss();
              onAsked?.();
            })
            .catch((error) => showErrorToast("Could not ask for a review", error))
            .finally(() => setAsking(false));
        }}
      >
        <MessageSquareText data-icon="inline-start" aria-hidden="true" />
        Ask for review
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="Dismiss review suggestion"
        onClick={dismiss}
      >
        <X aria-hidden="true" />
      </Button>
    </>
  );
});
