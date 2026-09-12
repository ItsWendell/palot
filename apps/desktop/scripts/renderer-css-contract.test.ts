import { describe, expect, it } from "vitest";
import { assertRendererCss } from "./renderer-css-contract";

const validCss = `
  .scroll-fade-y {
    animation: scroll-fade-reveal-t 1ms ease-in-out;
    animation-timeline: scroll(self y);
  }
  .glass { backdrop-filter: blur(14px); }
`;

describe("renderer CSS contract", () => {
  it("accepts Electron-compatible scroll fades and backdrop filters", () => {
    expect(() => assertRendererCss(validCss)).not.toThrow();
  });

  it("rejects scroll timelines folded into the animation shorthand", () => {
    expect(() =>
      assertRendererCss(
        validCss.replace(
          "animation: scroll-fade-reveal-t 1ms ease-in-out;\n    animation-timeline: scroll(self y);",
          "animation: 1ms ease-in-out scroll-fade-reveal-t scroll(self y);",
        ),
      ),
    ).toThrow(/scroll timeline inside the animation shorthand/);
  });

  it("requires the standard backdrop-filter property", () => {
    expect(() =>
      assertRendererCss(validCss.replace("backdrop-filter", "-webkit-backdrop-filter")),
    ).toThrow(/standard backdrop-filter/);
  });
});
