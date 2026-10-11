import { Check, FileDiff, MessageSquare, Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import type {
  PullRequestDetail,
  PullRequestReviewInput,
} from "../../../../shared/source-control-contract";
import { useSubmitPullRequestReview } from "../../../hooks/use-source-control";
import { Button } from "../../ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "../../ui/popover";
import { Spinner } from "../../ui/spinner";
import { Textarea } from "../../ui/textarea";
import type { PendingReviewController } from "./pending-review-store";
import { describeLines, toDraftComments } from "./pull-request-code-model";

type ReviewEvent = PullRequestReviewInput["event"];

const SUBMIT_LABEL: Record<ReviewEvent, string> = {
  comment: "Comment",
  approve: "Approve",
  "request-changes": "Request changes",
};

/** Toolbar trigger and popover holding the pending line comments. */
export function PendingCommentsTray({
  pending,
  onReveal,
}: {
  pending: PendingReviewController;
  onReveal(path: string, line: number, side: "LEFT" | "RIGHT"): void;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const comments = pending.review.comments;
  const count = comments.length;
  if (count === 0) return null;
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setEditing(null);
      }}
    >
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={`${count} pending ${count === 1 ? "comment" : "comments"}`}
          />
        }
      >
        <MessageSquare data-icon="inline-start" aria-hidden="true" />
        <span className="tabular-nums">{count}</span>
        <span className="hidden @min-[40rem]/pr-code:inline">pending</span>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 max-w-[calc(100vw-2rem)] gap-2">
        <div className="text-meta font-medium text-muted-foreground">
          Pending comments ({count})
        </div>
        <ul aria-label="Pending comments" className="flex max-h-80 flex-col gap-1.5 overflow-auto">
          {comments.map((comment) => {
            const isEditing = editing?.id === comment.id;
            return (
              <li
                key={comment.id}
                className="flex flex-col gap-1 rounded-md border border-border bg-card p-2"
              >
                <button
                  type="button"
                  className="truncate text-left text-meta text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
                  title={comment.path}
                  onClick={() => {
                    setOpen(false);
                    onReveal(comment.path, comment.line, comment.side);
                  }}
                >
                  {comment.path} · {describeLines(comment)}
                  {comment.side === "LEFT" ? " (old)" : ""}
                </button>
                {isEditing ? (
                  <form
                    className="flex flex-col gap-1.5"
                    onSubmit={(event) => {
                      event.preventDefault();
                      if (!editing.text.trim()) return;
                      pending.updateComment(comment.id, editing.text.trim());
                      setEditing(null);
                    }}
                  >
                    <Textarea
                      aria-label="Edit comment"
                      rows={3}
                      value={editing.text}
                      autoFocus
                      onChange={(event) => setEditing({ id: comment.id, text: event.target.value })}
                    />
                    <div className="flex justify-end gap-1.5">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setEditing(null)}
                      >
                        Cancel
                      </Button>
                      <Button type="submit" size="sm" disabled={!editing.text.trim()}>
                        Save
                      </Button>
                    </div>
                  </form>
                ) : (
                  <div className="flex items-start gap-1">
                    <p className="min-w-0 flex-1 text-sm break-words whitespace-pre-wrap">
                      {comment.body}
                    </p>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`Edit comment on ${comment.path} ${describeLines(comment)}`}
                      onClick={() => setEditing({ id: comment.id, text: comment.body })}
                    >
                      <Pencil />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`Remove comment on ${comment.path} ${describeLines(comment)}`}
                      onClick={() => pending.removeComment(comment.id)}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

/** The Review button: summary plus Comment, Approve, or Request changes. */
export function PullRequestReviewPopover({
  pullRequest,
  commitOid,
  pending,
}: {
  pullRequest: PullRequestDetail;
  /** The head the reviewer read the diff at, so comments land on the lines they saw. */
  commitOid: string;
  pending: PendingReviewController;
}) {
  const [open, setOpen] = useState(false);
  const submit = useSubmitPullRequestReview();
  const [submitting, setSubmitting] = useState<ReviewEvent | null>(null);
  const { body, comments } = pending.review;
  const hasBody = body.trim().length > 0;
  const isAuthor = pullRequest.viewer.isAuthor;

  const canSubmit: Record<ReviewEvent, boolean> = {
    comment: hasBody || comments.length > 0,
    approve: !isAuthor,
    "request-changes": !isAuthor && hasBody,
  };

  const send = (event: ReviewEvent) => {
    if (submit.isPending || !canSubmit[event]) return;
    const sentBody = body;
    const sentComments = comments;
    setSubmitting(event);
    submit.mutate(
      {
        host: pullRequest.host,
        repository: pullRequest.repository,
        number: pullRequest.number,
        event,
        body: sentBody.trim(),
        comments: toDraftComments(sentComments),
        commitOid,
      },
      {
        onSuccess: () => {
          pending.settleSubmitted({
            body: sentBody,
            commentIDs: sentComments.map((comment) => comment.id),
          });
          setOpen(false);
          submit.reset();
        },
        onSettled: () => setSubmitting(null),
      },
    );
  };

  const count = comments.length;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button type="button" size="sm" />}>
        <FileDiff data-icon="inline-start" aria-hidden="true" />
        Review
        {count > 0 ? (
          <span className="ml-0.5 rounded-sm bg-primary-foreground/20 px-1 tabular-nums">
            {count}
          </span>
        ) : null}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 max-w-[calc(100vw-2rem)] gap-2">
        <form
          aria-label="Submit review"
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            send("comment");
          }}
        >
          <Textarea
            aria-label="Review summary"
            placeholder="Leave a summary (required to request changes)"
            rows={4}
            value={body}
            disabled={submit.isPending}
            onChange={(event) => pending.setBody(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                send("comment");
              }
            }}
          />
          <p className="text-meta text-muted-foreground">
            {count === 0
              ? "No line comments. Select lines in the diff to add some."
              : `${count} line ${count === 1 ? "comment" : "comments"} will be sent with this review.`}
          </p>
          {isAuthor ? (
            <p className="text-meta text-muted-foreground">
              You opened this pull request, so you can only comment on it.
            </p>
          ) : null}
          {submit.isError ? (
            <p role="alert" className="text-meta text-destructive">
              {submit.error instanceof Error && submit.error.message
                ? submit.error.message
                : "The review could not be submitted."}
            </p>
          ) : null}
          <div className="flex flex-wrap justify-end gap-1.5">
            <SubmitButton
              event="comment"
              variant="outline"
              disabled={!canSubmit.comment || submit.isPending}
              busy={submitting === "comment"}
              onSubmit={send}
            />
            <SubmitButton
              event="request-changes"
              variant="outline"
              disabled={!canSubmit["request-changes"] || submit.isPending}
              busy={submitting === "request-changes"}
              onSubmit={send}
            />
            <SubmitButton
              event="approve"
              variant="default"
              disabled={!canSubmit.approve || submit.isPending}
              busy={submitting === "approve"}
              onSubmit={send}
            />
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}

function SubmitButton({
  event,
  variant,
  disabled,
  busy,
  onSubmit,
}: {
  event: ReviewEvent;
  variant: "default" | "outline";
  disabled: boolean;
  busy: boolean;
  onSubmit(event: ReviewEvent): void;
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant={variant}
      disabled={disabled}
      aria-busy={busy || undefined}
      onClick={() => onSubmit(event)}
    >
      {busy ? (
        <Spinner data-icon="inline-start" aria-hidden="true" />
      ) : event === "approve" ? (
        <Check data-icon="inline-start" aria-hidden="true" />
      ) : null}
      {SUBMIT_LABEL[event]}
    </Button>
  );
}
