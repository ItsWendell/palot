/** The status marks and the small live text leaves that tick on the shared clock. */

import {
  CircleHelp,
  CircleStop,
  Clock3,
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  GitPullRequestDraft,
  PencilLine,
  ShieldAlert,
} from "lucide-react";
import { useSyncExternalStore } from "react";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/cn";
import { formatDuration, formatQuiet, formatRelative } from "@/lib/task-list/model/format";
import type { StatusClock, StatusKind, TaskStatus } from "@/lib/task-list/model/status";
import { clockNow, subscribeClock } from "@/lib/task-list/clock";
import type { TaskPullRequest } from "@/lib/task-list/types";

const MARK_LABEL: Record<StatusKind, string> = {
  approval: "Needs approval",
  question: "Needs an answer",
  failed: "Failed",
  unseen: "Finished, not seen yet",
  working: "Working",
  stale: "No recent update",
  stopped: "Stopped",
  idle: "",
};

/** One mark per status. Colour only for ranks 1-4; working, stale and stopped stay neutral. */
export function StatusMark({
  kind,
  className,
}: {
  kind: StatusKind | "snoozed";
  className?: string;
}) {
  const label = kind === "snoozed" ? "Snoozed" : MARK_LABEL[kind];
  if (kind === "idle") return null;
  return (
    <span
      data-slot="status-mark"
      data-kind={kind}
      role="img"
      aria-label={label}
      title={label}
      className={cn("flex size-4 shrink-0 items-center justify-center", className)}
    >
      {kind === "approval" ? (
        <ShieldAlert className="size-3.5 text-warning" aria-hidden="true" />
      ) : kind === "question" ? (
        <CircleHelp className="size-3.5 text-warning" aria-hidden="true" />
      ) : kind === "failed" ? (
        <span className="size-[7px] rounded-full bg-destructive" aria-hidden="true" />
      ) : kind === "unseen" ? (
        <span className="size-[7px] rounded-full bg-info" aria-hidden="true" />
      ) : kind === "working" ? (
        <Spinner
          role="presentation"
          aria-label={undefined}
          aria-hidden="true"
          className="size-3 text-sidebar-foreground/50"
        />
      ) : kind === "stale" ? (
        <span
          className="size-2.5 rounded-full border border-dashed border-sidebar-foreground/55"
          aria-hidden="true"
        />
      ) : kind === "stopped" ? (
        <CircleStop className="size-3 text-sidebar-foreground/45" aria-hidden="true" />
      ) : (
        <Clock3 className="size-3 text-sidebar-foreground/50" aria-hidden="true" />
      )}
    </span>
  );
}

function useClockText(format: (now: number) => string): string {
  return useSyncExternalStore(subscribeClock, () => format(clockNow()));
}

function formatClock(clock: StatusClock, now: number) {
  return clock.format === "elapsed"
    ? formatDuration(now - clock.since)
    : formatQuiet(now - clock.since);
}

/**
 * The status sentence; only its clock leaf ticks. `detailClassName` lets a row hide the
 * request detail where its third line already shows it.
 */
export function StatusSentence({
  status,
  detailClassName,
}: {
  status: TaskStatus;
  detailClassName?: string;
}) {
  return (
    <>
      {status.text}
      {status.detail ? <span className={detailClassName}> · {status.detail}</span> : null}
      {status.clock ? (
        <>
          {status.clock.format === "elapsed" ? " · " : " "}
          <ClockText clock={status.clock} />
        </>
      ) : null}
    </>
  );
}

function ClockText({ clock }: { clock: StatusClock }) {
  const text = useClockText((now) => formatClock(clock, now));
  return <span className="tabular-nums">{text}</span>;
}

/** "5m", "3h", "Mar 4": changes at most once a minute, so it re-renders at most once a minute. */
export function RelativeTime({ at }: { at: number }) {
  const text = useClockText((now) => formatRelative(at, now));
  return (
    <time dateTime={new Date(at).toISOString()} className="tabular-nums">
      {text}
    </time>
  );
}

const PR_ICON = {
  open: GitPullRequest,
  draft: GitPullRequestDraft,
  merged: GitMerge,
  closed: GitPullRequestClosed,
} as const;

const PR_LABEL = { open: "Open", draft: "Draft", merged: "Merged", closed: "Closed" } as const;
const CHECKS_LABEL = {
  passing: "checks passing",
  failing: "checks failing",
  pending: "checks running",
  none: "no checks",
} as const;

/**
 * One PR mark: state icon and number. Neutral unless checks fail, or success-tinted once ready
 * to merge. The tooltip adds the readiness verdict.
 */
export function PullRequestMark({ pr }: { pr: TaskPullRequest }) {
  const Icon = PR_ICON[pr.state];
  const failing = pr.checks === "failing";
  const ready = pr.readiness?.ready === true;
  const label = `Pull request #${pr.number}, ${PR_LABEL[pr.state]}, ${pr.readiness?.text ?? CHECKS_LABEL[pr.checks]}`;
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      data-slot="pull-request-mark"
      data-ready={ready || undefined}
      className={cn(
        "inline-flex shrink-0 items-center gap-0.5 tabular-nums",
        failing ? "text-destructive" : ready ? "text-success" : "text-sidebar-foreground/45",
      )}
    >
      <Icon className="size-3" aria-hidden="true" />
      <span aria-hidden="true" className="@max-[230px]/row:hidden">
        {pr.number}
      </span>
    </span>
  );
}

export const DRAFT_LABEL = "Unsent draft";

/** A quiet pencil after the title: the task's composer holds something not sent yet. */
export function DraftMark() {
  return (
    <span
      role="img"
      aria-label={DRAFT_LABEL}
      title={DRAFT_LABEL}
      data-slot="draft-mark"
      className="flex shrink-0 items-center text-sidebar-foreground/45"
    >
      <PencilLine className="size-3" aria-hidden="true" />
    </span>
  );
}
