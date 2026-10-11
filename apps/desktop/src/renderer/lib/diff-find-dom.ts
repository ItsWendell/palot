/**
 * Find in diff: DOM highlighting with the CSS Custom Highlight API.
 *
 * `@pierre/diffs` renders each file into an open shadow root. Ranges inside shadow
 * trees can join the document's highlight registry; the matching `::highlight()`
 * rules live in the diff's injected CSS (`file-viewer-theme.ts`), because document
 * styles do not reach into shadow trees.
 */
import {
  diffLineText,
  occurrenceOffsets,
  type DiffFindMatch,
  type DiffFindSide,
} from "./diff-find";

export const DIFF_FIND_HIGHLIGHT = "palot-diff-find";
export const DIFF_FIND_ACTIVE_HIGHLIGHT = "palot-diff-find-active";

/** A rendered diff item: its ID and the element hosting its shadow root. */
export interface RenderedDiffItem {
  id: string;
  element: Element;
}

export function supportsDiffHighlights(): boolean {
  return (
    typeof CSS !== "undefined" &&
    typeof CSS.highlights === "object" &&
    CSS.highlights !== null &&
    typeof Highlight === "function"
  );
}

// Several diff tabs can search at once; each owner contributes its own ranges.
const owners = new Map<object, { hits: Range[]; active: Range | null }>();

function flushHighlights() {
  if (!supportsDiffHighlights()) return;
  const hits: Range[] = [];
  const active: Range[] = [];
  for (const entry of owners.values()) {
    hits.push(...entry.hits);
    if (entry.active) active.push(entry.active);
  }
  if (hits.length === 0 && active.length === 0) {
    CSS.highlights.delete(DIFF_FIND_HIGHLIGHT);
    CSS.highlights.delete(DIFF_FIND_ACTIVE_HIGHLIGHT);
    return;
  }
  const activeHighlight = new Highlight(...active);
  activeHighlight.priority = 1;
  CSS.highlights.set(DIFF_FIND_HIGHLIGHT, new Highlight(...hits));
  CSS.highlights.set(DIFF_FIND_ACTIVE_HIGHLIGHT, activeHighlight);
}

export function clearDiffHighlights(owner: object): void {
  if (!owners.delete(owner)) return;
  flushHighlights();
}

/** Which side a rendered content line belongs to; context lines in unified view are new-side. */
export function diffLineSide(line: Element): DiffFindSide {
  const code = line.closest("code");
  if (code?.hasAttribute("data-deletions")) return "deletions";
  if (code?.hasAttribute("data-additions")) return "additions";
  return line.getAttribute("data-line-type") === "change-deletion" ? "deletions" : "additions";
}

/** Rendered content lines (not gutter numbers) of one diff item. */
export function renderedDiffLines(item: RenderedDiffItem): Element[] {
  const root: ParentNode = item.element.shadowRoot ?? item.element;
  return [...root.querySelectorAll("code [data-line]")];
}

/** Ranges for each occurrence of the normalized needle within one rendered line. */
export function diffLineRanges(line: Element, needle: string): Range[] {
  const ownerDocument = line.ownerDocument;
  const walker = ownerDocument.createTreeWalker(line, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  const starts: number[] = [];
  let text = "";
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    nodes.push(node);
    starts.push(text.length);
    text += node.data;
  }
  const offsets = occurrenceOffsets(diffLineText(text), needle);
  if (offsets.length === 0) return [];
  let nodeIndex = 0;
  const locate = (offset: number, end: boolean) => {
    while (
      nodeIndex < nodes.length - 1 &&
      (end ? starts[nodeIndex + 1]! < offset : starts[nodeIndex + 1]! <= offset)
    )
      nodeIndex += 1;
    return { node: nodes[nodeIndex]!, offset: offset - starts[nodeIndex]! };
  };
  const ranges: Range[] = [];
  for (const at of offsets) {
    const start = locate(at, false);
    const end = locate(at + needle.length, true);
    if (start.offset > start.node.data.length || end.offset > end.node.data.length) continue;
    const range = ownerDocument.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    ranges.push(range);
  }
  return ranges;
}

export interface DiffHighlightResult {
  /** Range for the active match when its line is rendered. */
  active: Range | null;
  /** Rendered line of the active match. */
  activeLine: Element | null;
}

/**
 * Highlights every rendered occurrence in the given items for this owner, and the
 * active match's occurrence separately. Split view shows context lines on both sides;
 * both copies highlight, while the match count follows the data side.
 */
export function applyDiffHighlights(
  owner: object,
  items: readonly RenderedDiffItem[],
  needle: string,
  active: DiffFindMatch | null,
): DiffHighlightResult {
  const result: DiffHighlightResult = { active: null, activeLine: null };
  if (!needle) {
    clearDiffHighlights(owner);
    return result;
  }
  const hits: Range[] = [];
  for (const item of items) {
    for (const line of renderedDiffLines(item)) {
      const ranges = diffLineRanges(line, needle);
      if (ranges.length === 0) continue;
      if (
        active &&
        !result.active &&
        item.id === active.itemID &&
        Number(line.getAttribute("data-line")) === active.lineNumber &&
        diffLineSide(line) === active.side
      ) {
        result.activeLine = line;
        const index = Math.min(active.occurrence, ranges.length - 1);
        result.active = ranges[index]!;
        ranges.splice(index, 1);
      }
      hits.push(...ranges);
    }
  }
  owners.set(owner, { hits, active: result.active });
  flushHighlights();
  return result;
}

/**
 * Centers the range in the nearest horizontal scroller of its tree when it is outside
 * the scroller's visible part. The line-number gutter can sit over the scroller's left
 * edge, so a hidden match is centered rather than aligned to an edge.
 */
export function revealRangeHorizontally(range: Range, margin = 24): void {
  const rect = range.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return;
  let element: Element | null =
    range.startContainer instanceof Element
      ? range.startContainer
      : range.startContainer.parentElement;
  while (element) {
    if (element.scrollWidth > element.clientWidth + 1) {
      const overflow = getComputedStyle(element).overflowX;
      if (overflow === "auto" || overflow === "scroll") {
        const bounds = element.getBoundingClientRect();
        if (rect.left < bounds.left + margin * 3 || rect.right > bounds.right - margin) {
          element.scrollLeft += rect.left + rect.width / 2 - (bounds.left + bounds.width / 2);
        }
        return;
      }
    }
    element = element.parentElement;
  }
}
