import type { BrowserWindow } from "electron";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyLiquidGlassView,
  installLiquidGlass,
  removeLiquidGlassView,
  setResolvedChromeTier,
  updateLiquidGlassSettings,
  nativeGlassOptions,
  type LiquidGlassModule,
  type LiquidGlassWindow,
  selectWindowChromeTier,
} from "./liquid-glass";
import { DEFAULT_APPEARANCE_PREFERENCES } from "../shared/appearance-contract";

afterEach(() => {
  removeLiquidGlassView();
  setResolvedChromeTier("opaque");
});

function createWindow(): LiquidGlassWindow {
  return {
    setWindowButtonVisibility: vi.fn(),
    getNativeWindowHandle: () => Buffer.alloc(8),
    setVibrancy: vi.fn(),
  };
}

describe("selectWindowChromeTier", () => {
  it("uses native Liquid Glass on supported macOS", () => {
    expect(
      selectWindowChromeTier({ platform: "darwin", disabled: false, glassSupported: true }),
    ).toBe("liquid-glass");
  });

  it("uses vibrancy when native glass is not supported on macOS", () => {
    expect(
      selectWindowChromeTier({ platform: "darwin", disabled: false, glassSupported: false }),
    ).toBe("vibrancy");
  });

  it("honors a theme's explicit vibrancy treatment even when Liquid Glass is available", () => {
    expect(
      selectWindowChromeTier({
        platform: "darwin",
        disabled: false,
        glassSupported: true,
        backdrop: "vibrancy-menu",
      }),
    ).toBe("vibrancy");
  });

  it("uses opaque chrome when glass is disabled or the platform is not macOS", () => {
    expect(
      selectWindowChromeTier({ platform: "darwin", disabled: true, glassSupported: true }),
    ).toBe("opaque");
    expect(
      selectWindowChromeTier({ platform: "linux", disabled: false, glassSupported: true }),
    ).toBe("opaque");
  });

  it("uses opaque chrome for the explicit preference and reduced transparency", () => {
    expect(
      selectWindowChromeTier({
        platform: "darwin",
        disabled: false,
        glassSupported: true,
        preference: "opaque",
      }),
    ).toBe("opaque");
    expect(
      selectWindowChromeTier({
        platform: "darwin",
        disabled: false,
        glassSupported: true,
        reducedTransparency: true,
      }),
    ).toBe("opaque");
  });
});

describe("applyLiquidGlassView", () => {
  it("keeps the native tier after addView succeeds", () => {
    const window = createWindow();
    const glass: LiquidGlassModule = {
      isGlassSupported: () => true,
      addView: () => 7,
    };

    expect(applyLiquidGlassView(window, glass)).toBe("liquid-glass");
    expect(window.setWindowButtonVisibility).toHaveBeenCalledWith(true);
    expect(window.setVibrancy).not.toHaveBeenCalled();
  });

  it("passes documented native tint options to the glass view", () => {
    const window = createWindow();
    const addView = vi.fn(() => 7);
    const glass: LiquidGlassModule = { isGlassSupported: () => true, addView };

    expect(applyLiquidGlassView(window, glass, { tintColor: "#11111326" })).toBe("liquid-glass");
    expect(addView).toHaveBeenCalledWith(expect.any(Buffer), { tintColor: "#11111326" });
  });

  it("applies unstable material settings after creating the glass view", () => {
    const window = createWindow();
    const unstable_setVariant = vi.fn();
    const unstable_setScrim = vi.fn();
    const unstable_setSubdued = vi.fn();
    const setAppearance = vi.fn();
    const setTintColor = vi.fn();
    const addView = vi.fn(() => 7);
    const glass: LiquidGlassModule = {
      isGlassSupported: () => true,
      addView,
      unstable_setVariant,
      unstable_setScrim,
      unstable_setSubdued,
      setAppearance,
      setTintColor,
    };

    expect(
      applyLiquidGlassView(window, glass, {
        tintColor: "#11111326",
        appearance: "dark",
        variant: 2,
        scrim: 1,
        subdued: 0,
      }),
    ).toBe("liquid-glass");
    expect(addView).toHaveBeenCalledWith(expect.any(Buffer), {
      appearance: "dark",
      tintColor: "#11111326",
    });
    expect(unstable_setVariant).toHaveBeenCalledWith(7, 2);
    expect(unstable_setScrim).toHaveBeenCalledWith(7, 1);
    expect(unstable_setSubdued).toHaveBeenCalledWith(7, 0);
    expect(setAppearance).toHaveBeenCalledWith(7, "dark");
    expect(setTintColor).toHaveBeenCalledWith(7, "#11111326");
  });

  it("keeps native glass when an unstable material setter fails", () => {
    const window = createWindow();
    const glass: LiquidGlassModule = {
      isGlassSupported: () => true,
      addView: () => 7,
      unstable_setVariant: () => {
        throw new Error("private API changed");
      },
    };

    expect(applyLiquidGlassView(window, glass, { variant: 2 })).toBe("liquid-glass");
    expect(window.setVibrancy).not.toHaveBeenCalled();
  });

  it("reports vibrancy when addView returns -1", () => {
    const window = createWindow();
    const glass: LiquidGlassModule = {
      isGlassSupported: () => true,
      addView: () => -1,
    };

    expect(applyLiquidGlassView(window, glass)).toBe("vibrancy");
    expect(window.setVibrancy).toHaveBeenCalledWith("sidebar");
  });

  it("reports vibrancy when addView throws", () => {
    const window = createWindow();
    const glass: LiquidGlassModule = {
      isGlassSupported: () => true,
      addView: () => {
        throw new Error("native failure");
      },
    };

    expect(applyLiquidGlassView(window, glass)).toBe("vibrancy");
    expect(window.setVibrancy).toHaveBeenCalledWith("sidebar");
  });
});

describe("multiple window glass lifecycle", () => {
  function createGlass(): LiquidGlassModule {
    let id = 0;
    return {
      isGlassSupported: () => true,
      addView: vi.fn(() => ++id),
      removeView: vi.fn(),
      setTintColor: vi.fn(),
    };
  }

  it("updates and removes every installed window", () => {
    const glass = createGlass();
    applyLiquidGlassView(createWindow(), glass);
    applyLiquidGlassView(createWindow(), glass);

    updateLiquidGlassSettings({ tintColor: "#11111326" });
    expect(glass.setTintColor).toHaveBeenCalledWith(1, "#11111326");
    expect(glass.setTintColor).toHaveBeenCalledWith(2, "#11111326");
    removeLiquidGlassView();
    removeLiquidGlassView();
    expect(glass.removeView).toHaveBeenCalledTimes(2);
    expect(glass.removeView).toHaveBeenCalledWith(1);
    expect(glass.removeView).toHaveBeenCalledWith(2);
  });

  it("closing a window removes only its current record, even after reinstall", () => {
    const glass = createGlass();
    let close = () => {};
    const window = {
      ...createWindow(),
      once: vi.fn((_event: "closed", listener: () => void) => {
        close = listener;
      }),
    };
    applyLiquidGlassView(window, glass);
    applyLiquidGlassView(createWindow(), glass);
    applyLiquidGlassView(window, glass);
    expect(glass.removeView).toHaveBeenCalledWith(1);
    expect(window.once).toHaveBeenCalledTimes(1);
    close();
    expect(glass.removeView).toHaveBeenCalledWith(3);
    updateLiquidGlassSettings({ tintColor: "#11111326" });
    expect(glass.setTintColor).toHaveBeenCalledExactlyOnceWith(2, "#11111326");
    removeLiquidGlassView();
    close();
    expect(glass.removeView).toHaveBeenCalledTimes(3);
  });

  it("falling back in one window preserves other windows' glass", () => {
    const glass = createGlass();
    const window = createWindow();
    applyLiquidGlassView(window, glass);
    applyLiquidGlassView(createWindow(), glass);
    applyLiquidGlassView(window, { ...glass, addView: () => -1 });
    expect(glass.removeView).toHaveBeenCalledExactlyOnceWith(1);
    updateLiquidGlassSettings({ tintColor: "#11111326" });
    expect(glass.setTintColor).toHaveBeenCalledExactlyOnceWith(2, "#11111326");
  });

  it("does not install native glass on a destroyed window", () => {
    const glass = createGlass();
    applyLiquidGlassView({ ...createWindow(), isDestroyed: () => true }, glass);
    expect(glass.addView).not.toHaveBeenCalled();
  });

  it("does not touch a window destroyed while the module loads", async () => {
    let destroyed = false;
    const window = { ...createWindow(), isDestroyed: () => destroyed };
    setResolvedChromeTier("liquid-glass");
    const installation = installLiquidGlass(window as BrowserWindow);
    destroyed = true;
    await installation;
    expect(window.setWindowButtonVisibility).not.toHaveBeenCalled();
    expect(window.setVibrancy).not.toHaveBeenCalled();
  });

  it("does not reinstall glass after a global removal during module loading", async () => {
    const window = { ...createWindow(), isDestroyed: () => false };
    setResolvedChromeTier("liquid-glass");
    const installation = installLiquidGlass(window as BrowserWindow);
    removeLiquidGlassView();
    await installation;
    expect(window.setWindowButtonVisibility).not.toHaveBeenCalled();
    expect(window.setVibrancy).not.toHaveBeenCalled();
  });
});

describe("nativeGlassOptions", () => {
  it("derives an alpha tint from the active theme background", () => {
    expect(
      nativeGlassOptions({ ...DEFAULT_APPEARANCE_PREFERENCES, nativeGlassTint: 15 }, "dark"),
    ).toEqual({ appearance: "dark", tintColor: "#11111326", variant: 0 });
    expect(nativeGlassOptions(DEFAULT_APPEARANCE_PREFERENCES, "dark")).toEqual({
      appearance: "dark",
      tintColor: "#11111300",
      variant: 0,
    });
  });

  it("lets preferences override theme-level glass settings", () => {
    expect(
      nativeGlassOptions(
        {
          ...DEFAULT_APPEARANCE_PREFERENCES,
          nativeGlassVariant: "clear",
        },
        "dark",
      ),
    ).toEqual({ appearance: "dark", tintColor: "#11111300", variant: 1 });
  });
});
