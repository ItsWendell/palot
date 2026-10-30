import { describe, expect, it, vi } from "vitest";
import type { PalotSession } from "../../../shared";
import type { PullRequestLink, PullRequestSnapshot } from "../../../shared/source-control-contract";
import type { RetirementCheck } from "./merged-worktree-retirement";
import { cleanMergedWorktrees } from "./worktree-cleanup";

const pr: PullRequestSnapshot = {
  host: "github.com",
  repository: "o/r",
  number: 1,
  title: "Merged",
  url: "https://github.com/o/r/pull/1",
  state: "merged",
  checks: "passing",
  reviewDecision: null,
  mergeable: "mergeable",
  headBranch: "feature",
  baseBranch: "main",
  author: null,
  updatedAt: 1,
  mergedAt: 1,
  closedAt: 1,
};
const task = (directory: string): PalotSession => ({
  id: directory,
  projectID: "project",
  parentID: null,
  title: directory,
  agent: null,
  model: null,
  location: { directory },
  createdAt: 1,
  updatedAt: 1,
  archivedAt: null,
  cost: null,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
});
const link = (directory: string): PullRequestLink => ({
  profileID: "local",
  sessionID: directory,
  key: "github.com/o/r#1",
  pullRequest: pr,
  source: "url",
  linkedAt: 1,
  syncedAt: 1,
  syncError: null,
  watch: null,
  watchEnded: null,
  settledAt: 1,
});
const clean: RetirementCheck = {
  attachedTasks: [task("/wt")],
  activeTasks: [],
  dirtyFiles: [],
  git: { branch: "feature", oid: "abc", ahead: 0 },
  pullRequestHeadOid: "abc",
};
function fixture() {
  return {
    projectID: "project",
    canonical: "/main",
    worktrees: ["/main", "/wt"].map((directory) => ({ directory, strategy: "git" })),
    sessions: [task("/main"), task("/wt")],
    links: [link("/main"), link("/wt")],
    valid: () => true,
    check: vi.fn(async () => clean),
    remove: vi.fn(async () => undefined),
    cleaned: vi.fn(),
  };
}
describe("worktree cleanup", () => {
  it("removes only the merged managed worktree, never the main checkout, and records it", async () => {
    const input = fixture();
    expect(await cleanMergedWorktrees(input)).toEqual({ removed: 1, kept: 0 });
    expect(input.remove).toHaveBeenCalledExactlyOnceWith("/wt");
    expect(input.cleaned).toHaveBeenCalledOnce();
  });
  it("allows a managed worktree nested inside the main checkout, but not its ancestors", async () => {
    const input = fixture();
    const nested = "/main/.worktrees/feature";
    input.worktrees = ["/", "/main", nested].map((directory) => ({ directory, strategy: "git" }));
    input.sessions = input.worktrees.map(({ directory }) => task(directory));
    input.links = input.worktrees.map(({ directory }) => link(directory));
    await cleanMergedWorktrees(input);
    expect(input.remove).toHaveBeenCalledExactlyOnceWith(nested);
  });
  it("keeps worktrees when any attached PR link failed to refresh", async () => {
    const input = fixture();
    input.links[1]!.syncError = "Network unavailable";
    expect(await cleanMergedWorktrees(input)).toEqual({ removed: 0, kept: 1 });
    expect(input.remove).not.toHaveBeenCalled();
  });
  it.each([
    { activeTasks: [{ id: "running", title: null }] },
    { activeTasks: null },
    { dirtyFiles: ["keep.txt"] },
    { dirtyFiles: null },
    { git: { branch: "feature", oid: "abc", ahead: 1 } },
    { git: { branch: "other", oid: "abc", ahead: 0 } },
    { pullRequestHeadOid: null },
    { pullRequestHeadOid: "new-head" },
  ])("keeps unsafe or unreadable state: %j", async (changed) => {
    const input = fixture();
    input.check.mockResolvedValue({ ...clean, ...changed });
    expect(await cleanMergedWorktrees(input)).toEqual({ removed: 0, kept: 1 });
    expect(input.remove).not.toHaveBeenCalled();
  });
  it("does not remove after the owning connection or preference changes during a check", async () => {
    const input = fixture();
    let valid = true;
    input.valid = () => valid;
    input.check.mockImplementation(async () => {
      valid = false;
      return clean;
    });
    await cleanMergedWorktrees(input);
    expect(input.remove).not.toHaveBeenCalled();
  });
  it("never retries a removal refusal with force", async () => {
    const input = fixture();
    input.remove.mockRejectedValue({ forceRequired: true });
    expect(await cleanMergedWorktrees(input)).toEqual({ removed: 0, kept: 1 });
    expect(input.remove).toHaveBeenCalledTimes(1);
    expect(input.cleaned).not.toHaveBeenCalled();
  });
});
