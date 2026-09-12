import { describe, expect, it } from "vitest";
import { startupWindowPresentation } from "./window-startup";

describe("startupWindowPresentation", () => {
  it("keeps an explicitly hidden development window hidden", () => {
    expect(startupWindowPresentation({ PALOT_START_HIDDEN: "1" })).toBe("hidden");
  });

  it("preserves inactive visible E2E launches", () => {
    expect(startupWindowPresentation({ PALOT_E2E_INACTIVE: "1" })).toBe("inactive");
  });

  it("supports visible inactive development launches", () => {
    expect(startupWindowPresentation({ PALOT_START_INACTIVE: "1" })).toBe("inactive");
  });

  it("focuses ordinary launches", () => {
    expect(startupWindowPresentation({})).toBe("focused");
  });
});
