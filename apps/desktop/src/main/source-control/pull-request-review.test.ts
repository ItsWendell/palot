// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import type { SourceControlChangedEvent } from "../../shared/source-control-contract";
import { toSourceControlFailure } from "./errors";
import { GitHubApiError, type GitHubGateway } from "./github-client";
import { pullRequestSearchQuery, sanitizeSearchText } from "./github-pull-requests";
import { classifyMergeFailure, decodeTimelineCursor } from "./github-review";
import { PullRequestReviewService } from "./pull-request-review";

const HEAD = "a".repeat(40);
const REF = { host: "github.com", repository: "Acme/Web", number: 7 };
const KEY = "github.com/acme/web#7";
const at = (minute: number) => new Date(Date.UTC(2026, 9, 10, 12, minute)).toISOString();

type GraphQlCall = { operation: string; variables: Record<string, unknown>; priority: string };
type Answer = unknown | ((variables: Record<string, unknown>) => unknown);

/** Answers GraphQL documents by their operation name and records every request. */
function fakeGitHub(answers: Record<string, Answer | Answer[]> = {}) {
  const graphqlCalls: GraphQlCall[] = [];
  const restCalls: Array<{ path: string; method: string; body: unknown; priority: string }> = [];
  const restAnswers: Array<(path: string) => unknown> = [];
  const queues = new Map<string, Answer[]>();
  for (const [name, value] of Object.entries(answers))
    queues.set(name, Array.isArray(value) ? [...value] : [value]);
  const graphql = vi.fn(async (input: Parameters<GitHubGateway["graphql"]>[0]) => {
    const operation = /(?:query|mutation)\s+(\w+)/.exec(input.query)?.[1] ?? "";
    const variables = input.variables ?? {};
    graphqlCalls.push({ operation, variables, priority: input.priority });
    const queue = queues.get(operation);
    if (!queue?.length) return {};
    const answer = queue.length > 1 ? queue.shift() : queue[0];
    if (answer instanceof Error) throw answer;
    return typeof answer === "function" ? (answer as (v: unknown) => unknown)(variables) : answer;
  });
  const rest = vi.fn(async (input: Parameters<GitHubGateway["rest"]>[0]) => {
    restCalls.push({
      path: input.path,
      method: input.method ?? "GET",
      body: input.body,
      priority: input.priority,
    });
    for (const answer of restAnswers) {
      const value = answer(input.path);
      if (value instanceof Error) throw value;
      if (value !== undefined) return { status: 200, data: value, notModified: false };
    }
    return { status: 200, data: {}, notModified: false };
  });
  const gateway = {
    graphql,
    rest,
    graphqlPartial: vi.fn(),
    credential: async () => ({ source: "env" as const, fingerprint: "github.com:fake" }),
    pausedUntil: () => null,
  } as unknown as GitHubGateway;
  return { gateway, graphqlCalls, restCalls, restAnswers };
}

function service(github: ReturnType<typeof fakeGitHub>) {
  const events: SourceControlChangedEvent[] = [];
  const syncLinks = vi.fn();
  return {
    events,
    syncLinks,
    review: new PullRequestReviewService({
      github: github.gateway,
      emit: (event) => events.push(event),
      syncLinks,
    }),
  };
}

function context(name: string, extra: Record<string, unknown> = {}) {
  return {
    __typename: "CheckRun",
    name,
    status: "COMPLETED",
    conclusion: "SUCCESS",
    detailsUrl: `https://ci/${name}`,
    startedAt: at(1),
    completedAt: at(2),
    isRequired: false,
    checkSuite: { app: { name: "GitHub Actions" }, workflowRun: { workflow: { name: "CI" } } },
    ...extra,
  };
}

function detailAnswer(
  overrides: Record<string, unknown> = {},
  contexts: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: unknown[] } = {
    pageInfo: { hasNextPage: false, endCursor: null },
    nodes: [context("build", { isRequired: true })],
  },
) {
  return {
    viewer: { login: "me" },
    repository: {
      mergeCommitAllowed: true,
      squashMergeAllowed: true,
      rebaseMergeAllowed: false,
      viewerDefaultMergeMethod: "SQUASH",
      viewerPermission: "WRITE",
      pullRequest: {
        id: "PR_7",
        number: 7,
        title: "Fix login",
        url: "https://github.com/acme/web/pull/7",
        state: "OPEN",
        isDraft: false,
        body: "Body **text**",
        createdAt: at(0),
        updatedAt: at(30),
        mergedAt: null,
        closedAt: null,
        headRefName: "fix",
        baseRefName: "main",
        headRefOid: HEAD,
        mergeable: "MERGEABLE",
        mergeStateStatus: "BLOCKED",
        reviewDecision: "REVIEW_REQUIRED",
        additions: 10,
        deletions: 2,
        changedFiles: 3,
        totalCommits: { totalCount: 4 },
        author: { __typename: "User", login: "alice", avatarUrl: "https://a" },
        repository: { nameWithOwner: "Acme/Web" },
        labels: { nodes: [{ name: "bug", color: "d73a4a" }] },
        assignees: { nodes: [{ __typename: "User", login: "bob", avatarUrl: null }] },
        reviewRequests: {
          nodes: [
            { requestedReviewer: { __typename: "Team", combinedSlug: "acme/core" } },
            { requestedReviewer: { __typename: "User", login: "carol", avatarUrl: null } },
          ],
        },
        latestReviews: {
          nodes: [
            {
              state: "APPROVED",
              author: { __typename: "Bot", login: "review-bot", avatarUrl: null },
            },
            { state: "CHANGES_REQUESTED", author: { __typename: "User", login: "carol" } },
          ],
        },
        autoMergeRequest: null,
        viewerCanUpdate: true,
        viewerDidAuthor: false,
        viewerCanMergeAsAdmin: false,
        viewerLatestReview: { state: "COMMENTED" },
        commits: {
          nodes: [
            { commit: { id: "C_1", oid: HEAD, statusCheckRollup: { state: "SUCCESS", contexts } } },
          ],
        },
        ...overrides,
      },
    },
  };
}

describe("pull request detail", () => {
  it("edits only title/body, toggles one label, and guards branch updates with the head", async () => {
    const github = fakeGitHub({ PalotPullRequestDetail: detailAnswer() });
    github.restAnswers.push((path) =>
      path.includes("/labels?") ? [{ name: "bug", color: "ff0000" }] : undefined,
    );
    const { review, syncLinks } = service(github);
    await review.edit({ ...REF, title: " Revised ", body: "New body" });
    expect(await review.labels(REF)).toEqual([{ name: "bug", color: "ff0000" }]);
    await review.setLabel({ ...REF, name: "help/wanted", add: true });
    await review.setLabel({ ...REF, name: "help/wanted", add: false });
    await review.updateBranch({ ...REF, expectedHeadOid: HEAD });
    expect(github.restCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          method: "PATCH",
          path: "repos/acme/web/pulls/7",
          body: { title: "Revised", body: "New body" },
        }),
        expect.objectContaining({
          method: "POST",
          path: "repos/acme/web/issues/7/labels",
          body: { labels: ["help/wanted"] },
        }),
        expect.objectContaining({
          method: "DELETE",
          path: "repos/acme/web/issues/7/labels/help%2Fwanted",
        }),
        expect.objectContaining({
          method: "PUT",
          path: "repos/acme/web/pulls/7/update-branch",
          body: { expected_head_sha: HEAD },
        }),
      ]),
    );
    expect(syncLinks).toHaveBeenCalledWith(KEY);
  });

  it("uses GitHub auto-merge mutations and refuses enabling when the repository disallows it", async () => {
    const answer = detailAnswer();
    const github = fakeGitHub({ PalotPullRequestDetail: answer });
    const { review } = service(github);
    await expect(
      review.setAutoMerge({ ...REF, enabled: true, method: "squash" }),
    ).rejects.toMatchObject({ code: "merge-blocked" });
    Object.assign(answer.repository, { autoMergeAllowed: true });
    await review.setAutoMerge({ ...REF, enabled: true, method: "squash" });
    await review.setAutoMerge({ ...REF, enabled: false, method: "squash" });
    expect(github.graphqlCalls.filter((call) => call.operation.includes("AutoMerge"))).toEqual([
      {
        operation: "PalotEnableAutoMerge",
        variables: { id: "PR_7", method: "SQUASH" },
        priority: "interactive",
      },
      { operation: "PalotDisableAutoMerge", variables: { id: "PR_7" }, priority: "interactive" },
    ]);
  });

  it("maps GitHub's answer to the contract at interactive priority", async () => {
    const github = fakeGitHub({ PalotPullRequestDetail: detailAnswer() });
    const detail = await service(github).review.detail(REF);
    expect(github.graphqlCalls[0]).toMatchObject({
      operation: "PalotPullRequestDetail",
      variables: { owner: "acme", name: "web", number: 7 },
      priority: "interactive",
    });
    expect(detail).toMatchObject({
      host: "github.com",
      repository: "acme/web",
      number: 7,
      state: "open",
      checks: "passing",
      body: "Body **text**",
      authorPerson: { login: "alice", avatarUrl: "https://a", isBot: false },
      labels: [{ name: "bug", color: "d73a4a" }],
      assignees: [{ login: "bob", avatarUrl: null, isBot: false }],
      checksComplete: true,
      additions: 10,
      deletions: 2,
      changedFiles: 3,
      commits: 4,
      headOid: HEAD,
      mergeState: "blocked",
      mergeMethods: ["squash", "merge"],
      autoMerge: null,
      viewer: {
        login: "me",
        canMerge: true,
        canUpdate: true,
        isAuthor: false,
        reviewState: "commented",
      },
    });
    // A re-requested reviewer shows as requested; bots are marked.
    expect(detail.reviewers).toEqual([
      {
        name: "review-bot",
        person: { login: "review-bot", avatarUrl: null, isBot: true },
        isTeam: false,
        state: "approved",
      },
      {
        name: "carol",
        person: { login: "carol", avatarUrl: null, isBot: false },
        isTeam: false,
        state: "requested",
      },
      { name: "acme/core", person: null, isTeam: true, state: "requested" },
    ]);
    expect(detail.checkRuns).toEqual([
      {
        name: "build",
        workflow: "CI",
        status: "completed",
        conclusion: "success",
        required: true,
        url: "https://ci/build",
        startedAt: Date.parse(at(1)),
        completedAt: Date.parse(at(2)),
      },
    ]);
  });

  it("derives merge permission from admin rights or write access only", async () => {
    const readOnly = detailAnswer();
    readOnly.repository.viewerPermission = "READ";
    const admin = detailAnswer({ viewerCanMergeAsAdmin: true });
    admin.repository.viewerPermission = "TRIAGE";
    await expect(
      service(fakeGitHub({ PalotPullRequestDetail: readOnly })).review.detail(REF),
    ).resolves.toMatchObject({ viewer: { canMerge: false } });
    await expect(
      service(fakeGitHub({ PalotPullRequestDetail: admin })).review.detail(REF),
    ).resolves.toMatchObject({ viewer: { canMerge: true } });
  });

  it("pages through every check of the head commit, and flags a partial list", async () => {
    const first = detailAnswer(
      {},
      {
        pageInfo: { hasNextPage: true, endCursor: "c1" },
        nodes: [context("build")],
      },
    );
    const page = (oid: string, more: boolean) => ({
      node: {
        oid,
        statusCheckRollup: {
          contexts: {
            pageInfo: { hasNextPage: more, endCursor: more ? "c2" : null },
            nodes: [context("lint", { status: "IN_PROGRESS", conclusion: null })],
          },
        },
      },
    });
    const complete = fakeGitHub({
      PalotPullRequestDetail: first,
      PalotPullRequestChecks: page(HEAD, false),
    });
    const detail = await service(complete).review.detail(REF);
    expect(complete.graphqlCalls[1]).toMatchObject({
      operation: "PalotPullRequestChecks",
      variables: { id: "C_1", after: "c1" },
    });
    expect(detail.checksComplete).toBe(true);
    expect(detail.checkRuns.map((check) => [check.name, check.status])).toEqual([
      ["build", "completed"],
      ["lint", "in-progress"],
    ]);

    const moved = fakeGitHub({
      PalotPullRequestDetail: first,
      PalotPullRequestChecks: page("b".repeat(40), false),
    });
    await expect(service(moved).review.detail(REF)).resolves.toMatchObject({
      checksComplete: false,
    });
    const failing = fakeGitHub({
      PalotPullRequestDetail: first,
      PalotPullRequestChecks: new GitHubApiError("network", "offline"),
    });
    await expect(service(failing).review.detail(REF)).resolves.toMatchObject({
      checksComplete: false,
    });
  });

  it("reports a missing pull request", async () => {
    const github = fakeGitHub({ PalotPullRequestDetail: { repository: { pullRequest: null } } });
    await expect(service(github).review.detail(REF)).rejects.toMatchObject({
      code: "github-not-found",
    });
  });
});

describe("pull request timeline", () => {
  const actor = { __typename: "User", login: "alice", avatarUrl: null };
  const threads = {
    repository: {
      pullRequest: {
        reviewThreads: {
          pageInfo: { hasNextPage: false },
          nodes: [
            {
              id: "T_late",
              isResolved: true,
              isOutdated: false,
              viewerCanResolve: false,
              viewerCanUnresolve: true,
              viewerCanReply: true,
              path: "b.ts",
              line: 9,
              diffSide: "RIGHT",
              comments: {
                nodes: [
                  {
                    id: "TC2",
                    author: actor,
                    body: "later",
                    path: "b.ts",
                    line: 9,
                    diffHunk: "@@",
                    createdAt: at(50),
                    url: "u",
                  },
                ],
              },
            },
            {
              id: "T_early",
              isResolved: false,
              isOutdated: true,
              viewerCanResolve: true,
              viewerCanUnresolve: false,
              viewerCanReply: true,
              path: "a.ts",
              line: null,
              originalLine: 4,
              diffSide: "LEFT",
              comments: {
                nodes: [
                  {
                    id: "TC1",
                    author: { __typename: "Bot", login: "lint-bot" },
                    body: "nit",
                    path: "a.ts",
                    line: null,
                    originalLine: 4,
                    startLine: null,
                    originalStartLine: 2,
                    diffHunk: "@@ -1 +1 @@",
                    createdAt: at(5),
                    url: "u1",
                  },
                ],
              },
            },
          ],
        },
      },
    },
  };
  const page1 = {
    repository: {
      pullRequest: {
        timelineItems: {
          pageInfo: { hasNextPage: true, endCursor: "t1" },
          nodes: [
            {
              __typename: "IssueComment",
              id: "IC1",
              author: actor,
              body: "hi",
              createdAt: at(1),
              updatedAt: at(2),
              url: "c1",
            },
            {
              __typename: "PullRequestReview",
              id: "R_pending",
              author: actor,
              body: "",
              state: "PENDING",
              submittedAt: null,
              createdAt: at(3),
            },
            {
              __typename: "PullRequestReview",
              id: "R_envelope",
              author: actor,
              body: "",
              state: "COMMENTED",
              submittedAt: at(6),
              url: "r",
            },
            {
              __typename: "PullRequestCommit",
              id: "PC1",
              commit: {
                oid: HEAD,
                message: "Fix",
                committedDate: at(8),
                author: { name: "Alice", avatarUrl: null, user: null },
              },
            },
            {
              __typename: "LabeledEvent",
              id: "LE1",
              actor,
              createdAt: at(10),
              label: { name: "bug" },
            },
          ],
        },
      },
    },
  };
  const page2 = {
    repository: {
      pullRequest: {
        timelineItems: {
          pageInfo: { hasNextPage: false, endCursor: "t2" },
          nodes: [
            {
              __typename: "HeadRefForcePushedEvent",
              id: "FP",
              actor,
              createdAt: at(40),
              beforeCommit: { oid: "1234567890" },
              afterCommit: { oid: "abcdef0123" },
            },
            {
              __typename: "PullRequestReview",
              id: "R2",
              author: actor,
              body: "lgtm",
              state: "APPROVED",
              submittedAt: at(55),
              url: "r2",
            },
            {
              __typename: "MergedEvent",
              id: "ME",
              actor,
              createdAt: at(60),
              mergeRefName: "main",
              commit: { oid: "fedcba9876" },
            },
          ],
        },
      },
    },
  };

  it("merges review threads into the page whose window they fall in, oldest first", async () => {
    const github = fakeGitHub({
      PalotPullRequestTimeline: [page1, page2],
      PalotPullRequestThreads: threads,
    });
    const { review } = service(github);
    const first = await review.timeline({ ...REF, limit: 5 });
    expect(first.items.map((item) => item.id)).toEqual(["IC1", "T_early", "PC1", "LE1"]);
    expect(first.items[1]).toMatchObject({
      kind: "review-thread",
      path: "a.ts",
      line: 4,
      isOutdated: true,
      viewerCanResolve: true,
      comments: [
        {
          author: { login: "lint-bot", isBot: true },
          line: 4,
          startLine: 2,
          side: "LEFT",
          diffHunk: "@@ -1 +1 @@",
        },
      ],
    });
    expect(first.items[2]).toMatchObject({
      kind: "commit",
      author: { login: "Alice", isBot: false },
    });
    expect(decodeTimelineCursor(first.nextCursor!)).toEqual({
      after: "t1",
      through: Date.parse(at(10)),
    });

    const second = await review.timeline({ ...REF, cursor: first.nextCursor });
    expect(
      github.graphqlCalls
        .filter((call) => call.operation === "PalotPullRequestTimeline")
        .map((call) => call.variables.after),
    ).toEqual([null, "t1"]);
    expect(second.items.map((item) => item.id)).toEqual(["FP", "T_late", "R2", "ME"]);
    expect(second.items[0]).toMatchObject({
      kind: "event",
      type: "force-pushed",
      detail: "1234567 → abcdef0",
    });
    // A resolved thread reports whether the viewer may unresolve it.
    expect(second.items[1]).toMatchObject({ isResolved: true, viewerCanResolve: true });
    expect(second.items[3]).toMatchObject({ type: "merged", detail: "fedcba9 into main" });
    expect(second.nextCursor).toBeNull();
  });

  it("rejects a forged cursor", async () => {
    const github = fakeGitHub();
    await expect(
      service(github).review.timeline({ ...REF, cursor: "not-a-cursor" }),
    ).rejects.toMatchObject({
      code: "invalid-input",
    });
    expect(github.graphqlCalls).toEqual([]);
  });
});

describe("pull request files", () => {
  function viewedPage(paths: string[], next: string | null, changedFiles = paths.length) {
    return {
      repository: {
        pullRequest: {
          id: "PR_7",
          headRefOid: HEAD,
          changedFiles,
          files: {
            pageInfo: { hasNextPage: next !== null, endCursor: next },
            nodes: paths.map((path) => ({
              path,
              viewerViewedState: path === "f0.ts" ? "VIEWED" : "DISMISSED",
            })),
          },
        },
      },
    };
  }
  const restFile = (index: number) => ({
    filename: `f${index}.ts`,
    status: index === 0 ? "renamed" : "modified",
    previous_filename: index === 0 ? "old.ts" : undefined,
    additions: 1,
    deletions: 0,
    ...(index === 1 ? {} : { patch: `@@ ${index}` }),
  });

  it("merges REST patches with GitHub's viewed marks across pages", async () => {
    const github = fakeGitHub({
      PalotPullRequestFiles: [viewedPage(["f0.ts"], "v1", 150), viewedPage(["f1.ts"], null, 150)],
    });
    github.restAnswers.push((path) => {
      const page = Number(/&page=(\d+)/.exec(path)?.[1]);
      return Array.from({ length: page === 1 ? 100 : 50 }, (_, index) =>
        restFile((page - 1) * 100 + index),
      );
    });
    const files = await service(github).review.files(REF);
    expect(github.restCalls.map((call) => call.path)).toEqual([
      "repos/acme/web/pulls/7/files?per_page=100&page=1",
      "repos/acme/web/pulls/7/files?per_page=100&page=2",
    ]);
    expect(files.headOid).toBe(HEAD);
    expect(files.truncated).toBe(false);
    expect(files.files).toHaveLength(150);
    expect(files.files[0]).toEqual({
      path: "f0.ts",
      previousPath: "old.ts",
      status: "renamed",
      additions: 1,
      deletions: 0,
      patch: "@@ 0",
      viewed: "viewed",
    });
    expect(files.files[1]).toMatchObject({ patch: null, viewed: "dismissed" });
    expect(files.files[2]).toMatchObject({ viewed: "unviewed" });
  });

  it("is truncated past GitHub's 3,000-file cap or when a later page fails", async () => {
    const capped = fakeGitHub({ PalotPullRequestFiles: viewedPage([], null, 3_500) });
    capped.restAnswers.push((path) => {
      const page = Number(/&page=(\d+)/.exec(path)?.[1]);
      return Array.from({ length: 100 }, (_, index) => restFile((page - 1) * 100 + index));
    });
    const result = await service(capped).review.files(REF);
    expect(capped.restCalls).toHaveLength(30);
    expect(result).toMatchObject({ truncated: true });
    expect(result.files).toHaveLength(3_000);

    const broken = fakeGitHub({ PalotPullRequestFiles: viewedPage([], null, 150) });
    broken.restAnswers.push((path) =>
      path.endsWith("page=2") ? new GitHubApiError("network", "offline") : [restFile(0)],
    );
    await expect(service(broken).review.files(REF)).resolves.toMatchObject({ truncated: true });
  });
});

describe("pull request actions", () => {
  const nodeID = { repository: { pullRequest: { id: "PR_7" } } };

  it("marks files viewed through the cached node ID and announces it", async () => {
    const github = fakeGitHub({ PalotPullRequestID: nodeID });
    const { review, events } = service(github);
    await review.setFileViewed({ ...REF, path: "src/a.ts", viewed: true });
    await review.setFileViewed({ ...REF, path: "src/a.ts", viewed: false });
    expect(github.graphqlCalls.map((call) => [call.operation, call.variables])).toEqual([
      ["PalotPullRequestID", { owner: "acme", name: "web", number: 7 }],
      ["PalotMarkViewed", { id: "PR_7", path: "src/a.ts" }],
      ["PalotUnmarkViewed", { id: "PR_7", path: "src/a.ts" }],
    ]);
    expect(events).toEqual([
      { type: "pull-request", key: KEY, reason: "viewed" },
      { type: "pull-request", key: KEY, reason: "viewed" },
    ]);
  });

  it("submits one REST review with anchored and multi-line comments", async () => {
    const github = fakeGitHub();
    const { review, events } = service(github);
    await review.review({
      ...REF,
      event: "request-changes",
      body: "Please fix",
      commitOid: HEAD,
      comments: [
        { path: "a.ts", line: 4, side: "RIGHT", body: "one line" },
        { path: "b.ts", line: 9, startLine: 7, side: "LEFT", body: "range" },
      ],
    });
    expect(github.restCalls).toEqual([
      {
        path: "repos/acme/web/pulls/7/reviews",
        method: "POST",
        priority: "interactive",
        body: {
          event: "REQUEST_CHANGES",
          body: "Please fix",
          commit_id: HEAD,
          comments: [
            { path: "a.ts", line: 4, side: "RIGHT", body: "one line" },
            {
              path: "b.ts",
              line: 9,
              side: "LEFT",
              start_line: 7,
              start_side: "LEFT",
              body: "range",
            },
          ],
        },
      },
    ]);
    expect(events).toEqual([{ type: "pull-request", key: KEY, reason: "reviewed" }]);
  });

  it("refuses reviews GitHub would reject, without a request", async () => {
    const github = fakeGitHub();
    const { review } = service(github);
    const base = { ...REF, commitOid: HEAD, comments: [] };
    await expect(
      review.review({ ...base, event: "request-changes", body: " " }),
    ).rejects.toMatchObject({ code: "invalid-input", message: expect.stringContaining("summary") });
    await expect(review.review({ ...base, event: "comment", body: "" })).rejects.toMatchObject({
      code: "invalid-input",
    });
    await expect(review.review({ ...base, event: "approve", body: "" })).resolves.toBeUndefined();
    await expect(
      review.review({
        ...base,
        event: "comment",
        body: "",
        comments: [{ path: "a", line: 2, startLine: 5, side: "RIGHT", body: "x" }],
      }),
    ).rejects.toMatchObject({ code: "invalid-input" });
    expect(github.restCalls).toHaveLength(1);
  });

  it("comments, replies and resolves only on threads of this pull request", async () => {
    const owner = (number: number) => ({
      node: { pullRequest: { number, repository: { nameWithOwner: "acme/web" } } },
    });
    const github = fakeGitHub({
      PalotPullRequestID: nodeID,
      PalotReviewThreadOwner: [owner(7), owner(7), owner(8)],
    });
    const { review, events } = service(github);
    await review.comment({ ...REF, body: "Thanks" });
    await review.reply({ ...REF, threadID: "T1", body: "Done" });
    await review.resolve({ ...REF, threadID: "T1", resolved: true });
    await expect(review.resolve({ ...REF, threadID: "T9", resolved: false })).rejects.toMatchObject(
      { code: "invalid-input" },
    );
    expect(github.graphqlCalls.map((call) => [call.operation, call.variables])).toEqual([
      ["PalotPullRequestID", { owner: "acme", name: "web", number: 7 }],
      ["PalotComment", { id: "PR_7", body: "Thanks" }],
      ["PalotReviewThreadOwner", { id: "T1" }],
      ["PalotThreadReply", { id: "T1", body: "Done" }],
      ["PalotReviewThreadOwner", { id: "T1" }],
      ["PalotResolveThread", { id: "T1" }],
      ["PalotReviewThreadOwner", { id: "T9" }],
    ]);
    expect(events.map((event) => event.type === "pull-request" && event.reason)).toEqual([
      "commented",
      "commented",
      "commented",
    ]);
  });

  it("merges against the reviewed head, syncs linked tasks and returns fresh detail", async () => {
    const github = fakeGitHub({
      PalotPullRequestID: nodeID,
      PalotPullRequestDetail: detailAnswer({ state: "MERGED", mergedAt: at(70) }),
    });
    const { review, events, syncLinks } = service(github);
    const detail = await review.merge({
      ...REF,
      method: "squash",
      expectedHeadOid: HEAD,
      commitTitle: " Fix login (#7) ",
      commitBody: "",
    });
    expect(github.graphqlCalls[1]).toEqual({
      operation: "PalotMerge",
      priority: "interactive",
      variables: {
        input: {
          pullRequestId: "PR_7",
          mergeMethod: "SQUASH",
          expectedHeadOid: HEAD,
          commitHeadline: "Fix login (#7)",
          commitBody: "",
        },
      },
    });
    expect(detail.state).toBe("merged");
    expect(events).toEqual([{ type: "pull-request", key: KEY, reason: "merged" }]);
    expect(syncLinks).toHaveBeenCalledWith(KEY);

    // Rebase merges carry no message.
    await review.merge({ ...REF, method: "rebase", expectedHeadOid: HEAD, commitTitle: "ignored" });
    expect(github.graphqlCalls.at(-2)?.variables).toEqual({
      input: { pullRequestId: "PR_7", mergeMethod: "REBASE", expectedHeadOid: HEAD },
    });
  });

  it.each([
    ["Head branch was modified. Review and try the merge again.", "merge-head-moved"],
    ["Pull Request is not mergeable", "merge-not-mergeable"],
    ['Required status check "build" is expected.', "merge-checks-required"],
    ["At least 1 approving review is required by reviewers with write access.", "merge-blocked"],
    ["Repository rule violations found", "merge-blocked"],
  ])("maps the merge refusal %j to %s", async (message, code) => {
    const github = fakeGitHub({
      PalotPullRequestID: nodeID,
      PalotMerge: new GitHubApiError("response", `GitHub returned an error: ${message}`, {
        githubMessages: [message],
      }),
    });
    const { review, events, syncLinks } = service(github);
    const failure = await review
      .merge({ ...REF, method: "merge", expectedHeadOid: HEAD })
      .catch((error: unknown) => error);
    expect(toSourceControlFailure(failure)).toMatchObject({ code, detail: message });
    expect(events).toEqual([]);
    expect(syncLinks).not.toHaveBeenCalled();
  });

  it("closes, reopens and toggles drafts, syncing linked tasks each time", async () => {
    const github = fakeGitHub({
      PalotPullRequestID: nodeID,
      PalotPullRequestDetail: detailAnswer(),
    });
    const { review, events, syncLinks } = service(github);
    await review.setState({ ...REF, state: "closed" });
    await review.setState({ ...REF, state: "open" });
    await review.setDraft({ ...REF, draft: true });
    await review.setDraft({ ...REF, draft: false });
    expect(
      github.graphqlCalls
        .map((call) => call.operation)
        .filter((name) => name !== "PalotPullRequestDetail"),
    ).toEqual(["PalotPullRequestID", "PalotClose", "PalotReopen", "PalotDraft", "PalotReady"]);
    expect(events.map((event) => event.type === "pull-request" && event.reason)).toEqual([
      "state",
      "state",
      "state",
      "state",
    ]);
    expect(syncLinks).toHaveBeenCalledTimes(4);
  });

  it("requests users and the owner's teams, refusing teams of other organizations", async () => {
    const github = fakeGitHub({ PalotPullRequestDetail: detailAnswer() });
    const { review, events } = service(github);
    await review.requestReviewers({ ...REF, reviewers: ["carol", "@dave", "Acme/core"] });
    expect(github.restCalls[0]).toEqual({
      path: "repos/acme/web/pulls/7/requested_reviewers",
      method: "POST",
      priority: "interactive",
      body: { reviewers: ["carol", "dave"], team_reviewers: ["core"] },
    });
    expect(events).toEqual([{ type: "pull-request", key: KEY, reason: "reviewers" }]);
    await expect(
      review.requestReviewers({ ...REF, reviewers: ["other/core"] }),
    ).rejects.toMatchObject({ code: "invalid-input" });
    expect(github.restCalls).toHaveLength(1);
  });

  it("maps refused permissions to a forbidden code", () => {
    expect(toSourceControlFailure(new GitHubApiError("forbidden", "no"))).toMatchObject({
      code: "github-forbidden",
    });
    expect(classifyMergeFailure(["Something unrelated"])).toBeNull();
  });

  it("rejects malformed refs before any request", async () => {
    const github = fakeGitHub();
    await expect(
      service(github).review.detail({
        host: "github.com",
        repository: "acme/web/extra",
        number: 7,
      }),
    ).rejects.toMatchObject({ code: "invalid-input" });
    expect(github.graphqlCalls).toEqual([]);
  });
});

describe("pull request search", () => {
  it("adds the assigned and mentioned lists", () => {
    expect(pullRequestSearchQuery("assigned").search).toContain("assignee:@me");
    expect(pullRequestSearchQuery("mentioned").search).toContain("mentions:@me");
  });

  it("lists others' open pull requests only within a repository, organization or user", () => {
    expect(pullRequestSearchQuery("others", "org:acme no:assignee").search).toBe(
      "is:pr is:open archived:false -author:@me sort:updated-desc org:acme no:assignee",
    );
    expect(pullRequestSearchQuery("others", "repo:acme/web").search).toContain("repo:acme/web");
    for (const unscoped of [undefined, "", "label:bug", "notorg:acme"])
      expect(() => pullRequestSearchQuery("others", unscoped)).toThrow(
        "Choose a repository or organization",
      );
  });

  it("appends sanitized user text to every list", () => {
    expect(pullRequestSearchQuery("authored", "  repo:acme/web\nlabel:bug\u0000 ").search).toBe(
      "is:pr is:open archived:false author:@me sort:updated-desc repo:acme/web label:bug",
    );
    expect(sanitizeSearchText("a\u2028b\r\nc")).toBe("a b c");
    expect(sanitizeSearchText("x".repeat(1_000))).toHaveLength(256);
    expect(pullRequestSearchQuery("authored", " \n ").search).not.toMatch(/\s$/);
  });
});
