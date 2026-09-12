import { afterEach, describe, expect, it, vi } from "vitest";
import { UI_FONT_OPTIONS } from "../../shared";
import { isAppearanceFontAvailable, prepareCodeFont } from "./font-loading";

const originalFonts = Object.getOwnPropertyDescriptor(document, "fonts");

afterEach(() => {
  vi.restoreAllMocks();
  if (originalFonts) {
    Object.defineProperty(document, "fonts", originalFonts);
  } else {
    Reflect.deleteProperty(document, "fonts");
  }
});

describe("font loading", () => {
  it("keeps platform system fonts out of unavailable pickers", () => {
    expect(isAppearanceFontAvailable(UI_FONT_OPTIONS.system, "linux")).toBe(true);
    expect(isAppearanceFontAvailable(UI_FONT_OPTIONS["sf-pro"], "darwin")).toBe(true);
    expect(isAppearanceFontAvailable(UI_FONT_OPTIONS["sf-pro"], "linux")).toBe(false);
    expect(isAppearanceFontAvailable(UI_FONT_OPTIONS.geist, "linux")).toBe(true);
    expect(UI_FONT_OPTIONS.geist.source).toBe("bundled");
  });

  it("loads the selected local code face and its common variants once", async () => {
    const load = vi.fn().mockResolvedValue([{}]);
    Object.defineProperty(document, "fonts", {
      configurable: true,
      value: { load },
    });

    await prepareCodeFont("consolas");
    await prepareCodeFont("consolas");

    expect(load).toHaveBeenCalledTimes(6);
    expect(load).toHaveBeenNthCalledWith(1, 'normal 400 16px "Consolas"');
    expect(load).toHaveBeenCalledWith('italic 700 16px "Consolas"');
  });
});
