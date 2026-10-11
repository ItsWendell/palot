import type { PullRequestSnapshot } from "../../shared/source-control-contract";
import type { GitHubGateway } from "./github-client";
import type { GitHubPriority } from "./github-quota";
import {
  buildWatchDetail,
  present,
  remarkActiveAt,
  reviewEntry,
  watchPageQueries,
  type PullRequestWatchDetail,
  type PullRequestWatchPage,
  type RawConnection,
  type RawContext,
  type RawRemark,
  type RawReview,
} from "./github-pull-requests";

/** Follow-up reads per watched PR per sweep; past this the read counts as incomplete. */
export const WATCH_FOLLOW_UP_LIMIT = 10;

type NodeAnswer<T> = { node?: T | null };

/**
 * Finishes a watched PR's page when the batched read truncated it: every check of the head
 * commit, and every comment or review newer than `since` (the watch's remark watermark).
 * Anything still missing after the follow-up budget, or a follow-up that failed, marks the
 * detail incomplete instead of failing the read, so the watch neither announces "passed" on
 * a partial check list nor advances its remark watermark past comments it did not see.
 */
export async function completeWatchDetail(input: {
  github: Pick<GitHubGateway, "graphql">;
  host: string;
  number: number;
  page: PullRequestWatchPage;
  snapshot: PullRequestSnapshot;
  since: number;
  priority: GitHubPriority;
}): Promise<PullRequestWatchDetail> {
  const page: PullRequestWatchPage = {
    ...input.page,
    contexts: [...input.page.contexts],
    comments: [...input.page.comments],
    reviews: input.page.reviews.map((entry) => ({ ...entry, comments: [...entry.comments] })),
  };
  let budget = WATCH_FOLLOW_UP_LIMIT;
  let checks = page.checksAfter === null;
  let remarks = true;
  const query = async <T>(document: string, variables: Record<string, unknown>) => {
    budget -= 1;
    return input.github.graphql<NodeAnswer<T>>({
      host: input.host,
      query: document,
      variables,
      priority: input.priority,
    });
  };

  try {
    while (page.checksAfter !== null && page.commitID && budget > 0) {
      const answer = await query<{
        oid?: string;
        statusCheckRollup?: { contexts?: RawConnection<RawContext> | null } | null;
      }>(watchPageQueries.checks(input.number), { id: page.commitID, after: page.checksAfter });
      // A push between pages would mix two commits' checks.
      if (answer.node?.oid !== page.headSha) break;
      const contexts = answer.node?.statusCheckRollup?.contexts;
      page.contexts.push(...present(contexts?.nodes));
      page.checksAfter = contexts?.pageInfo?.hasNextPage
        ? (contexts.pageInfo.endCursor ?? null)
        : null;
    }
    checks = page.checksAfter === null;
  } catch {
    checks = false;
  }

  try {
    const oldest = (items: Array<RawRemark>) =>
      Math.min(...items.map((item) => remarkActiveAt(item) ?? Number.POSITIVE_INFINITY));
    while (
      page.commentsBefore !== null &&
      page.pullRequestID &&
      oldest(page.comments) > input.since &&
      budget > 0
    ) {
      const answer = await query<{ comments?: RawConnection<RawRemark> | null }>(
        watchPageQueries.comments,
        { id: page.pullRequestID, before: page.commentsBefore },
      );
      const connection = answer.node?.comments;
      page.comments.unshift(...present(connection?.nodes));
      page.commentsBefore = connection?.pageInfo?.hasPreviousPage
        ? (connection.pageInfo.startCursor ?? null)
        : null;
    }
    if (page.commentsBefore !== null && oldest(page.comments) > input.since) remarks = false;

    while (
      page.reviewsBefore !== null &&
      page.pullRequestID &&
      oldest(page.reviews.map((entry) => entry.review)) > input.since &&
      budget > 0
    ) {
      const answer = await query<{ reviews?: RawConnection<RawReview> | null }>(
        watchPageQueries.reviews,
        { id: page.pullRequestID, before: page.reviewsBefore },
      );
      const connection = answer.node?.reviews;
      page.reviews.unshift(...present(connection?.nodes).map(reviewEntry));
      page.reviewsBefore = connection?.pageInfo?.hasPreviousPage
        ? (connection.pageInfo.startCursor ?? null)
        : null;
    }
    if (
      page.reviewsBefore !== null &&
      oldest(page.reviews.map((entry) => entry.review)) > input.since
    )
      remarks = false;

    for (const entry of page.reviews) {
      // Comments of a review submitted before the watermark were already seen with it.
      if ((remarkActiveAt(entry.review) ?? 0) <= input.since) continue;
      while (entry.commentsAfter !== null && entry.review.id && budget > 0) {
        const answer = await query<{ comments?: RawConnection<RawRemark> | null }>(
          watchPageQueries.reviewComments,
          { id: entry.review.id, after: entry.commentsAfter },
        );
        const connection = answer.node?.comments;
        entry.comments.push(...present(connection?.nodes));
        entry.commentsAfter = connection?.pageInfo?.hasNextPage
          ? (connection.pageInfo.endCursor ?? null)
          : null;
      }
      if (entry.commentsAfter !== null) remarks = false;
    }
  } catch {
    remarks = false;
  }

  return buildWatchDetail(page, input.snapshot, { checks, remarks });
}
