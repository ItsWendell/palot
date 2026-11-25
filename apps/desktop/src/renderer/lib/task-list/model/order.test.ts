import { describe, expect, it } from "vitest";
import {
  holdLayout,
  holdOrder,
  isHeld,
  MAX_TRAVEL_PX,
  SETTLE_WINDOW_MS,
  travelOffset,
  visibleRange,
  entryStarts,
} from "./order";
import type { Layout, RowEntry } from "./sections";

const row = (key: string, container: string): RowEntry => ({
  type: "row",
  key,
  container,
  placement: "inbox",
  lines: 1,
  size: 34,
  depth: 0,
});

const keys = (layout: Layout) =>
  layout.entries
    .map((entry) => entry.key)
    .concat(layout.shelves.flatMap((shelf) => shelf.rows.map((item) => item.key)));

describe("holdOrder", () => {
  it("keeps held rows in place, drops removed ones and slots new ones by their live position", () => {
    expect(holdOrder(["a", "b", "c"], ["c", "a", "b"])).toEqual(["a", "b", "c"]);
    expect(holdOrder(["a", "b", "c"], ["c", "a"])).toEqual(["a", "c"]);
    expect(holdOrder(["a", "b", "c"], ["new", "c", "a", "b"])).toEqual(["a", "b", "new", "c"]);
    expect(holdOrder(["a", "b"], ["a", "b", "tail"])).toEqual(["a", "b", "tail"]);
  });
});

describe("isHeld", () => {
  const base = { pointerInside: false, keyboardInside: false, now: 10_000, lastChangeAt: 0 };
  it("holds while the pointer or keyboard is in the list", () => {
    expect(isHeld(base)).toBe(false);
    expect(isHeld({ ...base, pointerInside: true })).toBe(true);
    expect(isHeld({ ...base, keyboardInside: true })).toBe(true);
  });
  it("holds for the settle window after the last change", () => {
    expect(isHeld({ ...base, lastChangeAt: base.now - SETTLE_WINDOW_MS + 1 })).toBe(true);
    expect(isHeld({ ...base, lastChangeAt: base.now - SETTLE_WINDOW_MS })).toBe(false);
  });
});

describe("holdLayout", () => {
  it("holds moves within a container but never across containers", () => {
    const displayed: Layout = {
      entries: [
        { type: "heading", key: "heading:needs-you", label: "Needs you", size: 28 },
        row("x", "needs-you"),
        row("a", "inbox"),
        row("b", "inbox"),
        row("c", "inbox"),
      ],
      shelves: [],
      attention: 1,
    };
    // "c" rose into Needs you (taking its sorted slot at once); "b" moved above "a" in the
    // inbox, which waits for the release.
    const live: Layout = {
      entries: [
        { type: "heading", key: "heading:needs-you", label: "Needs you", size: 28 },
        row("c", "needs-you"),
        row("x", "needs-you"),
        row("b", "inbox"),
        row("a", "inbox"),
      ],
      shelves: [],
      attention: 2,
    };
    expect(keys(holdLayout(displayed, live))).toEqual(["heading:needs-you", "c", "x", "a", "b"]);
  });
});

describe("travelOffset", () => {
  it("caps how far a released row travels", () => {
    expect(travelOffset(300, 100)).toBe(MAX_TRAVEL_PX);
    expect(travelOffset(100, 300)).toBe(-MAX_TRAVEL_PX);
    expect(travelOffset(100, 120)).toBe(-20);
  });
});

describe("visibleRange", () => {
  const sizes = Array.from({ length: 400 }, () => 34);
  const starts = entryStarts(sizes.map((size) => ({ size })));
  it("mounts only the rows near the viewport", () => {
    expect(visibleRange(starts, sizes, 0, 340, 2)).toEqual([0, 11]);
    expect(visibleRange(starts, sizes, 3400, 340, 2)).toEqual([98, 111]);
    expect(visibleRange([], [], 0, 340)).toBeNull();
  });
});
