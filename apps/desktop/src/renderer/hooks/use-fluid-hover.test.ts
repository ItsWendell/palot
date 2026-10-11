import { describe, expect, it } from "vitest";
import { pickNearest } from "./use-fluid-hover";

const base = {
  containerRect: { left: 0, top: 0, width: 200, height: 300 },
  scroll: { x: 0, y: 0 },
  border: { x: 0, y: 0 },
  layoutSize: { width: 200, height: 300 },
};
const rows = [
  { top: 0, height: 30, left: 0, width: 200 },
  { top: 40, height: 30, left: 0, width: 200 },
  { top: 80, height: 30, left: 0, width: 200 },
];

describe("pickNearest", () => {
  it("prefers the row under the pointer, then the nearest row across gaps", () => {
    expect(pickNearest({ ...base, axis: "y", point: { x: 10, y: 50 }, rects: rows })).toBe(1);
    // In the gap between rows 1 and 2, nearer row 2's centre.
    expect(pickNearest({ ...base, axis: "y", point: { x: 10, y: 76 }, rects: rows })).toBe(2);
    // Past the last row still lands on it.
    expect(pickNearest({ ...base, axis: "y", point: { x: 10, y: 260 }, rects: rows })).toBe(2);
  });

  it("skips disabled rows and accounts for scrolling", () => {
    expect(
      pickNearest({
        ...base,
        axis: "y",
        point: { x: 10, y: 50 },
        rects: rows,
        isDisabled: (index) => index === 1,
      }),
    ).not.toBe(1);
    expect(
      pickNearest({
        ...base,
        axis: "y",
        point: { x: 10, y: 10 },
        rects: rows,
        scroll: { x: 0, y: 40 },
      }),
    ).toBe(1);
  });
});
