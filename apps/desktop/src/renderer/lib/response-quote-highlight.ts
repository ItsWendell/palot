import { supportsTranscriptHighlights } from "./transcript-search-dom";

export const RESPONSE_QUOTE_HIGHLIGHT = "palot-response-quote";

/** Client-only coordinates. Never persisted with the quote or sent to OpenCode. */
export interface ResponseQuoteSource {
  element: HTMLElement;
  startContainer: Node;
  startOffset: number;
  endContainer: Node;
  endOffset: number;
  text: string;
}

export function captureResponseQuoteSource(
  element: HTMLElement,
  range: Range,
): ResponseQuoteSource {
  return {
    element,
    startContainer: range.startContainer,
    startOffset: range.startOffset,
    endContainer: range.endContainer,
    endOffset: range.endOffset,
    text: range.toString(),
  };
}

export function sameResponseQuoteSource(left: ResponseQuoteSource, right: ResponseQuoteSource) {
  return (
    left.element === right.element &&
    left.startContainer === right.startContainer &&
    left.startOffset === right.startOffset &&
    left.endContainer === right.endContainer &&
    left.endOffset === right.endOffset &&
    left.text === right.text
  );
}

function resolveRange(source: ResponseQuoteSource): Range | null {
  const { element, startContainer, startOffset, endContainer, endOffset } = source;
  if (!element.isConnected || !element.contains(startContainer) || !element.contains(endContainer))
    return null;
  try {
    // Range objects are live and can silently move when React replaces their nodes.
    // Reconstruct only at the original boundary points, never by searching for text.
    const range = element.ownerDocument.createRange();
    range.setStart(startContainer, startOffset);
    range.setEnd(endContainer, endOffset);
    return !range.collapsed && range.toString() === source.text ? range : null;
  } catch {
    return null;
  }
}

/** Keep one pending quote highlighted, dropping it rather than guessing after a rerender. */
export function highlightResponseQuote(
  root: HTMLElement,
  source: ResponseQuoteSource,
  onInvalid: () => void,
): () => void {
  if (!supportsTranscriptHighlights()) return () => {};
  const range = resolveRange(source);
  if (!range || !root.contains(source.element)) {
    onInvalid();
    return () => {};
  }
  const highlight = new Highlight(range);
  // Find in task takes precedence when both highlights cover the same text.
  highlight.priority = -1;
  CSS.highlights.set(RESPONSE_QUOTE_HIGHLIGHT, highlight);
  const clear = () => {
    observer.disconnect();
    if (CSS.highlights.get(RESPONSE_QUOTE_HIGHLIGHT) === highlight)
      CSS.highlights.delete(RESPONSE_QUOTE_HIGHLIGHT);
  };
  const observer = new MutationObserver(() => {
    if (
      source.element.isConnected &&
      root.contains(source.element) &&
      resolveRange(source) &&
      sameResponseQuoteSource(source, captureResponseQuoteSource(source.element, range))
    )
      return;
    clear();
    onInvalid();
  });
  observer.observe(root, { subtree: true, childList: true, characterData: true });
  return clear;
}
