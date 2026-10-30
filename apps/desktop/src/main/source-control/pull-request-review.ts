import type {
  PullRequestEditInput,
  PullRequestLabelInput,
  PullRequestAutoMergeInput,
  PullRequestUpdateBranchInput,
  PullRequestCommentInput,
  PullRequestDetail,
  PullRequestDraftInput,
  PullRequestFileViewedInput,
  PullRequestFiles,
  PullRequestMergeInput,
  PullRequestRef,
  PullRequestReviewInput,
  PullRequestReviewersInput,
  PullRequestStateInput,
  PullRequestThreadReplyInput,
  PullRequestThreadResolveInput,
  PullRequestTimelineInput,
  PullRequestTimelinePage,
  SourceControlChangedEvent,
} from "../../shared/source-control-contract";
import { pullRequestKey } from "../../shared/source-control-contract";
import { SourceControlError } from "./errors";
import { GitHubApiError, type GitHubGateway } from "./github-client";
import type { RawConnection } from "./github-pull-requests";
import {
  FILES_LIMIT,
  FILES_PAGE_SIZE,
  GRAPHQL_MERGE_METHODS,
  MERGE_FAILURE_MESSAGES,
  TIMELINE_DEFAULT_LIMIT,
  TIMELINE_MAX_LIMIT,
  checksPageQuery,
  classifyMergeFailure,
  decodeTimelineCursor,
  detailQuery,
  filesViewedQuery,
  mergeTimeline,
  mutations,
  nodeIDQuery,
  normalizePullRequestRef,
  parseDetail,
  present,
  reviewInputProblem,
  reviewRequestBody,
  reviewThreadsQuery,
  splitReviewers,
  threadOwnerQuery,
  timelineQuery,
  toFile,
  toThread,
  type NormalizedPullRequestRef,
  type RawCheckContext,
  type RawDetail,
  type RawFilesViewed,
  type RawRestFile,
  type RawThread,
  type RawTimelineNode,
} from "./github-review";

/** Extra pages of a head commit's checks read for the detail (100 checks each). */
const CHECK_PAGE_LIMIT = 10;
/** Review thread pages (50 threads each) read per timeline page. */
const THREAD_PAGE_LIMIT = 20;
const NODE_ID_CACHE_LIMIT = 500;

type ChangeReason = Extract<SourceControlChangedEvent, { type: "pull-request" }>["reason"];

export interface PullRequestReviewOptions {
  github: GitHubGateway;
  emit(event: SourceControlChangedEvent): void;
  /** Re-reads the linked tasks of this PR now, so they update or settle after a merge. */
  syncLinks(key: string): void;
}

/**
 * Reads and actions of the Pull requests review workspace. Everything runs at interactive
 * priority with the local machine's credential for the PR's host; no OpenCode profile is
 * involved. Actions announce `{ type: "pull-request", key, reason }` after GitHub accepted them.
 */
export class PullRequestReviewService {
  private readonly nodeIDs = new Map<string, string>();

  constructor(private readonly options: PullRequestReviewOptions) {}

  async detail(input: PullRequestRef): Promise<PullRequestDetail> {
    const ref = normalized(input);
    const data = await this.graphql<RawDetail>(ref, detailQuery(ref.number), {
      owner: ref.owner,
      name: ref.name,
      number: ref.number,
    });
    const first = parseDetailOrThrow(data, ref);
    this.rememberNodeID(ref, first.pullRequestID);
    if (!first.checksCursor) return first.detail;

    const extra: RawCheckContext[] = [];
    let after: string | null = first.checksCursor.after;
    try {
      for (let page = 0; after && page < CHECK_PAGE_LIMIT; page += 1) {
        const answer: {
          node?: {
            oid?: string;
            statusCheckRollup?: { contexts?: RawConnection<RawCheckContext> | null } | null;
          } | null;
        } = await this.graphql(ref, checksPageQuery(ref.number), {
          id: first.checksCursor.commitID,
          after,
        });
        // A push between pages would mix two commits' checks.
        if (answer.node?.oid !== first.checksCursor.headOid) break;
        const contexts = answer.node?.statusCheckRollup?.contexts;
        extra.push(...present(contexts?.nodes));
        after = contexts?.pageInfo?.hasNextPage ? (contexts.pageInfo.endCursor ?? null) : null;
      }
    } catch {
      // The detail is still useful; `checksComplete` says the list is partial.
    }
    const complete = parseDetailOrThrow(data, ref, extra).detail;
    return { ...complete, checksComplete: after === null };
  }

  async timeline(input: PullRequestTimelineInput): Promise<PullRequestTimelinePage> {
    const ref = normalized(input);
    const limit = Math.min(
      TIMELINE_MAX_LIMIT,
      Math.max(1, Math.trunc(input.limit ?? TIMELINE_DEFAULT_LIMIT)),
    );
    const cursor = input.cursor ? decodeTimelineCursor(input.cursor) : null;
    if (input.cursor && !cursor)
      throw new SourceControlError("invalid-input", "The timeline cursor is invalid.");
    const variables = { owner: ref.owner, name: ref.name, number: ref.number };
    const [page, threads] = await Promise.all([
      this.graphql<{
        repository?: {
          pullRequest?: { timelineItems?: RawConnection<RawTimelineNode> | null } | null;
        } | null;
      }>(ref, timelineQuery, { ...variables, first: limit, after: cursor?.after ?? null }),
      this.threads(ref),
    ]);
    const connection = page.repository?.pullRequest?.timelineItems;
    if (!page.repository?.pullRequest) throw notFound(ref);
    return mergeTimeline({
      nodes: present(connection?.nodes),
      pageInfo: connection?.pageInfo,
      threads,
      since: cursor?.through ?? Number.NEGATIVE_INFINITY,
    });
  }

  async files(input: PullRequestRef): Promise<PullRequestFiles> {
    const ref = normalized(input);
    const variables = { owner: ref.owner, name: ref.name, number: ref.number };
    const first = await this.graphql<RawFilesViewed>(ref, filesViewedQuery, {
      ...variables,
      after: null,
    });
    const pull = first.repository?.pullRequest;
    if (!pull?.id || !pull.headRefOid) throw notFound(ref);
    this.rememberNodeID(ref, pull.id);
    const changedFiles = pull.changedFiles ?? 0;
    const pages = Math.max(1, Math.ceil(Math.min(changedFiles, FILES_LIMIT) / FILES_PAGE_SIZE));
    let truncated = changedFiles > FILES_LIMIT;

    const viewed = new Map<string, string | null | undefined>();
    const readViewed = async () => {
      let connection = pull.files;
      for (let page = 0; page < FILES_LIMIT / FILES_PAGE_SIZE; page += 1) {
        for (const file of present(connection?.nodes))
          if (file.path) viewed.set(file.path, file.viewerViewedState);
        const after = connection?.pageInfo?.hasNextPage ? connection.pageInfo.endCursor : null;
        if (!after) return;
        const next = await this.graphql<RawFilesViewed>(ref, filesViewedQuery, {
          ...variables,
          after,
        });
        connection = next.repository?.pullRequest?.files;
      }
    };
    const readPage = (page: number) =>
      this.options.github
        .rest<RawRestFile[]>({
          host: ref.host,
          path: `repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.name)}/pulls/${ref.number}/files?per_page=${FILES_PAGE_SIZE}&page=${page}`,
          priority: "interactive",
        })
        .then((response) => (Array.isArray(response.data) ? response.data : []));

    const [viewedResult, ...pageResults] = await Promise.allSettled([
      readViewed(),
      ...Array.from({ length: pages }, (_, index) => readPage(index + 1)),
    ]);
    if (pageResults[0]?.status === "rejected") throw pageResults[0].reason;
    if (viewedResult?.status === "rejected") truncated = true;
    const files = pageResults.flatMap((result) => {
      if (result.status === "rejected") {
        truncated = true;
        return [];
      }
      return result.value.flatMap((raw) => {
        const file = toFile(raw, viewed);
        return file ? [file] : [];
      });
    });
    // A full last page means GitHub may have more than `changedFiles` said when it was read.
    const last = pageResults.at(-1);
    if (
      last?.status === "fulfilled" &&
      last.value.length === FILES_PAGE_SIZE &&
      pages * FILES_PAGE_SIZE < FILES_LIMIT
    )
      truncated = true;
    return { headOid: pull.headRefOid, files, truncated };
  }

  async setFileViewed(input: PullRequestFileViewedInput): Promise<void> {
    const ref = normalized(input);
    if (!input.path || input.path.includes("\0"))
      throw new SourceControlError("invalid-input", "The file path is invalid.");
    await this.withNodeID(ref, (id) =>
      this.graphql(ref, input.viewed ? mutations.markViewed : mutations.unmarkViewed, {
        id,
        path: input.path,
      }),
    );
    this.changed(ref, "viewed");
  }

  async review(input: PullRequestReviewInput): Promise<void> {
    const ref = normalized(input);
    const problem = reviewInputProblem(input);
    if (problem) throw new SourceControlError("invalid-input", problem);
    await this.options.github.rest({
      host: ref.host,
      method: "POST",
      path: `repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.name)}/pulls/${ref.number}/reviews`,
      body: reviewRequestBody(input),
      priority: "interactive",
    });
    this.changed(ref, "reviewed");
  }

  async comment(input: PullRequestCommentInput): Promise<void> {
    const ref = normalized(input);
    if (!input.body.trim()) throw new SourceControlError("invalid-input", "Write a comment first.");
    await this.withNodeID(ref, (id) =>
      this.graphql(ref, mutations.comment, { id, body: input.body }),
    );
    this.changed(ref, "commented");
  }

  async reply(input: PullRequestThreadReplyInput): Promise<void> {
    const ref = normalized(input);
    if (!input.body.trim()) throw new SourceControlError("invalid-input", "Write a reply first.");
    await this.assertThreadOf(ref, input.threadID);
    await this.graphql(ref, mutations.reply, { id: input.threadID, body: input.body });
    this.changed(ref, "commented");
  }

  async resolve(input: PullRequestThreadResolveInput): Promise<void> {
    const ref = normalized(input);
    await this.assertThreadOf(ref, input.threadID);
    await this.graphql(ref, input.resolved ? mutations.resolve : mutations.unresolve, {
      id: input.threadID,
    });
    this.changed(ref, "commented");
  }

  async merge(input: PullRequestMergeInput): Promise<PullRequestDetail> {
    const ref = normalized(input);
    if (!/^[0-9a-f]{40}$/i.test(input.expectedHeadOid))
      throw new SourceControlError(
        "invalid-input",
        "The merge is missing the reviewed head commit.",
      );
    const message =
      input.method === "rebase"
        ? {}
        : {
            ...(input.commitTitle?.trim() ? { commitHeadline: input.commitTitle.trim() } : {}),
            ...(input.commitBody !== undefined ? { commitBody: input.commitBody } : {}),
          };
    try {
      await this.withNodeID(ref, (id) =>
        this.graphql(ref, mutations.merge, {
          input: {
            pullRequestId: id,
            mergeMethod: GRAPHQL_MERGE_METHODS[input.method],
            expectedHeadOid: input.expectedHeadOid,
            ...message,
          },
        }),
      );
    } catch (error) {
      throw mergeError(error);
    }
    return this.afterStateChange(ref, "merged");
  }

  async setState(input: PullRequestStateInput): Promise<PullRequestDetail> {
    const ref = normalized(input);
    await this.withNodeID(ref, (id) =>
      this.graphql(ref, input.state === "closed" ? mutations.close : mutations.reopen, { id }),
    );
    return this.afterStateChange(ref, "state");
  }

  async setDraft(input: PullRequestDraftInput): Promise<PullRequestDetail> {
    const ref = normalized(input);
    await this.withNodeID(ref, (id) =>
      this.graphql(ref, input.draft ? mutations.draft : mutations.ready, { id }),
    );
    return this.afterStateChange(ref, "state");
  }

  async requestReviewers(input: PullRequestReviewersInput): Promise<PullRequestDetail> {
    const ref = normalized(input);
    const body = splitReviewers(ref.owner, input.reviewers);
    if (typeof body === "string") throw new SourceControlError("invalid-input", body);
    await this.options.github.rest({
      host: ref.host,
      method: "POST",
      path: `repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.name)}/pulls/${ref.number}/requested_reviewers`,
      body,
      priority: "interactive",
    });
    this.changed(ref, "reviewers");
    return this.detail(ref);
  }

  async edit(input: PullRequestEditInput): Promise<PullRequestDetail> {
    const ref = normalized(input);
    if (!input.title.trim()) throw new SourceControlError("invalid-input", "Write a title first.");
    await this.options.github.rest({
      host: ref.host,
      method: "PATCH",
      path: this.restPath(ref, "pulls"),
      body: { title: input.title.trim(), body: input.body },
      priority: "interactive",
    });
    return this.afterStateChange(ref, "edited");
  }

  async labels(input: PullRequestRef): Promise<Array<{ name: string; color: string }>> {
    const ref = normalized(input);
    const labels: Array<{ name: string; color: string }> = [];
    // Page until exhausted, so a repository's less common labels stay selectable.
    for (let page = 1; page <= 100; page += 1) {
      const { data } = await this.options.github.rest<Array<{ name: string; color: string }>>({
        host: ref.host,
        path: `repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.name)}/labels?per_page=100&page=${page}`,
        priority: "interactive",
      });
      labels.push(...data);
      if (data.length < 100) break;
    }
    return labels;
  }

  async setLabel(input: PullRequestLabelInput): Promise<PullRequestDetail> {
    const ref = normalized(input);
    if (!input.name.trim()) throw new SourceControlError("invalid-input", "Choose a label.");
    // Add/remove just one label: never overwrite a concurrent label edit.
    await this.options.github.rest({
      host: ref.host,
      method: input.add ? "POST" : "DELETE",
      path: `${this.restPath(ref, "issues")}/labels${input.add ? "" : `/${encodeURIComponent(input.name)}`}`,
      ...(input.add ? { body: { labels: [input.name] } } : {}),
      priority: "interactive",
    });
    return this.afterStateChange(ref, "edited");
  }

  async setAutoMerge(input: PullRequestAutoMergeInput): Promise<PullRequestDetail> {
    const ref = normalized(input);
    const detail = await this.detail(ref);
    if (
      input.enabled &&
      (!detail.autoMergeAllowed ||
        detail.state !== "open" ||
        !detail.mergeMethods.includes(input.method))
    )
      throw new SourceControlError(
        "merge-blocked",
        "Auto-merge is unavailable for this repository or pull request.",
      );
    await this.withNodeID(ref, (id) =>
      this.graphql(ref, input.enabled ? mutations.enableAutoMerge : mutations.disableAutoMerge, {
        id,
        ...(input.enabled ? { method: GRAPHQL_MERGE_METHODS[input.method] } : {}),
      }),
    );
    return this.afterStateChange(ref, "state");
  }

  async updateBranch(input: PullRequestUpdateBranchInput): Promise<PullRequestDetail> {
    const ref = normalized(input);
    if (!/^[0-9a-f]{40}$/i.test(input.expectedHeadOid))
      throw new SourceControlError(
        "invalid-input",
        "Refresh the pull request before updating its branch.",
      );
    await this.options.github.rest({
      host: ref.host,
      method: "PUT",
      path: `${this.restPath(ref, "pulls")}/update-branch`,
      body: { expected_head_sha: input.expectedHeadOid },
      priority: "interactive",
    });
    return this.afterStateChange(ref, "state");
  }

  private restPath(ref: NormalizedPullRequestRef, kind: "pulls" | "issues") {
    return `repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.name)}/${kind}/${ref.number}`;
  }

  private async afterStateChange(
    ref: NormalizedPullRequestRef,
    reason: ChangeReason,
  ): Promise<PullRequestDetail> {
    this.changed(ref, reason);
    this.options.syncLinks(pullRequestKey(ref));
    return this.detail(ref);
  }

  private changed(ref: NormalizedPullRequestRef, reason: ChangeReason): void {
    this.options.emit({ type: "pull-request", key: pullRequestKey(ref), reason });
  }

  private async threads(ref: NormalizedPullRequestRef) {
    const threads: RawThread[] = [];
    let after: string | null = null;
    for (let page = 0; page < THREAD_PAGE_LIMIT; page += 1) {
      const answer: {
        repository?: {
          pullRequest?: { reviewThreads?: RawConnection<RawThread> | null } | null;
        } | null;
      } = await this.graphql(ref, reviewThreadsQuery, {
        owner: ref.owner,
        name: ref.name,
        number: ref.number,
        after,
      });
      const connection = answer.repository?.pullRequest?.reviewThreads;
      threads.push(...present(connection?.nodes));
      after = connection?.pageInfo?.hasNextPage ? (connection.pageInfo.endCursor ?? null) : null;
      if (!after) break;
    }
    return threads.flatMap((raw) => {
      const thread = toThread(raw);
      return thread ? [thread] : [];
    });
  }

  /** A thread ID from the renderer must belong to this PR, so the write and its event agree. */
  private async assertThreadOf(ref: NormalizedPullRequestRef, threadID: string): Promise<void> {
    const answer = await this.graphql<{
      node?: { pullRequest?: { number?: number; repository?: { nameWithOwner?: string } } } | null;
    }>(ref, threadOwnerQuery, { id: threadID });
    const pull = answer.node?.pullRequest;
    if (
      pull?.number !== ref.number ||
      pull.repository?.nameWithOwner?.toLowerCase() !== ref.repository
    )
      throw new SourceControlError(
        "invalid-input",
        "That review thread is not on this pull request.",
      );
  }

  private async withNodeID<T>(
    ref: NormalizedPullRequestRef,
    action: (id: string) => Promise<T>,
  ): Promise<T> {
    const key = pullRequestKey(ref);
    let id = this.nodeIDs.get(key);
    if (!id) {
      const answer = await this.graphql<{
        repository?: { pullRequest?: { id?: string } | null } | null;
      }>(ref, nodeIDQuery, { owner: ref.owner, name: ref.name, number: ref.number });
      id = answer.repository?.pullRequest?.id;
      if (!id) throw notFound(ref);
      this.rememberNodeID(ref, id);
    }
    try {
      return await action(id);
    } catch (error) {
      if (error instanceof GitHubApiError && error.code === "not-found") this.nodeIDs.delete(key);
      throw error;
    }
  }

  private rememberNodeID(ref: NormalizedPullRequestRef, id: string): void {
    const key = pullRequestKey(ref);
    this.nodeIDs.delete(key);
    this.nodeIDs.set(key, id);
    if (this.nodeIDs.size > NODE_ID_CACHE_LIMIT)
      this.nodeIDs.delete(this.nodeIDs.keys().next().value!);
  }

  private graphql<T>(
    ref: NormalizedPullRequestRef,
    query: string,
    variables: Record<string, unknown>,
  ): Promise<T> {
    return this.options.github.graphql<T>({
      host: ref.host,
      query,
      variables,
      priority: "interactive",
    });
  }
}

function normalized(ref: PullRequestRef): NormalizedPullRequestRef {
  const value = normalizePullRequestRef(ref);
  if (!value)
    throw new SourceControlError(
      "invalid-input",
      "The pull request reference must be a host, owner/name and number.",
    );
  return value;
}

function notFound(ref: NormalizedPullRequestRef): SourceControlError {
  return new SourceControlError(
    "github-not-found",
    `GitHub could not find ${ref.repository}#${ref.number}, or the credential cannot see it.`,
  );
}

function parseDetailOrThrow(
  data: RawDetail,
  ref: NormalizedPullRequestRef,
  extra?: RawCheckContext[],
) {
  const parsed = parseDetail(data, ref, extra);
  if (!parsed) throw notFound(ref);
  return parsed;
}

/** Turns GitHub's merge refusal into a specific code; other failures pass through. */
export function mergeError(error: unknown): unknown {
  if (!(error instanceof GitHubApiError)) return error;
  if (error.code !== "response" && error.code !== "validation" && error.code !== "forbidden")
    return error;
  const code = classifyMergeFailure(error.options.githubMessages ?? [error.message]);
  if (!code) return error;
  return new SourceControlError(
    code,
    MERGE_FAILURE_MESSAGES[code],
    (error.options.githubMessages ?? []).join("\n") || undefined,
  );
}
