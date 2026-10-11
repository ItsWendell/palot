/**
 * Pure model for the pull request Code tab: GitHub file order, patch parsing, viewed state,
 * default folding, thread placement, and the review payload. No React here.
 */

import {
  parsePatchFiles,
  type FileDiffMetadata,
  type SelectedLineRange,
  type SelectionSide,
} from "@pierre/diffs";
import type {
  PullRequestDraftComment,
  PullRequestFile,
  PullRequestReviewComment,
  PullRequestTimelineItem,
} from "../../../../shared/source-control-contract";
import { contentCacheKey } from "../../../lib/file-diffs";
import { hideWhitespaceChanges } from "../../../lib/diff-whitespace";

/** Files with more changed lines than this start folded, like GitHub's large-diff guard. */
export const LARGE_FILE_CHANGED_LINES = 1_500;

export type GitHubSide = PullRequestDraftComment["side"];

export type ReviewThread = Extract<PullRequestTimelineItem, { kind: "review-thread" }>;

/** A line comment waiting to be sent with the next review. */
export interface PendingReviewComment extends PullRequestDraftComment {
  id: string;
}

// ---------------------------------------------------------------------------------------------
// Order
// ---------------------------------------------------------------------------------------------

/**
 * GitHub's file tree order, which the Files changed list follows: at each directory level,
 * folders before files, then names compared case-insensitively.
 */
export function compareGitHubPaths(left: string, right: string): number {
  const a = left.split("/");
  const b = right.split("/");
  const shared = Math.min(a.length, b.length);
  for (let index = 0; index < shared; index += 1) {
    const leftSegment = a[index]!;
    const rightSegment = b[index]!;
    if (leftSegment === rightSegment) continue;
    const leftIsDirectory = index < a.length - 1;
    const rightIsDirectory = index < b.length - 1;
    if (leftIsDirectory !== rightIsDirectory) return leftIsDirectory ? -1 : 1;
    return compareNames(leftSegment, rightSegment);
  }
  return a.length - b.length;
}

function compareNames(left: string, right: string): number {
  const folded = left.toLowerCase().localeCompare(right.toLowerCase(), "en");
  if (folded !== 0) return folded;
  return left < right ? -1 : left > right ? 1 : 0;
}

export function orderPullRequestFiles(files: readonly PullRequestFile[]): PullRequestFile[] {
  return files.toSorted((left, right) => compareGitHubPaths(left.path, right.path));
}

// ---------------------------------------------------------------------------------------------
// Patches
// ---------------------------------------------------------------------------------------------

export interface PresentedPullRequestFile {
  file: PullRequestFile;
  /** Null when GitHub sent no patch (binary or too large) or it could not be parsed. */
  fileDiff: FileDiffMetadata | null;
  /** Counts after whitespace hiding; GitHub's own counts otherwise. */
  additions: number;
  deletions: number;
  /** Every change was whitespace and whitespace is hidden. */
  whitespaceOnly: boolean;
  /** Hash of what is rendered, for CodeView item versions. */
  contentHash: number;
}

const MAX_CACHED = 512;
const parsed = new Map<string, FileDiffMetadata | null>();

/**
 * GitHub's `patch` is hunks only. Give it the Git header its status implies so the viewer
 * knows about new, deleted, and renamed files, then parse it.
 */
export function parsePullRequestPatch(
  file: Pick<PullRequestFile, "path" | "previousPath" | "status">,
  hunks: string,
): FileDiffMetadata | null {
  const normalized = hunks.replace(/\r\n?/g, "\n");
  const header = synthesizePatchHeader(file, normalized.trim() !== "");
  const text = normalized.trim() === "" ? `${header}\n` : `${header}\n${normalized}`;
  const key = contentCacheKey(file.path, text);
  const cached = parsed.get(key);
  if (cached !== undefined || parsed.has(key)) return cached ?? null;
  let result: FileDiffMetadata | null = null;
  try {
    result = parsePatchFiles(text, key).flatMap((patch) => patch.files)[0] ?? null;
  } catch {
    result = null;
  }
  parsed.set(key, result);
  if (parsed.size > MAX_CACHED) {
    const oldest = parsed.keys().next().value;
    if (oldest !== undefined) parsed.delete(oldest);
  }
  return result;
}

export function synthesizePatchHeader(
  file: Pick<PullRequestFile, "path" | "previousPath" | "status">,
  hasHunks = true,
): string {
  const path = safePath(file.path);
  const previous = safePath(file.previousPath ?? file.path);
  const moved = (file.status === "renamed" || file.status === "copied") && previous !== path;
  const lines = [`diff --git a/${moved ? previous : path} b/${path}`];
  if (file.status === "added") lines.push("new file mode 100644");
  if (file.status === "removed") lines.push("deleted file mode 100644");
  if (moved) {
    const verb = file.status === "copied" ? "copy" : "rename";
    // The parser reads "similarity index" to tell a pure move from a changed one.
    lines.push(
      `similarity index ${hasHunks ? 50 : 100}%`,
      `${verb} from ${previous}`,
      `${verb} to ${path}`,
    );
    if (!hasHunks) return lines.join("\n");
  }
  lines.push(
    file.status === "added" ? "--- /dev/null" : `--- a/${moved ? previous : path}`,
    file.status === "removed" ? "+++ /dev/null" : `+++ b/${path}`,
  );
  return lines.join("\n");
}

function safePath(path: string): string {
  return path.replace(/[\t\r\n]/g, " ");
}

// Presenting is the costly step (whitespace pairing, parsing). A viewed toggle replaces one
// file object and keeps the rest, so cache by object.
const presentedFiles = [
  new WeakMap<PullRequestFile, PresentedPullRequestFile>(),
  new WeakMap<PullRequestFile, PresentedPullRequestFile>(),
] as const;

export function presentPullRequestFile(
  file: PullRequestFile,
  hideWhitespace: boolean,
): PresentedPullRequestFile {
  const cache = presentedFiles[hideWhitespace ? 1 : 0];
  const cached = cache.get(file);
  if (cached) return cached;
  const value = presentUncached(file, hideWhitespace);
  cache.set(file, value);
  return value;
}

function presentUncached(file: PullRequestFile, hideWhitespace: boolean): PresentedPullRequestFile {
  const pureMove =
    (file.status === "renamed" || file.status === "copied") &&
    file.additions + file.deletions === 0 &&
    !file.patch;
  if (pureMove) {
    return {
      file,
      fileDiff: parsePullRequestPatch(file, ""),
      additions: 0,
      deletions: 0,
      whitespaceOnly: false,
      contentHash: hashString(`move:${file.previousPath ?? ""}:${file.path}`),
    };
  }
  if (file.patch === null || file.patch === "") {
    return {
      file,
      fileDiff: null,
      additions: file.additions,
      deletions: file.deletions,
      whitespaceOnly: false,
      contentHash: hashString(`none:${file.path}`),
    };
  }
  let patch = file.patch;
  let additions = file.additions;
  let deletions = file.deletions;
  let whitespaceOnly = false;
  if (hideWhitespace) {
    const filtered = hideWhitespaceChanges(file.patch);
    if (filtered.patch !== file.patch) {
      ({ patch, additions, deletions, whitespaceOnly } = filtered);
    }
  }
  return {
    file,
    fileDiff: whitespaceOnly ? null : parsePullRequestPatch(file, patch),
    additions,
    deletions,
    whitespaceOnly,
    contentHash: hashString(`${whitespaceOnly ? "ws:" : ""}${file.status}:${patch}`),
  };
}

export function hashString(value: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

// ---------------------------------------------------------------------------------------------
// Viewed and folding
// ---------------------------------------------------------------------------------------------

export function countViewed(files: readonly PullRequestFile[]): number {
  return files.reduce((total, file) => total + (file.viewed === "viewed" ? 1 : 0), 0);
}

/** Viewed and very large files start folded; the reader's own toggles win. */
export function isFileCollapsed(
  file: PullRequestFile,
  overrides: ReadonlyMap<string, boolean>,
): boolean {
  const override = overrides.get(file.path);
  if (override !== undefined) return override;
  return file.viewed === "viewed" || file.additions + file.deletions > LARGE_FILE_CHANGED_LINES;
}

// ---------------------------------------------------------------------------------------------
// Lines, sides, and threads
// ---------------------------------------------------------------------------------------------

export function toViewerSide(side: GitHubSide): SelectionSide {
  return side === "LEFT" ? "deletions" : "additions";
}

export function toGitHubSide(side: SelectionSide | undefined): GitHubSide {
  return side === "deletions" ? "LEFT" : "RIGHT";
}

/** Whether a line is drawn by one of the file's hunks on that side. */
export function isLineInFileDiff(diff: FileDiffMetadata, side: GitHubSide, line: number): boolean {
  return diff.hunks.some((hunk) =>
    side === "LEFT"
      ? line >= hunk.deletionStart && line < hunk.deletionStart + hunk.deletionCount
      : line >= hunk.additionStart && line < hunk.additionStart + hunk.additionCount,
  );
}

/** A selected range as the anchor GitHub expects: the last line, plus the first for ranges. */
export function draftAnchorFromRange(
  range: SelectedLineRange,
): Pick<PullRequestDraftComment, "line" | "startLine" | "side"> {
  const first = Math.min(range.start, range.end);
  const last = Math.max(range.start, range.end);
  return {
    line: last,
    ...(first !== last ? { startLine: first } : {}),
    side: toGitHubSide(range.endSide ?? range.side),
  };
}

/** Review threads that can sit on a line: current (not outdated) and anchored. */
export function lineReviewThreads(items: readonly PullRequestTimelineItem[]): ReviewThread[] {
  return items.filter(
    (item): item is ReviewThread =>
      item.kind === "review-thread" && !item.isOutdated && item.line !== null,
  );
}

export function threadSide(thread: ReviewThread): GitHubSide {
  return thread.comments[0]?.side ?? "RIGHT";
}

export interface ReviewAnnotationGroup {
  threads: ReviewThread[];
  pending: PendingReviewComment[];
}

export interface FileAnnotation {
  side: SelectionSide;
  lineNumber: number;
  metadata: ReviewAnnotationGroup;
}

/** One annotation per line and side, holding the threads and pending comments there. */
export function buildFileAnnotations(
  path: string,
  diff: FileDiffMetadata,
  threads: readonly ReviewThread[],
  pending: readonly PendingReviewComment[],
): FileAnnotation[] {
  const groups = new Map<string, FileAnnotation>();
  const groupAt = (side: GitHubSide, line: number) => {
    const key = `${side}:${line}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        side: toViewerSide(side),
        lineNumber: line,
        metadata: { threads: [], pending: [] },
      };
      groups.set(key, group);
    }
    return group.metadata;
  };
  for (const thread of threads) {
    if (thread.path !== path || thread.line === null) continue;
    const side = threadSide(thread);
    if (!isLineInFileDiff(diff, side, thread.line)) continue;
    groupAt(side, thread.line).threads.push(thread);
  }
  for (const comment of pending) {
    if (comment.path !== path || !isLineInFileDiff(diff, comment.side, comment.line)) continue;
    groupAt(comment.side, comment.line).pending.push(comment);
  }
  return [...groups.values()];
}

/** Changes whenever anything an annotation shows changes, for CodeView item versions. */
export function annotationSignature(annotations: readonly FileAnnotation[]): string {
  return annotations
    .map(
      ({ side, lineNumber, metadata }) =>
        `${side}:${lineNumber}:${metadata.pending
          .map((comment) => `${comment.id}:${comment.body}`)
          .join(",")}:${metadata.threads
          .map(
            (thread) =>
              `${thread.id}:${thread.isResolved ? "r" : ""}:${thread.comments
                .map((comment: PullRequestReviewComment) => `${comment.id}:${comment.body}`)
                .join(";")}`,
          )
          .join(",")}`,
    )
    .join("|");
}

// ---------------------------------------------------------------------------------------------
// Review payload
// ---------------------------------------------------------------------------------------------

export function toDraftComments(
  comments: readonly PendingReviewComment[],
): PullRequestDraftComment[] {
  return comments.map(({ path, line, startLine, side, body }) => ({
    path,
    line,
    ...(startLine !== undefined && startLine < line ? { startLine } : {}),
    side,
    body,
  }));
}

export function describeLines(comment: Pick<PullRequestDraftComment, "line" | "startLine">) {
  return comment.startLine !== undefined && comment.startLine < comment.line
    ? `lines ${comment.startLine}–${comment.line}`
    : `line ${comment.line}`;
}
