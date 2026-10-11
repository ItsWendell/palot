import type {
  PullRequestMergeMethod,
  PullRequestSearchList,
} from "../../../shared/source-control-contract";
import { persistedAtom } from "../../atoms/persisted";

const MERGE_METHODS: readonly PullRequestMergeMethod[] = ["merge", "squash", "rebase"];
const MAX_REMEMBERED_REPOSITORIES = 200;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** The merge method last used per `host/owner/name`. */
export const pullRequestMergeMethodsAtom = persistedAtom<Record<string, PullRequestMergeMethod>>({
  key: "pull-requests.merge-methods",
  initialValue: {},
  validate: (value): value is Record<string, PullRequestMergeMethod> =>
    isRecord(value) &&
    Object.values(value).every((method) =>
      MERGE_METHODS.includes(method as PullRequestMergeMethod),
    ),
});

export function rememberMergeMethod(
  current: Record<string, PullRequestMergeMethod>,
  repository: string,
  method: PullRequestMergeMethod,
): Record<string, PullRequestMergeMethod> {
  const { [repository]: _previous, ...rest } = current;
  // Newest last; trim the oldest so the record stays bounded.
  const entries = Object.entries({ ...rest, [repository]: method });
  return Object.fromEntries(entries.slice(-MAX_REMEMBERED_REPOSITORIES));
}

/** The remembered method when the repository still allows it, else GitHub's first. */
export function resolveMergeMethod(
  allowed: readonly PullRequestMergeMethod[],
  remembered: PullRequestMergeMethod | undefined,
): PullRequestMergeMethod | null {
  if (remembered && allowed.includes(remembered)) return remembered;
  return allowed[0] ?? null;
}

export interface TimelineFilters {
  hideBots: boolean;
  hideResolved: boolean;
}

export const pullRequestTimelineFiltersAtom = persistedAtom<TimelineFilters>({
  key: "pull-requests.timeline-filters",
  initialValue: { hideBots: false, hideResolved: false },
  validate: (value): value is TimelineFilters =>
    isRecord(value) &&
    typeof value.hideBots === "boolean" &&
    typeof value.hideResolved === "boolean",
});

/** Collapsed list sections; absent means open. */
export const pullRequestCollapsedSectionsAtom = persistedAtom<
  Partial<Record<PullRequestSearchList, boolean>>
>({
  key: "pull-requests.collapsed-sections",
  initialValue: {},
  validate: (value): value is Partial<Record<PullRequestSearchList, boolean>> =>
    isRecord(value) && Object.values(value).every((entry) => typeof entry === "boolean"),
});
