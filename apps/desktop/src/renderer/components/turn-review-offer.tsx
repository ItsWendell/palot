import { useQuery } from "@tanstack/react-query";
import { atom, useAtom } from "jotai";
import { FileDiff, MessageSquareText, X } from "lucide-react";
import { memo, useState } from "react";
import { turnDiffsQueryOptions } from "../hooks/use-turn-diffs";
import { showErrorToast } from "../lib/toast-error";
import { ASK_FOR_REVIEW_PROMPT } from "../lib/turn-review-offer";
import { palot } from "../services/palot";
import { Button } from "./ui/button";

const dismissedReviewOffersAtom = atom<ReadonlySet<string>>(new Set<string>());

/**
 * A quiet follow-up after a settled turn that changed files. It appears only when
 * OpenCode reports a non-empty diff for the turn.
 */
export const TurnReviewOffer = memo(function TurnReviewOffer({
  connectionID,
  sessionID,
  userMessageID,
  available,
  onReview,
  onAsked,
}: {
  connectionID: string;
  sessionID: string;
  userMessageID: string;
  available: boolean;
  onReview(userMessageID: string): void;
  onAsked?(): void;
}) {
  const key = `${connectionID}\0${sessionID}\0${userMessageID}`;
  const [dismissed, setDismissed] = useAtom(dismissedReviewOffersAtom);
  const [asking, setAsking] = useState(false);
  const hidden = dismissed.has(key);
  const query = useQuery({
    ...turnDiffsQueryOptions(connectionID, sessionID, userMessageID),
    enabled: available && !hidden,
    // This offer mounts when the turn settles; earlier reads may predate its last edit.
    refetchOnMount: true,
  });
  const diffs = query.data ?? [];
  if (hidden || !available || diffs.length === 0) return null;

  const dismiss = () => setDismissed((current) => new Set(current).add(key));
  const additions = diffs.reduce((sum, file) => sum + file.additions, 0);
  const deletions = diffs.reduce((sum, file) => sum + file.deletions, 0);
  const files = `${diffs.length} ${diffs.length === 1 ? "file" : "files"} changed`;

  return (
    <div
      role="group"
      aria-label="Review this turn's changes"
      data-palot-turn-review-offer={userMessageID}
      className="mt-3 flex w-fit max-w-full flex-wrap items-center gap-x-1 gap-y-0.5 rounded-md border border-border/60 bg-muted/15 py-0.5 pr-0.5 pl-2 text-xs text-muted-foreground"
    >
      <span className="flex min-w-0 items-center gap-1.5 pr-1 tabular-nums">
        <FileDiff className="size-3.5 shrink-0" aria-hidden="true" />
        <span className="truncate">{files}</span>
        <span className="text-success">+{additions}</span>
        <span className="text-destructive">-{deletions}</span>
      </span>
      <Button type="button" variant="ghost" size="sm" onClick={() => onReview(userMessageID)}>
        Review changes
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
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
    </div>
  );
});
