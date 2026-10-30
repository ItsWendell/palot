import type {
  PullRequestCheck,
  PullRequestCheckConclusion,
  PullRequestDetail,
  PullRequestDraftComment,
  PullRequestFile,
  PullRequestFileViewedState,
  PullRequestMergeMethod,
  PullRequestMergeState,
  PullRequestPerson,
  PullRequestRef,
  PullRequestReviewComment,
  PullRequestReviewInput,
  PullRequestReviewer,
  PullRequestReviewerState,
  PullRequestTimelineItem,
} from "../../shared/source-control-contract";
import {
  toSnapshot,
  type PageInfo,
  type RawConnection,
  type RawSnapshot,
} from "./github-pull-requests";

/**
 * GraphQL documents and pure mappers for the pull request review workspace. Owner, name and
 * user text travel as variables; only validated integers (the PR number) are inlined.
 */

// ---------------------------------------------------------------------------------------------
// References
// ---------------------------------------------------------------------------------------------

const NAME = /^[A-Za-z0-9_.-]{1,100}$/;

export interface NormalizedPullRequestRef extends PullRequestRef {
  owner: string;
  name: string;
}

/** Lowercases and validates a ref; null when it is not `owner/name` plus a positive number. */
export function normalizePullRequestRef(ref: PullRequestRef): NormalizedPullRequestRef | null {
  const host = ref.host.trim().toLowerCase();
  const [owner, name, extra] = ref.repository.trim().split("/");
  if (!host || !owner || !name || extra !== undefined) return null;
  if (!NAME.test(owner) || !NAME.test(name) || name === "." || name === "..") return null;
  if (!Number.isSafeInteger(ref.number) || ref.number <= 0) return null;
  return {
    host,
    repository: `${owner.toLowerCase()}/${name.toLowerCase()}`,
    number: ref.number,
    owner: owner.toLowerCase(),
    name: name.toLowerCase(),
  };
}

// ---------------------------------------------------------------------------------------------
// Shared fragments
// ---------------------------------------------------------------------------------------------

const ACTOR = "__typename login avatarUrl";

function checkContextFields(number: number): string {
  return `__typename
    ... on CheckRun {
      name status conclusion detailsUrl startedAt completedAt
      isRequired(pullRequestNumber: ${number})
      checkSuite { app { name } workflowRun { workflow { name } } }
    }
    ... on StatusContext {
      context state targetUrl createdAt
      isRequired(pullRequestNumber: ${number})
    }`;
}

function assertNumber(number: number): void {
  if (!Number.isSafeInteger(number) || number <= 0)
    throw new Error("Pull request number is invalid");
}

// ---------------------------------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------------------------------

export function detailQuery(number: number): string {
  assertNumber(number);
  return `query PalotPullRequestDetail($owner: String!, $name: String!, $number: Int!) {
    viewer { login }
    repository(owner: $owner, name: $name) {
      mergeCommitAllowed squashMergeAllowed rebaseMergeAllowed autoMergeAllowed
      viewerDefaultMergeMethod viewerPermission
      pullRequest(number: $number) {
        id number title url state isDraft body createdAt updatedAt mergedAt closedAt
        headRefName baseRefName headRefOid mergeable mergeStateStatus reviewDecision
        additions deletions changedFiles
        totalCommits: commits { totalCount }
        author { ${ACTOR} }
        repository { nameWithOwner }
        labels(first: 50) { nodes { name color } }
        assignees(first: 25) { nodes { ${ACTOR} } }
        reviewRequests(first: 50) { nodes { requestedReviewer {
          __typename
          ... on User { login avatarUrl }
          ... on Bot { login avatarUrl }
          ... on Mannequin { login avatarUrl }
          ... on Team { combinedSlug }
        } } }
        latestReviews(first: 50) { nodes { state author { ${ACTOR} } } }
        autoMergeRequest { mergeMethod }
        viewerCanUpdate viewerDidAuthor viewerCanMergeAsAdmin
        viewerLatestReview { state }
        commits(last: 1) { nodes { commit { id oid statusCheckRollup { state
          contexts(first: 100) { pageInfo { hasNextPage endCursor } nodes { ${checkContextFields(number)} } }
        } } } }
      }
    }
  }`;
}

/** The next page of a commit's check contexts, by the commit's node ID. */
export function checksPageQuery(number: number): string {
  assertNumber(number);
  return `query PalotPullRequestChecks($id: ID!, $after: String) { node(id: $id) { ... on Commit {
    oid statusCheckRollup { contexts(first: 100, after: $after) {
      pageInfo { hasNextPage endCursor } nodes { ${checkContextFields(number)} }
    } } } } }`;
}

export interface RawPerson {
  __typename?: string;
  login?: string | null;
  avatarUrl?: string | null;
}

export interface RawCheckContext {
  __typename?: string;
  name?: string | null;
  status?: string | null;
  conclusion?: string | null;
  detailsUrl?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  isRequired?: boolean | null;
  checkSuite?: {
    app?: { name?: string | null } | null;
    workflowRun?: { workflow?: { name?: string | null } | null } | null;
  } | null;
  context?: string | null;
  state?: string | null;
  targetUrl?: string | null;
  createdAt?: string | null;
}

export interface RawDetailPullRequest extends RawSnapshot {
  id?: string;
  body?: string | null;
  createdAt?: string;
  mergeStateStatus?: string | null;
  additions?: number;
  deletions?: number;
  changedFiles?: number;
  totalCommits?: { totalCount?: number } | null;
  author?: RawPerson | null;
  labels?: RawConnection<{ name?: string; color?: string }> | null;
  assignees?: RawConnection<RawPerson> | null;
  reviewRequests?: RawConnection<{
    requestedReviewer?: (RawPerson & { combinedSlug?: string | null }) | null;
  }> | null;
  latestReviews?: RawConnection<{ state?: string | null; author?: RawPerson | null }> | null;
  autoMergeRequest?: { mergeMethod?: string | null } | null;
  viewerCanUpdate?: boolean;
  viewerDidAuthor?: boolean;
  viewerCanMergeAsAdmin?: boolean;
  viewerLatestReview?: { state?: string | null } | null;
  commits?: {
    nodes?: Array<{
      commit?: {
        id?: string;
        oid?: string;
        statusCheckRollup?: {
          state?: string;
          contexts?: RawConnection<RawCheckContext> | null;
        } | null;
      };
    } | null>;
  };
}

export interface RawDetail {
  viewer?: { login?: string | null } | null;
  repository?: {
    autoMergeAllowed?: boolean;
    mergeCommitAllowed?: boolean;
    squashMergeAllowed?: boolean;
    rebaseMergeAllowed?: boolean;
    viewerDefaultMergeMethod?: string | null;
    viewerPermission?: string | null;
    pullRequest?: RawDetailPullRequest | null;
  } | null;
}

/** What the first detail read leaves to page through: the head commit's remaining checks. */
export interface DetailChecksCursor {
  commitID: string;
  headOid: string;
  after: string;
}

export function toPerson(raw: RawPerson | null | undefined): PullRequestPerson | null {
  if (!raw?.login) return null;
  return { login: raw.login, avatarUrl: raw.avatarUrl ?? null, isBot: raw.__typename === "Bot" };
}

const FAILED_CHECK: Record<string, PullRequestCheckConclusion> = {
  SUCCESS: "success",
  FAILURE: "failure",
  NEUTRAL: "neutral",
  CANCELLED: "cancelled",
  SKIPPED: "skipped",
  TIMED_OUT: "timed-out",
  ACTION_REQUIRED: "action-required",
  STALE: "stale",
  STARTUP_FAILURE: "failure",
};

export function toCheck(raw: RawCheckContext): PullRequestCheck | null {
  if (raw.__typename === "StatusContext" || (raw.context && !raw.name)) {
    if (!raw.context) return null;
    const state = raw.state ?? "";
    const completed = state === "SUCCESS" || state === "FAILURE" || state === "ERROR";
    return {
      name: raw.context,
      workflow: null,
      status: completed ? "completed" : state === "EXPECTED" ? "queued" : "in-progress",
      conclusion: !completed ? null : state === "SUCCESS" ? "success" : "failure",
      required: raw.isRequired === true,
      url: raw.targetUrl ?? null,
      startedAt: time(raw.createdAt),
      completedAt: null,
    };
  }
  if (!raw.name) return null;
  const status = raw.status ?? "";
  return {
    name: raw.name,
    workflow: raw.checkSuite?.workflowRun?.workflow?.name ?? raw.checkSuite?.app?.name ?? null,
    status:
      status === "COMPLETED"
        ? "completed"
        : status === "IN_PROGRESS"
          ? "in-progress"
          : status === "WAITING" || status === "PENDING" || status === "REQUESTED"
            ? "waiting"
            : "queued",
    conclusion: status === "COMPLETED" ? (FAILED_CHECK[raw.conclusion ?? ""] ?? "neutral") : null,
    required: raw.isRequired === true,
    url: raw.detailsUrl ?? null,
    startedAt: time(raw.startedAt),
    completedAt: time(raw.completedAt),
  };
}

/** One entry per workflow and check name; a later run of the same check replaces the earlier. */
export function dedupeChecks(checks: PullRequestCheck[]): PullRequestCheck[] {
  const latest = new Map<string, PullRequestCheck>();
  for (const check of checks) {
    const key = `${check.workflow ?? ""}\0${check.name}`;
    const previous = latest.get(key);
    const at = (value: PullRequestCheck) => value.startedAt ?? value.completedAt ?? 0;
    if (!previous || at(check) >= at(previous)) latest.set(key, check);
  }
  return [...latest.values()];
}

const MERGE_METHODS: Record<string, PullRequestMergeMethod> = {
  MERGE: "merge",
  SQUASH: "squash",
  REBASE: "rebase",
};

const MERGE_STATES: Record<string, PullRequestMergeState> = {
  CLEAN: "clean",
  BLOCKED: "blocked",
  BEHIND: "behind",
  DIRTY: "dirty",
  UNSTABLE: "unstable",
  HAS_HOOKS: "has-hooks",
  DRAFT: "draft",
};

const REVIEW_STATES: Record<string, Exclude<PullRequestReviewerState, "requested">> = {
  APPROVED: "approved",
  CHANGES_REQUESTED: "changes-requested",
  COMMENTED: "commented",
  DISMISSED: "dismissed",
};

const WRITE_PERMISSIONS = new Set(["ADMIN", "MAINTAIN", "WRITE"]);

/**
 * Maps the detail answer. Reviewers list everyone who reviewed (their latest verdict), then
 * outstanding requests; a reviewer who was re-requested after reviewing shows as `requested`,
 * which is what GitHub waits on. `checksAfter` is set when the head commit has more checks.
 */
export function parseDetail(
  data: RawDetail,
  ref: NormalizedPullRequestRef,
  extraContexts: RawCheckContext[] = [],
): {
  detail: PullRequestDetail;
  pullRequestID: string;
  checksCursor: DetailChecksCursor | null;
} | null {
  const repository = data.repository;
  const raw = repository?.pullRequest;
  if (!raw?.id) return null;
  const snapshot = toSnapshot(raw, ref.host, ref);
  if (!snapshot) return null;
  const commit = raw.commits?.nodes?.at(-1)?.commit;
  const contexts = commit?.statusCheckRollup?.contexts;
  const checkRuns = dedupeChecks(
    [...present(contexts?.nodes), ...extraContexts].flatMap((context) => {
      const check = toCheck(context);
      return check ? [check] : [];
    }),
  );

  const reviewers = new Map<string, PullRequestReviewer>();
  for (const review of present(raw.latestReviews?.nodes)) {
    const person = toPerson(review.author);
    const state = REVIEW_STATES[review.state ?? ""];
    if (!person || !state) continue;
    reviewers.set(person.login.toLowerCase(), { name: person.login, person, isTeam: false, state });
  }
  for (const request of present(raw.reviewRequests?.nodes)) {
    const reviewer = request.requestedReviewer;
    if (!reviewer) continue;
    if (reviewer.__typename === "Team") {
      if (!reviewer.combinedSlug) continue;
      reviewers.set(reviewer.combinedSlug.toLowerCase(), {
        name: reviewer.combinedSlug,
        person: null,
        isTeam: true,
        state: "requested",
      });
      continue;
    }
    const person = toPerson(reviewer);
    if (!person) continue;
    reviewers.set(person.login.toLowerCase(), {
      name: person.login,
      person,
      isTeam: false,
      state: "requested",
    });
  }

  const allowed = new Set<PullRequestMergeMethod>([
    ...(repository?.mergeCommitAllowed ? (["merge"] as const) : []),
    ...(repository?.squashMergeAllowed ? (["squash"] as const) : []),
    ...(repository?.rebaseMergeAllowed ? (["rebase"] as const) : []),
  ]);
  const preferred = MERGE_METHODS[repository?.viewerDefaultMergeMethod ?? ""];
  const mergeMethods = [
    ...(preferred && allowed.has(preferred) ? [preferred] : []),
    ...(["merge", "squash", "rebase"] as const).filter(
      (method) => allowed.has(method) && method !== preferred,
    ),
  ];
  const autoMethod = MERGE_METHODS[raw.autoMergeRequest?.mergeMethod ?? ""];
  const checksAfter = contexts?.pageInfo?.hasNextPage
    ? (contexts.pageInfo.endCursor ?? null)
    : null;

  return {
    pullRequestID: raw.id,
    checksCursor:
      checksAfter && commit?.id && commit.oid
        ? { commitID: commit.id, headOid: commit.oid, after: checksAfter }
        : null,
    detail: {
      ...snapshot,
      body: raw.body ?? "",
      authorPerson: toPerson(raw.author),
      labels: present(raw.labels?.nodes).flatMap((label) =>
        label.name ? [{ name: label.name, color: label.color ?? "" }] : [],
      ),
      assignees: present(raw.assignees?.nodes).flatMap((person) => {
        const value = toPerson(person);
        return value ? [value] : [];
      }),
      reviewers: [...reviewers.values()],
      checkRuns,
      checksComplete: checksAfter === null,
      additions: raw.additions ?? 0,
      deletions: raw.deletions ?? 0,
      changedFiles: raw.changedFiles ?? 0,
      commits: raw.totalCommits?.totalCount ?? 0,
      headOid: raw.headRefOid ?? commit?.oid ?? "",
      mergeState: MERGE_STATES[raw.mergeStateStatus ?? ""] ?? "unknown",
      mergeMethods,
      autoMerge: autoMethod ? { method: autoMethod } : null,
      autoMergeAllowed: repository?.autoMergeAllowed === true,
      viewer: {
        login: data.viewer?.login ?? null,
        canMerge:
          raw.viewerCanMergeAsAdmin === true ||
          WRITE_PERMISSIONS.has(repository?.viewerPermission ?? ""),
        canUpdate: raw.viewerCanUpdate === true,
        isAuthor: raw.viewerDidAuthor === true,
        reviewState: REVIEW_STATES[raw.viewerLatestReview?.state ?? ""] ?? null,
      },
      createdAt: time(raw.createdAt) ?? 0,
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------------------------

export const TIMELINE_DEFAULT_LIMIT = 50;
export const TIMELINE_MAX_LIMIT = 100;

const TIMELINE_TYPES = [
  "ISSUE_COMMENT",
  "PULL_REQUEST_REVIEW",
  "PULL_REQUEST_COMMIT",
  "MERGED_EVENT",
  "CLOSED_EVENT",
  "REOPENED_EVENT",
  "READY_FOR_REVIEW_EVENT",
  "CONVERT_TO_DRAFT_EVENT",
  "REVIEW_REQUESTED_EVENT",
  "LABELED_EVENT",
  "UNLABELED_EVENT",
  "HEAD_REF_FORCE_PUSHED_EVENT",
  "HEAD_REF_DELETED_EVENT",
  "RENAMED_TITLE_EVENT",
].join(", ");

export const timelineQuery = `query PalotPullRequestTimeline($owner: String!, $name: String!, $number: Int!, $first: Int!, $after: String) {
  repository(owner: $owner, name: $name) { pullRequest(number: $number) {
    timelineItems(first: $first, after: $after, itemTypes: [${TIMELINE_TYPES}]) {
      pageInfo { hasNextPage endCursor }
      nodes {
        __typename
        ... on IssueComment { id author { ${ACTOR} } body createdAt updatedAt url }
        ... on PullRequestReview { id author { ${ACTOR} } body state submittedAt createdAt url }
        ... on PullRequestCommit { id commit { oid message committedDate
          author { name avatarUrl user { ${ACTOR} } } } }
        ... on MergedEvent { id actor { ${ACTOR} } createdAt mergeRefName commit { oid } }
        ... on ClosedEvent { id actor { ${ACTOR} } createdAt }
        ... on ReopenedEvent { id actor { ${ACTOR} } createdAt }
        ... on ReadyForReviewEvent { id actor { ${ACTOR} } createdAt }
        ... on ConvertToDraftEvent { id actor { ${ACTOR} } createdAt }
        ... on ReviewRequestedEvent { id actor { ${ACTOR} } createdAt requestedReviewer {
          __typename ... on User { login } ... on Bot { login } ... on Mannequin { login }
          ... on Team { combinedSlug } } }
        ... on LabeledEvent { id actor { ${ACTOR} } createdAt label { name } }
        ... on UnlabeledEvent { id actor { ${ACTOR} } createdAt label { name } }
        ... on HeadRefForcePushedEvent { id actor { ${ACTOR} } createdAt
          beforeCommit { oid } afterCommit { oid } }
        ... on HeadRefDeletedEvent { id actor { ${ACTOR} } createdAt headRefName }
        ... on RenamedTitleEvent { id actor { ${ACTOR} } createdAt currentTitle }
      }
    }
  } }
}`;

/** Review threads with their comments; read whole for every timeline page (see `mergeTimeline`). */
export const reviewThreadsQuery = `query PalotPullRequestThreads($owner: String!, $name: String!, $number: Int!, $after: String) {
  repository(owner: $owner, name: $name) { pullRequest(number: $number) {
    reviewThreads(first: 50, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id isResolved isOutdated viewerCanResolve viewerCanUnresolve viewerCanReply
        path line originalLine diffSide
        comments(first: 100) { nodes {
          id author { ${ACTOR} } body path line originalLine startLine originalStartLine
          diffHunk createdAt url
        } }
      }
    }
  } }
}`;

export interface RawTimelineNode {
  __typename?: string;
  id?: string;
  author?: RawPerson | null;
  actor?: RawPerson | null;
  body?: string | null;
  state?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  submittedAt?: string | null;
  url?: string | null;
  mergeRefName?: string | null;
  commit?: {
    oid?: string;
    message?: string;
    committedDate?: string | null;
    author?: { name?: string | null; avatarUrl?: string | null; user?: RawPerson | null } | null;
  } | null;
  requestedReviewer?: { __typename?: string; login?: string; combinedSlug?: string } | null;
  label?: { name?: string } | null;
  beforeCommit?: { oid?: string } | null;
  afterCommit?: { oid?: string } | null;
  headRefName?: string | null;
  currentTitle?: string | null;
}

export interface RawThread {
  id?: string;
  isResolved?: boolean;
  isOutdated?: boolean;
  viewerCanResolve?: boolean;
  viewerCanUnresolve?: boolean;
  viewerCanReply?: boolean;
  path?: string | null;
  line?: number | null;
  originalLine?: number | null;
  diffSide?: string | null;
  comments?: RawConnection<{
    id?: string;
    author?: RawPerson | null;
    body?: string | null;
    path?: string | null;
    line?: number | null;
    originalLine?: number | null;
    startLine?: number | null;
    originalStartLine?: number | null;
    diffHunk?: string | null;
    createdAt?: string | null;
    url?: string | null;
  }> | null;
}

const EVENT_TYPES: Record<string, Extract<PullRequestTimelineItem, { kind: "event" }>["type"]> = {
  MergedEvent: "merged",
  ClosedEvent: "closed",
  ReopenedEvent: "reopened",
  ReadyForReviewEvent: "ready-for-review",
  ConvertToDraftEvent: "converted-to-draft",
  ReviewRequestedEvent: "review-requested",
  LabeledEvent: "labeled",
  UnlabeledEvent: "unlabeled",
  HeadRefForcePushedEvent: "force-pushed",
  HeadRefDeletedEvent: "head-ref-deleted",
  RenamedTitleEvent: "renamed",
};

/** When a raw timeline node happened, used for the thread window even if the node is hidden. */
export function timelineNodeTime(node: RawTimelineNode): number | null {
  return time(node.submittedAt ?? node.createdAt ?? node.commit?.committedDate);
}

/**
 * Maps one timeline node. Pending reviews (the viewer's unsent draft) and empty COMMENTED
 * reviews (the envelope of inline comments, which appear as review threads) are left out.
 */
export function toTimelineItem(node: RawTimelineNode): PullRequestTimelineItem | null {
  if (!node.id) return null;
  const type = node.__typename ?? "";
  if (type === "IssueComment") {
    const createdAt = time(node.createdAt);
    if (createdAt === null) return null;
    return {
      kind: "comment",
      id: node.id,
      author: toPerson(node.author),
      body: node.body ?? "",
      createdAt,
      updatedAt: time(node.updatedAt) ?? createdAt,
      url: node.url ?? "",
    };
  }
  if (type === "PullRequestReview") {
    const state = REVIEW_STATES[node.state ?? ""];
    const submittedAt = time(node.submittedAt ?? node.createdAt);
    if (!state || submittedAt === null) return null;
    if (state === "commented" && !node.body?.trim()) return null;
    return {
      kind: "review",
      id: node.id,
      author: toPerson(node.author),
      state,
      body: node.body ?? "",
      submittedAt,
      url: node.url ?? "",
    };
  }
  if (type === "PullRequestCommit") {
    const commit = node.commit;
    const createdAt = time(commit?.committedDate);
    if (!commit?.oid || createdAt === null) return null;
    const author =
      toPerson(commit.author?.user) ??
      (commit.author?.name
        ? { login: commit.author.name, avatarUrl: commit.author.avatarUrl ?? null, isBot: false }
        : null);
    return {
      kind: "commit",
      id: node.id,
      oid: commit.oid,
      message: commit.message ?? "",
      author,
      createdAt,
    };
  }
  const eventType = EVENT_TYPES[type];
  const createdAt = time(node.createdAt);
  if (!eventType || createdAt === null) return null;
  return {
    kind: "event",
    id: node.id,
    type: eventType,
    actor: toPerson(node.actor),
    detail: eventDetail(node),
    createdAt,
  };
}

function eventDetail(node: RawTimelineNode): string | null {
  switch (node.__typename) {
    case "MergedEvent":
      return node.commit?.oid
        ? `${node.commit.oid.slice(0, 7)}${node.mergeRefName ? ` into ${node.mergeRefName}` : ""}`
        : (node.mergeRefName ?? null);
    case "ReviewRequestedEvent":
      return node.requestedReviewer?.login ?? node.requestedReviewer?.combinedSlug ?? null;
    case "LabeledEvent":
    case "UnlabeledEvent":
      return node.label?.name ?? null;
    case "HeadRefForcePushedEvent": {
      const before = node.beforeCommit?.oid?.slice(0, 7);
      const after = node.afterCommit?.oid?.slice(0, 7);
      return before && after ? `${before} → ${after}` : (after ?? null);
    }
    case "HeadRefDeletedEvent":
      return node.headRefName ?? null;
    case "RenamedTitleEvent":
      return node.currentTitle ?? null;
    default:
      return null;
  }
}

export function toThread(
  raw: RawThread,
): Extract<PullRequestTimelineItem, { kind: "review-thread" }> | null {
  if (!raw.id) return null;
  const side = raw.diffSide === "LEFT" ? "LEFT" : "RIGHT";
  const comments: PullRequestReviewComment[] = present(raw.comments?.nodes).flatMap((comment) => {
    const createdAt = time(comment.createdAt);
    if (!comment.id || createdAt === null) return [];
    return [
      {
        id: comment.id,
        author: toPerson(comment.author),
        body: comment.body ?? "",
        path: comment.path ?? raw.path ?? "",
        // An outdated comment has no current line; its original line matches its diff hunk.
        line: comment.line ?? comment.originalLine ?? null,
        startLine: comment.startLine ?? comment.originalStartLine ?? null,
        side,
        diffHunk: comment.diffHunk ?? "",
        createdAt,
        url: comment.url ?? "",
      },
    ];
  });
  const first = comments[0];
  if (!first) return null;
  return {
    kind: "review-thread",
    id: raw.id,
    path: raw.path ?? first.path,
    line: raw.line ?? raw.originalLine ?? null,
    isResolved: raw.isResolved === true,
    isOutdated: raw.isOutdated === true,
    // GitHub answers "resolve" and "unresolve" separately; the contract asks about the toggle.
    viewerCanResolve:
      raw.isResolved === true ? raw.viewerCanUnresolve === true : raw.viewerCanResolve === true,
    viewerCanReply: raw.viewerCanReply === true,
    comments,
    createdAt: first.createdAt,
  };
}

export interface TimelineCursor {
  /** GitHub's `timelineItems` end cursor. */
  after: string;
  /** Threads at or before this time (epoch ms) were already returned. */
  through: number;
}

export function encodeTimelineCursor(cursor: TimelineCursor): string {
  return Buffer.from(JSON.stringify({ a: cursor.after, t: cursor.through })).toString("base64url");
}

export function decodeTimelineCursor(value: string): TimelineCursor | null {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as {
      a?: unknown;
      t?: unknown;
    };
    if (typeof parsed.a !== "string" || typeof parsed.t !== "number" || !Number.isFinite(parsed.t))
      return null;
    return { after: parsed.a, through: parsed.t };
  } catch {
    return null;
  }
}

/**
 * Merges one timeline page with the review threads that belong to its time window. GitHub's
 * `timelineItems` and `reviewThreads` are separate connections, so threads cannot share the
 * timeline's cursor. Instead each page owns the threads whose first comment falls after the
 * previous page's window and at or before the latest time on this page; the last page takes
 * every remaining thread. Pages therefore stay oldest first when concatenated, and every thread
 * appears exactly once. Within a page GitHub's own order is kept and each thread is placed
 * before the first item that happened after it.
 */
export function mergeTimeline(input: {
  nodes: RawTimelineNode[];
  pageInfo: PageInfo | null | undefined;
  threads: Array<Extract<PullRequestTimelineItem, { kind: "review-thread" }>>;
  /** The previous page's window end; -Infinity for the first page. */
  since: number;
}): { items: PullRequestTimelineItem[]; nextCursor: string | null } {
  const hasNext = input.pageInfo?.hasNextPage === true && Boolean(input.pageInfo.endCursor);
  const times = input.nodes.flatMap((node) => {
    const value = timelineNodeTime(node);
    return value === null ? [] : [value];
  });
  const through = hasNext ? Math.max(input.since, ...times) : Number.POSITIVE_INFINITY;
  const threads = input.threads
    .filter((thread) => thread.createdAt > input.since && thread.createdAt <= through)
    .sort((left, right) => left.createdAt - right.createdAt);
  const items: PullRequestTimelineItem[] = [];
  let next = 0;
  for (const node of input.nodes) {
    const item = toTimelineItem(node);
    if (!item) continue;
    const at = itemTime(item);
    while (next < threads.length && threads[next]!.createdAt <= at) items.push(threads[next++]!);
    items.push(item);
  }
  items.push(...threads.slice(next));
  return {
    items,
    nextCursor: hasNext
      ? encodeTimelineCursor({ after: input.pageInfo!.endCursor!, through })
      : null,
  };
}

function itemTime(item: PullRequestTimelineItem): number {
  return item.kind === "review" ? item.submittedAt : item.createdAt;
}

// ---------------------------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------------------------

/** GitHub lists at most 3,000 files for a pull request. */
export const FILES_LIMIT = 3_000;
export const FILES_PAGE_SIZE = 100;

export const filesViewedQuery = `query PalotPullRequestFiles($owner: String!, $name: String!, $number: Int!, $after: String) {
  repository(owner: $owner, name: $name) { pullRequest(number: $number) {
    id headRefOid changedFiles
    files(first: 100, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes { path viewerViewedState }
    }
  } }
}`;

export interface RawFilesViewed {
  repository?: {
    pullRequest?: {
      id?: string;
      headRefOid?: string;
      changedFiles?: number;
      files?: RawConnection<{ path?: string; viewerViewedState?: string | null }> | null;
    } | null;
  } | null;
}

export interface RawRestFile {
  filename?: string;
  previous_filename?: string;
  status?: string;
  additions?: number;
  deletions?: number;
  patch?: string;
}

const FILE_STATUSES = new Set<PullRequestFile["status"]>([
  "added",
  "modified",
  "removed",
  "renamed",
  "copied",
  "changed",
]);

const VIEWED: Record<string, PullRequestFileViewedState> = {
  VIEWED: "viewed",
  UNVIEWED: "unviewed",
  DISMISSED: "dismissed",
};

export function toFile(
  raw: RawRestFile,
  viewed: ReadonlyMap<string, string | null | undefined>,
): PullRequestFile | null {
  if (!raw.filename) return null;
  const status = FILE_STATUSES.has(raw.status as PullRequestFile["status"])
    ? (raw.status as PullRequestFile["status"])
    : "modified";
  return {
    path: raw.filename,
    previousPath: raw.previous_filename ?? null,
    status,
    additions: raw.additions ?? 0,
    deletions: raw.deletions ?? 0,
    patch: typeof raw.patch === "string" ? raw.patch : null,
    viewed: VIEWED[viewed.get(raw.filename) ?? ""] ?? "unviewed",
  };
}

// ---------------------------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------------------------

export const nodeIDQuery = `query PalotPullRequestID($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) { pullRequest(number: $number) { id } }
}`;

export const threadOwnerQuery = `query PalotReviewThreadOwner($id: ID!) {
  node(id: $id) { ... on PullRequestReviewThread { pullRequest { number repository { nameWithOwner } } } }
}`;

export const mutations = {
  enableAutoMerge: `mutation PalotEnableAutoMerge($id: ID!, $method: PullRequestMergeMethod!) {
    enablePullRequestAutoMerge(input: { pullRequestId: $id, mergeMethod: $method }) { clientMutationId } }`,
  disableAutoMerge: `mutation PalotDisableAutoMerge($id: ID!) {
    disablePullRequestAutoMerge(input: { pullRequestId: $id }) { clientMutationId } }`,
  markViewed: `mutation PalotMarkViewed($id: ID!, $path: String!) {
    markFileAsViewed(input: { pullRequestId: $id, path: $path }) { clientMutationId } }`,
  unmarkViewed: `mutation PalotUnmarkViewed($id: ID!, $path: String!) {
    unmarkFileAsViewed(input: { pullRequestId: $id, path: $path }) { clientMutationId } }`,
  comment: `mutation PalotComment($id: ID!, $body: String!) {
    addComment(input: { subjectId: $id, body: $body }) { clientMutationId } }`,
  reply: `mutation PalotThreadReply($id: ID!, $body: String!) {
    addPullRequestReviewThreadReply(input: { pullRequestReviewThreadId: $id, body: $body }) { clientMutationId } }`,
  resolve: `mutation PalotResolveThread($id: ID!) {
    resolveReviewThread(input: { threadId: $id }) { clientMutationId } }`,
  unresolve: `mutation PalotUnresolveThread($id: ID!) {
    unresolveReviewThread(input: { threadId: $id }) { clientMutationId } }`,
  merge: `mutation PalotMerge($input: MergePullRequestInput!) {
    mergePullRequest(input: $input) { clientMutationId } }`,
  close: `mutation PalotClose($id: ID!) {
    closePullRequest(input: { pullRequestId: $id }) { clientMutationId } }`,
  reopen: `mutation PalotReopen($id: ID!) {
    reopenPullRequest(input: { pullRequestId: $id }) { clientMutationId } }`,
  ready: `mutation PalotReady($id: ID!) {
    markPullRequestReadyForReview(input: { pullRequestId: $id }) { clientMutationId } }`,
  draft: `mutation PalotDraft($id: ID!) {
    convertPullRequestToDraft(input: { pullRequestId: $id }) { clientMutationId } }`,
};

const REVIEW_EVENTS: Record<PullRequestReviewInput["event"], string> = {
  approve: "APPROVE",
  "request-changes": "REQUEST_CHANGES",
  comment: "COMMENT",
};

/** The REST review body; a multi-line comment names its start on the same side. */
export function reviewRequestBody(input: PullRequestReviewInput) {
  return {
    event: REVIEW_EVENTS[input.event],
    body: input.body,
    commit_id: input.commitOid,
    comments: input.comments.map((comment: PullRequestDraftComment) => ({
      path: comment.path,
      line: comment.line,
      side: comment.side,
      ...(comment.startLine !== undefined && comment.startLine !== comment.line
        ? { start_line: comment.startLine, start_side: comment.side }
        : {}),
      body: comment.body,
    })),
  };
}

/** A clear validation message for a review GitHub would refuse, or null when it is sendable. */
export function reviewInputProblem(input: PullRequestReviewInput): string | null {
  const body = input.body.trim();
  if (input.event === "request-changes" && !body)
    return "Requesting changes needs a summary comment.";
  if (input.event === "comment" && !body && input.comments.length === 0)
    return "A comment review needs a summary or at least one inline comment.";
  if (!/^[0-9a-f]{40}$/i.test(input.commitOid))
    return "The review is missing the commit it was written against.";
  for (const comment of input.comments) {
    if (!comment.path || !comment.body.trim()) return "Every inline comment needs a file and text.";
    if (!Number.isSafeInteger(comment.line) || comment.line <= 0)
      return "An inline comment has an invalid line.";
    if (
      comment.startLine !== undefined &&
      (!Number.isSafeInteger(comment.startLine) ||
        comment.startLine <= 0 ||
        comment.startLine > comment.line)
    )
      return "A multi-line comment must start at or before its last line.";
  }
  return null;
}

const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})(?:\[bot\])?$/;
const TEAM_SLUG = /^[A-Za-z0-9_.-]{1,100}$/;

/**
 * Splits requested reviewers into user logins and team slugs. Teams are `org/team` and must
 * belong to the repository's owner, the only organization GitHub accepts teams from.
 */
export function splitReviewers(
  owner: string,
  reviewers: string[],
): { reviewers: string[]; team_reviewers: string[] } | string {
  const users: string[] = [];
  const teams: string[] = [];
  for (const raw of reviewers) {
    const value = raw.trim().replace(/^@/, "");
    if (value.includes("/")) {
      const [org, slug, extra] = value.split("/");
      if (!org || !slug || extra !== undefined || !TEAM_SLUG.test(slug))
        return `${raw} is not a valid org/team name.`;
      if (org.toLowerCase() !== owner.toLowerCase())
        return `Team ${value} is not in ${owner}; only the repository owner's teams can review.`;
      teams.push(slug);
    } else if (LOGIN.test(value)) users.push(value);
    else return `${raw} is not a valid GitHub login.`;
  }
  if (users.length === 0 && teams.length === 0) return "Choose at least one reviewer.";
  return { reviewers: [...new Set(users)], team_reviewers: [...new Set(teams)] };
}

export type MergeFailureCode =
  | "merge-head-moved"
  | "merge-not-mergeable"
  | "merge-checks-required"
  | "merge-blocked";

/** Classifies GitHub's merge refusal text. Null when it is not a merge-specific refusal. */
export function classifyMergeFailure(messages: string[]): MergeFailureCode | null {
  const text = messages.join("\n");
  if (/head branch was modified|base branch was modified|expected head|head (sha|oid)/i.test(text))
    return "merge-head-moved";
  if (
    /required status check|status checks? (is|are) (expected|required|pending|failing)|checks? (has|have) not (passed|completed)/i.test(
      text,
    )
  )
    return "merge-checks-required";
  if (
    /protected branch|branch protection|repository rule|ruleset|approving review|review is required|changes (were )?requested|merge queue|draft|policy|not authorized to (push|merge)|code owner/i.test(
      text,
    )
  )
    return "merge-blocked";
  if (/not mergeable|merge conflict|conflicts?\b|cannot be merged|is not clean/i.test(text))
    return "merge-not-mergeable";
  return null;
}

export const MERGE_FAILURE_MESSAGES: Record<MergeFailureCode, string> = {
  "merge-head-moved": "The branch changed since you looked. Review the new commits and try again.",
  "merge-not-mergeable":
    "GitHub cannot merge this pull request as it stands; resolve its conflicts first.",
  "merge-checks-required": "Required checks have not passed yet.",
  "merge-blocked": "Branch protection or repository rules block this merge.",
};

export const GRAPHQL_MERGE_METHODS: Record<PullRequestMergeMethod, string> = {
  merge: "MERGE",
  squash: "SQUASH",
  rebase: "REBASE",
};

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

export function present<T>(nodes: Array<T | null> | null | undefined): T[] {
  return (nodes ?? []).filter((node): node is T => node !== null && node !== undefined);
}

function time(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}
