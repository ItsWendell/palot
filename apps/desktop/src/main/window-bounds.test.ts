import { describe, expect, it } from "vitest";
import { fitWindowBounds } from "./window-bounds";

const primary = { x: 0, y: 0, width: 1_920, height: 1_080 };

describe("fitWindowBounds", () => {
  it("preserves bounds that fit their display", () => {
    expect(
      fitWindowBounds({ x: 300, y: 120, width: 1_440, height: 920 }, [primary], primary),
    ).toEqual({ x: 300, y: 120, width: 1_440, height: 920 });
  });

  it("clamps oversized and partially hidden bounds to the matching display", () => {
    expect(
      fitWindowBounds({ x: 1_700, y: 900, width: 2_000, height: 1_200 }, [primary], primary),
    ).toEqual(primary);
  });

  it("centers bounds on the primary display when their previous display is disconnected", () => {
    expect(
      fitWindowBounds({ x: 2_400, y: 100, width: 1_200, height: 800 }, [primary], primary),
    ).toEqual({ x: 360, y: 140, width: 1_200, height: 800 });
  });

  it("uses the display containing the largest part of the window", () => {
    const secondary = { x: 1_920, y: 0, width: 1_440, height: 900 };

    expect(
      fitWindowBounds(
        { x: 1_800, y: 100, width: 1_000, height: 700 },
        [primary, secondary],
        primary,
      ),
    ).toEqual({ x: 1_920, y: 100, width: 1_000, height: 700 });
  });
});
