/**
 * One answer to "can this pull request merge?", shared by the watch in main and every surface
 * that shows a PR. Pure. It reads only what the code host reported: a fact the host did not
 * give is listed as unknown, never guessed, so a verdict is "ready" only when every part is
 * known and clear. Merging stays with the person; this only says what is still missing.
 */
import type {
  PullRequestCheck,
  PullRequestChecksSummary,
  PullRequestDetail,
  PullRequestMergeable,
  PullRequestMergeState,
  PullRequestReviewDecision,
  PullRequestSnapshot,
  PullRequestState,
} from "./source-control-contract";

export type ReadinessCheckOutcome = "pending" | "success" | "failure";

export interface PullRequestReadinessFacts {
  state: PullRequestState;
  /** Undefined when the host doesn't report a review decision; null when none is required. */
  reviewDecision?: PullRequestReviewDecision | null;
  mergeable: PullRequestMergeable;
  /** GitHub's merge state. Undefined when the host doesn't report one. */
  mergeState?: PullRequestMergeState;
  /**
   * Every check with whether it is required, or the host's rollup when only that is known.
   * Null when the host reports no checks at all.
   */
  checks:
    | { list: Array<{ outcome: ReadinessCheckOutcome; required: boolean }>; complete: boolean }
    | PullRequestChecksSummary
    | null;
  /** Review threads nobody resolved. Undefined or null when they were not (fully) read. */
  unresolvedThreads?: number | null;
}

export type ReadinessNeed =
  | { kind: "draft" }
  | { kind: "approval" }
  | { kind: "changes-requested" }
  | { kind: "conflicts" }
  | { kind: "behind" }
  | { kind: "failing-checks"; count: number | null }
  | { kind: "pending-checks"; count: number | null }
  | { kind: "threads"; count: number }
  | { kind: "blocked" };

export type ReadinessPart = "review" | "checks" | "merge-state" | "threads";

export type PullRequestReadiness =
  | { status: "ready" }
  | { status: "needs"; needs: ReadinessNeed[]; unknown: ReadinessPart[] }
  | { status: "unknown"; unknown: ReadinessPart[] };

/**
 * `ready` when nothing stands between the PR and a merge, else what is still needed. Merged and
 * closed PRs have no verdict (null). Checks count when required ones exist, else all of them,
 * the same gate the watch uses for "checks passed".
 */
export function pullRequestReadiness(
  facts: PullRequestReadinessFacts,
): PullRequestReadiness | null {
  if (facts.state === "merged" || facts.state === "closed") return null;
  const needs: ReadinessNeed[] = [];
  const unknown: ReadinessPart[] = [];

  if (facts.state === "draft" || facts.mergeState === "draft") needs.push({ kind: "draft" });

  if (facts.reviewDecision === undefined) unknown.push("review");
  else if (facts.reviewDecision === "review-required") needs.push({ kind: "approval" });
  else if (facts.reviewDecision === "changes-requested") needs.push({ kind: "changes-requested" });

  if (facts.mergeable === "conflicting" || facts.mergeState === "dirty")
    needs.push({ kind: "conflicts" });
  else if (facts.mergeState === "behind") needs.push({ kind: "behind" });
  else if (
    facts.mergeState === "unknown" ||
    (facts.mergeState === undefined && facts.mergeable === "unknown")
  )
    unknown.push("merge-state");

  const checks = facts.checks;
  if (checks === null) unknown.push("checks");
  else if (typeof checks === "string") {
    // A rollup counts every check. GitHub's "unstable" says only optional ones are not green,
    // but not whether any are required, so the gate can't be told from the rollup alone.
    if (checks === "failing" || checks === "pending") {
      if (facts.mergeState === "unstable") unknown.push("checks");
      else
        needs.push({
          kind: checks === "failing" ? "failing-checks" : "pending-checks",
          count: null,
        });
    }
  } else {
    const required = checks.list.filter((check) => check.required);
    const gate = required.length > 0 ? required : checks.list;
    const failing = gate.filter((check) => check.outcome === "failure").length;
    const pending = gate.filter((check) => check.outcome === "pending").length;
    if (failing > 0) needs.push({ kind: "failing-checks", count: failing });
    if (pending > 0) needs.push({ kind: "pending-checks", count: pending });
    if (!checks.complete && failing === 0) unknown.push("checks");
  }

  if (facts.unresolvedThreads === undefined || facts.unresolvedThreads === null)
    unknown.push("threads");
  else if (facts.unresolvedThreads > 0)
    needs.push({ kind: "threads", count: facts.unresolvedThreads });

  // Blocked by branch rules that none of the reasons above explain.
  if (facts.mergeState === "blocked" && needs.length === 0) needs.push({ kind: "blocked" });

  if (needs.length > 0) return { status: "needs", needs, unknown };
  if (unknown.length > 0) return { status: "unknown", unknown };
  return { status: "ready" };
}

/** GitHub snapshots carry a merge state (possibly "unknown"); other hosts leave it out. */
function reportsMergeState(snapshot: Pick<PullRequestSnapshot, "mergeState">): boolean {
  return snapshot.mergeState !== undefined;
}

/** Facts from a linked PR's snapshot (task rows, the task header's PR control). */
export function snapshotReadinessFacts(snapshot: PullRequestSnapshot): PullRequestReadinessFacts {
  const github = reportsMergeState(snapshot);
  return {
    state: snapshot.state,
    ...(github || snapshot.reviewDecision !== null
      ? { reviewDecision: snapshot.reviewDecision }
      : {}),
    mergeable: snapshot.mergeable,
    ...(snapshot.mergeState !== undefined ? { mergeState: snapshot.mergeState } : {}),
    checks: github || snapshot.checks !== "none" ? snapshot.checks : null,
    ...(snapshot.unresolvedThreads !== undefined
      ? { unresolvedThreads: snapshot.unresolvedThreads }
      : {}),
  };
}

export function checkOutcome(check: Pick<PullRequestCheck, "status" | "conclusion">) {
  if (check.status !== "completed") return "pending" as const;
  return check.conclusion === "failure" ||
    check.conclusion === "timed-out" ||
    check.conclusion === "cancelled" ||
    check.conclusion === "action-required"
    ? ("failure" as const)
    : ("success" as const);
}

/** Facts from the Pull requests screen's detail, which lists every check with its gate. */
export function detailReadinessFacts(detail: PullRequestDetail): PullRequestReadinessFacts {
  const github = !detail.capabilities;
  const base = snapshotReadinessFacts(detail);
  return {
    ...base,
    ...(github || detail.mergeState !== "unknown" ? { mergeState: detail.mergeState } : {}),
    checks:
      detail.checkRuns.length > 0
        ? {
            list: detail.checkRuns.map((check) => ({
              outcome: checkOutcome(check),
              required: check.required,
            })),
            complete: detail.checksComplete,
          }
        : base.checks,
  };
}

const plural = (count: number, one: string, many = `${one}s`) =>
  `${count} ${count === 1 ? one : many}`;

export function readinessNeedLabel(need: ReadinessNeed): string {
  switch (need.kind) {
    case "draft":
      return "out of draft";
    case "approval":
      return "approval";
    case "changes-requested":
      return "requested changes";
    case "conflicts":
      return "conflicts resolved";
    case "behind":
      return "branch behind";
    case "failing-checks":
      return need.count === null ? "failing checks" : plural(need.count, "failing check");
    case "pending-checks":
      return need.count === null ? "checks running" : `${plural(need.count, "check")} running`;
    case "threads":
      return plural(need.count, "open thread");
    case "blocked":
      return "branch rules";
  }
}

const PART_LABEL: Record<ReadinessPart, string> = {
  review: "review",
  checks: "checks",
  "merge-state": "merge state",
  threads: "threads",
};

/** "Ready to merge", "Still needed: approval, branch behind" or what couldn't be read. */
export function readinessText(readiness: PullRequestReadiness): string {
  if (readiness.status === "ready") return "Ready to merge";
  if (readiness.status === "needs")
    return `Still needed: ${readiness.needs.map(readinessNeedLabel).join(", ")}`;
  return `No blockers seen; can't read ${readiness.unknown.map((part) => PART_LABEL[part]).join(", ")}`;
}
