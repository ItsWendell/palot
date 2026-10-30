import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  captureResponseQuoteSource,
  highlightResponseQuote,
  RESPONSE_QUOTE_HIGHLIGHT,
} from "./response-quote-highlight";

const highlights = new Map<string, Set<Range>>();
beforeEach(() => {
  vi.stubGlobal("CSS", { highlights });
  vi.stubGlobal(
    "Highlight",
    class extends Set<Range> {
      constructor(...ranges: Range[]) {
        super(ranges);
      }
    },
  );
});
afterEach(() => {
  document.body.replaceChildren();
  highlights.clear();
  vi.unstubAllGlobals();
});

function fixture() {
  const root = document.createElement("div");
  root.innerHTML =
    "<article><p>ring buffer</p><p>Use a <strong>ring</strong> buffer.</p></article>";
  document.body.append(root);
  const element = root.querySelector("article")!;
  const start = root.querySelector("strong")!.firstChild!;
  const end = root.querySelector("strong")!.nextSibling!;
  const range = document.createRange();
  range.setStart(start, 0);
  range.setEnd(end, 7);
  return { root, element, start, end, range, source: captureResponseQuoteSource(element, range) };
}

describe("pending response quote highlight", () => {
  it("keeps the exact repeated occurrence across inline nodes after native selection is cleared", () => {
    const { root, source, start, end, range } = fixture();
    const selection = document.getSelection()!;
    selection.addRange(range);
    const dispose = highlightResponseQuote(root, source, vi.fn());
    selection.removeAllRanges();
    const painted = [...highlights.get(RESPONSE_QUOTE_HIGHLIGHT)!][0]!;
    expect(painted.toString()).toBe("ring buffer");
    expect(painted.startContainer).toBe(start);
    expect(painted.endContainer).toBe(end);
    expect(painted.endOffset).toBe(7);
    dispose();
    expect(highlights.has(RESPONSE_QUOTE_HIGHLIGHT)).toBe(false);
  });

  it.each(["replace", "edit", "remove"])(
    "drops invalid coordinates after a %s without finding another occurrence",
    async (change) => {
      const { root, source, element, start } = fixture();
      const invalid = vi.fn();
      const dispose = highlightResponseQuote(root, source, invalid);
      if (change === "replace") element.innerHTML = "<p>ring buffer</p>";
      else if (change === "edit") start.textContent = "changed";
      else element.remove();
      await Promise.resolve();
      expect(invalid).toHaveBeenCalledOnce();
      expect(highlights.has(RESPONSE_QUOTE_HIGHLIGHT)).toBe(false);
      dispose();
    },
  );

  it("stops observing on cleanup and leaves other highlight owners alone", async () => {
    const { root, source, start } = fixture();
    const invalid = vi.fn();
    const dispose = highlightResponseQuote(root, source, invalid);
    const replacement = new Set<Range>();
    highlights.set(RESPONSE_QUOTE_HIGHLIGHT, replacement);
    dispose();
    start.textContent = "changed";
    await Promise.resolve();
    expect(invalid).not.toHaveBeenCalled();
    expect(highlights.get(RESPONSE_QUOTE_HIGHLIGHT)).toBe(replacement);
  });

  it("quietly skips unsupported browsers", () => {
    vi.stubGlobal("Highlight", undefined);
    const { root, source } = fixture();
    const invalid = vi.fn();
    highlightResponseQuote(root, source, invalid)();
    expect(highlights.size).toBe(0);
    expect(invalid).not.toHaveBeenCalled();
  });
});
