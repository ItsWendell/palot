import type {
  PullRequestChecksSummary,
  PullRequestMergeable,
  PullRequestReviewDecision,
  PullRequestSearchList,
  PullRequestSnapshot,
  PullRequestState,
} from "../../shared/source-control-contract";

export interface GitHubRepositoryRef {
  host: string;
  owner: string;
  name: string;
}

export interface GitHubPullRequestRef extends GitHubRepositoryRef {
  number: number;
}

export { isSupportedGitHubHost } from "./github-credentials";

const NAME = /^[A-Za-z0-9_.-]{1,100}$/;

function repository(host: string, owner: string, rawName: string): GitHubRepositoryRef | null {
  const name = rawName.replace(/\.git$/i, "");
  if (!NAME.test(owner) || !NAME.test(name) || name === "." || name === "..") return null;
  const normalizedHost = host
    .trim()
    .toLowerCase()
    .replace(/^ssh\./, "");
  return { host: normalizedHost, owner: owner.toLowerCase(), name: name.toLowerCase() };
}

/** Parses `git@host:owner/repo.git`, `ssh://git@host[:port]/owner/repo`, or an HTTPS remote. */
export function parseGitHubRemote(remote: string): GitHubRepositoryRef | null {
  const value = remote.trim();
  const scp = /^[\w.-]+@([\w.-]+):\/?([^/\s]+)\/([^/\s]+?)\/?$/.exec(value);
  if (scp) return repository(scp[1]!, scp[2]!, scp[3]!);
  try {
    const url = new URL(value);
    if (!["https:", "http:", "ssh:", "git:", "git+ssh:"].includes(url.protocol)) return null;
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length !== 2) return null;
    return repository(url.hostname, parts[0]!, parts[1]!);
  } catch {
    return null;
  }
}

/** Parses `https://github.com/owner/repo/pull/123` (with any trailing path, query or hash). */
export function parsePullRequestUrl(input: string): GitHubPullRequestRef | null {
  try {
    const url = new URL(input.trim());
    if (url.protocol !== "https:") return null;
    const [owner, name, kind, number] = url.pathname.split("/").filter(Boolean);
    if (!owner || !name || (kind !== "pull" && kind !== "pulls") || !number) return null;
    if (!/^\d{1,9}$/.test(number)) return null;
    const repo = repository(url.hostname, owner, name);
    return repo ? { ...repo, number: Number(number) } : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------------
// GraphQL
// ---------------------------------------------------------------------------------------------

const SNAPSHOT_FIELDS = `
  number title url state isDraft mergedAt closedAt updatedAt
  headRefName baseRefName headRefOid mergeable reviewDecision
  author { login }
  repository { nameWithOwner }
  commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }`;

function contextFields(number: number): string {
  return `__typename
    ... on CheckRun { name status conclusion detailsUrl isRequired(pullRequestNumber: ${number}) }
    ... on StatusContext { context state targetUrl isRequired(pullRequestNumber: ${number}) }`;
}

const COMMENT_FIELDS = "id url body createdAt lastEditedAt author { login }";
const REVIEW_FIELDS = `id url body state submittedAt createdAt lastEditedAt author { login }
    comments(first: 10) { pageInfo { hasNextPage endCursor } nodes { ${COMMENT_FIELDS} path } }`;

/**
 * Checks and the latest remarks of a watched PR, with the cursors needed to finish a truncated
 * read. Replies on old review threads arrive as new reviews (GitHub files every submitted
 * review comment under a review), so the latest reviews cover them without reading threads.
 * Connections nest at most 20 x 10, about one GraphQL point per watched PR.
 */
function watchFields(number: number): string {
  return `
  id
  commits(last: 1) { nodes { commit { id oid statusCheckRollup { contexts(first: 100) {
    pageInfo { hasNextPage endCursor } nodes { ${contextFields(number)} }
  } } } } }
  comments(last: 30) { pageInfo { hasPreviousPage startCursor } nodes { ${COMMENT_FIELDS} } }
  reviews(last: 20) { pageInfo { hasPreviousPage startCursor } nodes { ${REVIEW_FIELDS} } }`;
}

/** Follow-up reads that finish a truncated watch page. `id` is a GraphQL node ID. */
export const watchPageQueries = {
  checks: (number: number) => {
    if (!Number.isSafeInteger(number) || number <= 0)
      throw new Error("Pull request number is invalid");
    return `query PalotWatchChecks($id: ID!, $after: String) { node(id: $id) { ... on Commit {
      oid statusCheckRollup { contexts(first: 100, after: $after) {
        pageInfo { hasNextPage endCursor } nodes { ${contextFields(number)} }
      } } } } }`;
  },
  comments: `query PalotWatchComments($id: ID!, $before: String) { node(id: $id) { ... on PullRequest {
    comments(last: 50, before: $before) { pageInfo { hasPreviousPage startCursor } nodes { ${COMMENT_FIELDS} } }
  } } }`,
  reviews: `query PalotWatchReviews($id: ID!, $before: String) { node(id: $id) { ... on PullRequest {
    reviews(last: 20, before: $before) { pageInfo { hasPreviousPage startCursor } nodes { ${REVIEW_FIELDS} } }
  } } }`,
  reviewComments: `query PalotWatchReviewComments($id: ID!, $after: String) { node(id: $id) { ... on PullRequestReview {
    comments(first: 100, after: $after) { pageInfo { hasNextPage endCursor } nodes { ${COMMENT_FIELDS} path } }
  } } }`,
};

export interface PullRequestQueryTarget {
  ref: GitHubPullRequestRef;
  /** Also read checks and remarks for a watch. */
  watched: boolean;
}

/** One batched document for every target; owner and name travel as variables. */
export function pullRequestBatchQuery(targets: PullRequestQueryTarget[]): {
  query: string;
  variables: Record<string, string>;
} {
  const variables: Record<string, string> = {};
  const declarations: string[] = [];
  const selections = targets.map((target, index) => {
    if (!Number.isSafeInteger(target.ref.number) || target.ref.number <= 0)
      throw new Error("Pull request number is invalid");
    variables[`o${index}`] = target.ref.owner;
    variables[`n${index}`] = target.ref.name;
    declarations.push(`$o${index}: String!`, `$n${index}: String!`);
    const watch = target.watched
      ? `watch: pullRequest(number: ${target.ref.number}) { ${watchFields(target.ref.number)} }`
      : "";
    return `pr${index}: repository(owner: $o${index}, name: $n${index}) {
      pullRequest(number: ${target.ref.number}) { ${SNAPSHOT_FIELDS} }
      ${watch}
    }`;
  });
  return {
    query: `query PalotPullRequests(${declarations.join(", ")}) {
      viewer { login }
      ${selections.join("\n")}
    }`,
    variables,
  };
}

export interface RawActor {
  login?: string | null;
}

export interface RawSnapshot {
  number?: number;
  title?: string;
  url?: string;
  state?: string;
  isDraft?: boolean;
  mergedAt?: string | null;
  closedAt?: string | null;
  updatedAt?: string;
  headRefName?: string;
  baseRefName?: string;
  headRefOid?: string | null;
  mergeable?: string | null;
  reviewDecision?: string | null;
  author?: RawActor | null;
  repository?: { nameWithOwner?: string } | null;
  commits?: {
    nodes?: Array<{ commit?: { statusCheckRollup?: { state?: string } | null } } | null>;
  };
}

export interface RawRemark {
  id?: string;
  url?: string | null;
  body?: string | null;
  state?: string | null;
  path?: string | null;
  createdAt?: string | null;
  submittedAt?: string | null;
  lastEditedAt?: string | null;
  author?: RawActor | null;
}

export interface RawContext {
  __typename?: string;
  name?: string | null;
  context?: string | null;
  status?: string | null;
  conclusion?: string | null;
  state?: string | null;
  detailsUrl?: string | null;
  targetUrl?: string | null;
  isRequired?: boolean | null;
}

export interface PageInfo {
  hasNextPage?: boolean;
  endCursor?: string | null;
  hasPreviousPage?: boolean;
  startCursor?: string | null;
}

export interface RawConnection<T> {
  pageInfo?: PageInfo | null;
  nodes?: Array<T | null> | null;
}

export interface RawReview extends RawRemark {
  comments?: RawConnection<RawRemark> | null;
}

interface RawWatch {
  id?: string;
  commits?: {
    nodes?: Array<{
      commit?: {
        id?: string;
        oid?: string;
        statusCheckRollup?: { contexts?: RawConnection<RawContext> | null } | null;
      };
    } | null>;
  };
  comments?: RawConnection<RawRemark> | null;
  reviews?: RawConnection<RawReview> | null;
}

/** One reviewed page of a watched PR, plus the cursors that finish what it truncated. */
export interface PullRequestWatchPage {
  pullRequestID: string | null;
  commitID: string | null;
  headSha: string | null;
  contexts: RawContext[];
  /** Cursor of the next page of checks; null when every check was read. */
  checksAfter: string | null;
  comments: RawRemark[];
  /** Cursor before the oldest comment read; null when none are older. */
  commentsBefore: string | null;
  reviews: Array<{ review: RawReview; comments: RawRemark[]; commentsAfter: string | null }>;
  reviewsBefore: string | null;
}

export type PullRequestCheckStatus = "pending" | "success" | "failure";

export interface PullRequestCheck {
  name: string;
  status: PullRequestCheckStatus;
  /** Raw conclusion for the wake message, e.g. `timed_out`. */
  conclusion: string | null;
  required: boolean;
  url: string | null;
}

export interface PullRequestRemark {
  id: string;
  author: string | null;
  body: string;
  /** Epoch ms of creation or the latest edit, whichever is newer. */
  activeAt: number;
  url: string | null;
  path: string | null;
  reviewState: string | null;
}

export interface PullRequestWatchDetail {
  headSha: string | null;
  checks: PullRequestCheck[];
  /** False when some checks could not be read; "passed" is then never announced. */
  checksComplete: boolean;
  mergeable: PullRequestMergeable;
  baseBranch: string;
  remarks: PullRequestRemark[];
  /** False when remarks since the watch's watermark may be missing; they wait for a later read. */
  remarksComplete: boolean;
}

export interface PullRequestBatchEntry {
  snapshot: PullRequestSnapshot | null;
  watch: PullRequestWatchPage | null;
}

export interface PullRequestBatchResult {
  viewer: string | null;
  entries: PullRequestBatchEntry[];
}

export function parsePullRequestBatch(
  data: Record<string, unknown>,
  targets: PullRequestQueryTarget[],
): PullRequestBatchResult {
  const viewer = (data.viewer as RawActor | undefined)?.login ?? null;
  return {
    viewer,
    entries: targets.map((target, index) => {
      const repo = data[`pr${index}`] as
        | { pullRequest?: RawSnapshot | null; watch?: RawWatch | null }
        | null
        | undefined;
      const snapshot = repo?.pullRequest
        ? toSnapshot(repo.pullRequest, target.ref.host, target.ref)
        : null;
      const watch = snapshot && repo?.watch ? toWatchPage(repo.watch) : null;
      return { snapshot, watch };
    }),
  };
}

export function toSnapshot(
  raw: RawSnapshot,
  host: string,
  fallback?: GitHubRepositoryRef,
): PullRequestSnapshot | null {
  if (typeof raw.number !== "number" || typeof raw.url !== "string") return null;
  const repository =
    raw.repository?.nameWithOwner?.toLowerCase() ??
    (fallback ? `${fallback.owner}/${fallback.name}` : null);
  if (!repository) return null;
  return {
    host: host.toLowerCase(),
    repository,
    number: raw.number,
    title: raw.title ?? "",
    url: raw.url,
    state: pullRequestState(raw.state, raw.isDraft),
    checks: checksSummary(raw.commits?.nodes?.at(-1)?.commit?.statusCheckRollup?.state),
    reviewDecision: reviewDecision(raw.reviewDecision),
    mergeable: mergeable(raw.mergeable),
    headBranch: raw.headRefName ?? "",
    baseBranch: raw.baseRefName ?? "",
    author: raw.author?.login ?? null,
    updatedAt: time(raw.updatedAt) ?? 0,
    mergedAt: time(raw.mergedAt),
    closedAt: time(raw.closedAt),
  };
}

function toWatchPage(raw: RawWatch): PullRequestWatchPage {
  const commit = raw.commits?.nodes?.at(-1)?.commit;
  const contexts = commit?.statusCheckRollup?.contexts;
  return {
    pullRequestID: raw.id ?? null,
    commitID: commit?.id ?? null,
    headSha: commit?.oid ?? null,
    contexts: present(contexts?.nodes),
    checksAfter: contexts?.pageInfo?.hasNextPage ? (contexts.pageInfo.endCursor ?? null) : null,
    comments: present(raw.comments?.nodes),
    commentsBefore: raw.comments?.pageInfo?.hasPreviousPage
      ? (raw.comments.pageInfo.startCursor ?? null)
      : null,
    reviews: present(raw.reviews?.nodes).map(reviewEntry),
    reviewsBefore: raw.reviews?.pageInfo?.hasPreviousPage
      ? (raw.reviews.pageInfo.startCursor ?? null)
      : null,
  };
}

export function reviewEntry(review: RawReview): PullRequestWatchPage["reviews"][number] {
  return {
    review,
    comments: present(review.comments?.nodes),
    commentsAfter: review.comments?.pageInfo?.hasNextPage
      ? (review.comments.pageInfo.endCursor ?? null)
      : null,
  };
}

export function present<T>(nodes: Array<T | null> | null | undefined): T[] {
  return (nodes ?? []).filter((node): node is T => node !== null && node !== undefined);
}

/** The time a remark was last news: created, submitted with its review, or edited. */
export function remarkActiveAt(raw: RawRemark, review?: RawReview): number | null {
  const times = [raw.submittedAt, raw.createdAt, raw.lastEditedAt, review?.submittedAt].flatMap(
    (value) => {
      const parsed = time(value);
      return parsed === null ? [] : [parsed];
    },
  );
  return times.length ? Math.max(...times) : null;
}

export function buildWatchDetail(
  page: PullRequestWatchPage,
  snapshot: PullRequestSnapshot,
  complete: { checks: boolean; remarks: boolean },
): PullRequestWatchDetail {
  const checks = new Map<string, PullRequestCheck>();
  for (const context of page.contexts) {
    const check = toCheck(context);
    // A rerun of the same check later in the list replaces the earlier one.
    if (check) checks.set(check.name, check);
  }
  const remarks: PullRequestRemark[] = [];
  for (const comment of page.comments) {
    const remark = toRemark(comment, null, null);
    if (remark) remarks.push(remark);
  }
  for (const { review, comments } of page.reviews) {
    if (review.state === "PENDING") continue;
    // An empty COMMENTED review is only the envelope of its inline comments.
    if (review.body?.trim() || review.state !== "COMMENTED") {
      const remark = toRemark(review, null, review.state ?? null);
      if (remark) remarks.push(remark);
    }
    for (const comment of comments) {
      const remark = toRemark(comment, comment.path ?? null, null, review);
      if (remark) remarks.push(remark);
    }
  }
  const unique = new Map(remarks.map((remark) => [remark.id, remark]));
  return {
    headSha: page.headSha,
    checks: [...checks.values()],
    checksComplete: complete.checks,
    mergeable: snapshot.mergeable,
    baseBranch: snapshot.baseBranch,
    remarks: [...unique.values()].sort((left, right) => left.activeAt - right.activeAt),
    remarksComplete: complete.remarks,
  };
}

const FAILED_CONCLUSIONS = new Set([
  "FAILURE",
  "TIMED_OUT",
  "CANCELLED",
  "ACTION_REQUIRED",
  "STARTUP_FAILURE",
]);

function toCheck(raw: RawContext): PullRequestCheck | null {
  if (raw.__typename === "StatusContext" || raw.context) {
    const name = raw.context;
    if (!name) return null;
    const state = raw.state ?? "";
    return {
      name,
      status:
        state === "SUCCESS"
          ? "success"
          : state === "FAILURE" || state === "ERROR"
            ? "failure"
            : "pending",
      conclusion: state ? state.toLowerCase() : null,
      required: raw.isRequired === true,
      url: raw.targetUrl ?? null,
    };
  }
  const name = raw.name;
  if (!name) return null;
  const conclusion = raw.conclusion ?? null;
  return {
    name,
    status:
      raw.status !== "COMPLETED"
        ? "pending"
        : conclusion && FAILED_CONCLUSIONS.has(conclusion)
          ? "failure"
          : "success",
    conclusion: conclusion?.toLowerCase() ?? null,
    required: raw.isRequired === true,
    url: raw.detailsUrl ?? null,
  };
}

function toRemark(
  raw: RawRemark | null | undefined,
  path: string | null,
  reviewState: string | null,
  review?: RawReview,
): PullRequestRemark | null {
  if (!raw?.id) return null;
  const activeAt = remarkActiveAt(raw, review);
  if (activeAt === null) return null;
  return {
    id: raw.id,
    author: raw.author?.login ?? null,
    body: raw.body ?? "",
    activeAt,
    url: raw.url ?? null,
    path,
    reviewState: reviewState?.toLowerCase().replaceAll("_", " ") ?? null,
  };
}

function pullRequestState(state: string | undefined, isDraft: boolean | undefined) {
  const value: PullRequestState =
    state === "MERGED" ? "merged" : state === "CLOSED" ? "closed" : isDraft ? "draft" : "open";
  return value;
}

function checksSummary(state: string | undefined | null): PullRequestChecksSummary {
  if (state === "SUCCESS") return "passing";
  if (state === "FAILURE" || state === "ERROR") return "failing";
  if (state === "PENDING" || state === "EXPECTED") return "pending";
  return "none";
}

function reviewDecision(value: string | null | undefined): PullRequestReviewDecision | null {
  if (value === "APPROVED") return "approved";
  if (value === "CHANGES_REQUESTED") return "changes-requested";
  if (value === "REVIEW_REQUIRED") return "review-required";
  return null;
}

function mergeable(value: string | null | undefined): PullRequestMergeable {
  if (value === "MERGEABLE") return "mergeable";
  if (value === "CONFLICTING") return "conflicting";
  return "unknown";
}

function time(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

// ---------------------------------------------------------------------------------------------
// Review lists
// ---------------------------------------------------------------------------------------------

const SEARCH_QUERIES: Record<PullRequestSearchList, string> = {
  "review-requested": "is:pr is:open archived:false review-requested:@me sort:updated-desc",
  authored: "is:pr is:open archived:false author:@me sort:updated-desc",
  assigned: "is:pr is:open archived:false assignee:@me sort:updated-desc",
  mentioned: "is:pr is:open archived:false mentions:@me sort:updated-desc",
  "recently-merged": "is:pr is:merged author:@me sort:updated-desc",
};

/** Longest user search text appended to a list's qualifiers. */
export const SEARCH_TEXT_LIMIT = 256;

/**
 * User search text as one line of GitHub search terms: control characters and newlines become
 * spaces, runs of whitespace collapse, and the result is capped. It is ANDed with the list's
 * own qualifiers and travels as a GraphQL variable, never inside the document.
 */
export function sanitizeSearchText(input: string | undefined): string {
  if (!input) return "";
  return Array.from(input, (character) =>
    /[\p{Cc}\p{Zl}\p{Zp}]/u.test(character) ? " " : character,
  )
    .join("")
    .replaceAll(/\s+/g, " ")
    .trim()
    .slice(0, SEARCH_TEXT_LIMIT)
    .trim();
}

export function pullRequestSearchQuery(list: PullRequestSearchList, text?: string) {
  const extra = sanitizeSearchText(text);
  return {
    query: `query PalotPullRequestSearch($q: String!, $first: Int!, $after: String) {
      search(query: $q, type: ISSUE, first: $first, after: $after) {
        issueCount
        pageInfo { hasNextPage endCursor }
        nodes { ... on PullRequest { ${SNAPSHOT_FIELDS} } }
      }
    }`,
    search: extra ? `${SEARCH_QUERIES[list]} ${extra}` : SEARCH_QUERIES[list],
  };
}

export function parsePullRequestSearch(
  data: {
    search?: {
      issueCount?: number;
      pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
      nodes?: Array<RawSnapshot | null>;
    };
  },
  host: string,
): { items: PullRequestSnapshot[]; totalCount: number; nextCursor: string | null } {
  const search = data.search;
  const items = (search?.nodes ?? []).flatMap((node) => {
    const snapshot = node ? toSnapshot(node, host) : null;
    return snapshot ? [snapshot] : [];
  });
  return {
    items,
    totalCount: search?.issueCount ?? items.length,
    nextCursor: search?.pageInfo?.hasNextPage ? (search.pageInfo.endCursor ?? null) : null,
  };
}
