import { describe, expect, it } from "vitest";
import type { GitFileStatus, GitWorkingTreeStatus } from "../../shared/source-control-contract";
import { decideShipStep, needsUpstreamCheck, suggestBranchName, type ShipInput } from "./ship-step";

function file(path: string, overrides: Partial<GitFileStatus> = {}): GitFileStatus {
  return {
    path,
    originalPath: null,
    index: ".",
    worktree: "M",
    staged: false,
    unstaged: true,
    untracked: false,
    conflicted: false,
    ...overrides,
  };
}

function tree(
  branch: Partial<GitWorkingTreeStatus["branch"]> = {},
  files: GitFileStatus[] = [],
): GitWorkingTreeStatus {
  return {
    root: "/repo",
    branch: {
      name: "feature",
      oid: "abc1234",
      upstream: "origin/feature",
      ahead: 0,
      behind: 0,
      ...branch,
    },
    files,
    truncated: false,
  };
}

const open = { state: "open" as const, number: 7, url: "https://github.com/a/b/pull/7" };

function decide(input: Partial<ShipInput> & Pick<ShipInput, "tree">) {
  const step = decideShipStep({ defaultBranch: "main", pullRequest: null, ...input });
  return step.kind === "run"
    ? { action: step.action, stages: step.stages, newBranch: step.newBranch, commit: step.commit }
    : step;
}

describe("decideShipStep", () => {
  it("commits and pushes changes on a published branch, committing only what is staged", () => {
    expect(decide({ tree: tree({}, [file("a.ts", { staged: true }), file("b.ts")]) })).toEqual({
      action: "commit-push",
      stages: ["generate", "commit", "push"],
      newBranch: false,
      commit: { scope: "staged", count: 1 },
    });
    expect(decide({ tree: tree({}, [file("a.ts"), file("b.ts")]) })).toMatchObject({
      commit: { scope: "all", count: 2 },
    });
  });

  it("commits on an unpublished branch, then pushes it together with a new PR", () => {
    expect(decide({ tree: tree({ upstream: null }, [file("a.ts")]) })).toMatchObject({
      action: "commit",
      stages: ["generate", "commit"],
    });
    expect(decide({ tree: tree({ upstream: null }) })).toMatchObject({
      action: "push-create-pr",
      stages: ["push", "pull-request", "watch"],
    });
  });

  it("pushes commits to an open PR, or pushes and creates one", () => {
    expect(decide({ tree: tree({ ahead: 2 }), pullRequest: open })).toMatchObject({
      action: "push",
      stages: ["push"],
    });
    expect(decide({ tree: tree({ ahead: 2 }) })).toMatchObject({ action: "push-create-pr" });
    expect(decide({ tree: tree({}, [file("a.ts")]), pullRequest: open })).toMatchObject({
      action: "commit-push",
    });
  });

  it("creates a PR for a pushed branch, views an open one, and offers nothing when shipped", () => {
    expect(decide({ tree: tree() })).toMatchObject({
      action: "create-pr",
      stages: ["pull-request", "watch"],
    });
    expect(decide({ tree: tree(), pullRequest: open })).toMatchObject({
      action: "view-pr",
      stages: [],
    });
    expect(decide({ tree: tree(), pullRequest: { ...open, state: "merged" } })).toEqual({
      kind: "none",
    });
    expect(decide({ tree: tree({ name: "main", upstream: "origin/main" }) })).toEqual({
      kind: "none",
    });
    expect(decide({ tree: tree({ oid: null, upstream: null }) })).toEqual({ kind: "none" });
  });

  it("asks for a feature branch before shipping from the default branch", () => {
    expect(
      decide({ tree: tree({ name: "main", upstream: "origin/main" }, [file("a.ts")]) }),
    ).toEqual({
      action: "commit",
      stages: ["branch", "generate", "commit"],
      newBranch: true,
      commit: { scope: "all", count: 1 },
    });
    expect(
      decide({ tree: tree({ name: "main", upstream: "origin/main", ahead: 1 }) }),
    ).toMatchObject({
      action: "push-create-pr",
      stages: ["branch", "push", "pull-request", "watch"],
      newBranch: true,
    });
    // An unknown default branch never asks; the push guard still confirms there.
    expect(
      decide({
        tree: tree({ name: "main", upstream: "origin/main" }, [file("a.ts")]),
        defaultBranch: null,
      }),
    ).toMatchObject({ action: "commit-push", newBranch: false });
  });

  describe("refuses with a reason", () => {
    it("when the branch is behind", () => {
      expect(decide({ tree: tree({ behind: 2 }, [file("a.ts")]) })).toEqual({
        kind: "blocked",
        short: "Behind origin",
        reason: "Branch is behind origin. Pull first.",
      });
    });

    it("when the branch has diverged", () => {
      expect(decide({ tree: tree({ ahead: 1, behind: 1, upstream: "upstream/feature" }) })).toEqual(
        {
          kind: "blocked",
          short: "Diverged",
          reason: "Branch has diverged from upstream. Pull or rebase first.",
        },
      );
    });

    it("on a detached HEAD", () => {
      expect(decide({ tree: tree({ name: null, upstream: null }, [file("a.ts")]) })).toEqual({
        kind: "blocked",
        short: "Detached HEAD",
        reason: "HEAD is detached. Check out a branch first.",
      });
    });

    it("with unresolved conflicts", () => {
      expect(decide({ tree: tree({}, [file("a.ts", { conflicted: true })]) })).toMatchObject({
        kind: "blocked",
        short: "Conflicts",
      });
    });
  });
});

describe("needsUpstreamCheck", () => {
  const check = (branch: Partial<GitWorkingTreeStatus["branch"]>, files: GitFileStatus[] = []) => {
    const status = tree(branch, files);
    return needsUpstreamCheck(
      status,
      decideShipStep({ tree: status, defaultBranch: "main", pullRequest: null }),
    );
  };

  it("checks the upstream before a push, a PR, or blocking for being behind", () => {
    expect(check({ ahead: 1 })).toBe(true);
    expect(check({}, [file("a.ts")])).toBe(true);
    expect(check({})).toBe(true);
    expect(check({ behind: 2 })).toBe(true);
  });

  it("skips branches without an upstream and steps that stay local", () => {
    expect(check({ upstream: null, ahead: 0 })).toBe(false);
    expect(check({ name: "main" }, [file("a.ts")])).toBe(false);
    expect(check({}, [file("a.ts", { conflicted: true })])).toBe(false);
  });
});

describe("suggestBranchName", () => {
  it("slugs the task title under the worktree prefix", () => {
    expect(suggestBranchName("Fix the Login — redirect!", "palot/")).toBe(
      "palot/fix-the-login-redirect",
    );
    expect(suggestBranchName("Ünïcode café", "")).toBe("unicode-cafe");
    expect(suggestBranchName(null, "palot/")).toBe("palot/changes");
  });
});
