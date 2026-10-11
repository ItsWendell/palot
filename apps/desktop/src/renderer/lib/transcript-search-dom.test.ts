import { afterEach, describe, expect, it } from "vitest";
import { applyTranscriptHighlights, transcriptTextRanges } from "./transcript-search-dom";
import type { TranscriptFindMatch } from "./transcript-search";

function mount(html: string): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = html;
  document.body.append(root);
  return root;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("transcriptTextRanges", () => {
  it("matches across inline formatting and streamed text spans", () => {
    const root = mount("<p>The <strong>par</strong><span>ser</span> works</p>");
    const ranges = transcriptTextRanges([root], "PARSER");
    expect(ranges.map((range) => range.toString())).toEqual(["parser"]);
  });

  it("does not join text from separate blocks", () => {
    const root = mount("<p>foo</p><p>bar</p>");
    expect(transcriptTextRanges([root], "foobar")).toEqual([]);
    expect(transcriptTextRanges([root], "bar").map((range) => range.toString())).toEqual(["bar"]);
  });

  it("skips controls and hidden text", () => {
    const root = mount(
      '<pre><button>Copy</button><code>copy the file</code></pre><span aria-hidden="true">copy</span>',
    );
    expect(transcriptTextRanges([root], "copy").map((range) => range.toString())).toEqual(["copy"]);
  });
});

describe("applyTranscriptHighlights", () => {
  const match = (partKey: string, occurrence: number): TranscriptFindMatch => ({
    turnIndex: 0,
    turnID: "turn",
    partKey,
    location: "final",
    occurrence,
  });

  it("returns the rendered range for the active occurrence", () => {
    const root = mount(
      '<div data-transcript-find-part="a"><p>alpha beta alpha</p></div>' +
        '<div data-transcript-find-part="b"><p>alpha</p></div>',
    );
    const matches = [match("a", 0), match("a", 1), match("b", 0)];
    const result = applyTranscriptHighlights(root, "alpha", matches, matches[1]!);
    expect(result.active?.toString()).toBe("alpha");
    expect(result.active?.startOffset).toBe(11);
    expect(result.activePart?.getAttribute("data-transcript-find-part")).toBe("a");
  });

  it("clamps to the last rendered occurrence when Markdown hides raw text", () => {
    const root = mount('<div data-transcript-find-part="a"><p>one link</p></div>');
    const result = applyTranscriptHighlights(
      root,
      "link",
      [match("a", 0), match("a", 1)],
      match("a", 1),
    );
    expect(result.active?.toString()).toBe("link");
  });

  it("reports the part when its text is not rendered", () => {
    const root = mount('<div data-transcript-find-part="a"><p>nothing here</p></div>');
    const result = applyTranscriptHighlights(root, "missing", [match("a", 0)], match("a", 0));
    expect(result.active).toBeNull();
    expect(result.activePart).not.toBeNull();
  });
});
