import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  APPEARANCE_THEMES,
  APPEARANCE_THEME_IDS,
  APPEARANCE_STORED_ARGUMENT,
  DEFAULT_APPEARANCE_PREFERENCES,
  appearanceUpdateRequiresRestart,
  effectiveAppearanceTreatment,
  effectiveCodeTheme,
  effectiveNativeGlass,
  hasStoredAppearancePreferencesArgument,
  normalizeAppearancePreferences,
  parseAppearancePreferencesArgument,
  serializeAppearancePreferences,
} from "./appearance-contract";

describe("appearance preferences", () => {
  it("repairs invalid values and clamps typography and opacity", () => {
    expect(
      normalizeAppearancePreferences({
        mode: "invalid",
        lightTheme: "github",
        darkTheme: "missing",
        glassOpacity: 12,
        contentOpacity: 10,
        nativeGlassTint: 80,
        lightContrast: -20,
        darkContrast: 200,
        uiFontSize: 99,
        codeFontSize: 1,
        terminalFontSize: 30,
      }),
    ).toMatchObject({
      version: 3,
      mode: "system",
      lightTheme: "github",
      darkTheme: "palot",
      codeFont: "system",
      glassOpacity: 30,
      contentOpacity: 55,
      nativeGlassTint: 30,
      lightContrast: 0,
      darkContrast: 100,
      uiFontSize: 19,
      codeFontSize: 10,
      terminalFontSize: 22,
    });
  });

  it("upgrades the contract without changing interface sizes", () => {
    expect(
      normalizeAppearancePreferences({
        ...DEFAULT_APPEARANCE_PREFERENCES,
        version: 1,
        uiFontSize: 16,
      }),
    ).toMatchObject({ version: 3, uiFontSize: 16 });
    expect(
      normalizeAppearancePreferences({
        ...DEFAULT_APPEARANCE_PREFERENCES,
        version: 1,
        uiFontSize: 14,
      }),
    ).toMatchObject({ version: 3, uiFontSize: 14 });
  });

  it("migrates legacy defaults to theme values while preserving new explicit overrides", () => {
    expect(
      normalizeAppearancePreferences({
        ...DEFAULT_APPEARANCE_PREFERENCES,
        version: 2,
        glassOpacity: 82,
        nativeGlassTint: 0,
      }),
    ).toMatchObject({ version: 3, glassOpacity: "theme", nativeGlassTint: "theme" });
    expect(
      normalizeAppearancePreferences({
        ...DEFAULT_APPEARANCE_PREFERENCES,
        glassOpacity: 82,
        nativeGlassTint: 0,
      }),
    ).toMatchObject({ glassOpacity: 82, nativeGlassTint: 0 });
  });

  it("repairs themes selected for an unsupported color scheme", () => {
    expect(
      normalizeAppearancePreferences({
        ...DEFAULT_APPEARANCE_PREFERENCES,
        lightTheme: "nord",
        darkTheme: "proof",
      }),
    ).toMatchObject({ lightTheme: "palot", darkTheme: "palot" });
  });

  it("round-trips the bounded preload argument", () => {
    const preferences = {
      ...DEFAULT_APPEARANCE_PREFERENCES,
      mode: "dark" as const,
      darkTheme: "github" as const,
    };
    expect(
      parseAppearancePreferencesArgument([serializeAppearancePreferences(preferences)]),
    ).toEqual(preferences);
    expect(hasStoredAppearancePreferencesArgument([APPEARANCE_STORED_ARGUMENT])).toBe(true);
  });

  it("falls back safely when the preload argument is corrupt", () => {
    expect(parseAppearancePreferencesArgument(["--palot-appearance=%7Bbroken"])).toEqual(
      DEFAULT_APPEARANCE_PREFERENCES,
    );
  });

  it("lets code follow each app palette independently", () => {
    const preferences = {
      ...DEFAULT_APPEARANCE_PREFERENCES,
      lightTheme: "github" as const,
      darkTheme: "vercel" as const,
    };
    expect(effectiveCodeTheme(preferences, "light").name).toBe("github-light-default");
    expect(effectiveCodeTheme(preferences, "dark").name).toBe("vercel-dark");
  });

  it("uses OpenCode's matching code themes", () => {
    const preferences = {
      ...DEFAULT_APPEARANCE_PREFERENCES,
      lightTheme: "opencode" as const,
      darkTheme: "opencode" as const,
    };
    expect(effectiveCodeTheme(preferences, "light").name).toBe("opencode-light");
    expect(effectiveCodeTheme(preferences, "dark").name).toBe("opencode-dark");
  });

  it("resolves Codex's semantic text and menu-vibrancy sidebar treatment", () => {
    const preferences = {
      ...DEFAULT_APPEARANCE_PREFERENCES,
      darkTheme: "codex" as const,
    };

    expect(effectiveAppearanceTreatment(preferences, "dark")).toMatchObject({
      text: {
        primary: "#dfdfdf",
        secondary: "rgb(255 255 255 / 70%)",
        tertiary: "rgb(255 255 255 / 50%)",
      },
      sidebar: {
        surface: "#212121",
        opaqueSurface: "#171717",
        material: "translucent",
        opacity: 55,
        blendSpace: "srgb",
        blur: 0,
        saturation: 1,
      },
      surfaces: {
        composer: { blendSpace: "srgb", blur: 0, saturation: 1 },
        inspector: { blendSpace: "srgb", blur: 0, saturation: 1 },
        popover: { blendSpace: "srgb", blur: 0, saturation: 1 },
      },
      native: { backdrop: "vibrancy-menu", tint: 0 },
    });
  });

  it("lets explicit material and surface tint preferences override theme treatment", () => {
    const treatment = effectiveAppearanceTreatment(
      {
        ...DEFAULT_APPEARANCE_PREFERENCES,
        darkTheme: "codex",
        glassOpacity: 76,
        nativeGlassTint: 12,
        sidebarMaterial: "solid",
        windowMaterial: "opaque",
      },
      "dark",
    );

    expect(treatment.sidebar).toMatchObject({ material: "solid", opacity: 55 });
    expect(treatment.surfaces).toMatchObject({
      inspector: { opacity: 86 },
      composer: { opacity: 81 },
      popover: { opacity: 91 },
    });
    expect(treatment.native).toEqual({ backdrop: "opaque", tint: 12 });
  });

  it("keeps sidebar material theme-owned while giving low surface tint role-aware floors", () => {
    const treatment = effectiveAppearanceTreatment(
      {
        ...DEFAULT_APPEARANCE_PREFERENCES,
        darkTheme: "macos",
        glassOpacity: 30,
      },
      "dark",
    );

    expect(treatment.sidebar.opacity).toBe(67);
    expect(treatment.surfaces).toMatchObject({
      composer: { opacity: 35 },
      inspector: { opacity: 40 },
      popover: { opacity: 45 },
    });
  });

  it("requires a restart when an automatic theme switch changes native treatment", () => {
    const palot = { ...DEFAULT_APPEARANCE_PREFERENCES, darkTheme: "palot" as const };
    const codex = { ...DEFAULT_APPEARANCE_PREFERENCES, darkTheme: "codex" as const };

    expect(appearanceUpdateRequiresRestart(palot, "dark", codex, "dark")).toBe(true);
    expect(
      appearanceUpdateRequiresRestart(
        { ...palot, windowMaterial: "opaque" },
        "dark",
        { ...codex, windowMaterial: "opaque" },
        "dark",
      ),
    ).toBe(false);
    expect(
      appearanceUpdateRequiresRestart(
        { ...palot, nativeGlassTint: 0 },
        "dark",
        { ...palot, nativeGlassTint: 30 },
        "dark",
      ),
    ).toBe(false);
  });

  it("gives macOS an explicit native treatment without changing its adaptive behavior", () => {
    const treatment = effectiveAppearanceTreatment(
      { ...DEFAULT_APPEARANCE_PREFERENCES, darkTheme: "macos" },
      "dark",
    );

    expect(treatment).toMatchObject({
      text: {
        primary: "#f5f5f7",
        secondary: "#98989d",
      },
      sidebar: {
        surface: "#282828",
        material: "automatic",
        opacity: 67,
        blur: 22,
        saturation: 1.14,
      },
      surfaces: {
        inspector: { blur: 20, saturation: 1.8 },
        composer: { blur: 20, saturation: 1.8 },
        popover: { blur: 20, saturation: 1.8 },
      },
      native: { backdrop: "adaptive", tint: 0 },
    });

    expect(
      effectiveAppearanceTreatment(
        { ...DEFAULT_APPEARANCE_PREFERENCES, lightTheme: "macos" },
        "light",
      ).native,
    ).toEqual({ backdrop: "adaptive", tint: 30 });
  });

  it("matches Cursor Agent's independent light and dark glass layers", () => {
    const light = effectiveAppearanceTreatment(
      { ...DEFAULT_APPEARANCE_PREFERENCES, lightTheme: "cursor" },
      "light",
    );
    const dark = effectiveAppearanceTreatment(
      { ...DEFAULT_APPEARANCE_PREFERENCES, darkTheme: "cursor" },
      "dark",
    );

    expect(light).toMatchObject({
      sidebar: { material: "translucent", opacity: 27, blur: 0, saturation: 1 },
      surfaces: {
        inspector: { opacity: 84, blur: 0, saturation: 1 },
        composer: { opacity: 84, blur: 0, saturation: 1 },
        popover: { opacity: 84, blur: 0, saturation: 1 },
      },
      native: { backdrop: "vibrancy-sidebar", tint: 0 },
    });
    expect(dark).toMatchObject({
      sidebar: { material: "translucent", opacity: 59, blur: 0, saturation: 1 },
      surfaces: {
        inspector: { opacity: 76, blur: 0, saturation: 1 },
        composer: { opacity: 76, blur: 0, saturation: 1 },
        popover: { opacity: 76, blur: 0, saturation: 1 },
      },
      native: { backdrop: "vibrancy-sidebar", tint: 0 },
    });
  });

  it("matches Grok's opaque Sand surfaces and semantic text hierarchy", () => {
    const treatment = effectiveAppearanceTreatment(
      { ...DEFAULT_APPEARANCE_PREFERENCES, darkTheme: "grok" },
      "dark",
    );

    expect(APPEARANCE_THEMES.grok.dark).toMatchObject({
      nativeBackground: "#0b0b0b",
      palette: { background: "#070707", sidebar: "#111111", popover: "#181818" },
    });
    expect(treatment).toMatchObject({
      text: { primary: "#fcfcfc", secondary: "#fcfcfc99", tertiary: "#fcfcfc66" },
      sidebar: { material: "solid", opacity: 100, blur: 0, saturation: 1 },
      surfaces: {
        inspector: { opacity: 100, surface: "#151515", opaqueSurface: "#151515" },
        composer: { opacity: 100, surface: "#151515", opaqueSurface: "#151515" },
        popover: { opacity: 100, surface: "#181818", opaqueSurface: "#181818" },
      },
      native: { backdrop: "opaque", tint: 0 },
    });
  });

  it("keeps the complete built-in catalog and its native scheme availability", () => {
    expect(APPEARANCE_THEME_IDS).toHaveLength(35);
    expect(Object.keys(APPEARANCE_THEMES).sort()).toEqual([...APPEARANCE_THEME_IDS].sort());
    expect(APPEARANCE_THEMES.proof.light).toBeDefined();
    expect(APPEARANCE_THEMES.proof.dark).toBeUndefined();
    expect(APPEARANCE_THEMES.nord.light).toBeUndefined();
    expect(APPEARANCE_THEMES.nord.dark).toBeDefined();
    for (const theme of Object.values(APPEARANCE_THEMES)) {
      expect(theme.light ?? theme.dark, theme.name).toBeDefined();
    }
  });

  it("preserves the pre-consolidation palette, terminal, syntax IDs, and native treatments", () => {
    // Captured from the existing catalog before the palette helper refactor.
    // Descriptions are UI copy, not part of this color/selection compatibility contract.
    const catalog = Object.fromEntries(
      Object.entries(APPEARANCE_THEMES).map(([id, { description: _description, ...theme }]) => [
        id,
        theme,
      ]),
    );
    expect(createHash("sha256").update(JSON.stringify(catalog)).digest("hex")).toBe(
      "164cf97c70b9f89e9ac155455132a680477a2c005161e6aa7fa7b9028b45bcee",
    );
  });

  it("round-trips saved selections for every supported built-in theme variant", () => {
    for (const theme of Object.values(APPEARANCE_THEMES)) {
      for (const scheme of ["light", "dark"] as const) {
        const variant = theme[scheme];
        if (!variant) continue;
        const preferences = {
          ...DEFAULT_APPEARANCE_PREFERENCES,
          [`${scheme}Theme`]: theme.id,
        };
        const restored = parseAppearancePreferencesArgument([
          serializeAppearancePreferences(preferences),
        ]);
        expect(restored, `${theme.id}/${scheme}`).toEqual(preferences);
        expect(effectiveCodeTheme(restored, scheme).name).toBe(variant.codeTheme);
      }
    }
  });

  it("uses TanStack's semantic palette and matching code themes", () => {
    expect(APPEARANCE_THEMES.tanstack.light).toMatchObject({
      codeTheme: "tanstack-light",
      palette: {
        background: "#ffffff",
        foreground: "#111111",
        primary: "#003e53",
        success: "#1d4226",
      },
    });
    expect(APPEARANCE_THEMES.tanstack.dark).toMatchObject({
      codeTheme: "tanstack-dark",
      palette: {
        background: "#111111",
        foreground: "#ffffff",
        primary: "#3aa3c4",
        success: "#69bc75",
      },
    });
  });

  it("keeps each macOS color scheme coherent when the system uses the other scheme", () => {
    expect(APPEARANCE_THEMES.macos.light?.palette).toMatchObject({
      background: "#ffffff",
      foreground: "#1d1d1f",
      sidebar: "#f2f2f2",
      sidebarForeground: "#1d1d1f",
      sidebarBorder: "#d1d1d6",
    });
    expect(APPEARANCE_THEMES.macos.dark?.palette).toMatchObject({
      background: "#1e1e1e",
      foreground: "#f5f5f7",
      sidebar: "#282828",
      sidebarForeground: "#f5f5f7",
      sidebarBorder: "#48484a",
    });
    expect(APPEARANCE_THEMES.macos.light?.codeTheme).toBe("macos-code-light");
    expect(APPEARANCE_THEMES.macos.dark?.codeTheme).toBe("macos-code-dark");
  });

  it("uses Codex's shipped default liquid glass configuration", () => {
    const preferences = {
      ...DEFAULT_APPEARANCE_PREFERENCES,
      lightTheme: "codex" as const,
      darkTheme: "codex" as const,
    };

    expect(effectiveNativeGlass(preferences, "light")).toEqual({
      variant: "regular",
    });
  });

  it("allows user glass settings to override the active theme", () => {
    expect(
      effectiveNativeGlass(
        {
          ...DEFAULT_APPEARANCE_PREFERENCES,
          nativeGlassVariant: "clear",
        },
        "dark",
      ),
    ).toEqual({ variant: "clear" });
  });
});
