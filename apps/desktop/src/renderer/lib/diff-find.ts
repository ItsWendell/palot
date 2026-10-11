/**
 * Find in diff: data-side matches over parsed diffs.
 *
 * `CodeView` virtualizes files and lines, so matches come from the diff source text
 * rather than the DOM. The DOM side (`diff-find-dom.ts`) maps a match back to a
 * rendered line through its side and line number.
 */
import type { FileDiffMetadata } from "@pierre/diffs";

/** Upper bound for counted matches; very short queries in large diffs stop here. */
export const MAX_DIFF_FIND_MATCHES = 250;

export type DiffFindSide = "additions" | "deletions";

export interface DiffFindSource {
  id: string;
  fileDiff: FileDiffMetadata | null;
}

export interface DiffFindMatch {
  itemID: string;
  /** Context lines count once, on the new side. */
  side: DiffFindSide;
  lineNumber: number;
  /** Zero-based occurrence within the line text. */
  occurrence: number;
}

export interface DiffFindResult {
  matches: DiffFindMatch[];
  truncated: boolean;
}

/** Case-insensitive; whitespace is significant in code, so only blank queries are empty. */
export function normalizeDiffFindQuery(query: string): string {
  return query.trim() ? query.toLowerCase() : "";
}

export function diffLineText(line: string | undefined): string {
  return (line ?? "").replace(/\r?\n$/, "");
}

/** Non-overlapping occurrence offsets of an already normalized needle. */
export function occurrenceOffsets(text: string, needle: string): number[] {
  if (!needle) return [];
  const lower = text.toLowerCase();
  // Lowercasing can change length for a few scripts; skip rather than misplace.
  if (lower.length !== text.length) return [];
  const offsets: number[] = [];
  for (let at = lower.indexOf(needle); at !== -1; at = lower.indexOf(needle, at + needle.length)) {
    offsets.push(at);
  }
  return offsets;
}

/** Matches in display order: file order, then hunk order, removed lines before added lines. */
export function findDiffMatches(
  sources: readonly DiffFindSource[],
  query: string,
  limit = MAX_DIFF_FIND_MATCHES,
): DiffFindResult {
  const needle = normalizeDiffFindQuery(query);
  const matches: DiffFindMatch[] = [];
  if (!needle) return { matches, truncated: false };
  const push = (itemID: string, side: DiffFindSide, lineNumber: number, text: string) => {
    const count = occurrenceOffsets(text, needle).length;
    for (let occurrence = 0; occurrence < count; occurrence += 1) {
      if (matches.length >= limit) return false;
      matches.push({ itemID, side, lineNumber, occurrence });
    }
    return true;
  };
  for (const source of sources) {
    const diff = source.fileDiff;
    if (!diff) continue;
    for (const hunk of diff.hunks) {
      for (const content of hunk.hunkContent) {
        if (content.type === "context") {
          for (let offset = 0; offset < content.lines; offset += 1) {
            const index = content.additionLineIndex + offset;
            const lineNumber = hunk.additionStart + index - hunk.additionLineIndex;
            if (!push(source.id, "additions", lineNumber, diffLineText(diff.additionLines[index])))
              return { matches, truncated: true };
          }
          continue;
        }
        for (let offset = 0; offset < content.deletions; offset += 1) {
          const index = content.deletionLineIndex + offset;
          const lineNumber = hunk.deletionStart + index - hunk.deletionLineIndex;
          if (!push(source.id, "deletions", lineNumber, diffLineText(diff.deletionLines[index])))
            return { matches, truncated: true };
        }
        for (let offset = 0; offset < content.additions; offset += 1) {
          const index = content.additionLineIndex + offset;
          const lineNumber = hunk.additionStart + index - hunk.additionLineIndex;
          if (!push(source.id, "additions", lineNumber, diffLineText(diff.additionLines[index])))
            return { matches, truncated: true };
        }
      }
    }
  }
  return { matches, truncated: false };
}

export function stepDiffMatch(
  current: number,
  count: number,
  direction: "next" | "previous",
): number {
  if (count <= 0) return -1;
  if (current < 0 || current >= count) return direction === "next" ? 0 : count - 1;
  return (current + (direction === "next" ? 1 : -1) + count) % count;
}

export function sameDiffMatch(
  left: DiffFindMatch | null | undefined,
  right: DiffFindMatch | null | undefined,
): boolean {
  return Boolean(
    left &&
    right &&
    left.itemID === right.itemID &&
    left.side === right.side &&
    left.lineNumber === right.lineNumber &&
    left.occurrence === right.occurrence,
  );
}

/** Keeps the same match selected when the diff refreshes under an open search. */
export function preservedDiffMatch(
  matches: readonly DiffFindMatch[],
  previous: DiffFindMatch | null,
  previousIndex: number,
): number {
  if (matches.length === 0) return -1;
  if (previous) {
    const index = matches.findIndex((match) => sameDiffMatch(match, previous));
    if (index !== -1) return index;
  }
  return Math.min(Math.max(previousIndex, 0), matches.length - 1);
}
