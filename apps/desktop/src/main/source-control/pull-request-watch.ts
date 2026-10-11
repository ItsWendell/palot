import { randomUUID } from "node:crypto";
import type {
  PullRequestCheck,
  PullRequestRemark,
  PullRequestWatchDetail,
} from "./github-pull-requests";

/** Comment-only wakes in a row before watching stops; any other news resets the count. */
export const PULL_REQUEST_WATCH_COMMENT_LIMIT = 10;
/** Failed reads in a row (rate limits excluded) before watching stops. */
export const PULL_REQUEST_WATCH_READ_FAILURE_LIMIT = 8;
const LISTED_ITEMS = 10;
const SNIPPET_LENGTH = 200;

/** What a watch has already told the agent. Persisted as JSON with the link. */
export interface PullRequestWatchState {
  /** Identity of this watch; a stop and restart in the same millisecond still differ. */
  id: string;
  startedAt: number;
  /** False until the first read records the starting point without waking. */
  baselined: boolean;
  headSha: string | null;
  failedChecks: string[];
  passed: boolean;
  passedChecks: string[];
  /** Remarks at or before this time (epoch ms) were already seen. */
  remarksThrough: number;
  /** Remarks exactly at `remarksThrough`, told apart by ID since GitHub times are per second. */
  remarkIDs: string[];
  conflicting: boolean;
  commentWakes: number;
  readFailures: number;
  lastWakeAt: number | null;
}

export type PullRequestWatchChange =
  | { kind: "checks-failed"; failed: PullRequestCheck[] }
  | { kind: "checks-passed"; count: number; required: boolean }
  | { kind: "remarks"; remarks: PullRequestRemark[] }
  | { kind: "conflicting" };

export interface PullRequestWatchReport {
  /** What the agent has not been told yet. Empty means no wake. */
  changes: PullRequestWatchChange[];
  /** The state to record whether or not anything is reported. */
  next: PullRequestWatchState;
  /** This report spends the last comment-only wake, so watching stops after it. */
  exhausted: boolean;
}

export function newPullRequestWatch(startedAt: number, id = randomUUID()): PullRequestWatchState {
  return {
    id,
    startedAt,
    baselined: false,
    headSha: null,
    failedChecks: [],
    passed: false,
    passedChecks: [],
    remarksThrough: startedAt,
    remarkIDs: [],
    conflicting: false,
    commentWakes: 0,
    readFailures: 0,
    lastWakeAt: null,
  };
}

/**
 * Compares a watched pull request with what its agent was last told. The first read only
 * records the starting point (checks already failing or passing, an existing conflict), so
 * turning a watch on never wakes the agent with old news; remarks posted after the watch
 * started still count. Afterwards each check is reported as soon as it fails, "passed" once
 * the required checks (or all checks, when none are required) pass, remarks by anyone other
 * than `viewer`, and a branch that starts to conflict. A new head commit resets check state.
 */
export function evaluatePullRequestWatch(
  watch: PullRequestWatchState,
  detail: PullRequestWatchDetail,
  viewer: string | null,
): PullRequestWatchReport {
  const changes: PullRequestWatchChange[] = [];
  const baseline = !watch.baselined;
  const headMoved = detail.headSha !== watch.headSha;

  let failedChecks = headMoved ? [] : watch.failedChecks;
  let passed = headMoved ? false : watch.passed;
  let passedChecks = headMoved ? [] : watch.passedChecks;
  // An empty list keeps the last state: GitHub can answer with one while checks are created.
  if (detail.checks.length > 0) {
    const failed = detail.checks.filter((check) => check.status === "failure");
    const newlyFailed = failed.filter((check) => !failedChecks.includes(check.name));
    if (newlyFailed.length > 0 && !baseline)
      changes.push({ kind: "checks-failed", failed: newlyFailed });
    // A check that reruns leaves the list, so a rerun that fails again is reported. On a partial
    // list, failures on the unread pages are kept so they are not announced again later.
    const seen = new Set(detail.checks.map((check) => check.name));
    failedChecks = [
      ...(detail.checksComplete ? [] : failedChecks.filter((name) => !seen.has(name))),
      ...failed.map((check) => check.name),
    ];

    const required = detail.checks.filter((check) => check.required);
    const gate = required.length > 0 ? required : detail.checks;
    // Checks on unread pages may be pending or failing, so a partial list never passes.
    const passedNow = detail.checksComplete && gate.every((check) => check.status === "success");
    const gateNames = gate.map((check) => check.name);
    // A required check created and finished between two reads is never seen pending.
    const gateGrew = required.length > 0 && gateNames.some((name) => !passedChecks.includes(name));
    if (passedNow && (!passed || gateGrew) && !baseline)
      changes.push({ kind: "checks-passed", count: gate.length, required: required.length > 0 });
    passed = passedNow;
    passedChecks = passedNow ? gateNames : [];
  }

  const own = viewer?.toLowerCase() ?? null;
  // An incomplete read may lack older remarks, so none are reported and the watermark waits.
  const remarks = detail.remarksComplete ? detail.remarks : [];
  const fresh = remarks.filter(
    (remark) =>
      (remark.activeAt > watch.remarksThrough ||
        (remark.activeAt === watch.remarksThrough && !watch.remarkIDs.includes(remark.id))) &&
      (own === null || remark.author?.toLowerCase() !== own),
  );
  if (fresh.length > 0) changes.push({ kind: "remarks", remarks: fresh });
  const latest = Math.max(watch.remarksThrough, ...fresh.map((remark) => remark.activeAt));
  const remarkIDs = [
    ...(latest === watch.remarksThrough ? watch.remarkIDs : []),
    ...fresh.filter((remark) => remark.activeAt === latest).map((remark) => remark.id),
  ];

  if (detail.mergeable === "conflicting" && !watch.conflicting && !baseline)
    changes.push({ kind: "conflicting" });
  // "unknown" is GitHub still computing after a push; only a clean answer clears a conflict.
  const conflicting =
    detail.mergeable === "unknown" ? watch.conflicting : detail.mergeable === "conflicting";

  const commentsOnly = changes.length > 0 && changes.every((change) => change.kind === "remarks");
  const progress = (headMoved && !baseline) || (changes.length > 0 && !commentsOnly);
  const commentWakes = (progress ? 0 : watch.commentWakes) + (commentsOnly ? 1 : 0);
  return {
    changes,
    next: {
      ...watch,
      baselined: true,
      headSha: detail.headSha,
      failedChecks,
      passed,
      passedChecks,
      remarksThrough: latest,
      remarkIDs,
      conflicting,
      commentWakes,
      readFailures: 0,
    },
    exhausted: commentsOnly && commentWakes >= PULL_REQUEST_WATCH_COMMENT_LIMIT,
  };
}

function snippet(body: string): string {
  const text = body
    .replaceAll(/<!--[\s\S]*?-->/g, " ")
    .replaceAll(/\s+/g, " ")
    .trim();
  return text.length <= SNIPPET_LENGTH ? text : `${text.slice(0, SNIPPET_LENGTH - 3)}...`;
}

function listed<T>(items: T[], line: (item: T) => string): string[] {
  const lines = items.slice(0, LISTED_ITEMS).map(line);
  if (items.length > LISTED_ITEMS) lines.push(`  - and ${items.length - LISTED_ITEMS} more`);
  return lines;
}

function changeLines(change: PullRequestWatchChange, baseBranch: string, commit: string) {
  switch (change.kind) {
    case "checks-failed":
      return [
        `- Checks failed${commit}:`,
        ...listed(
          change.failed,
          (check) =>
            `  - ${check.name}${check.conclusion && check.conclusion !== "failure" ? ` (${check.conclusion.replaceAll("_", " ")})` : ""}${check.url ? ` ${check.url}` : ""}`,
        ),
      ];
    case "checks-passed":
      return [
        `- All ${change.count} ${change.required ? "required " : ""}${change.count === 1 ? "check" : "checks"} passed${commit}.`,
      ];
    case "remarks":
      return [
        `- ${change.remarks.length} new ${change.remarks.length === 1 ? "comment" : "comments"}:`,
        ...listed(change.remarks, (remark) => {
          const where = remark.path ? ` on ${remark.path}` : "";
          const body = snippet(remark.body);
          const said = body ? `"${body}"` : (remark.reviewState ?? "reviewed");
          return `  - ${remark.author ?? "someone"}${where}: ${said}${remark.url ? ` ${remark.url}` : ""}`;
        }),
      ];
    case "conflicting":
      return [`- The branch now conflicts with ${baseBranch}.`];
  }
}

/** The queued prompt that wakes the agent. */
export function pullRequestWatchMessage(input: {
  number: number;
  url: string;
  baseBranch: string;
  headSha: string | null;
  report: Pick<PullRequestWatchReport, "changes" | "exhausted">;
}): string {
  const commit = input.headSha ? ` on ${input.headSha.slice(0, 7)}` : "";
  return [
    `Update on pull request #${input.number} (${input.url}), which Palot is watching for you:`,
    ...input.report.changes.flatMap((change) => changeLines(change, input.baseBranch, commit)),
    "",
    input.report.exhausted
      ? `Palot stopped watching after ${PULL_REQUEST_WATCH_COMMENT_LIMIT} comment-only updates in a row. Handle these, then end your turn; the user can turn watching back on.`
      : "Look into each item and act on it as your task requires. Palot keeps watching and wakes you on the next change, so end your turn when you are done. A wake is news, not a merge decision: check readiness yourself before merging.",
  ].join("\n");
}

export function pullRequestUnreadableMessage(input: { number: number; url: string }): string {
  return `Palot stopped watching pull request #${input.number} (${input.url}) because it failed to read it from GitHub ${PULL_REQUEST_WATCH_READ_FAILURE_LIMIT} times in a row. Check it yourself if your task needs it, then end your turn; the user can turn watching back on.`;
}
