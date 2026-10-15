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

export const PULL_REQUEST_LIST_WIDTH = { min: 260, max: 640, default: 360 } as const;

/** Width of the pull request list pane, in pixels. */
export const pullRequestListWidthAtom = persistedAtom<number>({
  key: "pull-requests.list-width",
  initialValue: PULL_REQUEST_LIST_WIDTH.default,
  validate: (value): value is number =>
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= PULL_REQUEST_LIST_WIDTH.min &&
    value <= PULL_REQUEST_LIST_WIDTH.max,
});

export type PullRequestReviewFilter = "required" | "approved" | "changes_requested";
export type PullRequestChecksFilter = "success" | "failure" | "pending";

/** Narrows every list through GitHub search qualifiers, so it applies beyond loaded rows. */
export interface PullRequestFilters {
  /** `owner/name`, lowercase. Any selected repository or organization matches. */
  repositories: string[];
  /** Organization or user logins, lowercase. */
  organizations: string[];
  review: PullRequestReviewFilter | null;
  checks: PullRequestChecksFilter | null;
  hideDrafts: boolean;
}

export const EMPTY_PULL_REQUEST_FILTERS: PullRequestFilters = {
  repositories: [],
  organizations: [],
  review: null,
  checks: null,
  hideDrafts: false,
};

/** Keeps the composed query well under the 4 KB search limit. */
export const MAX_SCOPE_FILTERS = 30;
const REPOSITORY_PATTERN = /^[a-z0-9-]+\/[a-z0-9._-]+$/;
const OWNER_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,38})$/;

export function normalizeRepository(value: string): string | null {
  const repository = value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\/[^/]+\//, "")
    .replace(/\.git$/, "")
    .replace(/\/+$/, "");
  return REPOSITORY_PATTERN.test(repository) ? repository : null;
}

export function normalizeOwner(value: string): string | null {
  const owner = value.trim().toLowerCase().replace(/^@/, "");
  return OWNER_PATTERN.test(owner) ? owner : null;
}

function isStringList(value: unknown, valid: (entry: string) => boolean): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= MAX_SCOPE_FILTERS &&
    value.every((entry) => typeof entry === "string" && valid(entry))
  );
}

export const pullRequestFiltersAtom = persistedAtom<PullRequestFilters>({
  key: "pull-requests.filters",
  initialValue: EMPTY_PULL_REQUEST_FILTERS,
  validate: (value): value is PullRequestFilters =>
    isRecord(value) &&
    isStringList(value.repositories, (entry) => normalizeRepository(entry) === entry) &&
    isStringList(value.organizations, (entry) => normalizeOwner(entry) === entry) &&
    (value.review === null ||
      value.review === "required" ||
      value.review === "approved" ||
      value.review === "changes_requested") &&
    (value.checks === null ||
      value.checks === "success" ||
      value.checks === "failure" ||
      value.checks === "pending") &&
    typeof value.hideDrafts === "boolean",
});

export function activePullRequestFilterCount(filters: PullRequestFilters): number {
  return (
    filters.repositories.length +
    filters.organizations.length +
    Number(filters.review !== null) +
    Number(filters.checks !== null) +
    Number(filters.hideDrafts)
  );
}

/**
 * GitHub search qualifiers for the filters. Repeated `repo:` and `org:` qualifiers match
 * any of them; `org:` also accepts personal accounts.
 */
export function pullRequestFilterQuery(filters: PullRequestFilters): string {
  return [
    ...filters.repositories.map((repository) => `repo:${repository}`),
    ...filters.organizations.map((owner) => `org:${owner}`),
    filters.review ? `review:${filters.review}` : null,
    filters.checks ? `status:${filters.checks}` : null,
    filters.hideDrafts ? "draft:false" : null,
  ]
    .filter(Boolean)
    .join(" ");
}
