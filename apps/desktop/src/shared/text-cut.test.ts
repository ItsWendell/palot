import { describe, expect, it, vi } from "vitest";
import { cutHead, cutTail, splitTail, truncateEnd, truncateMiddle } from "./text-cut";

const FAMILY = "👨‍👩‍👧‍👦"; // ZWJ sequence, 11 code units
const FLAG = "🇳🇱"; // two regional indicators, 4 code units
const THUMB = "👍🏽"; // emoji with skin tone, 4 code units
const ACCENT = "e\u0301"; // e + combining acute, 2 code units

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const graphemes = (text: string) => [...segmenter.segment(text)].map((part) => part.segment);

/** Every grapheme of the cut is a whole grapheme of the original. */
function expectWhole(original: string, cut: string) {
  const whole = new Set(graphemes(original));
  for (const part of graphemes(cut)) expect(whole.has(part), JSON.stringify(part)).toBe(true);
}

describe("text cuts", () => {
  it("never splits emoji, flags, ZWJ sequences or combining marks", () => {
    for (const cluster of [FAMILY, FLAG, THUMB, ACCENT, "😀"]) {
      const text = `ab${cluster}cd`;
      for (let limit = 0; limit <= text.length; limit++) {
        const head = cutHead(text, limit);
        const tail = cutTail(text, limit);
        expect(head.length).toBeLessThanOrEqual(limit);
        expect(tail.length).toBeLessThanOrEqual(limit);
        expect(text.startsWith(head) && text.endsWith(tail)).toBe(true);
        expectWhole(text, head);
        expectWhole(text, tail);
      }
    }
    expect(cutHead(`ab${FAMILY}`, 5)).toBe("ab");
    expect(cutHead(`ab${FAMILY}`, 13)).toBe(`ab${FAMILY}`);
    expect(cutTail(`${FLAG}${FLAG}x`, 4)).toBe("x");
  });

  it("keeps flags paired in a long run of flags", () => {
    const text = `x${FLAG.repeat(200)}`;
    for (const limit of [300, 301, 302, 303, 600]) {
      expectWhole(text, cutHead(text, limit));
      expectWhole(text, cutTail(text, limit));
    }
  });

  it("finds the same boundary deep in a long text as segmenting all of it", () => {
    const unit = `word ${FAMILY} ${FLAG}${THUMB}${ACCENT} `;
    const text = unit.repeat(400);
    const starts = new Set([...segmenter.segment(text)].map((part) => part.index));
    for (const limit of [999, 1_000, 1_001, 4_321, 7_777]) {
      const head = cutHead(text, limit);
      expect(starts.has(head.length)).toBe(true);
      expect(limit - head.length).toBeLessThan(FAMILY.length);
      const tail = cutTail(text, limit);
      expect(starts.has(text.length - tail.length)).toBe(true);
    }
    // A grapheme wider than the window around the cut is still kept whole.
    const marks = `a${"\u0301".repeat(600)}b`;
    expect(cutHead(marks, 400)).toBe("");
    expect(cutTail(marks, 400)).toBe("b");
  });

  it("caps truncated text at the limit, ellipsis included", () => {
    expect(truncateEnd("short", 10)).toBe("short");
    expect(truncateEnd(`abc${THUMB}def`, 6)).toBe("abc…");
    expect(truncateEnd("a title that is long", 10, "...")).toBe("a title...");
    const middle = truncateMiddle(`${FAMILY}/middle/${FLAG}.ts`, 12);
    expect(middle.length).toBeLessThanOrEqual(12);
    expect(middle).toContain("…");
    expect(splitTail(`src/${THUMB}.ts`, 6)).toEqual({ head: `src/${THUMB}`, tail: ".ts" });
  });

  it("keeps surrogate pairs whole without Intl.Segmenter", async () => {
    vi.resetModules();
    vi.stubGlobal("Intl", { ...Intl, Segmenter: undefined });
    delete (globalThis.Intl as { Segmenter?: unknown }).Segmenter;
    try {
      const fallback = await import("./text-cut");
      expect(fallback.cutHead("ab😀", 3)).toBe("ab");
      expect(fallback.cutTail("😀ab", 3)).toBe("ab");
      expect(fallback.cutHead("ab😀", 4)).toBe("ab😀");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
