/**
 * Find in file previews: rendered Markdown, notebooks, documents and tables.
 *
 * Previews that render all their text are searched in the DOM. Virtualized tables
 * mount only the rows on screen, so they register their rows and are searched from
 * that data instead; the DOM side then highlights whichever matching rows are mounted.
 */
import { MAX_DIFF_FIND_MATCHES, occurrenceOffsets } from "./diff-find";
import { diffLineRanges } from "./diff-find-dom";
import { normalizeTranscriptQuery } from "./transcript-search";
import { transcriptTextRanges } from "./transcript-search-dom";

/** Shares the diff cap, so every find in a file tab counts the same way. */
export const MAX_DOCUMENT_FIND_MATCHES = MAX_DIFF_FIND_MATCHES;

/** Case-insensitive and trimmed, like Find in task: previews show prose, not code. */
export const normalizeDocumentFindQuery = normalizeTranscriptQuery;

export interface DocumentFindResult {
  ranges: Range[];
  truncated: boolean;
}

function rangeShown(range: Range): boolean {
  const element = range.startContainer.parentElement;
  // Collapsed `<details>` and other hidden text cannot be shown as a match.
  return !element || typeof element.checkVisibility !== "function" || element.checkVisibility();
}

/** Visible occurrences of the query under `root`, in reading order. */
export function documentTextRanges(
  root: Element,
  query: string,
  limit = MAX_DOCUMENT_FIND_MATCHES,
): DocumentFindResult {
  const ranges = transcriptTextRanges([root], query, { limit: limit + 1, accept: rangeShown });
  const truncated = ranges.length > limit;
  return { ranges: truncated ? ranges.slice(0, limit) : ranges, truncated };
}

/** A virtualized preview table's rows, registered on its scroll element. */
export interface PreviewTableSource {
  rowCount: number;
  row(index: number): readonly string[];
  /** Brings a row into the table's viewport so its cells mount. */
  scrollToRow(index: number): void;
}

export interface TableFindMatch {
  row: number;
  column: number;
  /** Zero-based occurrence within the cell text. */
  occurrence: number;
}

export interface TableFindResult {
  matches: TableFindMatch[];
  truncated: boolean;
}

export const PREVIEW_TABLE_ATTRIBUTE = "data-preview-table";
const tables = new WeakMap<Element, PreviewTableSource>();

/** Lets Find search a virtualized table by its data; returns the cleanup. */
export function registerPreviewTable(element: Element, source: PreviewTableSource): () => void {
  tables.set(element, source);
  element.setAttribute(PREVIEW_TABLE_ATTRIBUTE, "");
  return () => {
    if (tables.get(element) !== source) return;
    tables.delete(element);
    element.removeAttribute(PREVIEW_TABLE_ATTRIBUTE);
  };
}

export function previewTableIn(
  root: Element,
): { element: Element; source: PreviewTableSource } | null {
  for (const element of root.querySelectorAll(`[${PREVIEW_TABLE_ATTRIBUTE}]`)) {
    const source = tables.get(element);
    if (source) return { element, source };
  }
  return null;
}

/** Matches in row order, then column order, then position in the cell. */
export function findTableMatches(
  table: Pick<PreviewTableSource, "rowCount" | "row">,
  query: string,
  limit = MAX_DOCUMENT_FIND_MATCHES,
): TableFindResult {
  const needle = normalizeDocumentFindQuery(query);
  const matches: TableFindMatch[] = [];
  if (!needle) return { matches, truncated: false };
  for (let row = 0; row < table.rowCount; row += 1) {
    const cells = table.row(row);
    for (let column = 0; column < cells.length; column += 1) {
      const count = occurrenceOffsets(cells[column] ?? "", needle).length;
      for (let occurrence = 0; occurrence < count; occurrence += 1) {
        if (matches.length >= limit) return { matches, truncated: true };
        matches.push({ row, column, occurrence });
      }
    }
  }
  return { matches, truncated: false };
}

export interface TableHighlightRanges {
  hits: Range[];
  /** The active match's range when its row is mounted. */
  active: Range | null;
}

/** Ranges for matches in the table's mounted rows (`aria-rowindex` counts the header). */
export function tableMatchRanges(
  table: Element,
  query: string,
  matches: readonly TableFindMatch[],
  active: TableFindMatch | null,
): TableHighlightRanges {
  const result: TableHighlightRanges = { hits: [], active: null };
  const needle = normalizeDocumentFindQuery(query);
  if (!needle || matches.length === 0) return result;
  const rows = new Set(matches.map((match) => match.row));
  for (const rowElement of table.querySelectorAll('[role="row"][aria-rowindex]')) {
    const row = Number(rowElement.getAttribute("aria-rowindex")) - 2;
    if (!rows.has(row)) continue;
    for (const cell of rowElement.querySelectorAll('[role="cell"][aria-colindex]')) {
      const ranges = diffLineRanges(cell, needle);
      if (ranges.length === 0) continue;
      const column = Number(cell.getAttribute("aria-colindex")) - 1;
      if (active && active.row === row && active.column === column) {
        const index = Math.min(active.occurrence, ranges.length - 1);
        result.active = ranges[index]!;
        ranges.splice(index, 1);
      }
      result.hits.push(...ranges);
    }
  }
  return result;
}

/**
 * Centers the range in each scrollable ancestor up to `root` where it is out of view,
 * innermost first, without scrolling anything outside the preview.
 */
export function revealRangeIn(root: Element, range: Range, margin = 24): void {
  let element: Element | null =
    range.startContainer instanceof Element
      ? range.startContainer
      : range.startContainer.parentElement;
  while (element) {
    if (element.scrollHeight > element.clientHeight + 1) {
      const overflow = getComputedStyle(element).overflowY;
      if (overflow === "auto" || overflow === "scroll") {
        const rect = range.getBoundingClientRect();
        const bounds = element.getBoundingClientRect();
        if (rect.top < bounds.top + margin || rect.bottom > bounds.bottom - margin) {
          element.scrollTop += rect.top + rect.height / 2 - (bounds.top + bounds.height / 2);
        }
      }
    }
    if (element === root) break;
    element = element.parentElement;
  }
}
