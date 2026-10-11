import { vi, type Mock } from "vitest";
import type {
  PalotSourceControlApi,
  PullRequestDetail,
  PullRequestLink,
  PullRequestPerson,
  PullRequestSearchList,
  PullRequestSnapshot,
  PullRequestTimelineItem,
  SourceControlChangedEvent,
  SourceControlStatus,
} from "../../../shared/source-control-contract";

export function pullRequest(
  number: number,
  overrides: Partial<PullRequestSnapshot> = {},
): PullRequestSnapshot {
  return {
    host: "github.com",
    repository: "acme/web",
    number,
    title: `Pull request ${number}`,
    url: `https://github.com/acme/web/pull/${number}`,
    state: "open",
    checks: "passing",
    reviewDecision: null,
    mergeable: "mergeable",
    headBranch: "feature",
    baseBranch: "main",
    author: "octocat",
    updatedAt: Date.now() - 2 * 3_600_000,
    mergedAt: null,
    closedAt: null,
    ...overrides,
  };
}

export function pullRequestLink(
  sessionID: string,
  number: number,
  overrides: Partial<Omit<PullRequestLink, "pullRequest">> & {
    pullRequest?: Partial<PullRequestSnapshot>;
  } = {},
): PullRequestLink {
  const { pullRequest: snapshot, ...rest } = overrides;
  return {
    profileID: "profile",
    sessionID,
    key: `github.com/acme/web#${number}`,
    source: "url",
    linkedAt: 1,
    syncedAt: 1,
    syncError: null,
    watch: null,
    watchEnded: null,
    settledAt: null,
    pullRequest: pullRequest(number, snapshot),
    ...rest,
  };
}

export function sourceControlStatus(
  overrides: Omit<Partial<SourceControlStatus>, "github"> & {
    github?: Partial<SourceControlStatus["github"]>;
  } = {},
): SourceControlStatus {
  const { github, ...rest } = overrides;
  const account = {
    host: "github.com",
    authenticated: true,
    source: "gh" as const,
    login: "octocat",
    error: null,
    pausedUntil: null,
    ...github,
  };
  return {
    profileID: "profile",
    supported: true,
    unsupportedReason: null,
    githubHosts: [account],
    ...rest,
    github: account,
  };
}

export function person(login: string, isBot = false): PullRequestPerson {
  return { login, avatarUrl: null, isBot };
}

export function pullRequestDetail(
  number: number,
  overrides: Partial<PullRequestDetail> = {},
): PullRequestDetail {
  return {
    ...pullRequest(number),
    body: "Adds **billing**.",
    authorPerson: person("octocat"),
    labels: [],
    assignees: [],
    reviewers: [],
    checkRuns: [],
    checksComplete: true,
    additions: 10,
    deletions: 2,
    changedFiles: 3,
    commits: 1,
    headOid: "abc1234def",
    mergeState: "clean",
    mergeMethods: ["merge", "squash", "rebase"],
    autoMerge: null,
    viewer: {
      login: "octocat",
      canMerge: true,
      canUpdate: true,
      isAuthor: true,
      reviewState: null,
    },
    createdAt: Date.now() - 86_400_000,
    ...overrides,
  };
}

export function timelineComment(
  id: string,
  body: string,
  author: PullRequestPerson = person("hubot"),
): PullRequestTimelineItem {
  return {
    kind: "comment",
    id,
    author,
    body,
    createdAt: 1,
    updatedAt: 1,
    url: `https://github.com/acme/web/pull/1#${id}`,
  };
}

/** Installs a mocked `window.palot.sourceControl`, merged into any existing bridge. */
type MockedSourceControlApi = {
  [Method in keyof PalotSourceControlApi]: Mock<PalotSourceControlApi[Method]>;
};

export function installSourceControl(overrides: Partial<PalotSourceControlApi> = {}): {
  api: MockedSourceControlApi;
  emit(event: SourceControlChangedEvent): void;
} {
  const listeners = new Set<(event: SourceControlChangedEvent) => void>();
  const unsupported = async () => ({
    ok: false as const,
    error: { code: "internal" as const, message: "Not mocked" },
  });
  const source: PalotSourceControlApi = {
    status: async () => sourceControlStatus(),
    listPullRequestLinks: async () => ({ ok: true, value: [] }),
    linkPullRequest: async (input) => ({ ok: true, value: pullRequestLink(input.sessionID, 1) }),
    unlinkPullRequest: async () => ({ ok: true, value: null }),
    watchPullRequest: async (input) => ({ ok: true, value: pullRequestLink(input.sessionID, 1) }),
    refreshPullRequests: async () => ({ ok: true, value: [] }),
    searchPullRequests: async (input) => ({
      ok: true,
      value: { list: input.list, items: [], totalCount: 0, nextCursor: null },
    }),
    pullRequestDetail: async (ref) => ({ ok: true, value: pullRequestDetail(ref.number) }),
    pullRequestTimeline: async () => ({ ok: true, value: { items: [], nextCursor: null } }),
    pullRequestFiles: async () => ({
      ok: true,
      value: { headOid: "abc1234def", files: [], truncated: false },
    }),
    setPullRequestFileViewed: async () => ({ ok: true, value: null }),
    submitPullRequestReview: async () => ({ ok: true, value: null }),
    addPullRequestComment: async () => ({ ok: true, value: null }),
    replyToPullRequestThread: async () => ({ ok: true, value: null }),
    resolvePullRequestThread: async () => ({ ok: true, value: null }),
    mergePullRequest: async (input) => ({
      ok: true,
      value: pullRequestDetail(input.number, { state: "merged" }),
    }),
    setPullRequestState: async (input) => ({
      ok: true,
      value: pullRequestDetail(input.number, {
        state: input.state === "closed" ? "closed" : "open",
      }),
    }),
    setPullRequestDraft: async (input) => ({
      ok: true,
      value: pullRequestDetail(input.number, { state: input.draft ? "draft" : "open" }),
    }),
    requestPullRequestReviewers: async (input) => ({
      ok: true,
      value: pullRequestDetail(input.number),
    }),
    gitStatus: unsupported,
    gitStage: unsupported,
    gitUnstage: unsupported,
    gitCommit: unsupported,
    gitPush: unsupported,
    onChanged: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    ...overrides,
  };
  const api: MockedSourceControlApi = {
    status: vi.fn(source.status),
    listPullRequestLinks: vi.fn(source.listPullRequestLinks),
    linkPullRequest: vi.fn(source.linkPullRequest),
    unlinkPullRequest: vi.fn(source.unlinkPullRequest),
    watchPullRequest: vi.fn(source.watchPullRequest),
    refreshPullRequests: vi.fn(source.refreshPullRequests),
    searchPullRequests: vi.fn(source.searchPullRequests),
    pullRequestDetail: vi.fn(source.pullRequestDetail),
    pullRequestTimeline: vi.fn(source.pullRequestTimeline),
    pullRequestFiles: vi.fn(source.pullRequestFiles),
    setPullRequestFileViewed: vi.fn(source.setPullRequestFileViewed),
    submitPullRequestReview: vi.fn(source.submitPullRequestReview),
    addPullRequestComment: vi.fn(source.addPullRequestComment),
    replyToPullRequestThread: vi.fn(source.replyToPullRequestThread),
    resolvePullRequestThread: vi.fn(source.resolvePullRequestThread),
    mergePullRequest: vi.fn(source.mergePullRequest),
    setPullRequestState: vi.fn(source.setPullRequestState),
    setPullRequestDraft: vi.fn(source.setPullRequestDraft),
    requestPullRequestReviewers: vi.fn(source.requestPullRequestReviewers),
    gitStatus: vi.fn(source.gitStatus),
    gitStage: vi.fn(source.gitStage),
    gitUnstage: vi.fn(source.gitUnstage),
    gitCommit: vi.fn(source.gitCommit),
    gitPush: vi.fn(source.gitPush),
    onChanged: vi.fn(source.onChanged),
  };
  const existing = (window as { palot?: object }).palot ?? {};
  Object.defineProperty(window, "palot", {
    configurable: true,
    value: { ...existing, sourceControl: api },
  });
  return {
    api,
    emit: (event: SourceControlChangedEvent) => listeners.forEach((listener) => listener(event)),
  };
}

/** A paged search mock: `data[list][cursor ?? ""]` → items and the next cursor. */
export function searchPages(
  data: Partial<
    Record<PullRequestSearchList, Record<string, { items: PullRequestSnapshot[]; next?: string }>>
  >,
): PalotSourceControlApi["searchPullRequests"] {
  return async (input) => {
    const page = data[input.list]?.[input.cursor ?? ""] ?? { items: [] };
    return {
      ok: true,
      value: {
        list: input.list,
        items: page.items,
        totalCount: page.items.length,
        nextCursor: page.next ?? null,
      },
    };
  };
}
