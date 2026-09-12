import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_APPEARANCE_PREFERENCES } from "../../shared";
import {
  applyAppearanceToRoot,
  applyNativeSystemAppearanceToRoot,
  applySidebarMaterialToRoot,
  resolveAppearance,
} from "./appearance";

describe("renderer appearance", () => {
  beforeEach(() => {
    document.documentElement.removeAttribute("style");
    document.getElementById("palot-theme")?.remove();
    document.documentElement.dataset.chromeTier = "opaque";
    document.documentElement.dataset.reducedTransparency = "false";
  });

  it("publishes semantic variables and concrete datasets together", () => {
    applyAppearanceToRoot(resolveAppearance(DEFAULT_APPEARANCE_PREFERENCES, "dark"));

    expect(document.documentElement.dataset.resolvedTheme).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("palot");
    expect(document.documentElement.dataset.uiFont).toBe("system");
    const css = document.getElementById("palot-theme")?.textContent;
    expect(css).toContain(":root[data-theme][data-resolved-theme]");
    expect(css).toContain("--background: oklch(0.14 0.004 285.82)");
    expect(css).toContain("--glass-sidebar-opacity: 67%");
    expect(css).toContain("--content-surface-opacity: 100%");
    expect(css).toContain("--theme-ui-font-size: 14px");
    expect(css).toContain("--theme-code-font-size: 12px");
    expect(css).not.toContain("--theme-sidebar-font-size");
    expect(css).not.toContain("--theme-diff-font-size");
    expect(css).not.toContain("--theme-tree-font-size");
    expect(document.documentElement.dataset.contentTranslucent).toBe("false");
    expect(document.documentElement.dataset.themeRevision).toBeTruthy();
  });

  it("publishes contrast, typography, and content translucency preferences", () => {
    applyAppearanceToRoot(
      resolveAppearance(
        {
          ...DEFAULT_APPEARANCE_PREFERENCES,
          darkContrast: 80,
          contentOpacity: 72,
          uiFontSize: 18,
        },
        "dark",
      ),
    );

    const css = document.getElementById("palot-theme")?.textContent;
    expect(css).toContain("color-mix(in oklch");
    expect(css).toContain("--content-surface-opacity: 72%");
    expect(css).toContain("--theme-ui-font-size: 18px");
    expect(document.documentElement.dataset.contentTranslucent).toBe("true");
  });

  it("keeps generic interaction surfaces neutral across branded themes", () => {
    applyAppearanceToRoot(
      resolveAppearance(
        {
          ...DEFAULT_APPEARANCE_PREFERENCES,
          darkTheme: "linear",
        },
        "dark",
      ),
    );

    const css = document.getElementById("palot-theme")?.textContent;
    expect(css).toContain("--accent: color-mix(in oklch, #e3e4e6 11%, transparent)");
    expect(css).toContain("--sidebar-accent: color-mix(in oklch, #e3e4e6 11%, transparent)");
    expect(css).not.toContain("--accent: color-mix(in oklch, #0f0f11 82%, #606acc)");
  });

  it("publishes the Codex sidebar treatment as semantic renderer variables", () => {
    applyAppearanceToRoot(
      resolveAppearance(
        {
          ...DEFAULT_APPEARANCE_PREFERENCES,
          darkTheme: "codex",
        },
        "dark",
      ),
    );

    const css = document.getElementById("palot-theme")?.textContent;
    expect(css).toContain("--foreground: #dfdfdf");
    expect(css).toContain("--text-secondary: rgb(255 255 255 / 70%)");
    expect(css).toContain("--background: #181818");
    expect(css).toContain("--code-background: #111111");
    expect(css).toContain("--sidebar: #171717");
    expect(css).toContain("--glass-sidebar-opacity: 55%");
    expect(css).toContain("--sidebar-background-opaque: #171717");
    expect(css).toContain(
      "--sidebar-background-translucent: color-mix(in srgb, #212121 55%, transparent)",
    );
    expect(css).toContain("--glass-sidebar-blur: 0px");
    expect(css).toContain("--glass-sidebar-saturation: 1");
    expect(css).toContain("--glass-composer-blur: 0px");
    expect(css).toContain("--glass-popover-saturation: 1");
    expect(document.documentElement.dataset.sidebarPreference).toBe("translucent");
    expect(document.documentElement.dataset.nativeBackdrop).toBe("vibrancy-menu");
  });

  it("publishes Cursor's independent sidebar and elevated surface opacities", () => {
    applyAppearanceToRoot(
      resolveAppearance(
        {
          ...DEFAULT_APPEARANCE_PREFERENCES,
          lightTheme: "cursor",
        },
        "light",
      ),
    );

    const css = document.getElementById("palot-theme")?.textContent;
    expect(css).toContain("--glass-sidebar-opacity: 27%");
    expect(css).toContain("--glass-inspector-opacity: 84%");
    expect(css).toContain("--glass-composer-opacity: 84%");
    expect(css).toContain("--glass-popover-opacity: 84%");
    expect(document.documentElement.dataset.nativeBackdrop).toBe("vibrancy-sidebar");
  });

  it("resolves automatic sidebars from the available native material", () => {
    document.documentElement.dataset.sidebarPreference = "automatic";
    applySidebarMaterialToRoot();
    expect(document.documentElement.dataset.sidebarMaterial).toBe("solid");

    document.documentElement.dataset.chromeTier = "vibrancy";
    applySidebarMaterialToRoot();
    expect(document.documentElement.dataset.sidebarMaterial).toBe("translucent");

    document.documentElement.dataset.sidebarPreference = "transparent";
    applySidebarMaterialToRoot();
    expect(document.documentElement.dataset.sidebarMaterial).toBe("transparent");

    document.documentElement.dataset.reducedTransparency = "true";
    document.documentElement.dataset.sidebarPreference = "translucent";
    applySidebarMaterialToRoot();
    expect(document.documentElement.dataset.sidebarMaterial).toBe("solid");
  });

  it("publishes Electron system colors as native theme variables", () => {
    applyNativeSystemAppearanceToRoot({
      colors: {
        accent: "#007affff",
        blue: "#007affff",
        control: "#f2f2f2ff",
        controlBackground: "#ffffffff",
        controlText: "#1d1d1fff",
        disabledControlText: "#999999ff",
        green: "#34c759ff",
        keyboardFocusIndicator: "#0067f4ff",
        label: "#1d1d1fff",
        link: "#0068daff",
        orange: "#ff9500ff",
        placeholderText: "#8e8e93ff",
        purple: "#af52deff",
        quaternaryLabel: "#c7c7ccff",
        red: "#ff3b30ff",
        secondaryLabel: "#6e6e73ff",
        selectedControl: "#d9d9d9ff",
        selectedContentBackground: "#b3d7ffcc",
        selectedControlText: "#ffffffff",
        selectedText: "#000000ff",
        selectedTextBackground: "#b3d7ffcc",
        separator: "#3c3c434a",
        tertiaryLabel: "#8e8e93ff",
        text: "#1d1d1fff",
        textBackground: "#ffffffff",
        underPageBackground: "#e8e8e8ff",
        unemphasizedSelectedContentBackground: "#dcdcdcff",
        unemphasizedSelectedText: "#3a3a3cff",
        unemphasizedSelectedTextBackground: "#dcdcdcff",
        windowBackground: "#ecececff",
        windowFrameText: "#1d1d1fff",
      },
      increasedContrast: true,
      invertedColors: false,
      differentiateWithoutColor: true,
      reducedMotion: false,
    });

    expect(document.documentElement.style.getPropertyValue("--native-accent")).toBe("#007affff");
    expect(document.documentElement.style.getPropertyValue("--native-window-background")).toBe(
      "#ecececff",
    );
    expect(document.documentElement.dataset.increasedContrast).toBe("true");
    expect(document.documentElement.dataset.differentiateWithoutColor).toBe("true");
  });
});
