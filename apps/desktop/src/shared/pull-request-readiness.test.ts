import { describe, expect, it } from "vitest";
import {
  pullRequestReadiness,
  readinessText,
  snapshotReadinessFacts,
  type PullRequestReadinessFacts,
} from "./pull-request-readiness";
import type { PullRequestSnapshot } from "./source-control-contract";

const clear: PullRequestReadinessFacts = {
  state: "open",
  reviewDecision: "approved",
  mergeable: "mergeable",
  mergeState: "clean",
  checks: { list: [{ outcome: "success", required: true }], complete: true },
  unresolvedThreads: 0,
};

const text = (facts: Partial<PullRequestReadinessFacts>) => {
  const readiness = pullRequestReadiness({ ...clear, ...facts });
  return readiness ? readinessText(readiness) : null;
};

describe("pullRequestReadiness", () => {
  it.each<[string, Partial<PullRequestReadinessFacts>, string | null]>([
    ["everything clear", {}, "Ready to merge"],
    ["no review required", { reviewDecision: null }, "Ready to merge"],
    ["merged", { state: "merged" }, null],
    ["draft", { state: "draft", mergeState: "draft" }, "Still needed: out of draft"],
    [
      "approval and behind",
      { reviewDecision: "review-required", mergeState: "behind" },
      "Still needed: approval, branch behind",
    ],
    [
      "changes requested",
      { reviewDecision: "changes-requested" },
      "Still needed: requested changes",
    ],
    [
      "conflicts",
      { mergeable: "conflicting", mergeState: "dirty" },
      "Still needed: conflicts resolved",
    ],
    [
      "required checks failing and running",
      {
        checks: {
          list: [
            { outcome: "failure", required: true },
            { outcome: "pending", required: true },
            { outcome: "failure", required: false },
          ],
          complete: true,
        },
      },
      "Still needed: 1 failing check, 1 check running",
    ],
    [
      "only optional checks fail",
      {
        mergeState: "unstable",
        checks: {
          list: [
            { outcome: "success", required: true },
            { outcome: "failure", required: false },
          ],
          complete: true,
        },
      },
      "Ready to merge",
    ],
    [
      "every check counts when none is required",
      { checks: { list: [{ outcome: "pending", required: false }], complete: true } },
      "Still needed: 1 check running",
    ],
    ["rollup failing", { checks: "failing" }, "Still needed: failing checks"],
    ["open threads", { unresolvedThreads: 2 }, "Still needed: 2 open threads"],
    [
      "blocked by rules nothing else explains",
      { mergeState: "blocked" },
      "Still needed: branch rules",
    ],
    [
      "blocked explained by a missing approval",
      { mergeState: "blocked", reviewDecision: "review-required" },
      "Still needed: approval",
    ],
    [
      "merge state still computing",
      { mergeState: "unknown" },
      "No blockers seen; can't read merge state",
    ],
    [
      "partial check list with nothing failing",
      { checks: { list: [{ outcome: "success", required: true }], complete: false } },
      "No blockers seen; can't read checks",
    ],
    [
      "optional checks failing seen only in the rollup",
      { mergeState: "unstable", checks: "failing" },
      "No blockers seen; can't read checks",
    ],
  ])("%s", (_name, facts, expected) => {
    expect(text(facts)).toBe(expected);
  });

  it("lists what a host without the data can't tell, instead of guessing ready", () => {
    const gitlab: PullRequestSnapshot = {
      host: "gitlab.com",
      repository: "a/b",
      number: 3,
      title: "Change",
      url: "https://gitlab.com/a/b/-/merge_requests/3",
      state: "open",
      checks: "passing",
      reviewDecision: null,
      mergeable: "mergeable",
      headBranch: "feature",
      baseBranch: "main",
      author: null,
      updatedAt: 0,
      mergedAt: null,
      closedAt: null,
    };
    expect(pullRequestReadiness(snapshotReadinessFacts(gitlab))).toEqual({
      status: "unknown",
      unknown: ["review", "threads"],
    });
    expect(
      pullRequestReadiness(
        snapshotReadinessFacts({ ...gitlab, mergeState: "clean", unresolvedThreads: 0 }),
      ),
    ).toEqual({ status: "ready" });
  });
});
