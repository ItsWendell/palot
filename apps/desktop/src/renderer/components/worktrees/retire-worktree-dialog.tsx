import { CircleCheck, GitMerge, LoaderCircle, RefreshCw, TriangleAlert } from "lucide-react";
import type { PullRequestSnapshot } from "../../../shared/source-control-contract";
import { PullRequestStatePill } from "../pull-requests/pull-request-person";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Banner } from "../ui/banner";
import { Button } from "../ui/button";
import {
  canRetire,
  retirementChecklist,
  type RetirementCandidate,
  type RetirementCheck,
} from "./merged-worktree-retirement";

export function directoryLabel(directory: string): string {
  return directory.split(/[\\/]/).filter(Boolean).at(-1) ?? directory;
}

/** "Merged, ready to retire": worktrees whose linked pull request merged. */
export function MergedWorktreesSection({
  candidates,
  checkingDirectory,
  disabled,
  onReview,
}: {
  candidates: readonly RetirementCandidate[];
  checkingDirectory: string | null;
  disabled: boolean;
  onReview: (candidate: RetirementCandidate) => void;
}) {
  if (candidates.length === 0) return null;
  return (
    <section
      className="mb-5 overflow-hidden rounded-xl border bg-card/45"
      aria-labelledby="merged-worktrees-title"
    >
      <div className="border-b px-4 py-3">
        <h2 id="merged-worktrees-title" className="text-sm font-medium">
          Merged, ready to retire
        </h2>
        <p className="mt-0.5 text-meta text-muted-foreground">
          Their pull requests merged. Review each worktree before removing it; nothing is removed
          automatically.
        </p>
      </div>
      <ul className="min-w-0">
        {candidates.map((candidate) => {
          const label = directoryLabel(candidate.directory);
          const checking = checkingDirectory === candidate.directory;
          const tasks = candidate.attachedTasks.length;
          return (
            <li
              key={candidate.directory}
              className="flex min-w-0 items-center gap-3 border-b px-4 py-3 last:border-b-0"
            >
              <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border bg-background/70 text-muted-foreground">
                <GitMerge className="size-4" aria-hidden="true" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 break-all font-medium">{label}</span>
                  <PullRequestStatePill state={candidate.pullRequest.state} />
                </div>
                <p
                  className="mt-0.5 truncate text-xs text-muted-foreground"
                  title={candidate.pullRequest.title}
                >
                  #{candidate.pullRequest.number} {candidate.pullRequest.title}
                  {tasks > 0 ? ` · ${tasks} ${tasks === 1 ? "task" : "tasks"}` : ""}
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-label={`Review ${label} for retirement`}
                disabled={disabled || checkingDirectory !== null}
                onClick={() => onReview(candidate)}
              >
                {checking ? (
                  <LoaderCircle
                    className="animate-spin"
                    data-icon="inline-start"
                    aria-hidden="true"
                  />
                ) : null}
                Review
              </Button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export interface RetirementReview {
  connectionID: string;
  projectID: string;
  directory: string;
  pullRequest: PullRequestSnapshot;
  check: RetirementCheck;
  /** Why the last retirement attempt kept the worktree, if one did. */
  kept: string | null;
}

export function RetireWorktreeDialog({
  review,
  checking,
  pending,
  onClose,
  onCheckAgain,
  onRetire,
}: {
  review: RetirementReview | null;
  checking: boolean;
  pending: boolean;
  onClose: () => void;
  onCheckAgain: () => void;
  onRetire: () => void;
}) {
  const items = review ? retirementChecklist(review.check, review.pullRequest) : [];
  // A kept worktree stays blocked until the next fresh check.
  const ready = review !== null && review.kept === null && canRetire(items);
  const label = review ? directoryLabel(review.directory) : "worktree";
  const busy = checking || pending;
  return (
    <AlertDialog open={review !== null} onOpenChange={(open) => !open && !busy && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogMedia>
            <GitMerge aria-hidden="true" />
          </AlertDialogMedia>
          <AlertDialogTitle>Retire {label}?</AlertDialogTitle>
          <AlertDialogDescription>
            Retiring removes this worktree&apos;s checkout. Palot checks again right before removing
            it and keeps it if anything changed.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <ul className="min-w-0 space-y-2" aria-label="Retirement checks">
          {items.map((item) => (
            <li key={item.id} className="flex min-w-0 items-start gap-2 text-sm">
              {item.ok ? (
                <CircleCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
              ) : (
                <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
              )}
              <div className="min-w-0 flex-1" data-retirement-check={item.id} data-ok={item.ok}>
                <span className="font-medium">{item.label}: </span>
                <span className={item.ok ? "text-muted-foreground" : undefined}>{item.detail}</span>
                {item.id === "tasks" && review ? <TaskList check={review.check} /> : null}
                {item.id === "changes" && review?.check.dirtyFiles?.length ? (
                  <div className="mt-1 max-h-28 overflow-y-auto rounded-md border border-border bg-muted/30 p-2 font-mono text-code-compact text-muted-foreground">
                    {review.check.dirtyFiles.slice(0, 20).map((file) => (
                      <div key={file} className="truncate" title={file}>
                        {file}
                      </div>
                    ))}
                    {review.check.dirtyFiles.length > 20 ? (
                      <div>+{review.check.dirtyFiles.length - 20} more</div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
        {review && !ready ? (
          <Banner status="warning" title={review.kept ? "Worktree kept" : "Keeping this worktree"}>
            {review.kept ??
              "Resolve the items above, then check again. You can still remove it yourself from the list."}
          </Banner>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>{ready ? "Cancel" : "Close"}</AlertDialogCancel>
          {ready ? (
            <AlertDialogAction variant="destructive" disabled={busy} onClick={onRetire}>
              {pending ? "Removing…" : checking ? "Checking…" : "Retire worktree"}
            </AlertDialogAction>
          ) : (
            <Button type="button" variant="outline" disabled={busy} onClick={onCheckAgain}>
              {checking ? (
                <LoaderCircle
                  className="animate-spin"
                  data-icon="inline-start"
                  aria-hidden="true"
                />
              ) : (
                <RefreshCw data-icon="inline-start" aria-hidden="true" />
              )}
              Check again
            </Button>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** Attached tasks plus any other running task OpenCode found inside the worktree. */
function TaskList({ check }: { check: RetirementCheck }) {
  const running = new Set(check.activeTasks?.map((task) => task.id));
  const rows = [
    ...check.attachedTasks.map((task) => ({ id: task.id, title: task.title })),
    ...(check.activeTasks ?? []).filter(
      (active) => !check.attachedTasks.some((task) => task.id === active.id),
    ),
  ];
  if (rows.length === 0) return null;
  return (
    <ul className="mt-1 space-y-0.5 text-meta text-muted-foreground">
      {rows.slice(0, 5).map((task) => (
        <li key={task.id} className="truncate">
          {task.title?.trim() || "Untitled task"}
          {running.has(task.id) ? " · Running" : ""}
        </li>
      ))}
      {rows.length > 5 ? <li>+{rows.length - 5} more</li> : null}
    </ul>
  );
}
