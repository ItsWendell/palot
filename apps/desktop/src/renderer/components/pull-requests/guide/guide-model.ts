/**
 * Pure model for the Guide tab: slicing an excerpt out of a file's patch, lettering notes,
 * stepping through stops, and the prompt for asking about a stop. No React here.
 */

import type { PullRequestFile } from "../../../../shared/source-control-contract";
import {
  parsePatchLines,
  type PatchLine,
  type ReviewGuideAttentionKind,
  type ReviewGuideExcerpt,
  type ReviewGuideNote,
  type ReviewGuideStop,
} from "../../../lib/review-guide";

export const ATTENTION_LABELS: Record<ReviewGuideAttentionKind, string> = {
  tradeoff: "tradeoff",
  contract: "contract",
  product: "product call",
  risk: "risk",
  accessibility: "accessibility",
};

/** One step forward or back, held to the first and last stops. */
export function stepStop(current: number, delta: 1 | -1, stopCount: number): number {
  return Math.max(Math.min(current + delta, stopCount - 1), 0);
}

/** The stop's files in reading order: excerpted ones first, then the rest it owns. */
export function stopFilePaths(stop: ReviewGuideStop): string[] {
  return [
    ...new Set([
      ...stop.excerpts.map((excerpt) => excerpt.path),
      ...stop.files.map((file) => file.path),
    ]),
  ];
}

/** The rail's second line for a stop. */
export function stopSubline(stop: ReviewGuideStop): string {
  const count = stopFilePaths(stop).length;
  if (count === 0) return "Context";
  return count === 1 ? "1 file" : `${count} files`;
}

/**
 * The lines an excerpt covers. Its range is in one side's numbers, so the other side's half
 * of a replacement at either edge comes along: an excerpt starting on an added line also
 * shows the lines it replaced, which is what makes it read as a change.
 */
export function excerptRows(
  rows: readonly PatchLine[],
  excerpt: Pick<ReviewGuideExcerpt, "side" | "start" | "end">,
): PatchLine[] {
  const lineOf = (row: PatchLine) => (excerpt.side === "new" ? row.newLine : row.oldLine);
  const inRange = (row: PatchLine) => {
    const line = lineOf(row);
    return line !== null && line >= excerpt.start && line <= excerpt.end;
  };
  let first = rows.findIndex(inRange);
  if (first === -1) return [];
  let last = rows.findLastIndex(inRange);
  const sameHunk = (index: number, anchor: number) => rows[index]?.hunk === rows[anchor]?.hunk;
  if (excerpt.side === "new" && rows[first]?.kind === "addition") {
    while (first > 0 && rows[first - 1]?.kind === "deletion" && sameHunk(first - 1, first)) {
      first -= 1;
    }
  }
  if (excerpt.side === "old" && rows[last]?.kind === "deletion") {
    while (
      last < rows.length - 1 &&
      rows[last + 1]?.kind === "addition" &&
      sameHunk(last + 1, last)
    ) {
      last += 1;
    }
  }
  return rows.slice(first, last + 1);
}

const ROW_PREFIX = { context: " ", addition: "+", deletion: "-" } as const;

/**
 * Hunks of just these rows with their real line numbers, so the shared diff renderer draws a
 * slice of the file that numbers and highlights exactly like the Code tab.
 */
export function rowsToHunks(rows: readonly PatchLine[]): string {
  const lines: string[] = [];
  let start = 0;
  while (start < rows.length) {
    let end = start;
    while (end + 1 < rows.length && rows[end + 1]?.hunk === rows[start]?.hunk) end += 1;
    const group = rows.slice(start, end + 1);
    const head = group[0]!;
    const oldCount = group.filter((row) => row.oldLine !== null).length;
    const newCount = group.filter((row) => row.newLine !== null).length;
    // Git names the line before an empty side, so an insertion after line 9 is `-9,0`.
    const oldStart = oldCount === 0 ? Math.max(head.oldAt - 1, 0) : head.oldAt;
    const newStart = newCount === 0 ? Math.max(head.newAt - 1, 0) : head.newAt;
    lines.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`);
    for (const row of group) lines.push(`${ROW_PREFIX[row.kind]}${row.text}`);
    start = end + 1;
  }
  return lines.join("\n");
}

export interface ExcerptSlice {
  hunks: string;
  /** Lines drawn, by viewer side, so only comments that land on one are placed in it. */
  drawn: { additions: Set<number>; deletions: Set<number> };
  shown: number;
  total: number;
}

/** The excerpt's slice of a file's patch, or null when the patch no longer has those lines. */
export function sliceExcerpt(
  file: Pick<PullRequestFile, "patch">,
  excerpt: Pick<ReviewGuideExcerpt, "side" | "start" | "end">,
): ExcerptSlice | null {
  if (!file.patch) return null;
  const rows = parsePatchLines(file.patch);
  const shown = excerptRows(rows, excerpt);
  if (shown.length === 0) return null;
  return {
    hunks: rowsToHunks(shown),
    drawn: {
      additions: new Set(shown.flatMap((row) => (row.newLine === null ? [] : [row.newLine]))),
      deletions: new Set(shown.flatMap((row) => (row.oldLine === null ? [] : [row.oldLine]))),
    },
    shown: shown.length,
    total: rows.length,
  };
}

/** A note's marker: A, B, C… in guide order, numbers past Z. */
function noteMarker(index: number): string {
  return index < 26 ? String.fromCharCode(65 + index) : String(index + 1);
}

export interface LetteredNote {
  marker: string;
  note: ReviewGuideNote;
}

/** Letters a stop's notes and groups them under the excerpt that contains their line. */
export function letterStopNotes(stop: ReviewGuideStop): {
  lettered: LetteredNote[];
  byExcerpt: LetteredNote[][];
} {
  const lettered = stop.notes.map((note, index) => ({ marker: noteMarker(index), note }));
  const claimed = new Set<string>();
  const byExcerpt = stop.excerpts.map((excerpt) =>
    lettered.filter(({ marker, note }) => {
      const inside =
        note.path === excerpt.path && note.line >= excerpt.start && note.line <= excerpt.end;
      if (!inside || claimed.has(marker)) return false;
      claimed.add(marker);
      return true;
    }),
  );
  return { lettered, byExcerpt };
}

function describeExcerpt(excerpt: ReviewGuideExcerpt): string {
  const lines =
    excerpt.start === excerpt.end
      ? `line ${excerpt.start}`
      : `lines ${excerpt.start}–${excerpt.end}`;
  return `- ${excerpt.path}, ${lines}${excerpt.side === "old" ? " (removed code)" : ""}`;
}

/** The New task prompt for asking about one stop of a guide. */
export function askAboutStopPrompt(input: {
  url: string;
  stop: ReviewGuideStop;
  index: number;
  stopCount: number;
  question?: string;
}): string {
  const { stop } = input;
  const files = stop.files.map((file) => `- ${file.path}`);
  return [
    `I'm reviewing this pull request: ${input.url}`,
    "",
    `Its review guide, stop ${input.index + 1} of ${input.stopCount}: ${stop.title}`,
    ...(stop.summary ? ["", stop.summary] : []),
    ...(stop.excerpts.length > 0
      ? ["", "Code at this stop:", ...stop.excerpts.map(describeExcerpt)]
      : []),
    ...(files.length > 0 ? ["", "Files at this stop:", ...files.slice(0, 20)] : []),
    "",
    input.question?.trim() || "Help me understand this part of the change.",
  ].join("\n");
}
