/**
 * Runs a shipping step's stages in order (branch, commit, push, pull request, watch) and reports
 * each one by name. A failed stage stops the chain and keeps what earlier stages did: a failed
 * push never undoes the commit before it, and a failed watch never undoes the pull request.
 */
import type {
  GitCommitResult,
  GitPushResult,
  GitWorkingTreeStatus,
  PullRequestLink,
  PullRequestPreparation,
} from "../../shared/source-control-contract";
import {
  decideShipStep,
  needsUpstreamCheck,
  type ShipInput,
  type ShipStage,
  type ShipStep,
} from "./ship-step";

export type ShipStageStatus = "pending" | "running" | "done" | "failed" | "skipped";

export interface ShipStageState {
  stage: ShipStage;
  status: ShipStageStatus;
  text: string;
}

export interface ShipChainDeps {
  createBranch(name: string): Promise<unknown>;
  /** Stages every change, for a commit when nothing was staged. */
  stageAll(): Promise<unknown>;
  commit(message: string): Promise<GitCommitResult>;
  push(confirmDefaultBranch: boolean): Promise<GitPushResult>;
  /** The push guard stopped a push that may update the default branch; true pushes anyway. */
  confirmDefaultBranchPush(): Promise<boolean>;
  preparePullRequest(): Promise<PullRequestPreparation>;
  /** Opens the Create PR dialog; resolves with the link once created, or null when dismissed. */
  createPullRequest(prepared: PullRequestPreparation): Promise<PullRequestLink | null>;
  /** Whether to watch the pull request once it exists, read when the stage starts. */
  watchEnabled(): boolean;
  /** Starts the task's watch on the linked pull request. */
  watchPullRequest(link: PullRequestLink): Promise<PullRequestLink>;
  /** A specific reason for a failure, such as Git's rejection. */
  describe(stage: ShipStage, error: unknown): string;
}

export interface ShipChainInput {
  message?: string;
  branchName?: string;
}

const RUNNING: Record<ShipStage, (input: { remote: string; branch: string }) => string> = {
  branch: ({ branch }) => `Creating branch ${branch}…`,
  generate: () => "Generating commit message…",
  commit: () => "Committing…",
  push: ({ remote }) => `Pushing to ${remote}…`,
  "pull-request": () => "Creating PR…",
  watch: () => "Watching PR…",
};

const FAILED: Record<ShipStage, string> = {
  branch: "Branch creation failed",
  generate: "Generating the commit message failed",
  commit: "Commit failed",
  push: "Push failed",
  "pull-request": "PR creation failed",
  watch: "Watching the PR failed",
};

export function runningText(stage: ShipStage, remote: string, branch = ""): string {
  return RUNNING[stage]({ remote, branch });
}

export function failedText(stage: ShipStage, reason: string): string {
  return `${FAILED[stage]}: ${reason}`;
}

export class ShipStageError extends Error {
  constructor(
    readonly stage: ShipStage,
    message: string,
  ) {
    super(message);
  }
}

/** The stages the chain itself runs; generation happens before the person confirms. */
export function chainStages(step: Extract<ShipStep, { kind: "run" }>): ShipStage[] {
  return step.stages.filter((stage) => stage !== "generate");
}

export async function runShipChain(
  step: Extract<ShipStep, { kind: "run" }>,
  input: ShipChainInput,
  deps: ShipChainDeps,
  report: (state: ShipStageState) => void,
): Promise<{ ok: boolean; pullRequest: PullRequestLink | null }> {
  const progress: { current: ShipStage | null } = { current: null };
  let pullRequest: PullRequestLink | null = null;
  const start = (stage: ShipStage) => {
    progress.current = stage;
    report({ stage, status: "running", text: runningText(stage, step.remote, input.branchName) });
  };
  const finish = (stage: ShipStage, text: string, status: ShipStageStatus = "done") => {
    report({ stage, status, text });
    progress.current = null;
  };
  try {
    for (const stage of chainStages(step)) {
      start(stage);
      if (stage === "branch") {
        const name = input.branchName?.trim();
        if (!name) throw new ShipStageError(stage, "Name the new branch.");
        await deps.createBranch(name);
        finish(stage, `Created branch ${name}`);
      } else if (stage === "commit") {
        const message = input.message?.trim();
        if (!message) throw new ShipStageError(stage, "Write a commit message first.");
        if (step.commit?.scope === "all") await deps.stageAll();
        const result = await deps.commit(message);
        finish(stage, `Committed ${result.oid.slice(0, 7)} ${result.summary}`);
      } else if (stage === "push") {
        let result: GitPushResult;
        try {
          result = await deps.push(false);
        } catch (error) {
          if (!isDefaultBranchConfirmation(error)) throw error;
          if (!(await deps.confirmDefaultBranchPush())) {
            finish(stage, "Push cancelled", "skipped");
            return { ok: false, pullRequest };
          }
          report({ stage, status: "running", text: runningText(stage, step.remote) });
          result = await deps.push(true);
        }
        finish(
          stage,
          `${result.setUpstream ? "Published" : "Pushed"} ${result.branch} to ${result.remote}`,
        );
      } else if (stage === "pull-request") {
        const prepared = await deps.preparePullRequest();
        if (prepared.existing) {
          pullRequest = prepared.existing;
          finish(stage, `PR #${prepared.existing.pullRequest.number} already exists`);
          continue;
        }
        if (!prepared.commits.trim())
          throw new ShipStageError(
            stage,
            `No commits to include. ${prepared.branch} has nothing that ${prepared.base} lacks.`,
          );
        pullRequest = await deps.createPullRequest(prepared);
        if (!pullRequest) {
          finish(stage, "PR not created", "skipped");
          return { ok: false, pullRequest };
        }
        finish(stage, `Created PR #${pullRequest.pullRequest.number}`);
      } else if (stage === "watch") {
        if (!pullRequest) {
          finish(stage, "No PR to watch", "skipped");
          continue;
        }
        const number = pullRequest.pullRequest.number;
        if (pullRequest.watch) {
          finish(stage, `Already watching PR #${number}`);
          continue;
        }
        if (!deps.watchEnabled()) {
          finish(stage, "Not watching the PR", "skipped");
          continue;
        }
        try {
          pullRequest = await deps.watchPullRequest(pullRequest);
        } catch (error) {
          // The PR stays: only the watch failed, and it can be started from the PR control.
          finish(stage, failedText(stage, deps.describe(stage, error)), "failed");
          return { ok: false, pullRequest };
        }
        finish(stage, `Watching PR #${number}`);
      }
    }
    return { ok: true, pullRequest };
  } catch (error) {
    const stage = progress.current ?? "commit";
    const reason = error instanceof ShipStageError ? error.message : deps.describe(stage, error);
    report({ stage, status: "failed", text: failedText(stage, reason) });
    return { ok: false, pullRequest };
  }
}

/** A fetch that finished this recently still counts as fresh. */
export const UPSTREAM_FRESH_MS = 30_000;
/** Ship decides on local status rather than wait longer for a slow remote. */
export const UPSTREAM_TIMEOUT_MS = 15_000;

/**
 * Fetches a checkout's upstream at most once per freshness window: callers share a fetch that is
 * still running, and one that finished (or failed) within the window is not repeated. Resolves
 * true when the fetch succeeded; it never rejects.
 */
export function createUpstreamCheck(
  options: { freshMs?: number; timeoutMs?: number; now?: () => number } = {},
) {
  const freshMs = options.freshMs ?? UPSTREAM_FRESH_MS;
  const timeoutMs = options.timeoutMs ?? UPSTREAM_TIMEOUT_MS;
  const now = options.now ?? Date.now;
  const entries = new Map<string, { finishedAt: number | null; result: Promise<boolean> }>();
  return (key: string, fetch: () => Promise<unknown>): Promise<boolean> => {
    const entry = entries.get(key);
    if (entry && (entry.finishedAt === null || now() - entry.finishedAt < freshMs))
      return entry.result;
    const next: { finishedAt: number | null; result: Promise<boolean> } = {
      finishedAt: null,
      result: Promise.resolve(false),
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(false), timeoutMs);
    });
    next.result = Promise.race([
      new Promise((resolve) => resolve(fetch())).then(
        () => true,
        () => false,
      ),
      timeout,
    ]).then((ok) => {
      clearTimeout(timer);
      next.finishedAt = now();
      return ok;
    });
    entries.set(key, next);
    return next.result;
  };
}

export interface FreshShipDecision {
  step: ShipStep;
  tree: GitWorkingTreeStatus;
  /** The upstream fetch failed, so `step` rests on remote-tracking refs as of the last fetch. */
  upstreamUnchecked: boolean;
}

/**
 * Decides the next step on current status. When the step depends on the upstream (a push, a pull
 * request, or being behind), fetches first and decides again on the status after the fetch. A
 * failed fetch falls back to the local status instead of blocking.
 */
export async function decideFreshShipStep(
  context: Omit<ShipInput, "tree">,
  io: {
    readStatus(): Promise<GitWorkingTreeStatus | undefined>;
    fetchUpstream(): Promise<boolean>;
  },
): Promise<FreshShipDecision | null> {
  const local = await io.readStatus();
  if (!local) return null;
  const first = decideShipStep({ ...context, tree: local });
  if (!needsUpstreamCheck(local, first))
    return { step: first, tree: local, upstreamUnchecked: false };
  if (!(await io.fetchUpstream())) return { step: first, tree: local, upstreamUnchecked: true };
  const tree = (await io.readStatus()) ?? local;
  return { step: decideShipStep({ ...context, tree }), tree, upstreamUnchecked: false };
}

function isDefaultBranchConfirmation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: unknown }).code === "default-branch-confirmation"
  );
}
