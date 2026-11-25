/**
 * The task header's one next shipping step, worked out from the task checkout's Git status and
 * its linked pull request. Pure: the button and its tests share it.
 */
import type {
  GitWorkingTreeStatus,
  PullRequestSnapshot,
} from "../../shared/source-control-contract";

export type ShipAction =
  | "commit"
  | "commit-push"
  | "push"
  | "push-create-pr"
  | "create-pr"
  | "view-pr";

/**
 * Stages in the order a chain runs them. Generation happens before the confirm step; watching
 * follows every pull request stage and is skipped when the person turned it off.
 */
export type ShipStage = "branch" | "generate" | "commit" | "push" | "pull-request" | "watch";

export const SHIP_LABEL: Record<ShipAction, string> = {
  commit: "Commit",
  "commit-push": "Commit & push",
  push: "Push",
  "push-create-pr": "Push & create PR",
  "create-pr": "Create PR",
  "view-pr": "View PR",
};

export interface ShipInput {
  tree: GitWorkingTreeStatus;
  /** The remote's default branch, when known. */
  defaultBranch: string | null;
  /** The task's primary linked pull request, if any. */
  pullRequest: Pick<PullRequestSnapshot, "state" | "number" | "url"> | null;
}

export type ShipStep =
  | { kind: "none" }
  | { kind: "blocked"; short: string; reason: string }
  | {
      kind: "run";
      action: ShipAction;
      label: string;
      stages: ShipStage[];
      /** On the default branch: ask for a feature branch first, carrying the changes over. */
      newBranch: boolean;
      /** What a commit includes: the staged files, or all changes when nothing is staged. */
      commit: { scope: "staged" | "all"; count: number } | null;
      remote: string;
    };

function run(
  action: Exclude<ShipAction, never>,
  options: {
    newBranch: boolean;
    commit: ShipStep extends never ? never : { scope: "staged" | "all"; count: number } | null;
    remote: string;
  },
): ShipStep {
  const stages: ShipStage[] = [];
  if (options.newBranch) stages.push("branch");
  if (options.commit) stages.push("generate", "commit");
  if (action === "commit-push" || action === "push" || action === "push-create-pr")
    stages.push("push");
  if (action === "push-create-pr" || action === "create-pr") stages.push("pull-request", "watch");
  return { kind: "run", action, label: SHIP_LABEL[action], stages, ...options };
}

export function decideShipStep({ tree, defaultBranch, pullRequest }: ShipInput): ShipStep {
  const { branch, files } = tree;
  const remote = branch.upstream?.split("/")[0] || "origin";
  if (!branch.name)
    return {
      kind: "blocked",
      short: "Detached HEAD",
      reason: "HEAD is detached. Check out a branch first.",
    };
  if (files.some((file) => file.conflicted))
    return {
      kind: "blocked",
      short: "Conflicts",
      reason: "Resolve the merge conflicts and commit them first.",
    };
  if (branch.upstream && branch.behind > 0)
    return branch.ahead > 0
      ? {
          kind: "blocked",
          short: "Diverged",
          reason: `Branch has diverged from ${remote}. Pull or rebase first.`,
        }
      : {
          kind: "blocked",
          short: `Behind ${remote}`,
          reason: `Branch is behind ${remote}. Pull first.`,
        };

  const openPullRequest =
    pullRequest && (pullRequest.state === "open" || pullRequest.state === "draft")
      ? pullRequest
      : null;
  // Pull requests can't be opened from the default branch into itself.
  const onDefault = defaultBranch !== null && branch.name === defaultBranch && !openPullRequest;
  const staged = files.filter((file) => file.staged).length;

  if (files.length > 0) {
    const commit =
      staged > 0
        ? { scope: "staged" as const, count: staged }
        : { scope: "all" as const, count: files.length };
    // A branch that is not on the remote yet is published together with its pull request.
    if (onDefault || !branch.upstream)
      return run("commit", { newBranch: onDefault, commit, remote });
    return run("commit-push", { newBranch: false, commit, remote });
  }

  if (!branch.oid) return { kind: "none" };
  if (!branch.upstream || branch.ahead > 0) {
    if (openPullRequest) return run("push", { newBranch: false, commit: null, remote });
    return run("push-create-pr", { newBranch: onDefault, commit: null, remote });
  }
  if (openPullRequest)
    return {
      kind: "run",
      action: "view-pr",
      label: SHIP_LABEL["view-pr"],
      stages: [],
      newBranch: false,
      commit: null,
      remote,
    };
  if (onDefault || pullRequest) return { kind: "none" };
  return run("create-pr", { newBranch: false, commit: null, remote });
}

/**
 * Whether `step` depends on how the branch compares with its upstream, which local
 * remote-tracking refs only know as of the last fetch: a push, a pull request, or a block for
 * being behind.
 */
export function needsUpstreamCheck(tree: GitWorkingTreeStatus, step: ShipStep): boolean {
  if (!tree.branch.name || !tree.branch.upstream) return false;
  if (step.kind === "blocked") return tree.branch.behind > 0;
  return (
    step.kind === "run" && step.stages.some((stage) => stage === "push" || stage === "pull-request")
  );
}

/** A feature branch name from the task title: `prefix` plus a short slug. */
export function suggestBranchName(title: string | null, prefix: string): string {
  const slug = (title ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");
  return `${prefix}${slug || "changes"}`;
}
