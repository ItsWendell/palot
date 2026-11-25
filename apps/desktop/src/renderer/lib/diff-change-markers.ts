/**
 * Change marker rail geometry: where each diff's changes and find matches sit in the
 * whole scrollable review, computed from hunk metadata and the virtualized item layout,
 * never by measuring rendered lines.
 */
import type { FileDiffMetadata, Hunk } from "@pierre/diffs";
import type { DiffFindSide } from "./diff-find";
import type { DiffLayout } from "./diff-layout";

export type DiffMarkKind = "added" | "removed" | "modified";

/** A change block inside one diff, in rendered rows from the top of its content. */
export interface DiffItemMark {
  kind: DiffMarkKind;
  row: number;
  rows: number;
  /** First changed line: new side for additions and modifications, old side for removals. */
  line: number;
}

export interface DiffItemMarks {
  marks: DiffItemMark[];
  /** Rendered rows in the diff's content, including one row per folded gap. */
  rows: number;
}

/** One review item placed in scroll space. */
export interface DiffRailItem {
  id: string;
  /** Scroll offset of the item's top, including its header. */
  top: number;
  /** Height of the item, header included. */
  height: number;
  headerHeight: number;
  fileDiff: FileDiffMetadata | null;
  collapsed: boolean;
}

export interface DiffRailMatch {
  itemID: string;
  side: DiffFindSide;
  lineNumber: number;
}

export interface RailMark {
  kind: DiffMarkKind | "match";
  /** Scroll offset of the mark's top and its height, in content pixels. */
  top: number;
  height: number;
  itemID: string;
  line: number;
}

interface RowOptions {
  layout: DiffLayout;
  /** Unchanged gaps render in full instead of as one separator row. */
  expandUnchanged: boolean;
}

function gapRows(lines: number, expandUnchanged: boolean): number {
  if (lines <= 0) return 0;
  return expandUnchanged ? lines : 1;
}

function changeRows(additions: number, deletions: number, layout: DiffLayout): number {
  return layout === "split" ? Math.max(additions, deletions) : additions + deletions;
}

/** Walks a diff's rendered rows, calling `visit` for each hunk content block. */
function walkRows(
  fileDiff: FileDiffMetadata,
  options: RowOptions,
  visit: (
    hunk: Hunk,
    block: Hunk["hunkContent"][number],
    row: number,
    oldLine: number,
    newLine: number,
  ) => boolean | void,
): number {
  let row = 0;
  for (const hunk of fileDiff.hunks) {
    row += gapRows(hunk.collapsedBefore, options.expandUnchanged);
    let oldLine = hunk.deletionStart;
    let newLine = hunk.additionStart;
    for (const block of hunk.hunkContent) {
      if (visit(hunk, block, row, oldLine, newLine) === true) return row;
      if (block.type === "context") {
        row += block.lines;
        oldLine += block.lines;
        newLine += block.lines;
      } else {
        row += changeRows(block.additions, block.deletions, options.layout);
        oldLine += block.deletions;
        newLine += block.additions;
      }
    }
  }
  return row;
}

/** Change blocks of one diff in rendered rows. Pure; cache it per diff and layout. */
export function diffItemMarks(fileDiff: FileDiffMetadata, options: RowOptions): DiffItemMarks {
  const marks: DiffItemMark[] = [];
  const rows = walkRows(fileDiff, options, (_hunk, block, row, oldLine, newLine) => {
    if (block.type !== "change") return;
    const kind: DiffMarkKind =
      block.additions > 0 && block.deletions > 0
        ? "modified"
        : block.additions > 0
          ? "added"
          : "removed";
    marks.push({
      kind,
      row,
      rows: Math.max(1, changeRows(block.additions, block.deletions, options.layout)),
      line: kind === "removed" ? oldLine : newLine,
    });
  });
  return { marks, rows: Math.max(1, rows) };
}

/** The rendered row of one line of a diff, or null when the line is in a folded gap. */
export function diffLineRow(
  fileDiff: FileDiffMetadata,
  side: DiffFindSide,
  lineNumber: number,
  options: RowOptions,
): number | null {
  let found: number | null = null;
  walkRows(fileDiff, options, (_hunk, block, row, oldLine, newLine) => {
    if (block.type === "context") {
      const start = side === "additions" ? newLine : oldLine;
      if (lineNumber >= start && lineNumber < start + block.lines) {
        found = row + lineNumber - start;
        return true;
      }
      return;
    }
    if (side === "deletions" && lineNumber >= oldLine && lineNumber < oldLine + block.deletions) {
      found = row + lineNumber - oldLine;
      return true;
    }
    if (side === "additions" && lineNumber >= newLine && lineNumber < newLine + block.additions) {
      // Unified rows list deletions before additions; split rows pair them.
      found = row + (options.layout === "split" ? 0 : block.deletions) + lineNumber - newLine;
      return true;
    }
  });
  return found;
}

/**
 * Places every diff's change blocks, and optional find matches, in scroll space.
 * Rows map proportionally onto each item's content height, so marks stay right while
 * the virtualizer refines item heights. Folded items contribute no marks.
 */
export function layoutRailMarks(
  items: readonly DiffRailItem[],
  options: RowOptions,
  matches: readonly DiffRailMatch[] = [],
  cache?: WeakMap<FileDiffMetadata, Map<string, DiffItemMarks>>,
): RailMark[] {
  const marks: RailMark[] = [];
  const byID = new Map<string, { item: DiffRailItem; rows: number }>();
  const cacheKey = `${options.layout}:${options.expandUnchanged}`;
  for (const item of items) {
    if (!item.fileDiff || item.collapsed) continue;
    let computed = cache?.get(item.fileDiff)?.get(cacheKey);
    if (!computed) {
      computed = diffItemMarks(item.fileDiff, options);
      if (cache) {
        const perDiff = cache.get(item.fileDiff) ?? new Map<string, DiffItemMarks>();
        perDiff.set(cacheKey, computed);
        cache.set(item.fileDiff, perDiff);
      }
    }
    const contentTop = item.top + item.headerHeight;
    const rowHeight = Math.max(0, item.height - item.headerHeight) / computed.rows;
    byID.set(item.id, { item, rows: computed.rows });
    for (const mark of computed.marks) {
      marks.push({
        kind: mark.kind,
        top: contentTop + mark.row * rowHeight,
        height: mark.rows * rowHeight,
        itemID: item.id,
        line: mark.line,
      });
    }
  }
  for (const match of matches) {
    const placed = byID.get(match.itemID);
    if (!placed?.item.fileDiff) continue;
    const row = diffLineRow(placed.item.fileDiff, match.side, match.lineNumber, options);
    if (row === null) continue;
    const { item } = placed;
    const rowHeight = Math.max(0, item.height - item.headerHeight) / placed.rows;
    marks.push({
      kind: "match",
      top: item.top + item.headerHeight + row * rowHeight,
      height: rowHeight,
      itemID: item.id,
      line: match.lineNumber,
    });
  }
  return marks;
}

/**
 * The scroll offset that centres the viewport on a point of the rail, clamped to the
 * scrollable range. `y` is measured from the rail's top.
 */
export function railScrollTop(
  y: number,
  railHeight: number,
  scrollHeight: number,
  viewportHeight: number,
): number {
  if (railHeight <= 0) return 0;
  const target = (Math.min(Math.max(y, 0), railHeight) / railHeight) * scrollHeight;
  const max = Math.max(0, scrollHeight - viewportHeight);
  return Math.min(Math.max(target - viewportHeight / 2, 0), max);
}
