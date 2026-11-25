/**
 * Review threads read from a pull request's timeline. Kept apart from the Code tab's model so
 * surfaces outside the lazily loaded diff renderer (the task header, PR repair) can use them.
 */
import type { PullRequestTimelineItem } from "../../../shared/source-control-contract";

export type ReviewThread = Extract<PullRequestTimelineItem, { kind: "review-thread" }>;

/** Review threads that can sit on a line: current (not outdated) and anchored. */
export function lineReviewThreads(items: readonly PullRequestTimelineItem[]): ReviewThread[] {
  return items.filter(
    (item): item is ReviewThread =>
      item.kind === "review-thread" && !item.isOutdated && item.line !== null,
  );
}
