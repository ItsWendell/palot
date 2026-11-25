import { describe, expect, it } from "vitest";
import {
  extendSelection,
  NO_SELECTION,
  pruneSelection,
  selectRange,
  toggleSelection,
} from "./selection";

const order = ["a", "b", "c", "d", "e"];

describe("selection", () => {
  it("toggles single rows with Mod+click and remembers the anchor", () => {
    const one = toggleSelection(NO_SELECTION, "b");
    const two = toggleSelection(one, "d");
    expect(two).toEqual({ keys: ["b", "d"], anchor: "d" });
    expect(toggleSelection(two, "b")).toEqual({ keys: ["d"], anchor: "b" });
    expect(toggleSelection({ keys: ["d"], anchor: "d" }, "d")).toEqual(NO_SELECTION);
  });

  it("selects a range from the anchor with Shift+click, in either direction", () => {
    expect(selectRange({ keys: ["b"], anchor: "b" }, order, "d").keys).toEqual(["b", "c", "d"]);
    expect(selectRange({ keys: ["d"], anchor: "d" }, order, "a").keys).toEqual([
      "a",
      "b",
      "c",
      "d",
    ]);
    expect(selectRange(NO_SELECTION, order, "c", "a")).toEqual({
      keys: ["a", "b", "c"],
      anchor: "a",
    });
  });

  it("extends with Shift+arrows from the focused row and moves focus along", () => {
    const first = extendSelection(NO_SELECTION, order, "b", 1);
    expect(first).toEqual({ selection: { keys: ["b", "c"], anchor: "b" }, focus: "c" });
    const second = extendSelection(first.selection, order, "c", 1);
    expect(second.selection.keys).toEqual(["b", "c", "d"]);
    const back = extendSelection(second.selection, order, "d", -1);
    expect(back.selection.keys).toEqual(["b", "c"]);
  });

  it("drops rows that are gone", () => {
    const selection = { keys: ["a", "b", "c"], anchor: "a" };
    expect(pruneSelection(selection, new Set(["b", "c"]))).toEqual({
      keys: ["b", "c"],
      anchor: "b",
    });
    expect(pruneSelection(selection, new Set(order))).toBe(selection);
  });
});
