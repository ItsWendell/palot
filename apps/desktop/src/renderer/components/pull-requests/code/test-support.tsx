/**
 * Test doubles for the pull request Code tab: a mocked `window.palot.sourceControl`, a CodeView
 * stand-in that renders headers, annotations, and selection, and small data builders.
 */
import type { CodeViewItem, SelectedLineRange } from "@pierre/diffs";
import type { CodeViewProps } from "@pierre/diffs/react";
import { act } from "@testing-library/react";
import { vi, type Mock } from "vitest";
import type {
  PalotSourceControlApi,
  PullRequestDetail,
  PullRequestFile,
  PullRequestTimelineItem,
} from "../../../../shared/source-control-contract";

type Api = Pick<
  PalotSourceControlApi,
  | "pullRequestFiles"
  | "pullRequestTimeline"
  | "setPullRequestFileViewed"
  | "submitPullRequestReview"
  | "onChanged"
>;
export type MockedCodeTabApi = { [Method in keyof Api]: Mock<Api[Method]> };

export function installCodeTabApi(
  data: { files: PullRequestFile[]; timeline?: PullRequestTimelineItem[]; headOid?: string },
  overrides: Partial<Api> = {},
): MockedCodeTabApi {
  const api: MockedCodeTabApi = {
    pullRequestFiles: vi.fn(
      overrides.pullRequestFiles ??
        (async () => ({
          ok: true as const,
          value: { headOid: data.headOid ?? "head123", files: data.files, truncated: false },
        })),
    ),
    pullRequestTimeline: vi.fn(
      overrides.pullRequestTimeline ??
        (async () => ({
          ok: true as const,
          value: { items: data.timeline ?? [], nextCursor: null },
        })),
    ),
    setPullRequestFileViewed: vi.fn(
      overrides.setPullRequestFileViewed ?? (async () => ({ ok: true as const, value: null })),
    ),
    submitPullRequestReview: vi.fn(
      overrides.submitPullRequestReview ?? (async () => ({ ok: true as const, value: null })),
    ),
    onChanged: vi.fn(overrides.onChanged ?? (() => () => {})),
  };
  Object.defineProperty(window, "palot", {
    configurable: true,
    value: { sourceControl: api },
  });
  return api;
}

export function pullRequestDetail(overrides: Partial<PullRequestDetail> = {}): PullRequestDetail {
  return {
    host: "github.com",
    repository: "acme/web",
    number: 7,
    title: "Add widgets",
    url: "https://github.com/acme/web/pull/7",
    state: "open",
    checks: "passing",
    reviewDecision: null,
    mergeable: "mergeable",
    headBranch: "feature",
    baseBranch: "main",
    author: "octocat",
    updatedAt: 1,
    mergedAt: null,
    closedAt: null,
    body: "",
    authorPerson: null,
    labels: [],
    assignees: [],
    reviewers: [],
    checkRuns: [],
    checksComplete: true,
    additions: 0,
    deletions: 0,
    changedFiles: 0,
    commits: 1,
    headOid: "head123",
    mergeState: "clean",
    mergeMethods: ["squash"],
    autoMerge: null,
    viewer: {
      login: "reviewer",
      canMerge: true,
      canUpdate: true,
      isAuthor: false,
      reviewState: null,
    },
    createdAt: 1,
    ...overrides,
  };
}

/** Three-line file whose second line changed. */
export const SIMPLE_PATCH = "@@ -1,3 +1,3 @@\n line one\n-old two\n+new two\n line three";

export function prFile(path: string, overrides: Partial<PullRequestFile> = {}): PullRequestFile {
  return {
    path,
    previousPath: null,
    status: "modified",
    additions: 1,
    deletions: 1,
    patch: SIMPLE_PATCH,
    viewed: "unviewed",
    ...overrides,
  };
}

export function reviewThread(
  id: string,
  overrides: Partial<Extract<PullRequestTimelineItem, { kind: "review-thread" }>> & {
    body?: string;
    author?: string;
    side?: "LEFT" | "RIGHT";
  } = {},
): PullRequestTimelineItem {
  const { body = "Looks off", author = "alice", side = "RIGHT", ...rest } = overrides;
  const path = rest.path ?? "src/a.ts";
  const line = rest.line === undefined ? 2 : rest.line;
  return {
    kind: "review-thread",
    id,
    path,
    line,
    isResolved: false,
    isOutdated: false,
    viewerCanResolve: true,
    viewerCanReply: true,
    createdAt: 1,
    comments: [
      {
        id: `${id}-c1`,
        author: { login: author, avatarUrl: null, isBot: false },
        body,
        path,
        line,
        startLine: null,
        side,
        diffHunk: "",
        createdAt: 1,
        url: `https://github.com/acme/web/pull/7#discussion_${id}`,
      },
    ],
    ...rest,
  };
}

// ---------------------------------------------------------------------------------------------
// CodeView stand-in
// ---------------------------------------------------------------------------------------------

type AnyCodeViewProps = CodeViewProps<unknown, undefined>;
let latestProps: AnyCodeViewProps | null = null;

/** Renders each item's custom header, and annotations for expanded diffs. */
export function FakeCodeView(props: AnyCodeViewProps) {
  latestProps = props;
  const items = (props.items ?? []) as readonly CodeViewItem<unknown>[];
  return (
    <div ref={props.containerRef}>
      {items.map((item) => (
        <section
          key={item.id}
          aria-label={`Diff ${item.id}`}
          data-collapsed={item.collapsed ? "true" : "false"}
          data-type={item.type}
        >
          {props.renderCustomHeader?.(item)}
          {item.type === "diff" && !item.collapsed
            ? (item.annotations ?? []).map((annotation) => (
                <div key={`${annotation.side}:${annotation.lineNumber}`}>
                  {props.renderAnnotation?.(annotation, item.fileDiff, item)}
                </div>
              ))
            : null}
        </section>
      ))}
      {props.renderCodeViewFooter?.()}
    </div>
  );
}

/** Simulates a line selection inside the diff for `id`. */
export function selectLines(id: string, range: SelectedLineRange) {
  act(() => latestProps?.onSelectedLinesChange?.({ id, range }));
}
