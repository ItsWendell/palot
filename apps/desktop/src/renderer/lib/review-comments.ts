import type { SelectedLineRange } from "@pierre/diffs";
import type { PalotMessage } from "../../shared";

/** Local draft context, not a second source of truth for sent OpenCode messages. */
export interface ReviewComment {
  id: string;
  path: string;
  comment: string;
  selection: { startLine: number; startChar: number; endLine: number; endChar: number };
  side?: "additions" | "deletions";
}

export function commentSelection(range: SelectedLineRange): ReviewComment["selection"] {
  return {
    startLine: Math.min(range.start, range.end),
    startChar: 0,
    endLine: Math.max(range.start, range.end),
    endChar: 0,
  };
}

export function canCommentOnRange(range: SelectedLineRange): boolean {
  return (
    Number.isSafeInteger(range.start) &&
    Number.isSafeInteger(range.end) &&
    range.start > 0 &&
    range.end > 0 &&
    (!range.side || !range.endSide || range.side === range.endSide)
  );
}

export function isReviewComment(value: unknown): value is ReviewComment {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<ReviewComment>;
  const selection = item.selection;
  return (
    typeof item.id === "string" &&
    typeof item.path === "string" &&
    Boolean(item.path) &&
    typeof item.comment === "string" &&
    !!selection &&
    [selection.startLine, selection.startChar, selection.endLine, selection.endChar].every(
      (number) => typeof number === "number" && Number.isSafeInteger(number) && number >= 0,
    ) &&
    selection.startLine! <= selection.endLine! &&
    (selection.startLine !== selection.endLine || selection.startChar! <= selection.endChar!) &&
    (item.side === undefined || item.side === "additions" || item.side === "deletions")
  );
}

export function reviewCommentsFromMessage(message: PalotMessage): ReviewComment[] | null {
  const data = message.data;
  const metadata = data && typeof data === "object" && !Array.isArray(data) ? data.metadata : null;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const { displayText, comments } = metadata as Record<string, unknown>;
  if (typeof displayText !== "string" || !Array.isArray(comments)) return null;
  const restored = comments.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
    const { path, comment, selection } = entry as Record<string, unknown>;
    return {
      id: `restored-${message.id}-${index}`,
      path,
      comment,
      selection,
    };
  });
  return restored.every(isReviewComment) ? (restored as ReviewComment[]) : null;
}

export function formatReviewComment(
  comment: Pick<ReviewComment, "path" | "selection" | "comment">,
): string {
  const { startLine, endLine } = comment.selection;
  const range =
    startLine === endLine ? `line ${startLine}` : `lines ${startLine} through ${endLine}`;
  return `The user made the following comment regarding ${range} of ${comment.path}: ${comment.comment}`;
}
