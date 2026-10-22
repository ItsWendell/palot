import { describe, expect, it } from "vitest";
import type { PalotSession } from "../../../shared";
import type { PullRequestLink, PullRequestSnapshot } from "../../../shared/source-control-contract";
import {
  attachedTasks,
  canRetire,
  isWithinDirectory,
  mergedWorktreeCandidates,
  retirementChecklist,
  sessionIsActive,
  type RetirementCheck,
} from "./merged-worktree-retirement";

const task = (id: string, directory: string): PalotSession => ({
  id,
  parentID: null,
  projectID: "project",
  title: id,
  agent: null,
  model: null,
  location: { directory },
  createdAt: 1,
  updatedAt: 1,
  archivedAt: null,
  cost: null,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
});

const pullRequest = (
  number: number,
  state: PullRequestSnapshot["state"],
  mergedAt: number | null = null,
): PullRequestSnapshot => ({
  host: "github.com",
  repository: "o/r",
  number,
  title: `PR ${number}`,
  url: `https://github.com/o/r/pull/${number}`,
  state,
  checks: "passing",
  reviewDecision: null,
  mergeable: "unknown",
  headBranch: "feature",
  baseBranch: "main",
  author: null,
  updatedAt: 1,
  mergedAt,
  closedAt: mergedAt,
});

const link = (sessionID: string, snapshot: PullRequestSnapshot): PullRequestLink => ({
  profileID: "profile",
  sessionID,
  key: `github.com/o/r#${snapshot.number}`,
  pullRequest: snapshot,
  source: "branch",
  linkedAt: 1,
  syncedAt: 1,
  syncError: null,
  watch: null,
  watchEnded: null,
  settledAt: null,
});

describe("isWithinDirectory", () => {
  it.each([
    ["/wt", "/wt", true],
    ["/wt/", "/wt", true],
    ["/wt", "/wt/", true],
    ["/wt/packages/app", "/wt", true],
    ["/wt//packages/app/", "/wt/", true],
    ["/wt2", "/wt", false],
    ["/wt2/packages", "/wt", false],
    ["/w", "/wt", false],
    ["/repo", "/repo/.worktrees/x", false],
    ["C:\\wt\\packages", "c:\\wt", true],
    ["C:\\wt2", "C:\\wt", false],
  ])("%s inside %s is %s", (path, root, expected) => {
    expect(isWithinDirectory(path, root)).toBe(expected);
  });

  it("attaches tasks working in the worktree's subdirectories, not in prefix siblings", () => {
    const sessions = [
      task("root", "/wt"),
      task("nested", "/wt/packages/app"),
      task("sibling", "/wt2"),
      task("sibling-nested", "/wt2/packages/app"),
    ];
    expect(attachedTasks(sessions, "project", "/wt/").map((session) => session.id)).toEqual([
      "root",
      "nested",
    ]);
  });
});

describe("mergedWorktreeCandidates", () => {
  it("offers worktrees whose task PRs merged, skipping any with an open PR", () => {
    const sessions = [
      task("merged-task", "/wt/merged/packages/app"),
      task("older-task", "/wt/merged"),
      task("mixed-task", "/wt/mixed"),
      task("mixed-open", "/wt/mixed"),
      task("closed-task", "/wt/closed"),
      { ...task("other-project", "/wt/merged"), projectID: "other" },
    ];
    const linksBySession = new Map([
      ["merged-task", [link("merged-task", pullRequest(2, "merged", 20))]],
      ["older-task", [link("older-task", pullRequest(1, "merged", 10))]],
      ["mixed-task", [link("mixed-task", pullRequest(3, "merged", 30))]],
      ["mixed-open", [link("mixed-open", pullRequest(4, "open"))]],
      ["closed-task", [link("closed-task", pullRequest(5, "closed"))]],
      // An open PR from a task in a subdirectory still blocks its worktree.
      ["nested-open", [link("nested-open", pullRequest(6, "open"))]],
    ]);
    sessions.push(task("nested-open", "/wt/closed/src"), task("prefix", "/wt/merged2"));
    const candidates = mergedWorktreeCandidates({
      worktrees: ["/wt/merged", "/wt/mixed", "/wt/closed", "/wt/none"].map((directory) => ({
        directory,
        strategy: "git",
      })),
      sessions,
      projectID: "project",
      linksBySession,
    });
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ directory: "/wt/merged", pullRequest: { number: 2 } });
    expect(candidates[0]!.attachedTasks.map((session) => session.id)).toEqual([
      "merged-task",
      "older-task",
    ]);
  });
});

describe("retirementChecklist", () => {
  const merged = pullRequest(7, "merged", 1);
  const clean: RetirementCheck = {
    attachedTasks: [task("t", "/wt")],
    activeTasks: [],
    dirtyFiles: [],
    git: { branch: "feature", oid: "abc", ahead: 0 },
    pullRequestHeadOid: "abc",
  };

  it("is ready only when every fresh check passes", () => {
    expect(canRetire(retirementChecklist(clean, merged))).toBe(true);
  });

  it.each([
    ["a running task", { activeTasks: [task("t", "/wt")] }, "tasks", "still running"],
    ["uncommitted files", { dirtyFiles: ["a.ts"] }, "changes", "would be lost"],
    ["unreadable changes", { dirtyFiles: null }, "changes", "Couldn't read"],
    [
      "running tasks OpenCode couldn't confirm",
      { activeTasks: null },
      "tasks",
      "Couldn't confirm with OpenCode",
    ],
    ["an unreadable branch", { git: null }, "commits", "Couldn't read the branch"],
    [
      "another branch",
      { git: { branch: "other", oid: "abc", ahead: 0 } },
      "commits",
      "not the pull request branch feature",
    ],
    [
      "unpushed commits",
      { git: { branch: "feature", oid: "def", ahead: 2 } },
      "commits",
      "2 local commits aren't pushed",
    ],
    ["an unknown PR head", { pullRequestHeadOid: null }, "commits", "head commit"],
    ["a different PR head", { pullRequestHeadOid: "zzz" }, "commits", "may hold unmerged work"],
  ] as const)("keeps the worktree for %s", (_label, change, id, detail) => {
    const items = retirementChecklist({ ...clean, ...change } as RetirementCheck, merged);
    expect(canRetire(items)).toBe(false);
    const item = items.find((candidate) => candidate.id === id)!;
    expect(item.ok).toBe(false);
    expect(item.detail).toContain(detail);
  });
});

describe("sessionIsActive", () => {
  it("counts a busy task or a running sub-agent as active", () => {
    const idle = { activeIDs: new Set<string>(), execution: new Map(), statuses: new Map() };
    expect(sessionIsActive(idle, "t")).toBe(false);
    expect(
      sessionIsActive({ ...idle, statuses: new Map([["t", { type: "busy" as const }]]) }, "t"),
    ).toBe(true);
    expect(
      sessionIsActive(
        {
          ...idle,
          activeIDs: new Set(["child"]),
          execution: new Map([
            [
              "child",
              { status: "running" as const, startedAt: 1, completedAt: null, parentID: "t" },
            ],
          ]),
        },
        "t",
      ),
    ).toBe(true);
  });
});
