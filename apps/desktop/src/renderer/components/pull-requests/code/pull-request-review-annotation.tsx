import { CheckCircle2, ExternalLink, Trash2 } from "lucide-react";
import { cn } from "../../../lib/cn";
import { MarkdownContent } from "../../markdown-content";
import { Button } from "../../ui/button";
import type {
  PendingReviewComment,
  ReviewAnnotationGroup,
  ReviewThread,
} from "./pull-request-code-model";

/** Everything on one diff line: existing review threads, then this review's pending comments. */
export function ReviewAnnotation({
  group,
  onRemovePending,
}: {
  group: ReviewAnnotationGroup;
  onRemovePending(id: string): void;
}) {
  return (
    <div className="flex flex-col gap-1.5 bg-background px-2 py-1.5 font-sans text-sm whitespace-normal">
      {group.threads.map((thread) => (
        <ThreadCard key={thread.id} thread={thread} />
      ))}
      {group.pending.map((comment) => (
        <PendingCard key={comment.id} comment={comment} onRemove={onRemovePending} />
      ))}
    </div>
  );
}

function ThreadCard({ thread }: { thread: ReviewThread }) {
  const first = thread.comments[0];
  return (
    <article
      aria-label={`Review thread by ${first?.author?.login ?? "unknown"}${thread.isResolved ? ", resolved" : ""}`}
      className={cn(
        "max-w-3xl rounded-md border border-border bg-card",
        thread.isResolved && "opacity-60",
      )}
    >
      {thread.isResolved ? (
        <div className="flex items-center gap-1 border-b border-border px-2 py-1 text-micro text-muted-foreground">
          <CheckCircle2 className="size-3" aria-hidden="true" />
          Resolved
        </div>
      ) : null}
      <ol className="flex flex-col divide-y divide-border">
        {thread.comments.map((comment) => (
          <li key={comment.id} className="flex flex-col gap-1 px-2 py-1.5">
            <div className="flex items-center gap-1.5 text-meta">
              {comment.author?.avatarUrl ? (
                <img
                  src={comment.author.avatarUrl}
                  alt=""
                  className="size-4 rounded-full"
                  loading="lazy"
                />
              ) : null}
              <span className="font-medium text-foreground">
                {comment.author?.login ?? "Unknown"}
              </span>
              <time
                className="text-muted-foreground"
                dateTime={new Date(comment.createdAt).toISOString()}
              >
                {formatDate(comment.createdAt)}
              </time>
              <a
                href={comment.url}
                target="_blank"
                rel="noreferrer"
                className="ml-auto text-muted-foreground hover:text-foreground"
                aria-label="Open comment on GitHub"
              >
                <ExternalLink className="size-3" aria-hidden="true" />
              </a>
            </div>
            <MarkdownContent value={comment.body} className="text-sm" />
          </li>
        ))}
      </ol>
    </article>
  );
}

function PendingCard({
  comment,
  onRemove,
}: {
  comment: PendingReviewComment;
  onRemove(id: string): void;
}) {
  return (
    <article
      aria-label="Pending comment"
      className="flex max-w-3xl items-start gap-2 rounded-md border border-dashed border-border bg-card px-2 py-1.5"
    >
      <span className="mt-0.5 shrink-0 rounded-sm bg-warning/15 px-1 text-tag font-medium text-warning">
        Pending
      </span>
      <p className="min-w-0 flex-1 break-words whitespace-pre-wrap">{comment.body}</p>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label="Remove pending comment"
        onClick={() => onRemove(comment.id)}
      >
        <Trash2 />
      </Button>
    </article>
  );
}

function formatDate(epoch: number): string {
  return new Date(epoch).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
