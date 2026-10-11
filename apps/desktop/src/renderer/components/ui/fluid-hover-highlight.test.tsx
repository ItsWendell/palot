import { describe, expect, it } from "vitest";
import { resolveHighlightSource, resolveHighlightTransition } from "./fluid-hover-highlight";

describe("FluidHoverHighlight", () => {
  it("only shows once rows are measured and something is active", () => {
    const rect = { top: 0, left: 0, width: 10, height: 10 };
    const hover = { activeIndex: 0, itemRects: [rect], isMeasured: false, session: 1 };
    expect(resolveHighlightSource({ hover }).rect).toBeNull();
    expect(resolveHighlightSource({ hover: { ...hover, isMeasured: true } }).rect).toBe(rect);
    expect(resolveHighlightSource({ hover: { ...hover, isMeasured: true }, hidden: true }).rect).toBeNull();
  });

  it("drops travel but keeps the fade under reduced motion", () => {
    const transition = resolveHighlightTransition(undefined, true);
    expect(transition).toMatchObject({ duration: 0, opacity: { duration: 0.08 } });
    expect(resolveHighlightTransition(undefined, false)).toMatchObject({ type: "spring" });
  });
});
