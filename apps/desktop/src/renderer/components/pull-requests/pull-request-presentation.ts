import {
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  GitPullRequestDraft,
  type LucideIcon,
} from "lucide-react";
import type {
  PullRequestChecksSummary,
  PullRequestLink,
  PullRequestReviewDecision,
  PullRequestSnapshot,
  PullRequestState,
  PullRequestWatchEndReason,
  PullRequestCheck,
  PullRequestDetail,
  PullRequestMergeMethod,
  PullRequestReviewerState,
} from "../../../shared/source-control-contract";
import { SourceControlError } from "../../hooks/use-source-control";

export const PULL_REQUEST_STATE_ICON: Record<PullRequestState, LucideIcon> = {
  open: GitPullRequest,
  draft: GitPullRequestDraft,
  merged: GitMerge,
  closed: GitPullRequestClosed,
};

export const PULL_REQUEST_STATE_LABEL: Record<PullRequestState, string> = {
  open: "Open",
  draft: "Draft",
  merged: "Merged",
  closed: "Closed",
};

/** Semantic theme colors only: the icon shape carries the state too. */
export const PULL_REQUEST_STATE_TEXT: Record<PullRequestState, string> = {
  open: "text-success",
  draft: "text-muted-foreground",
  merged: "text-info",
  closed: "text-destructive",
};

export const CHECKS_LABEL: Record<PullRequestChecksSummary, string> = {
  passing: "Checks passing",
  failing: "Checks failing",
  pending: "Checks running",
  none: "No checks",
};

export const CHECKS_DOT: Record<Exclude<PullRequestChecksSummary, "none">, string> = {
  passing: "bg-success",
  failing: "bg-destructive",
  pending: "bg-warning",
};

export const REVIEW_LABEL: Record<PullRequestReviewDecision, string> = {
  approved: "Approved",
  "changes-requested": "Changes requested",
  "review-required": "Review required",
};

export const WATCH_END_LABEL: Record<PullRequestWatchEndReason, string> = {
  merged: "Stopped watching: the pull request merged",
  closed: "Stopped watching: the pull request closed",
  settled: "Stopped watching: the task was settled",
  "comment-limit": "Stopped watching after 10 comment-only wake-ups",
  unreadable: "Stopped watching: GitHub could not be read",
  stopped: "Stopped watching",
};

export const WATCH_EXPLANATION =
  "Wakes the agent when checks fail or pass, someone reviews, or the branch conflicts.";

export function pullRequestCanWatch(pullRequest: Pick<PullRequestSnapshot, "state">): boolean {
  return pullRequest.state === "open" || pullRequest.state === "draft";
}

/** One-line accessible summary, e.g. "Pull request #12, open, checks failing, conflicts". */
export function describePullRequest(link: Pick<PullRequestLink, "pullRequest" | "watch">): string {
  const { pullRequest } = link;
  const parts = [
    `Pull request #${pullRequest.number}`,
    PULL_REQUEST_STATE_LABEL[pullRequest.state].toLowerCase(),
  ];
  if (pullRequest.checks !== "none") parts.push(CHECKS_LABEL[pullRequest.checks].toLowerCase());
  if (pullRequest.reviewDecision)
    parts.push(REVIEW_LABEL[pullRequest.reviewDecision].toLowerCase());
  if (pullRequest.mergeable === "conflicting") parts.push("has conflicts");
  if (link.watch) parts.push("watching");
  return parts.join(", ");
}

/**
 * The link a compact surface should represent: open work first, then the most recently
 * updated. Rows show one badge; the tooltip and task control list the rest.
 */
export function primaryPullRequestLink(
  links: readonly PullRequestLink[],
): PullRequestLink | undefined {
  const rank = (link: PullRequestLink) =>
    link.pullRequest.state === "open" || link.pullRequest.state === "draft" ? 1 : 0;
  let best: PullRequestLink | undefined;
  for (const link of links) {
    if (
      !best ||
      rank(link) > rank(best) ||
      (rank(link) === rank(best) && link.pullRequest.updatedAt > best.pullRequest.updatedAt)
    )
      best = link;
  }
  return best;
}

/** Identity-equal link arrays: React Query keeps unchanged link objects across refetches. */
export function samePullRequestLinks(
  previous: readonly PullRequestLink[] | undefined,
  next: readonly PullRequestLink[] | undefined,
): boolean {
  if (previous === next) return true;
  if (!previous || !next || previous.length !== next.length) return false;
  return previous.every((link, index) => link === next[index]);
}

export function formatPullRequestTime(timestamp: number, now = Date.now()): string {
  const elapsed = Math.max(0, now - timestamp);
  if (elapsed < 60_000) return "just now";
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}m ago`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}h ago`;
  if (elapsed < 604_800_000) return `${Math.floor(elapsed / 86_400_000)}d ago`;
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(timestamp);
}

export function formatRetryTime(retryAt: number | undefined | null): string | null {
  if (!retryAt) return null;
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(retryAt);
}

export const GITHUB_SIGN_IN_HINT = "Run `gh auth login` or set GH_TOKEN, then try again.";

/** A short, user-facing sentence for a failed source control call. */
export function sourceControlErrorMessage(error: unknown): string {
  if (error instanceof SourceControlError) {
    switch (error.code) {
      case "github-unauthenticated":
        return `GitHub is not signed in. ${GITHUB_SIGN_IN_HINT}`;
      case "github-auth-failed":
        return `GitHub rejected the token. ${GITHUB_SIGN_IN_HINT}`;
      case "github-rate-limited": {
        const retry = formatRetryTime(error.retryAt);
        return retry
          ? `GitHub rate limit reached. Try again after ${retry}.`
          : "GitHub rate limit reached. Try again shortly.";
      }
      case "no-pull-request":
        return "No pull request was found for this task's branch.";
      case "pull-request-not-open":
        return "Only open or draft pull requests can be watched.";
      case "unsupported-connection":
        return "Pull requests are only available for tasks on this computer.";
      case "github-not-found":
        return "GitHub could not find this pull request, or this account cannot see it.";
      case "github-forbidden":
        return "This GitHub account doesn't have permission to do that.";
      case "merge-head-moved":
        return "New commits were pushed since you loaded this pull request. Refresh and review them before merging.";
      case "merge-not-mergeable":
        return "This pull request can't be merged right now. Resolve conflicts or update the branch first.";
      case "merge-checks-required":
        return "Required checks haven't passed yet.";
      case "merge-blocked":
        return error.message || "GitHub blocked this merge.";
      default:
        return error.message;
    }
  }
  return error instanceof Error ? error.message : "Something went wrong.";
}

export const REVIEWER_STATE_LABEL: Record<PullRequestReviewerState, string> = {
  requested: "Awaiting review",
  approved: "Approved",
  "changes-requested": "Changes requested",
  commented: "Commented",
  dismissed: "Dismissed",
};

export const MERGE_METHOD_LABEL: Record<PullRequestMergeMethod, string> = {
  merge: "Create a merge commit",
  squash: "Squash and merge",
  rebase: "Rebase and merge",
};

export const MERGE_METHOD_SHORT: Record<PullRequestMergeMethod, string> = {
  merge: "Merge",
  squash: "Squash",
  rebase: "Rebase",
};

export type CheckGroup = "failing" | "pending" | "passing";

const FAILING_CONCLUSIONS = new Set([
  "failure",
  "timed-out",
  "action-required",
  "cancelled",
  "stale",
]);

export function checkGroup(check: PullRequestCheck): CheckGroup {
  if (check.status !== "completed" || check.conclusion === null) return "pending";
  return FAILING_CONCLUSIONS.has(check.conclusion) ? "failing" : "passing";
}

const CONCLUSION_LABEL: Record<NonNullable<PullRequestCheck["conclusion"]>, string> = {
  success: "Passed",
  failure: "Failed",
  neutral: "Neutral",
  cancelled: "Cancelled",
  skipped: "Skipped",
  "timed-out": "Timed out",
  "action-required": "Action required",
  stale: "Stale",
};

export function checkStatusLabel(check: PullRequestCheck): string {
  if (check.status === "queued") return "Queued";
  if (check.status === "waiting") return "Waiting";
  if (check.status === "in-progress" || check.conclusion === null) return "Running";
  return CONCLUSION_LABEL[check.conclusion];
}

/** Failing first, then running, then passing; stable by name within a group. */
export function groupChecks(checks: readonly PullRequestCheck[]) {
  const groups: Record<CheckGroup, PullRequestCheck[]> = { failing: [], pending: [], passing: [] };
  for (const check of checks) groups[checkGroup(check)].push(check);
  for (const group of Object.values(groups))
    group.sort((left, right) => left.name.localeCompare(right.name));
  return groups;
}

export function formatDuration(milliseconds: number): string {
  const seconds = Math.max(0, Math.round(milliseconds / 1_000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

export function checkDuration(check: PullRequestCheck, now = Date.now()): string | null {
  if (check.startedAt === null) return null;
  return formatDuration((check.completedAt ?? now) - check.startedAt);
}

export interface MergeAvailability {
  /** Why the merge button is disabled, or null when it can merge. */
  blocked: string | null;
  /** A caution that does not block merging. */
  warning: string | null;
}

/** What stands between the viewer and the merge button, in GitHub's own terms. */
export function mergeAvailability(detail: PullRequestDetail): MergeAvailability {
  const none = { blocked: null, warning: null };
  if (detail.state === "merged" || detail.state === "closed") return none;
  if (detail.state === "draft" || detail.mergeState === "draft")
    return {
      blocked: "This pull request is still a draft. Mark it ready for review before merging.",
      warning: null,
    };
  if (!detail.viewer.canMerge)
    return {
      blocked: "You don't have permission to merge into this repository.",
      warning: null,
    };
  if (detail.mergeable === "conflicting" || detail.mergeState === "dirty")
    return {
      blocked: `This branch has conflicts with ${detail.baseBranch} that must be resolved first.`,
      warning: null,
    };
  if (detail.mergeState === "behind")
    return {
      blocked: `This branch is out of date with ${detail.baseBranch}. Update it before merging.`,
      warning: null,
    };
  if (detail.mergeState === "blocked")
    return {
      blocked: "Merging is blocked until required reviews and checks pass.",
      warning: null,
    };
  if (detail.mergeState === "unknown")
    return {
      blocked: "GitHub is still checking whether this can merge. Refresh in a moment.",
      warning: null,
    };
  if (detail.mergeMethods.length === 0)
    return { blocked: "This repository allows no merge method.", warning: null };
  if (detail.mergeState === "unstable")
    return {
      blocked: null,
      warning: "Some checks are failing or still running. They are not required to merge.",
    };
  return none;
}

export function initials(login: string): string {
  const parts = login
    .replace(/\[bot\]$/, "")
    .split(/[-_.\s]+/)
    .filter(Boolean);
  const letters = parts.length > 1 ? `${parts[0]![0]}${parts[1]![0]}` : login.slice(0, 2);
  return letters.toUpperCase();
}
