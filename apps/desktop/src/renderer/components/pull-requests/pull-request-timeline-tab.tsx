import { useAtom } from "jotai";
import {
  CircleAlert,
  CircleCheck,
  CircleDot,
  FileCode2,
  GitCommitHorizontal,
  LoaderCircle,
  MessageSquare,
} from "lucide-react";
import { useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import type {
  PullRequestDetail,
  PullRequestPerson,
  PullRequestTimelineItem,
} from "../../../shared/source-control-contract";
import {
  useAddPullRequestComment,
  usePullRequestTimeline,
  useReplyToPullRequestThread,
  useResolvePullRequestThread,
} from "../../hooks/use-source-control";
import { cn } from "../../lib/cn";
import { shortcutPlatform } from "../../lib/keyboard-shortcuts";
import { MarkdownContent } from "../markdown-content";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
import { refOf } from "./pull-request-actions";
import { PullRequestAvatar } from "./pull-request-person";
import { pullRequestTimelineFiltersAtom } from "./pull-request-preferences";
import { formatPullRequestTime, sourceControlErrorMessage } from "./pull-request-presentation";

type ThreadItem = Extract<PullRequestTimelineItem, { kind: "review-thread" }>;
type EventItem = Extract<PullRequestTimelineItem, { kind: "event" }>;

function itemPeople(item: PullRequestTimelineItem): Array<PullRequestPerson | null> {
  switch (item.kind) {
    case "comment":
    case "review":
    case "commit":
      return [item.author];
    case "event":
      return [item.actor];
    case "review-thread":
      return item.comments.slice(0, 1).map((comment) => comment.author);
  }
}

export function filterTimeline(
  items: readonly PullRequestTimelineItem[],
  filters: { hideBots: boolean; hideResolved: boolean },
): PullRequestTimelineItem[] {
  return items.filter((item) => {
    if (filters.hideResolved && item.kind === "review-thread" && item.isResolved) return false;
    if (filters.hideBots && itemPeople(item).some((person) => person?.isBot)) return false;
    return true;
  });
}

export function PullRequestTimelineTab({ detail }: { detail: PullRequestDetail }) {
  const ref = refOf(detail);
  const timeline = usePullRequestTimeline(ref);
  const [filters, setFilters] = useAtom(pullRequestTimelineFiltersAtom);
  const items = useMemo(
    () => timeline.data?.pages.flatMap((page) => page.items) ?? [],
    [timeline.data],
  );
  const visible = useMemo(() => filterTimeline(items, filters), [filters, items]);
  const hidden = items.length - visible.length;

  return (
    <div className="flex flex-col pb-6">
      <div className="flex flex-wrap items-center gap-1 px-4 pt-3 pb-1">
        <FilterToggle
          label="Hide bots"
          pressed={filters.hideBots}
          onPressedChange={(hideBots) => setFilters((current) => ({ ...current, hideBots }))}
        />
        <FilterToggle
          label="Hide resolved"
          pressed={filters.hideResolved}
          onPressedChange={(hideResolved) =>
            setFilters((current) => ({ ...current, hideResolved }))
          }
        />
        {hidden > 0 ? (
          <span className="ml-auto text-micro text-muted-foreground tabular-nums">
            {hidden} hidden
          </span>
        ) : null}
      </div>
      {timeline.error && items.length === 0 ? (
        <p
          role="alert"
          className="flex items-start gap-1.5 px-4 py-3 text-sm text-muted-foreground"
        >
          <CircleAlert className="mt-0.5 size-3.5 shrink-0 text-destructive" aria-hidden="true" />
          {sourceControlErrorMessage(timeline.error)}
        </p>
      ) : timeline.isPending ? (
        <div className="flex items-center gap-2 px-4 py-3 text-sm text-muted-foreground">
          <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
          Loading activity
        </div>
      ) : visible.length === 0 ? (
        <p className="px-4 py-3 text-sm text-muted-foreground">
          {items.length ? "Every item is hidden by the filters above." : "No activity yet."}
        </p>
      ) : (
        <ol aria-label="Timeline" className="flex flex-col">
          {visible.map((item) => (
            <li key={`${item.kind}:${item.id}`} className="px-4">
              <TimelineEntry item={item} detail={detail} />
            </li>
          ))}
        </ol>
      )}
      {timeline.hasNextPage ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="mx-3 mt-1 self-start text-muted-foreground"
          disabled={timeline.isFetchingNextPage}
          onClick={() => void timeline.fetchNextPage()}
        >
          {timeline.isFetchingNextPage ? (
            <LoaderCircle data-icon="inline-start" className="animate-spin" aria-hidden="true" />
          ) : null}
          Load newer activity
        </Button>
      ) : null}
      <CommentComposer detail={detail} />
    </div>
  );
}

function FilterToggle({
  label,
  pressed,
  onPressedChange,
}: {
  label: string;
  pressed: boolean;
  onPressedChange(pressed: boolean): void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="xs"
      aria-pressed={pressed}
      className={cn("text-muted-foreground", pressed && "bg-muted text-foreground")}
      onClick={() => onPressedChange(!pressed)}
    >
      {label}
    </Button>
  );
}

function TimelineEntry({
  item,
  detail,
}: {
  item: PullRequestTimelineItem;
  detail: PullRequestDetail;
}) {
  switch (item.kind) {
    case "comment":
      return (
        <EntryShell person={item.author} at={item.createdAt} action="commented">
          <MarkdownContent value={item.body} baseUrl={item.url} className="mt-1 text-sm" />
        </EntryShell>
      );
    case "review":
      return (
        <EntryShell
          person={item.author}
          at={item.submittedAt}
          action={REVIEW_ACTION[item.state]}
          tone={
            item.state === "approved"
              ? "text-success"
              : item.state === "changes-requested"
                ? "text-destructive"
                : undefined
          }
        >
          {item.body.trim() ? (
            <MarkdownContent value={item.body} baseUrl={item.url} className="mt-1 text-sm" />
          ) : null}
        </EntryShell>
      );
    case "review-thread":
      return <ReviewThread thread={item} detail={detail} />;
    case "commit":
      return (
        <CompactEntry icon={<GitCommitHorizontal aria-hidden="true" />} at={item.createdAt}>
          <span className="font-mono text-muted-foreground">{item.oid.slice(0, 7)}</span>{" "}
          <span className="text-foreground/90">{item.message.split("\n")[0]}</span>
          {item.author ? <span> · {item.author.login}</span> : null}
        </CompactEntry>
      );
    case "event":
      return (
        <CompactEntry icon={<CircleDot aria-hidden="true" />} at={item.createdAt}>
          <span className="text-foreground/90">{item.actor?.login ?? "Someone"}</span>{" "}
          {eventSentence(item)}
        </CompactEntry>
      );
  }
}

const REVIEW_ACTION: Record<Extract<PullRequestTimelineItem, { kind: "review" }>["state"], string> =
  {
    approved: "approved these changes",
    "changes-requested": "requested changes",
    commented: "reviewed",
    dismissed: "had a review dismissed",
  };

export function eventSentence(item: EventItem): string {
  switch (item.type) {
    case "merged":
      return "merged this pull request";
    case "closed":
      return "closed this pull request";
    case "reopened":
      return "reopened this pull request";
    case "ready-for-review":
      return "marked this ready for review";
    case "converted-to-draft":
      return "converted this to a draft";
    case "review-requested":
      return item.detail ? `requested a review from ${item.detail}` : "requested a review";
    case "labeled":
      return item.detail ? `added the ${item.detail} label` : "added a label";
    case "unlabeled":
      return item.detail ? `removed the ${item.detail} label` : "removed a label";
    case "force-pushed":
      return "force-pushed the branch";
    case "head-ref-deleted":
      return "deleted the branch";
    case "renamed":
      return item.detail ? `renamed this to “${item.detail}”` : "renamed this pull request";
  }
}

function EntryShell({
  person,
  at,
  action,
  tone,
  children,
}: {
  person: PullRequestPerson | null;
  at: number;
  action: string;
  tone?: string;
  children?: ReactNode;
}) {
  return (
    <article className="flex min-w-0 gap-2.5 border-t border-border/50 py-3">
      <PullRequestAvatar person={person} className="mt-px" />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 text-meta">
          <span className="font-medium text-foreground">{person?.login ?? "ghost"}</span>
          <span className={cn("text-muted-foreground", tone)}>{action}</span>
          <time
            className="ml-auto text-muted-foreground tabular-nums"
            dateTime={new Date(at).toISOString()}
            title={new Date(at).toLocaleString()}
          >
            {formatPullRequestTime(at)}
          </time>
        </div>
        {children}
      </div>
    </article>
  );
}

function CompactEntry({
  icon,
  at,
  children,
}: {
  icon: ReactNode;
  at: number;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-7 min-w-0 items-center gap-2.5 py-1 text-meta text-muted-foreground [&>svg]:size-3.5 [&>svg]:shrink-0">
      <span className="flex w-5 shrink-0 justify-center [&>svg]:size-3.5">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
      <time className="shrink-0 tabular-nums" dateTime={new Date(at).toISOString()}>
        {formatPullRequestTime(at)}
      </time>
    </div>
  );
}

function hunkExcerpt(hunk: string, lines = 6): string {
  const all = hunk.split("\n").filter((line) => !line.startsWith("@@"));
  return all.slice(-lines).join("\n");
}

function ReviewThread({ thread, detail }: { thread: ThreadItem; detail: PullRequestDetail }) {
  const resolve = useResolvePullRequestThread();
  const [replying, setReplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const first = thread.comments[0];
  const location = `${thread.path}${thread.line !== null ? `:${thread.line}` : ""}`;
  const toggleResolved = () => {
    setError(null);
    void resolve
      .mutateAsync({ ...refOf(detail), threadID: thread.id, resolved: !thread.isResolved })
      .catch((cause: unknown) => setError(sourceControlErrorMessage(cause)));
  };
  return (
    <article
      aria-label={`Review thread on ${location}`}
      className="my-2 overflow-hidden rounded-lg border border-border/70"
    >
      <header className="flex min-w-0 items-center gap-2 border-b border-border/60 bg-muted/30 px-3 py-1.5 text-meta">
        <FileCode2 className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="min-w-0 truncate font-mono" title={location}>
          {location}
        </span>
        {thread.isOutdated ? (
          <span className="shrink-0 text-muted-foreground">Outdated</span>
        ) : null}
        {thread.isResolved ? (
          <span className="flex shrink-0 items-center gap-1 text-success">
            <CircleCheck className="size-3" aria-hidden="true" />
            Resolved
          </span>
        ) : null}
      </header>
      {first?.diffHunk ? (
        <pre className="overflow-x-auto border-b border-border/60 px-3 py-1.5 font-mono text-code-compact leading-relaxed text-muted-foreground">
          {hunkExcerpt(first.diffHunk)
            .split("\n")
            .map((line, index) => (
              <div
                key={index}
                className={cn(
                  line.startsWith("+") && "text-success",
                  line.startsWith("-") && "text-destructive",
                )}
              >
                {line || " "}
              </div>
            ))}
        </pre>
      ) : null}
      <div className="flex flex-col px-3">
        {thread.comments.map((comment, index) => (
          <div
            key={comment.id}
            className={cn("flex min-w-0 gap-2.5 py-2.5", index > 0 && "border-t border-border/40")}
          >
            <PullRequestAvatar person={comment.author} className="mt-px" />
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-baseline gap-1.5 text-meta">
                <span className="font-medium">{comment.author?.login ?? "ghost"}</span>
                <time className="ml-auto text-muted-foreground tabular-nums">
                  {formatPullRequestTime(comment.createdAt)}
                </time>
              </div>
              <MarkdownContent
                value={comment.body}
                baseUrl={comment.url}
                className="mt-1 text-sm"
              />
            </div>
          </div>
        ))}
      </div>
      {replying ? (
        <div className="border-t border-border/60 p-2">
          <MarkdownComposer
            label={`Reply on ${location}`}
            submitLabel="Reply"
            autoFocus
            onCancel={() => setReplying(false)}
            onSubmit={() => setReplying(false)}
            threadID={thread.id}
            detail={detail}
          />
        </div>
      ) : (
        <div className="flex items-center gap-1 border-t border-border/60 px-2 py-1">
          {thread.viewerCanReply ? (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className="text-muted-foreground"
              onClick={() => setReplying(true)}
            >
              <MessageSquare data-icon="inline-start" aria-hidden="true" />
              Reply
            </Button>
          ) : null}
          {thread.viewerCanResolve ? (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className="text-muted-foreground"
              disabled={resolve.isPending}
              onClick={toggleResolved}
            >
              {thread.isResolved ? "Unresolve" : "Resolve"}
            </Button>
          ) : null}
          {error ? (
            <span
              role="alert"
              className="ml-auto truncate text-micro text-destructive"
              title={error}
            >
              {error}
            </span>
          ) : null}
        </div>
      )}
    </article>
  );
}

function CommentComposer({ detail }: { detail: PullRequestDetail }) {
  return (
    <div className="mx-4 mt-4 border-t border-border/60 pt-4">
      <MarkdownComposer label="Add a comment" submitLabel="Comment" detail={detail} />
    </div>
  );
}

/** Markdown textarea; Mod+Enter submits. Comments the PR, or replies to `threadID`. */
function MarkdownComposer({
  label,
  submitLabel,
  detail,
  threadID,
  autoFocus,
  onSubmit,
  onCancel,
}: {
  label: string;
  submitLabel: string;
  detail: PullRequestDetail;
  threadID?: string;
  autoFocus?: boolean;
  onSubmit?(): void;
  onCancel?(): void;
}) {
  const comment = useAddPullRequestComment();
  const reply = useReplyToPullRequestThread();
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const pending = comment.isPending || reply.isPending;
  const mac = shortcutPlatform() === "mac";
  const submit = () => {
    const text = body.trim();
    if (!text || pending) return;
    setError(null);
    const request = threadID
      ? reply.mutateAsync({ ...refOf(detail), threadID, body: text })
      : comment.mutateAsync({ ...refOf(detail), body: text });
    void request
      .then(() => {
        setBody("");
        onSubmit?.();
      })
      .catch((cause: unknown) => setError(sourceControlErrorMessage(cause)));
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && (mac ? event.metaKey : event.ctrlKey)) {
      event.preventDefault();
      submit();
    }
    if (event.key === "Escape" && onCancel) {
      event.preventDefault();
      onCancel();
    }
  };
  return (
    <form
      className="flex flex-col gap-2"
      aria-label={label}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <Textarea
        aria-label={label}
        placeholder="Write a comment in Markdown"
        value={body}
        autoFocus={autoFocus}
        disabled={pending}
        className="min-h-20"
        onChange={(event) => setBody(event.target.value)}
        onKeyDown={onKeyDown}
      />
      {error ? (
        <p role="alert" className="flex items-start gap-1.5 text-meta text-destructive">
          <CircleAlert className="mt-px size-3 shrink-0" aria-hidden="true" />
          {error}
        </p>
      ) : null}
      <div className="flex items-center justify-end gap-1">
        <span className="mr-auto text-micro text-muted-foreground">
          {mac ? "⌘↵" : "Ctrl+Enter"} to send
        </span>
        {onCancel ? (
          <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
        <Button type="submit" size="sm" disabled={pending || !body.trim()}>
          {pending ? (
            <LoaderCircle data-icon="inline-start" className="animate-spin" aria-hidden="true" />
          ) : null}
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
