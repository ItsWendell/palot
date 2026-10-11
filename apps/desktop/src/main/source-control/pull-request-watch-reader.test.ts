// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import type { PullRequestSnapshot } from "../../shared/source-control-contract";
import type { PullRequestWatchPage, RawRemark } from "./github-pull-requests";
import { evaluatePullRequestWatch, newPullRequestWatch } from "./pull-request-watch";
import { WATCH_FOLLOW_UP_LIMIT, completeWatchDetail } from "./pull-request-watch-reader";

const SINCE = Date.parse("2026-10-10T12:00:00Z");
const at = (offsetSeconds: number) => new Date(SINCE + offsetSeconds * 1_000).toISOString();

const snapshot = {
  host: "github.com",
  repository: "acme/web",
  number: 7,
  baseBranch: "main",
  mergeable: "mergeable",
} as PullRequestSnapshot;

function comment(id: string, offsetSeconds: number, extra: Partial<RawRemark> = {}): RawRemark {
  return { id, body: id, createdAt: at(offsetSeconds), author: { login: "reviewer" }, ...extra };
}

function page(overrides: Partial<PullRequestWatchPage> = {}): PullRequestWatchPage {
  return {
    pullRequestID: "PR_1",
    commitID: "C_1",
    headSha: "abc1234",
    contexts: [
      { __typename: "CheckRun", name: "build", status: "COMPLETED", conclusion: "SUCCESS" },
    ],
    checksAfter: null,
    comments: [],
    commentsBefore: null,
    reviews: [],
    reviewsBefore: null,
    ...overrides,
  };
}

/** A watch that already reported the passing `build` check on the head commit. */
function told() {
  return {
    ...newPullRequestWatch(SINCE),
    baselined: true,
    headSha: "abc1234",
    passed: true,
    passedChecks: ["build"],
  };
}

function complete(input: PullRequestWatchPage, graphql: ReturnType<typeof vi.fn>) {
  return completeWatchDetail({
    github: { graphql: graphql as never },
    host: "github.com",
    number: 7,
    page: input,
    snapshot,
    since: SINCE,
    priority: "background",
  });
}

describe("completeWatchDetail", () => {
  it("reads every page of checks before calling them complete", async () => {
    const graphql = vi.fn(async () => ({
      node: {
        oid: "abc1234",
        statusCheckRollup: {
          contexts: {
            pageInfo: { hasNextPage: false },
            nodes: [{ __typename: "CheckRun", name: "deploy", status: "IN_PROGRESS" }],
          },
        },
      },
    }));
    const detail = await complete(page({ checksAfter: "cursor-1" }), graphql);
    expect(graphql).toHaveBeenCalledWith(
      expect.objectContaining({ variables: { id: "C_1", after: "cursor-1" } }),
    );
    expect(detail.checksComplete).toBe(true);
    expect(detail.checks.map((check) => [check.name, check.status])).toEqual([
      ["build", "success"],
      ["deploy", "pending"],
    ]);
  });

  it("never announces passing checks from a partial list", async () => {
    const graphql = vi.fn(async () => {
      throw new Error("offline");
    });
    const detail = await complete(page({ checksAfter: "cursor-1" }), graphql);
    expect(detail.checksComplete).toBe(false);
    const watch = evaluatePullRequestWatch(
      newPullRequestWatch(SINCE),
      { ...detail, checks: [{ ...detail.checks[0]!, status: "pending" }], checksComplete: true },
      "me",
    ).next;
    expect(evaluatePullRequestWatch(watch, detail, "me").changes).toEqual([]);
  });

  it("pages back through comments until it reaches the watermark", async () => {
    const graphql = vi
      .fn()
      .mockResolvedValueOnce({
        node: {
          comments: {
            pageInfo: { hasPreviousPage: true, startCursor: "before-2" },
            nodes: [comment("c2", 5)],
          },
        },
      })
      .mockResolvedValueOnce({
        node: {
          comments: {
            pageInfo: { hasPreviousPage: true, startCursor: "before-3" },
            nodes: [comment("old", -5)],
          },
        },
      });
    const detail = await complete(
      page({ comments: [comment("c3", 10)], commentsBefore: "before-1" }),
      graphql,
    );
    expect(graphql).toHaveBeenCalledTimes(2);
    expect(detail.remarksComplete).toBe(true);
    expect(detail.remarks.map((remark) => remark.id)).toEqual(["old", "c2", "c3"]);
  });

  it("reports a reply on an old thread through its new review, timed at submission", async () => {
    const graphql = vi.fn(async () => ({
      node: {
        comments: {
          pageInfo: { hasNextPage: false },
          nodes: [comment("late", -600, { path: "src/b.ts" })],
        },
      },
    }));
    const detail = await complete(
      page({
        reviews: [
          {
            review: { id: "R_1", state: "COMMENTED", body: "", submittedAt: at(30) },
            // Written in a pending review before the watermark, submitted after it.
            comments: [comment("reply", -300, { path: "src/a.ts" })],
            commentsAfter: "after-1",
          },
        ],
      }),
      graphql,
    );
    expect(detail.remarksComplete).toBe(true);
    expect(detail.remarks.map((remark) => [remark.id, remark.path, remark.activeAt])).toEqual([
      ["reply", "src/a.ts", SINCE + 30_000],
      ["late", "src/b.ts", SINCE + 30_000],
    ]);
    const watch = told();
    expect(evaluatePullRequestWatch(watch, detail, "me").changes).toEqual([
      expect.objectContaining({ kind: "remarks" }),
    ]);
  });

  it("holds remarks back when the follow-up budget runs out", async () => {
    let page_ = 0;
    const graphql = vi.fn(async () => {
      page_ += 1;
      return {
        node: {
          comments: {
            pageInfo: { hasPreviousPage: true, startCursor: `before-${page_ + 1}` },
            nodes: [comment(`c${page_}`, 100 - page_)],
          },
        },
      };
    });
    const detail = await complete(
      page({ comments: [comment("newest", 200)], commentsBefore: "before-1" }),
      graphql,
    );
    expect(graphql).toHaveBeenCalledTimes(WATCH_FOLLOW_UP_LIMIT);
    expect(detail.remarksComplete).toBe(false);
    const watch = told();
    const report = evaluatePullRequestWatch(watch, detail, "me");
    expect(report.changes).toEqual([]);
    expect(report.next.remarksThrough).toBe(SINCE);
  });

  it("makes no follow-up read when nothing was truncated", async () => {
    const graphql = vi.fn();
    const detail = await complete(page({ comments: [comment("c1", 5)] }), graphql);
    expect(graphql).not.toHaveBeenCalled();
    expect(detail).toMatchObject({ checksComplete: true, remarksComplete: true });
  });
});
