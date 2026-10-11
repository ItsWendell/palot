// @vitest-environment node

import { describe, expect, it } from "vitest";
import type {
  PullRequestCheck,
  PullRequestRemark,
  PullRequestWatchDetail,
} from "./github-pull-requests";
import {
  PULL_REQUEST_WATCH_COMMENT_LIMIT,
  evaluatePullRequestWatch,
  newPullRequestWatch,
  pullRequestWatchMessage,
  type PullRequestWatchState,
} from "./pull-request-watch";

const START = Date.parse("2026-10-10T10:00:00Z");

function check(
  name: string,
  status: PullRequestCheck["status"],
  required = false,
): PullRequestCheck {
  return { name, status, conclusion: status === "failure" ? "failure" : null, required, url: null };
}

function remark(id: string, author: string, at: number): PullRequestRemark {
  return {
    id,
    author,
    body: `comment ${id}`,
    activeAt: at,
    url: null,
    path: null,
    reviewState: null,
  };
}

function detail(overrides: Partial<PullRequestWatchDetail> = {}): PullRequestWatchDetail {
  return {
    headSha: "abc1234",
    checks: [check("build", "pending"), check("lint", "pending")],
    checksComplete: true,
    mergeable: "mergeable",
    baseBranch: "main",
    remarks: [],
    remarksComplete: true,
    ...overrides,
  };
}

/** A watch that already recorded its starting point against `detail()`. */
function baselined(overrides: Partial<PullRequestWatchDetail> = {}): PullRequestWatchState {
  return evaluatePullRequestWatch(newPullRequestWatch(START), detail(overrides), "me").next;
}

describe("evaluatePullRequestWatch", () => {
  it("records the starting point without waking for old news", () => {
    const report = evaluatePullRequestWatch(
      newPullRequestWatch(START),
      detail({ checks: [check("build", "failure")], mergeable: "conflicting" }),
      "me",
    );
    expect(report.changes).toEqual([]);
    expect(report.next).toMatchObject({
      baselined: true,
      failedChecks: ["build"],
      conflicting: true,
    });
  });

  it("wakes when a check newly fails, and again when a rerun fails", () => {
    const watch = baselined();
    const failed = evaluatePullRequestWatch(
      watch,
      detail({ checks: [check("build", "failure"), check("lint", "pending")] }),
      "me",
    );
    expect(failed.changes).toEqual([
      { kind: "checks-failed", failed: [check("build", "failure")] },
    ]);
    const unchanged = evaluatePullRequestWatch(
      failed.next,
      detail({ checks: [check("build", "failure"), check("lint", "pending")] }),
      "me",
    );
    expect(unchanged.changes).toEqual([]);
    const rerun = evaluatePullRequestWatch(unchanged.next, detail(), "me");
    const again = evaluatePullRequestWatch(
      rerun.next,
      detail({ checks: [check("build", "failure"), check("lint", "pending")] }),
      "me",
    );
    expect(again.changes.map((change) => change.kind)).toEqual(["checks-failed"]);
  });

  it("reports passing once the required checks pass, even with optional ones pending", () => {
    const watch = baselined({
      checks: [check("build", "pending", true), check("bot", "pending")],
    });
    const report = evaluatePullRequestWatch(
      watch,
      detail({ checks: [check("build", "success", true), check("bot", "pending")] }),
      "me",
    );
    expect(report.changes).toEqual([{ kind: "checks-passed", count: 1, required: true }]);
    expect(
      evaluatePullRequestWatch(
        report.next,
        detail({ checks: [check("build", "success", true), check("bot", "success")] }),
        "me",
      ).changes,
    ).toEqual([]);
  });

  it("requires every check to pass when none is required", () => {
    const watch = baselined();
    const partial = evaluatePullRequestWatch(
      watch,
      detail({ checks: [check("build", "success"), check("lint", "pending")] }),
      "me",
    );
    expect(partial.changes).toEqual([]);
    const all = evaluatePullRequestWatch(
      partial.next,
      detail({ checks: [check("build", "success"), check("lint", "success")] }),
      "me",
    );
    expect(all.changes).toEqual([{ kind: "checks-passed", count: 2, required: false }]);
  });

  it("wakes for comments by others since the watch started, not the viewer's own", () => {
    const watch = baselined();
    const report = evaluatePullRequestWatch(
      watch,
      detail({
        remarks: [
          remark("old", "reviewer", START - 1_000),
          remark("own", "Me", START + 1_000),
          remark("new", "reviewer", START + 2_000),
        ],
      }),
      "me",
    );
    expect(report.changes).toEqual([
      { kind: "remarks", remarks: [remark("new", "reviewer", START + 2_000)] },
    ]);
    // Same second, different ID: still news. Already-seen IDs are not.
    const same = evaluatePullRequestWatch(
      report.next,
      detail({
        remarks: [remark("new", "reviewer", START + 2_000), remark("twin", "bot", START + 2_000)],
      }),
      "me",
    );
    expect(same.changes).toEqual([
      { kind: "remarks", remarks: [remark("twin", "bot", START + 2_000)] },
    ]);
  });

  it("wakes when the branch starts to conflict, and keeps it while GitHub recomputes", () => {
    const watch = baselined();
    const conflict = evaluatePullRequestWatch(watch, detail({ mergeable: "conflicting" }), "me");
    expect(conflict.changes).toEqual([{ kind: "conflicting" }]);
    const unknown = evaluatePullRequestWatch(conflict.next, detail({ mergeable: "unknown" }), "me");
    expect(unknown.changes).toEqual([]);
    expect(unknown.next.conflicting).toBe(true);
  });

  it("stops after ten comment-only wakes in a row; other news resets the count", () => {
    let watch = baselined();
    for (let index = 1; index < PULL_REQUEST_WATCH_COMMENT_LIMIT; index += 1) {
      const report = evaluatePullRequestWatch(
        watch,
        detail({ remarks: [remark(`c${index}`, "bot", START + index * 1_000)] }),
        "me",
      );
      expect(report.exhausted).toBe(false);
      watch = report.next;
    }
    expect(watch.commentWakes).toBe(PULL_REQUEST_WATCH_COMMENT_LIMIT - 1);

    const reset = evaluatePullRequestWatch(
      watch,
      detail({
        mergeable: "conflicting",
        remarks: [remark("mixed", "bot", START + 100_000)],
      }),
      "me",
    );
    expect(reset.next.commentWakes).toBe(0);

    watch = baselined();
    let last;
    for (let index = 1; index <= PULL_REQUEST_WATCH_COMMENT_LIMIT; index += 1) {
      last = evaluatePullRequestWatch(
        watch,
        detail({ remarks: [remark(`d${index}`, "bot", START + index * 1_000)] }),
        "me",
      );
      watch = last.next;
    }
    expect(last?.exhausted).toBe(true);
    expect(
      pullRequestWatchMessage({
        number: 7,
        url: "https://github.com/a/b/pull/7",
        baseBranch: "main",
        headSha: "abc1234",
        report: last!,
      }),
    ).toContain("stopped watching after 10 comment-only updates");
  });

  it("tells the agent what changed and to end its turn", () => {
    const watch = baselined();
    const report = evaluatePullRequestWatch(
      watch,
      detail({ checks: [check("build", "failure"), check("lint", "pending")] }),
      "me",
    );
    const text = pullRequestWatchMessage({
      number: 7,
      url: "https://github.com/a/b/pull/7",
      baseBranch: "main",
      headSha: report.next.headSha,
      report,
    });
    expect(text).toContain("Update on pull request #7");
    expect(text).toContain("- Checks failed on abc1234:");
    expect(text).toContain("  - build");
    expect(text).toContain("end your turn when you are done");
  });
});
