import { describe, expect, it, vi } from "vitest";
import type {
  GitBranchStatus,
  PullRequestLink,
  PullRequestPreparation,
} from "../../shared/source-control-contract";
import type { GitWorkingTreeStatus } from "../../shared/source-control-contract";
import {
  createUpstreamCheck,
  decideFreshShipStep,
  runShipChain,
  type ShipChainDeps,
  type ShipStageState,
} from "./ship-chain";
import { decideShipStep } from "./ship-step";

const branch: GitBranchStatus = {
  name: "feature",
  oid: "abc1234",
  upstream: "origin/feature",
  ahead: 0,
  behind: 0,
};

function runStep(kind: "commit-push" | "push-create-pr") {
  const step =
    kind === "commit-push"
      ? decideShipStep({
          tree: {
            root: "/repo",
            branch,
            truncated: false,
            files: [
              {
                path: "a.ts",
                originalPath: null,
                index: ".",
                worktree: "M",
                staged: false,
                unstaged: true,
                untracked: false,
                conflicted: false,
              },
            ],
          },
          defaultBranch: "main",
          pullRequest: null,
        })
      : decideShipStep({
          tree: { root: "/repo", branch: { ...branch, ahead: 1 }, truncated: false, files: [] },
          defaultBranch: "main",
          pullRequest: null,
        });
  if (step.kind !== "run") throw new Error("expected a runnable step");
  return step;
}

const prepared: PullRequestPreparation = {
  branch: "feature",
  base: "main",
  branches: ["main"],
  diff: "diff",
  commits: "abc1234 Add a",
  pushed: true,
  existing: null,
};

function deps(overrides: Partial<ShipChainDeps> = {}): ShipChainDeps {
  return {
    createBranch: vi.fn(async () => undefined),
    stageAll: vi.fn(async () => undefined),
    commit: vi.fn(async () => ({ oid: "def5678abc", summary: "feat: add a", branch })),
    push: vi.fn(async () => ({
      remote: "origin",
      branch: "feature",
      setUpstream: false,
      branchStatus: branch,
    })),
    confirmDefaultBranchPush: vi.fn(async () => true),
    preparePullRequest: vi.fn(async () => prepared),
    createPullRequest: vi.fn(async () => null),
    watchEnabled: () => true,
    watchPullRequest: vi.fn(async (link: PullRequestLink) => ({
      ...link,
      watch: { startedAt: 1, commentWakes: 0, readFailures: 0, lastWakeAt: null },
    })),
    describe: (_stage, error) => (error instanceof Error ? error.message : String(error)),
    ...overrides,
  };
}

function collect() {
  const states: ShipStageState[] = [];
  return { states, report: (state: ShipStageState) => states.push(state) };
}

describe("runShipChain", () => {
  it("stages everything, commits and pushes, naming each stage", async () => {
    const chain = deps();
    const { states, report } = collect();
    const result = await runShipChain(
      runStep("commit-push"),
      { message: "feat: add a" },
      chain,
      report,
    );
    expect(result.ok).toBe(true);
    expect(chain.stageAll).toHaveBeenCalled();
    expect(chain.commit).toHaveBeenCalledWith("feat: add a");
    expect(states.map((state) => `${state.status}: ${state.text}`)).toEqual([
      "running: Committing…",
      "done: Committed def5678 feat: add a",
      "running: Pushing to origin…",
      "done: Pushed feature to origin",
    ]);
  });

  it("names the failed push and keeps the commit before it", async () => {
    const chain = deps({ push: vi.fn(async () => Promise.reject(new Error("remote rejected"))) });
    const { states, report } = collect();
    const result = await runShipChain(
      runStep("commit-push"),
      { message: "feat: add a" },
      chain,
      report,
    );
    expect(result.ok).toBe(false);
    expect(states.at(-1)).toEqual({
      stage: "push",
      status: "failed",
      text: "Push failed: remote rejected",
    });
    expect(states).toContainEqual({
      stage: "commit",
      status: "done",
      text: "Committed def5678 feat: add a",
    });
  });

  it("asks before a push the default-branch guard stopped, and pushes only when confirmed", async () => {
    const guard = Object.assign(new Error("may update main"), {
      code: "default-branch-confirmation",
    });
    const push = vi.fn(async (confirmed: boolean) => {
      if (!confirmed) throw guard;
      return { remote: "origin", branch: "feature", setUpstream: false, branchStatus: branch };
    });
    const declined = deps({ push, confirmDefaultBranchPush: vi.fn(async () => false) });
    const first = collect();
    expect(
      (await runShipChain(runStep("commit-push"), { message: "m" }, declined, first.report)).ok,
    ).toBe(false);
    expect(first.states.at(-1)).toMatchObject({ stage: "push", status: "skipped" });
    expect(push).toHaveBeenCalledTimes(1);

    const confirmed = deps({ push });
    expect(
      (await runShipChain(runStep("commit-push"), { message: "m" }, confirmed, collect().report))
        .ok,
    ).toBe(true);
    expect(push).toHaveBeenLastCalledWith(true);
  });

  it("refuses to create a PR with nothing to include", async () => {
    const chain = deps({ preparePullRequest: vi.fn(async () => ({ ...prepared, commits: "" })) });
    const { states, report } = collect();
    await runShipChain(runStep("push-create-pr"), {}, chain, report);
    expect(states.at(-1)).toEqual({
      stage: "pull-request",
      status: "failed",
      text: "PR creation failed: No commits to include. feature has nothing that main lacks.",
    });
    expect(chain.createPullRequest).not.toHaveBeenCalled();
  });

  const link = {
    key: "github.com/o/r#7",
    pullRequest: { number: 7 },
    watch: null,
  } as PullRequestLink;

  it("watches the PR it created, as the stage after the PR", async () => {
    const chain = deps({ createPullRequest: vi.fn(async () => link) });
    const { states, report } = collect();
    const result = await runShipChain(runStep("push-create-pr"), {}, chain, report);
    expect(result.ok).toBe(true);
    expect(chain.watchPullRequest).toHaveBeenCalledWith(link);
    expect(result.pullRequest?.watch).not.toBeNull();
    expect(
      states.slice(-2).map((state) => `${state.stage} ${state.status}: ${state.text}`),
    ).toEqual(["watch running: Watching PR…", "watch done: Watching PR #7"]);
  });

  it("watches a PR that already existed, and skips the watch when turned off", async () => {
    const existing = deps({
      preparePullRequest: vi.fn(async () => ({ ...prepared, existing: link })),
    });
    await runShipChain(runStep("push-create-pr"), {}, existing, collect().report);
    expect(existing.watchPullRequest).toHaveBeenCalledWith(link);

    const off = deps({ createPullRequest: vi.fn(async () => link), watchEnabled: () => false });
    const { states, report } = collect();
    expect((await runShipChain(runStep("push-create-pr"), {}, off, report)).ok).toBe(true);
    expect(off.watchPullRequest).not.toHaveBeenCalled();
    expect(states.at(-1)).toEqual({
      stage: "watch",
      status: "skipped",
      text: "Not watching the PR",
    });
  });

  it("keeps the PR when starting the watch fails", async () => {
    const chain = deps({
      createPullRequest: vi.fn(async () => link),
      watchPullRequest: vi.fn(async () => Promise.reject(new Error("not signed in"))),
    });
    const { states, report } = collect();
    const result = await runShipChain(runStep("push-create-pr"), {}, chain, report);
    expect(result).toEqual({ ok: false, pullRequest: link });
    expect(states).toContainEqual({ stage: "pull-request", status: "done", text: "Created PR #7" });
    expect(states.at(-1)).toEqual({
      stage: "watch",
      status: "failed",
      text: "Watching the PR failed: not signed in",
    });
  });

  it("refuses to commit without a message", async () => {
    const chain = deps();
    const { states, report } = collect();
    await runShipChain(runStep("commit-push"), { message: "  " }, chain, report);
    expect(states.at(-1)).toMatchObject({
      stage: "commit",
      status: "failed",
      text: "Commit failed: Write a commit message first.",
    });
    expect(chain.commit).not.toHaveBeenCalled();
  });
});

describe("decideFreshShipStep", () => {
  const context = { defaultBranch: "main", pullRequest: null };
  const status = (overrides: Partial<GitBranchStatus>): GitWorkingTreeStatus => ({
    root: "/repo",
    branch: { ...branch, ...overrides },
    truncated: false,
    files: [],
  });

  it("fetches before a push and decides on the status after the fetch", async () => {
    // Local refs say one commit ahead; the remote has moved on, so the fetch reveals divergence.
    const reads = [status({ ahead: 1 }), status({ ahead: 1, behind: 2 })];
    const fetchUpstream = vi.fn(async () => true);
    const decision = await decideFreshShipStep(context, {
      readStatus: async () => reads.shift(),
      fetchUpstream,
    });
    expect(fetchUpstream).toHaveBeenCalledTimes(1);
    expect(decision).toMatchObject({
      step: { kind: "blocked", short: "Diverged" },
      upstreamUnchecked: false,
    });
  });

  it("clears a stale behind once the fetch shows the branch is up to date", async () => {
    const reads = [status({ ahead: 1, behind: 1 }), status({ ahead: 1, behind: 0 })];
    const decision = await decideFreshShipStep(context, {
      readStatus: async () => reads.shift(),
      fetchUpstream: async () => true,
    });
    expect(decision?.step).toMatchObject({ kind: "run", action: "push-create-pr" });
  });

  it("falls back to the local status when the fetch fails, and says so", async () => {
    const readStatus = vi.fn(async () => status({ ahead: 1 }));
    const decision = await decideFreshShipStep(context, {
      readStatus,
      fetchUpstream: async () => false,
    });
    expect(decision).toMatchObject({
      step: { kind: "run", action: "push-create-pr" },
      upstreamUnchecked: true,
    });
    expect(readStatus).toHaveBeenCalledTimes(1);
  });

  it("does not fetch for a step that never talks to the remote", async () => {
    const fetchUpstream = vi.fn(async () => true);
    const decision = await decideFreshShipStep(context, {
      readStatus: async () => status({ upstream: null }),
      fetchUpstream,
    });
    expect(decision?.step).toMatchObject({ kind: "run", action: "push-create-pr" });
    expect(fetchUpstream).not.toHaveBeenCalled();
  });
});

describe("createUpstreamCheck", () => {
  it("shares a running fetch and skips one that finished within the window", async () => {
    let time = 0;
    const check = createUpstreamCheck({ freshMs: 30_000, now: () => time });
    let finish!: () => void;
    const fetch = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    const first = check("repo", fetch);
    const second = check("repo", fetch);
    finish();
    expect(await Promise.all([first, second])).toEqual([true, true]);
    expect(fetch).toHaveBeenCalledTimes(1);

    time = 29_000;
    expect(await check("repo", fetch)).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(await check("other", async () => undefined)).toBe(true);

    time = 31_000;
    expect(await check("repo", async () => Promise.reject(new Error("offline")))).toBe(false);
  });

  it("gives up on a fetch that takes too long", async () => {
    vi.useFakeTimers();
    try {
      const check = createUpstreamCheck({ timeoutMs: 1_000 });
      const result = check("repo", () => new Promise(() => {}));
      await vi.advanceTimersByTimeAsync(1_000);
      expect(await result).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
