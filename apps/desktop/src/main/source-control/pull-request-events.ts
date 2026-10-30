import type { PullRequestSnapshot } from "../../shared/source-control-contract";
import type { PullRequestWatchDetail } from "./github-pull-requests";
import type { StoredPullRequestLink } from "./pull-request-repository";

/** Reuses the existing batched GitHub sweep; listeners request detail only for matching links. */
interface Observer {
  matches(link: StoredPullRequestLink): boolean;
  detail(
    link: StoredPullRequestLink,
    snapshot: PullRequestSnapshot,
    detail: PullRequestWatchDetail,
    viewer: string | null,
  ): Promise<void>;
}
const observers = new Set<Observer>();
export const pullRequestEvents = {
  subscribe(observer: Observer): () => void {
    observers.add(observer);
    return () => observers.delete(observer);
  },
  interested(link: StoredPullRequestLink): boolean {
    return [...observers].some((observer) => observer.matches(link));
  },
  async publish(
    link: StoredPullRequestLink,
    snapshot: PullRequestSnapshot,
    detail: PullRequestWatchDetail,
    viewer: string | null,
  ): Promise<void> {
    for (const observer of observers)
      if (observer.matches(link)) await observer.detail(link, snapshot, detail, viewer);
  },
};
