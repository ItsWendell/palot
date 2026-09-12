import { useEffect, useState, type ComponentProps, type ReactNode } from "react";
import { CircleAlert, FolderGit2, GitBranch } from "lucide-react";
import { catalogSessionIsUnread } from "../hooks/use-session-info";
import { cn } from "../lib/cn";
import {
  inboxSessionState,
  type InboxSessionState,
  type InboxSessionView,
} from "../lib/session-inbox";
import {
  formatRelativeTime,
  sessionActivityAt,
  sessionIsAdditionalCheckout,
} from "../lib/view-models";
import type { OpenCodeVcsInfo } from "../services/opencode-vcs";
import { PulseDot } from "./ui/pulse-dot";
import { sidebarItemVariants } from "./ui/sidebar-styles";

export const INBOX_CARD_ACTION_BUTTON_CLASS =
  "text-sidebar-foreground/60 hover:bg-transparent! hover:text-sidebar-foreground! focus-visible:ring-1 focus-visible:ring-sidebar-ring";

/** Presentation only: callers own navigation, editing, drag behavior and every mutation. */
export function InboxCardSurface({
  item,
  selected,
  vcs,
  buttonProps,
  titleEditor,
  actions,
  hint,
  connectionBadge,
  ownerLabel,
  profileID,
  ...props
}: ComponentProps<"div"> & {
  item: InboxSessionView;
  selected: boolean;
  vcs?: OpenCodeVcsInfo;
  buttonProps: ComponentProps<"button">;
  titleEditor?: ReactNode;
  actions?: ReactNode;
  hint?: ReactNode;
  connectionBadge?: ReactNode;
  ownerLabel?: string;
  profileID?: string;
}) {
  const unread = !selected && catalogSessionIsUnread(item.session);
  const visualState = inboxSessionState(item, unread);
  const status = item.attention
    ? item.attentionCount === 1
      ? "Needs input"
      : `Needs input · ${item.attentionCount}`
    : item.running
      ? "Working"
      : item.failed
        ? "Failed"
        : visualState === "unread"
          ? `New, ${formatRelativeTime(sessionActivityAt(item.session))}`
          : formatRelativeTime(sessionActivityAt(item.session));
  const detachedWorktree = Boolean(
    vcs &&
    !vcs.currentBranch &&
    sessionIsAdditionalCheckout(item.session, item.project ?? undefined),
  );
  return (
    <div
      {...props}
      data-inbox-card
      data-profile-id={profileID}
      data-selected={selected || undefined}
      className={cn(
        "group/inbox-card relative overflow-hidden rounded-md bg-transparent transition-colors hover:bg-(--palot-sidebar-hover)",
        selected && "bg-(--palot-sidebar-selected) text-sidebar-foreground",
        props.className,
      )}
    >
      {hint}
      <button
        type="button"
        aria-label={`Open ${item.session.title ?? "Untitled task"}, ${item.projectName}, ${status}${ownerLabel ? ` · ${ownerLabel}` : ""}`}
        {...buttonProps}
        className={cn(
          "absolute inset-0 z-0 rounded-md outline-none active:bg-(--palot-sidebar-selected) focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sidebar-ring",
          buttonProps.className,
        )}
      />
      <div
        className={cn(
          "pointer-events-none relative z-10 flex flex-col justify-center pr-3 leading-4",
          sidebarItemVariants({ density: "rich", interactive: false, icons: "custom" }),
        )}
      >
        <div className="flex min-w-0 items-center gap-2 text-meta text-muted-foreground">
          <span className="min-w-0 flex-1 truncate font-medium text-sidebar-foreground/70">
            {item.projectName}
          </span>
          {visualState === "running" ? (
            <WorkingStatus startedAt={item.runningSince} />
          ) : (
            <span
              data-inbox-status
              className={cn(
                "flex shrink-0 items-center gap-1 tabular-nums transition-opacity group-hover/inbox-card:opacity-0 group-has-[:focus-visible]/inbox-card:opacity-0",
                item.attention && "text-warning",
                item.failed && "text-destructive",
              )}
            >
              <InboxStateGlyph state={visualState} />
              {visualState === "unread" ? (
                <span>New · {formatRelativeTime(sessionActivityAt(item.session))}</span>
              ) : (
                status
              )}
            </span>
          )}
        </div>
        {titleEditor ?? (
          <div className="mt-1 flex min-w-0 items-center gap-1.5 text-compact font-normal text-sidebar-foreground/90 transition-colors group-hover/inbox-card:text-sidebar-foreground/95">
            <span className="min-w-0 flex-1 truncate">{item.session.title ?? "Untitled task"}</span>
            {connectionBadge}
          </div>
        )}
        <div
          className="mt-1 flex min-w-0 items-center gap-1.5 text-meta text-muted-foreground"
          data-inbox-location
        >
          {detachedWorktree ? (
            <FolderGit2
              className="size-[11px] shrink-0 text-sidebar-foreground/55 transition-colors group-hover/inbox-card:text-sidebar-foreground/70"
              aria-hidden="true"
            />
          ) : (
            <GitBranch
              className="size-[11px] shrink-0 text-sidebar-foreground/55 transition-colors group-hover/inbox-card:text-sidebar-foreground/70"
              aria-hidden="true"
            />
          )}
          <span
            className="min-w-0 -translate-y-px truncate"
            title={item.session.location.directory}
          >
            {branchLabel(vcs, item)}
          </span>
        </div>
      </div>
      <div className="absolute top-0 right-1.5 z-20 flex items-center gap-0 opacity-0 transition-opacity group-hover/inbox-card:opacity-100 group-has-[:focus-visible]/inbox-card:opacity-100 group-has-[[data-popup-open]]/inbox-card:opacity-100">
        {actions}
      </div>
    </div>
  );
}

function WorkingStatus({ startedAt }: { startedAt: number | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (startedAt === null) return;
    const interval = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, [startedAt]);
  const duration = startedAt === null ? null : formatWorkingDuration(startedAt, now);
  return (
    <span
      data-inbox-status
      className="flex shrink-0 items-center gap-1 tabular-nums transition-opacity group-hover/inbox-card:opacity-0 group-has-[:focus-visible]/inbox-card:opacity-0"
      title={duration ? `Working for ${duration}` : "Working"}
    >
      <PulseDot className="size-3 [&>span]:size-1" aria-hidden="true" />
      {duration ?? "Working"}
    </span>
  );
}

export function InboxStateGlyph({ state }: { state: InboxSessionState }) {
  if (!state) return null;
  const label =
    state === "attention"
      ? "Task needs attention"
      : state === "failed"
        ? "Task failed"
        : state === "running"
          ? "Task is running"
          : "Unread task activity";
  return (
    <span
      className={cn(
        "flex size-3.5 shrink-0 items-center justify-center",
        state === "attention" && "text-warning",
        state === "failed" && "text-destructive",
      )}
      title={label}
      aria-label={label}
    >
      {state === "running" ? (
        <PulseDot className="size-3 [&>span]:size-1" aria-hidden="true" />
      ) : state === "attention" || state === "failed" ? (
        <CircleAlert className="size-3" aria-hidden="true" />
      ) : (
        <span className="size-[5px] rounded-full bg-info" aria-hidden="true" />
      )}
    </span>
  );
}

function branchLabel(vcs: OpenCodeVcsInfo | undefined, item: InboxSessionView): string {
  if (vcs?.currentBranch) return vcs.currentBranch;
  const directoryName = item.session.location.directory.split(/[\\/]/).filter(Boolean).at(-1);
  if (vcs && sessionIsAdditionalCheckout(item.session, item.project ?? undefined))
    return directoryName ?? "Worktree";
  if (vcs) return "Detached HEAD";
  return directoryName ?? "Branch unavailable";
}

function formatWorkingDuration(startedAt: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1_000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${String(minutes % 60).padStart(2, "0")}m`;
}
