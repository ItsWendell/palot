/**
 * Find in task: DOM highlighting with the CSS Custom Highlight API.
 *
 * Only rendered parts that have data matches are walked, so the cost is bounded by the
 * virtualizer's mounted turns rather than the whole transcript.
 */
import { normalizeTranscriptQuery, type TranscriptFindMatch } from "./transcript-search";

export const TRANSCRIPT_FIND_PART_ATTRIBUTE = "data-transcript-find-part";
export const TRANSCRIPT_FIND_HIGHLIGHT = "palot-transcript-find";
export const TRANSCRIPT_FIND_ACTIVE_HIGHLIGHT = "palot-transcript-find-active";

const IGNORED_TEXT_SELECTOR =
  'button, script, style, template, [aria-hidden="true"], .sr-only, [data-transcript-find-ignore]';
const BLOCK_SELECTOR =
  "p, li, pre, blockquote, h1, h2, h3, h4, h5, h6, td, th, dt, dd, figcaption, summary, div";

export function supportsTranscriptHighlights(): boolean {
  return (
    typeof CSS !== "undefined" &&
    typeof CSS.highlights === "object" &&
    CSS.highlights !== null &&
    typeof Highlight === "function"
  );
}

export function clearTranscriptHighlights(): void {
  if (!supportsTranscriptHighlights()) return;
  CSS.highlights.delete(TRANSCRIPT_FIND_HIGHLIGHT);
  CSS.highlights.delete(TRANSCRIPT_FIND_ACTIVE_HIGHLIGHT);
}

/**
 * Case-insensitive, non-overlapping ranges over the visible text of `elements`, read as
 * one string in DOM order. Text in different blocks is separated so a match never joins
 * two paragraphs, while inline formatting and streamed text spans still match across
 * node boundaries.
 */
export function transcriptTextRanges(elements: readonly Element[], query: string): Range[] {
  const needle = normalizeTranscriptQuery(query);
  const ownerDocument = elements[0]?.ownerDocument;
  if (!needle || !ownerDocument) return [];
  const nodes: Text[] = [];
  const starts: number[] = [];
  let text = "";
  let previousBlock: Element | null = null;
  for (const element of elements) {
    const walker = ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) =>
        node.parentElement?.closest(IGNORED_TEXT_SELECTOR)
          ? NodeFilter.FILTER_REJECT
          : NodeFilter.FILTER_ACCEPT,
    });
    for (
      let node = walker.nextNode() as Text | null;
      node;
      node = walker.nextNode() as Text | null
    ) {
      const value = node.data;
      if (!value) continue;
      const block = node.parentElement?.closest(BLOCK_SELECTOR) ?? element;
      if (text && block !== previousBlock) text += "\n";
      previousBlock = block;
      nodes.push(node);
      starts.push(text.length);
      text += value;
    }
    // Separate parts so a match cannot span two messages.
    previousBlock = null;
  }
  const lower = text.toLowerCase();
  // Lowercasing can change length for a few scripts; skip mapping rather than misplace.
  if (lower.length !== text.length) return [];
  const ranges: Range[] = [];
  let nodeIndex = 0;
  const locate = (offset: number, end: boolean) => {
    while (
      nodeIndex < nodes.length - 1 &&
      (end ? starts[nodeIndex + 1]! < offset : starts[nodeIndex + 1]! <= offset)
    )
      nodeIndex += 1;
    return { node: nodes[nodeIndex]!, offset: offset - starts[nodeIndex]! };
  };
  for (let at = lower.indexOf(needle); at !== -1; at = lower.indexOf(needle, at + needle.length)) {
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

export interface TranscriptHighlightResult {
  /** Range for the active match when its occurrence is rendered. */
  active: Range | null;
  /** Rendered element of the active match's part, used when the text itself is missing. */
  activePart: Element | null;
}

/**
 * Highlights every rendered occurrence for parts that have data matches. The active
 * match's occurrence is clamped to what the DOM shows, since Markdown can hide syntax
 * that the raw text contains.
 */
export function applyTranscriptHighlights(
  root: ParentNode,
  query: string,
  matches: readonly TranscriptFindMatch[],
  active: TranscriptFindMatch | null,
): TranscriptHighlightResult {
  const result: TranscriptHighlightResult = { active: null, activePart: null };
  if (!normalizeTranscriptQuery(query) || matches.length === 0) {
    clearTranscriptHighlights();
    return result;
  }
  const keys = new Set<string>();
  for (const match of matches) keys.add(match.partKey);
  const elementsByKey = new Map<string, Element[]>();
  for (const element of root.querySelectorAll(`[${TRANSCRIPT_FIND_PART_ATTRIBUTE}]`)) {
    const key = element.getAttribute(TRANSCRIPT_FIND_PART_ATTRIBUTE);
    if (!key || !keys.has(key)) continue;
    const list = elementsByKey.get(key);
    if (list) list.push(element);
    else elementsByKey.set(key, [element]);
  }
  const hits: Range[] = [];
  for (const [key, elements] of elementsByKey) {
    const ranges = transcriptTextRanges(elements, query);
    if (active && key === active.partKey) {
      result.activePart = elements[0] ?? null;
      const index = Math.min(active.occurrence, ranges.length - 1);
      if (index >= 0) {
        result.active = ranges[index]!;
        ranges.splice(index, 1);
      }
    }
    hits.push(...ranges);
  }
  if (supportsTranscriptHighlights()) {
    const hitHighlight = new Highlight(...hits);
    const activeHighlight = new Highlight(...(result.active ? [result.active] : []));
    activeHighlight.priority = 1;
    CSS.highlights.set(TRANSCRIPT_FIND_HIGHLIGHT, hitHighlight);
    CSS.highlights.set(TRANSCRIPT_FIND_ACTIVE_HIGHLIGHT, activeHighlight);
  }
  return result;
}
