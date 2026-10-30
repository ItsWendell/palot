/**
 * Palot-owned source control contracts: code-host pull/merge request links, watches, review lists,
 * and Git writes for a task's directory. OpenCode's `vcs` API stays the read path for
 * diffs and branch lists; this layer only adds what OpenCode does not own.
 *
 * Host APIs run in the desktop main process. Remote Git uses OpenCode's public shell API
 * through the selected connection, never a task transcript or a silent local fallback.
 */

export const SOURCE_CONTROL_IPC_CHANNELS = {
  codeHosts: "palot:source-control:hosts",
  saveCodeHost: "palot:source-control:host-save",
  removeCodeHost: "palot:source-control:host-remove",
  sourceControlStatus: "palot:source-control:status",
  pullRequestLinks: "palot:source-control:pull-request-links",
  pullRequestLink: "palot:source-control:pull-request-link",
  pullRequestPrepare: "palot:source-control:pull-request-prepare",
  pullRequestCreate: "palot:source-control:pull-request-create",
  pullRequestUnlink: "palot:source-control:pull-request-unlink",
  pullRequestRefresh: "palot:source-control:pull-request-refresh",
  pullRequestWatch: "palot:source-control:pull-request-watch",
  pullRequestSearch: "palot:source-control:pull-request-search",
  pullRequestDetail: "palot:source-control:pull-request-detail",
  pullRequestTimeline: "palot:source-control:pull-request-timeline",
  pullRequestFiles: "palot:source-control:pull-request-files",
  pullRequestFileViewed: "palot:source-control:pull-request-file-viewed",
  pullRequestReview: "palot:source-control:pull-request-review",
  pullRequestComment: "palot:source-control:pull-request-comment",
  pullRequestThreadReply: "palot:source-control:pull-request-thread-reply",
  pullRequestThreadResolve: "palot:source-control:pull-request-thread-resolve",
  pullRequestMerge: "palot:source-control:pull-request-merge",
  pullRequestState: "palot:source-control:pull-request-state",
  pullRequestDraft: "palot:source-control:pull-request-draft",
  pullRequestReviewers: "palot:source-control:pull-request-reviewers",
  pullRequestEdit: "palot:source-control:pull-request-edit",
  pullRequestLabels: "palot:source-control:pull-request-labels",
  pullRequestLabel: "palot:source-control:pull-request-label",
  pullRequestAutoMerge: "palot:source-control:pull-request-auto-merge",
  pullRequestUpdateBranch: "palot:source-control:pull-request-update-branch",
  gitBranch: "palot:source-control:git-branch",
  gitStatus: "palot:source-control:git-status",
  gitStage: "palot:source-control:git-stage",
  gitUnstage: "palot:source-control:git-unstage",
  gitCommit: "palot:source-control:git-commit",
  gitPush: "palot:source-control:git-push",
  gitFetch: "palot:source-control:git-fetch",
  gitPull: "palot:source-control:git-pull",
  gitSync: "palot:source-control:git-sync",
  sourceControlChanged: "palot:source-control:changed",
} as const;

// ---------------------------------------------------------------------------------------------
// Results and errors
// ---------------------------------------------------------------------------------------------

export type SourceControlErrorCode =
  | "host-unauthenticated"
  | "host-unavailable"
  | "unsupported-action"
  /** The selected connection cannot run Git through the required execution API. */
  | "unsupported-connection"
  | "unknown-profile"
  /** The task's OpenCode connection is not connected, so its directory cannot be resolved. */
  | "not-connected"
  | "invalid-input"
  /** No GitHub token: set GH_TOKEN/GITHUB_TOKEN or run `gh auth login`. */
  | "github-unauthenticated"
  /** GitHub refused the token (HTTP 401). */
  | "github-auth-failed"
  /** GitHub asked Palot to wait; `retryAt` says until when. */
  | "github-rate-limited"
  | "github-not-found"
  /** GitHub refused the action for this account (HTTP 403 or a FORBIDDEN GraphQL error). */
  | "github-forbidden"
  | "github-unavailable"
  /** The merge was refused because the head (or base) moved since `expectedHeadOid` was read. */
  | "merge-head-moved"
  /** The pull request has conflicts or GitHub cannot merge it as it stands. */
  | "merge-not-mergeable"
  /** Required status checks have not passed. */
  | "merge-checks-required"
  /** Branch protection, rulesets, required reviews, a draft or the merge queue blocked it. */
  | "merge-blocked"
  /** The repository's remote is not a supported GitHub host. */
  | "unsupported-remote"
  | "no-remote"
  /** Branch detection found no pull request for the task's branch. */
  | "no-pull-request"
  /** Watching needs an open or draft pull request. */
  | "pull-request-not-open"
  | "not-a-repository"
  | "path-outside-repository"
  | "nothing-to-commit"
  | "detached-head"
  | "identity-missing"
  | "hook-failed"
  | "push-rejected"
  | "default-branch-confirmation"
  | "branch-diverged"
  | "dirty-worktree"
  | "no-upstream"
  | "branch-not-pushed"
  | "auth-failed"
  | "network"
  | "timeout"
  | "git-failed"
  | "internal";

export interface SourceControlFailure {
  code: SourceControlErrorCode;
  /** One sentence suitable for a toast. Never contains a token. */
  message: string;
  /** Raw tool output (Git stderr/stdout, hook output), trimmed and bounded. */
  detail?: string;
  /** Epoch ms when a rate-limit pause ends. */
  retryAt?: number;
}

export type SourceControlResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: SourceControlFailure };

// ---------------------------------------------------------------------------------------------
// Availability
// ---------------------------------------------------------------------------------------------

export interface GitHubAccountStatus {
  host: string;
  authenticated: boolean;
  /** Where the token came from. Never the token itself. */
  source: "env" | "gh" | null;
  /** The account login, read once per credential and cached. */
  login: string | null;
  error: SourceControlFailure | null;
  /** Background sync is paused until this time (epoch ms) after a rate limit. */
  pausedUntil: number | null;
}

export interface SourceControlStatus {
  hosts?: CodeHostAccount[];
  /** Null when no profile was given (GitHub-only status for the Pull requests page). */
  profileID: string | null;
  /** Whether PR links and Git writes are available for this profile. */
  supported: boolean;
  unsupportedReason: string | null;
  /** github.com. Kept for views that only show the github.com account (review lists). */
  github: GitHubAccountStatus;
  /**
   * Every host Palot reads: github.com, then the host GH_HOST names. Linked PRs use the
   * credential of their own host. Always set by the main process.
   */
  githubHosts?: GitHubAccountStatus[];
}

// ---------------------------------------------------------------------------------------------
// Pull requests
// ---------------------------------------------------------------------------------------------

export type PullRequestState = "open" | "draft" | "merged" | "closed";
export type PullRequestChecksSummary = "passing" | "failing" | "pending" | "none";
export type PullRequestReviewDecision = "approved" | "changes-requested" | "review-required";
export type PullRequestMergeable = "mergeable" | "conflicting" | "unknown";

export interface PullRequestSnapshot {
  /** Lowercase GitHub host, currently `github.com` (or a configured GH_HOST). */
  host: string;
  /** `owner/name`, lowercase. */
  repository: string;
  number: number;
  title: string;
  url: string;
  state: PullRequestState;
  checks: PullRequestChecksSummary;
  reviewDecision: PullRequestReviewDecision | null;
  mergeable: PullRequestMergeable;
  headBranch: string;
  baseBranch: string;
  author: string | null;
  /** GitHub's `updatedAt`, epoch ms. */
  updatedAt: number;
  mergedAt: number | null;
  closedAt: number | null;
}

/** Stable identity of one pull request: `host/owner/name#number`, lowercase. */
export type PullRequestKey = string;

export type PullRequestWatchEndReason =
  | "merged"
  | "closed"
  | "settled"
  | "comment-limit"
  | "unreadable"
  | "stopped";

export interface PullRequestWatchSummary {
  startedAt: number;
  /** Comment-only wakes in a row; watching stops at 10. */
  commentWakes: number;
  /** Failed reads in a row; watching stops at 8. */
  readFailures: number;
  lastWakeAt: number | null;
}

export interface PullRequestLink {
  profileID: string;
  sessionID: string;
  key: PullRequestKey;
  pullRequest: PullRequestSnapshot;
  source: "url" | "branch";
  linkedAt: number;
  /** Last successful GitHub read, epoch ms. */
  syncedAt: number | null;
  /** Last read failure message, cleared by the next successful read. */
  syncError: string | null;
  /** Non-null while Palot watches this PR for the task. */
  watch: PullRequestWatchSummary | null;
  /** Why the most recent watch ended, if one did. Cleared when a new watch starts. */
  watchEnded: { reason: PullRequestWatchEndReason; at: number } | null;
  /** Set when Palot settled the task because this PR merged or closed. */
  settledAt: number | null;
}

export type PullRequestSearchList =
  | "review-requested"
  | "authored"
  | "assigned"
  | "mentioned"
  | "recently-merged"
  /**
   * Open pull requests by anyone else, whoever is assigned or requested. GitHub only, and only
   * within a `repo:`, `org:` or `user:` scope in the query; unscoped it would span all of GitHub.
   */
  | "others";

export interface PullRequestSearchInput {
  host?: string;
  list: PullRequestSearchList;
  /** Opaque cursor from the previous page; null or omitted for the first page. */
  cursor?: string | null;
  /** 1–50, default 25. */
  limit?: number;
  /**
   * Extra GitHub search terms ANDed onto the list's own qualifiers, e.g. `repo:o/n label:bug`
   * or free text. Empty or omitted means the plain list.
   */
  query?: string;
}

export interface PullRequestSearchPage {
  list: PullRequestSearchList;
  items: PullRequestSnapshot[];
  totalCount: number;
  nextCursor: string | null;
}

export interface PullRequestSessionInput {
  profileID: string;
  sessionID: string;
}

export interface LinkPullRequestInput extends PullRequestSessionInput {
  /** A GitHub pull request URL. Omit to detect the PR from the task directory's branch. */
  url?: string;
}

export interface PreparePullRequestInput extends PullRequestSessionInput {
  base?: string;
}

export interface PullRequestPreparation {
  provider?: CodeHostKind;
  draftSupported?: boolean;
  branch: string;
  base: string;
  branches: string[];
  /** Bounded, committed branch diff. Never includes uncommitted files. */
  diff: string;
  commits: string;
  pushed: boolean;
  existing: PullRequestLink | null;
}

export interface CreatePullRequestInput extends PullRequestSessionInput {
  base: string;
  title: string;
  body: string;
  draft?: boolean;
}

export interface UnlinkPullRequestInput extends PullRequestSessionInput {
  key: PullRequestKey;
}

export interface WatchPullRequestInput extends PullRequestSessionInput {
  key: PullRequestKey;
  watching: boolean;
}

export interface ListPullRequestLinksInput {
  /** Omit for every local profile. */
  profileID?: string;
  /** Narrow to one task. */
  sessionID?: string;
}

export interface RefreshPullRequestsInput {
  profileID: string;
  /** Omit to refresh every link of the profile. */
  sessionID?: string;
}

// ---------------------------------------------------------------------------------------------
// Local Git
// ---------------------------------------------------------------------------------------------

export interface GitTarget {
  profileID: string;
  /** Absolute path of the task's directory (a Changes tab's `location.directory`). */
  directory: string;
}

export interface GitBranchInput extends GitTarget {
  action: "switch" | "create" | "rename";
  name: string;
  /** A local or remote branch ref; omitted to create from HEAD. */
  base?: string;
}

/** Porcelain v2 status letters: `.` unmodified, M, T, A, D, R, C, U. */
export type GitStatusCode = "." | "M" | "T" | "A" | "D" | "R" | "C" | "U";

export interface GitFileStatus {
  /** Path relative to the repository root, `/`-separated. */
  path: string;
  /** Source path of a rename or copy. */
  originalPath: string | null;
  index: GitStatusCode;
  worktree: GitStatusCode;
  staged: boolean;
  unstaged: boolean;
  untracked: boolean;
  conflicted: boolean;
}

export interface GitBranchStatus {
  /** Null on a detached HEAD. */
  name: string | null;
  /** Null before the first commit. */
  oid: string | null;
  /** e.g. `origin/feature`; null when no upstream is configured. */
  upstream: string | null;
  ahead: number;
  behind: number;
}

export interface GitWorkingTreeStatus {
  /** Repository root; file paths are relative to it. */
  root: string;
  branch: GitBranchStatus;
  files: GitFileStatus[];
  /** More than 5,000 entries; `files` holds the first 5,000. */
  truncated: boolean;
}

export interface GitPathsInput extends GitTarget {
  /** Repository-root-relative paths, as returned by `gitStatus`. */
  paths: string[];
}

export interface GitCommitInput extends GitTarget {
  message: string;
}

export interface GitPushInput extends GitTarget {
  confirmDefaultBranch?: boolean;
}

export type GitPullStrategy = "ff-only" | "rebase" | "merge";

export interface GitPullInput extends GitTarget {
  strategy?: GitPullStrategy;
}

export interface GitSyncInput extends GitPullInput, GitPushInput {}

export interface GitCommitResult {
  oid: string;
  summary: string;
  branch: GitBranchStatus;
}

export interface GitPushResult {
  remote: string;
  branch: string;
  /** Palot set the upstream because the branch had none. */
  setUpstream: boolean;
  branchStatus: GitBranchStatus;
}

// ---------------------------------------------------------------------------------------------
// Pull request review workspace (the Pull requests screen's detail panel)
// ---------------------------------------------------------------------------------------------

/** Identifies one PR for detail reads and actions. Interactive priority. */
export interface PullRequestRef {
  host: string;
  repository: string;
  number: number;
}

export interface PullRequestPerson {
  login: string;
  avatarUrl: string | null;
  isBot: boolean;
}

export type PullRequestCheckConclusion =
  | "success"
  | "failure"
  | "neutral"
  | "cancelled"
  | "skipped"
  | "timed-out"
  | "action-required"
  | "stale";

export interface PullRequestCheck {
  /** Check run or status context name. */
  name: string;
  /** Workflow or app name when GitHub reports one. */
  workflow: string | null;
  status: "queued" | "in-progress" | "waiting" | "completed";
  /** Null until completed. */
  conclusion: PullRequestCheckConclusion | null;
  required: boolean;
  url: string | null;
  startedAt: number | null;
  completedAt: number | null;
}

export type PullRequestReviewerState =
  | "requested"
  | "approved"
  | "changes-requested"
  | "commented"
  | "dismissed";

export interface PullRequestReviewer {
  /** A user login, or `org/team` for a requested team. */
  name: string;
  person: PullRequestPerson | null;
  isTeam: boolean;
  state: PullRequestReviewerState;
}

export type PullRequestMergeMethod = "merge" | "squash" | "rebase";

export type PullRequestMergeState =
  | "clean"
  | "blocked"
  | "behind"
  | "dirty"
  | "unstable"
  | "has-hooks"
  | "draft"
  | "unknown";

export interface PullRequestDetail extends PullRequestSnapshot {
  capabilities?: CodeHostCapabilities;
  /** Markdown body as written (not rendered HTML). */
  body: string;
  authorPerson: PullRequestPerson | null;
  labels: Array<{ name: string; color: string }>;
  assignees: PullRequestPerson[];
  reviewers: PullRequestReviewer[];
  checkRuns: PullRequestCheck[];
  /** False when GitHub had more checks than were read; never treat as all-passing then. */
  checksComplete: boolean;
  additions: number;
  deletions: number;
  changedFiles: number;
  commits: number;
  headOid: string;
  mergeState: PullRequestMergeState;
  /** Methods the repository allows, in GitHub's preferred order. */
  mergeMethods: PullRequestMergeMethod[];
  autoMerge: { method: PullRequestMergeMethod } | null;
  autoMergeAllowed?: boolean;
  viewer: {
    login: string | null;
    canMerge: boolean;
    canUpdate: boolean;
    isAuthor: boolean;
    /** The viewer's own latest review state, if any. */
    reviewState: PullRequestReviewerState | null;
  };
  createdAt: number;
}

export interface PullRequestReviewComment {
  id: string;
  author: PullRequestPerson | null;
  body: string;
  path: string;
  /** New-side line (RIGHT) or old-side line (LEFT); null when outdated with no position. */
  line: number | null;
  startLine: number | null;
  side: "LEFT" | "RIGHT";
  diffHunk: string;
  createdAt: number;
  url: string;
}

export type PullRequestTimelineItem =
  | {
      kind: "comment";
      id: string;
      author: PullRequestPerson | null;
      body: string;
      createdAt: number;
      updatedAt: number;
      url: string;
    }
  | {
      kind: "review";
      id: string;
      author: PullRequestPerson | null;
      state: Exclude<PullRequestReviewerState, "requested">;
      body: string;
      submittedAt: number;
      url: string;
    }
  | {
      kind: "review-thread";
      /** GraphQL thread id, used for reply and resolve. */
      id: string;
      path: string;
      line: number | null;
      isResolved: boolean;
      isOutdated: boolean;
      viewerCanResolve: boolean;
      viewerCanReply: boolean;
      comments: PullRequestReviewComment[];
      /** First comment's time, for ordering. */
      createdAt: number;
    }
  | {
      kind: "commit";
      id: string;
      oid: string;
      message: string;
      author: PullRequestPerson | null;
      createdAt: number;
    }
  | {
      kind: "event";
      id: string;
      type:
        | "merged"
        | "closed"
        | "reopened"
        | "ready-for-review"
        | "converted-to-draft"
        | "review-requested"
        | "labeled"
        | "unlabeled"
        | "force-pushed"
        | "head-ref-deleted"
        | "renamed";
      actor: PullRequestPerson | null;
      /** Short human detail, e.g. a label name, requested reviewer, or new title. */
      detail: string | null;
      createdAt: number;
    };

export interface PullRequestTimelineInput extends PullRequestRef {
  /** Opaque cursor; omit for the oldest page. Items are oldest first. */
  cursor?: string | null;
  limit?: number;
}

export interface PullRequestTimelinePage {
  items: PullRequestTimelineItem[];
  nextCursor: string | null;
}

export type PullRequestFileViewedState = "viewed" | "unviewed" | "dismissed";

export interface PullRequestFile {
  path: string;
  previousPath: string | null;
  status: "added" | "modified" | "removed" | "renamed" | "copied" | "changed";
  additions: number;
  deletions: number;
  /** Unified diff for this file (GitHub's `patch`), or null when binary or too large. */
  patch: string | null;
  /** GitHub's own viewed mark; `dismissed` = viewed before the file changed again. */
  viewed: PullRequestFileViewedState;
}

export interface PullRequestFiles {
  headOid: string;
  files: PullRequestFile[];
  /** True when GitHub capped the list (3,000 files) or a read stopped early. */
  truncated: boolean;
}

export interface PullRequestFileViewedInput extends PullRequestRef {
  path: string;
  viewed: boolean;
}

export interface PullRequestDraftComment {
  path: string;
  line: number;
  startLine?: number;
  side: "LEFT" | "RIGHT";
  body: string;
}

export interface PullRequestReviewInput extends PullRequestRef {
  event: "approve" | "request-changes" | "comment";
  body: string;
  comments: PullRequestDraftComment[];
  /** The head the reviewer read; GitHub anchors comments to it. */
  commitOid: string;
}

export interface PullRequestCommentInput extends PullRequestRef {
  body: string;
}

export interface PullRequestThreadReplyInput extends PullRequestRef {
  threadID: string;
  body: string;
}

export interface PullRequestThreadResolveInput extends PullRequestRef {
  threadID: string;
  resolved: boolean;
}

export interface PullRequestMergeInput extends PullRequestRef {
  method: PullRequestMergeMethod;
  /** Refuse to merge if the head moved since the user looked. */
  expectedHeadOid: string;
  commitTitle?: string;
  commitBody?: string;
}

export interface PullRequestStateInput extends PullRequestRef {
  state: "open" | "closed";
}

export interface PullRequestEditInput extends PullRequestRef {
  title: string;
  body: string;
}

export interface PullRequestLabelInput extends PullRequestRef {
  name: string;
  add: boolean;
}

export interface PullRequestAutoMergeInput extends PullRequestRef {
  enabled: boolean;
  method: PullRequestMergeMethod;
}

export interface PullRequestUpdateBranchInput extends PullRequestRef {
  expectedHeadOid: string;
}

export interface PullRequestDraftInput extends PullRequestRef {
  draft: boolean;
}

export interface PullRequestReviewersInput extends PullRequestRef {
  /** User logins or `org/team` slugs to request. */
  reviewers: string[];
}

// ---------------------------------------------------------------------------------------------
// Change events
// ---------------------------------------------------------------------------------------------

export type SourceControlChangedEvent =
  | {
      type: "pull-requests";
      profileID: string;
      sessionIDs: string[];
      reason: "linked" | "unlinked" | "synced" | "watch" | "settled";
    }
  | { type: "git"; profileID: string; directory: string }
  | {
      /** A review-workspace action changed this PR on GitHub. */
      type: "pull-request";
      key: PullRequestKey;
      reason: "reviewed" | "commented" | "viewed" | "merged" | "state" | "reviewers" | "edited";
    }
  | { type: "github"; host: string };

// ---------------------------------------------------------------------------------------------
// Preload surface (`window.palot.sourceControl`)
// ---------------------------------------------------------------------------------------------

export interface PalotSourceControlApi {
  codeHosts(): Promise<CodeHostAccount[]>;
  saveCodeHost(input: SaveCodeHostInput): Promise<SourceControlResult<null>>;
  removeCodeHost(host: string): Promise<SourceControlResult<null>>;
  gitBranch(input: GitBranchInput): Promise<SourceControlResult<GitWorkingTreeStatus>>;
  editPullRequest(input: PullRequestEditInput): Promise<SourceControlResult<PullRequestDetail>>;
  pullRequestLabels(
    ref: PullRequestRef,
  ): Promise<SourceControlResult<Array<{ name: string; color: string }>>>;
  setPullRequestLabel(
    input: PullRequestLabelInput,
  ): Promise<SourceControlResult<PullRequestDetail>>;
  setPullRequestAutoMerge(
    input: PullRequestAutoMergeInput,
  ): Promise<SourceControlResult<PullRequestDetail>>;
  updatePullRequestBranch(
    input: PullRequestUpdateBranchInput,
  ): Promise<SourceControlResult<PullRequestDetail>>;
  status(profileID?: string): Promise<SourceControlStatus>;
  listPullRequestLinks(
    input?: ListPullRequestLinksInput,
  ): Promise<SourceControlResult<PullRequestLink[]>>;
  linkPullRequest(input: LinkPullRequestInput): Promise<SourceControlResult<PullRequestLink>>;
  preparePullRequest(
    input: PreparePullRequestInput,
  ): Promise<SourceControlResult<PullRequestPreparation>>;
  createPullRequest(input: CreatePullRequestInput): Promise<SourceControlResult<PullRequestLink>>;
  unlinkPullRequest(input: UnlinkPullRequestInput): Promise<SourceControlResult<null>>;
  refreshPullRequests(
    input: RefreshPullRequestsInput,
  ): Promise<SourceControlResult<PullRequestLink[]>>;
  watchPullRequest(input: WatchPullRequestInput): Promise<SourceControlResult<PullRequestLink>>;
  searchPullRequests(
    input: PullRequestSearchInput,
  ): Promise<SourceControlResult<PullRequestSearchPage>>;
  pullRequestDetail(ref: PullRequestRef): Promise<SourceControlResult<PullRequestDetail>>;
  pullRequestTimeline(
    input: PullRequestTimelineInput,
  ): Promise<SourceControlResult<PullRequestTimelinePage>>;
  pullRequestFiles(ref: PullRequestRef): Promise<SourceControlResult<PullRequestFiles>>;
  setPullRequestFileViewed(input: PullRequestFileViewedInput): Promise<SourceControlResult<null>>;
  submitPullRequestReview(input: PullRequestReviewInput): Promise<SourceControlResult<null>>;
  addPullRequestComment(input: PullRequestCommentInput): Promise<SourceControlResult<null>>;
  replyToPullRequestThread(input: PullRequestThreadReplyInput): Promise<SourceControlResult<null>>;
  resolvePullRequestThread(
    input: PullRequestThreadResolveInput,
  ): Promise<SourceControlResult<null>>;
  mergePullRequest(input: PullRequestMergeInput): Promise<SourceControlResult<PullRequestDetail>>;
  setPullRequestState(
    input: PullRequestStateInput,
  ): Promise<SourceControlResult<PullRequestDetail>>;
  setPullRequestDraft(
    input: PullRequestDraftInput,
  ): Promise<SourceControlResult<PullRequestDetail>>;
  requestPullRequestReviewers(
    input: PullRequestReviewersInput,
  ): Promise<SourceControlResult<PullRequestDetail>>;
  gitStatus(target: GitTarget): Promise<SourceControlResult<GitWorkingTreeStatus>>;
  gitStage(input: GitPathsInput): Promise<SourceControlResult<GitWorkingTreeStatus>>;
  gitUnstage(input: GitPathsInput): Promise<SourceControlResult<GitWorkingTreeStatus>>;
  gitCommit(input: GitCommitInput): Promise<SourceControlResult<GitCommitResult>>;
  gitPush(target: GitPushInput): Promise<SourceControlResult<GitPushResult>>;
  gitFetch(target: GitTarget): Promise<SourceControlResult<GitWorkingTreeStatus>>;
  gitPull(input: GitPullInput): Promise<SourceControlResult<GitWorkingTreeStatus>>;
  gitSync(input: GitSyncInput): Promise<SourceControlResult<GitPushResult>>;
  onChanged(listener: (event: SourceControlChangedEvent) => void): () => void;
}

export function pullRequestKey(input: { host: string; repository: string; number: number }) {
  return `${input.host.toLowerCase()}/${input.repository.toLowerCase()}#${input.number}`;
}

export type CodeHostKind = "github" | "gitlab" | "forgejo" | "bitbucket";
export interface CodeHostCapabilities {
  mergeDisabledReason?: string;
  requestChanges?: boolean;
  draft: boolean;
  review: boolean;
  inlineReview: boolean;
  fileViewed: boolean;
  reviewers: boolean;
  labels: boolean;
  updateBranch: boolean;
  autoMerge: boolean;
  state: boolean;
  edit: boolean;
}
/** Metadata only. Tokens never travel back to the renderer. */
export interface CodeHostAccount {
  host: string;
  url: string;
  kind: CodeHostKind;
  source: "saved" | "env" | "glab" | null;
  configured: boolean;
}
export interface SaveCodeHostInput {
  url: string;
  kind: Exclude<CodeHostKind, "github">;
  token: string;
}
