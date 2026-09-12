import { describe, expect, it } from "vitest";
import {
  contrastRatio,
  normalizeOmarchyTheme,
  omarchyCodeThemeName,
  omarchyThemeVariant,
  parseOmarchyPalette,
} from "./omarchy-theme";

describe("Omarchy palettes", () => {
  it("rejects partial and executable-looking palette values", () => {
    expect(parseOmarchyPalette("mode\tdark\nbackground\t#000000", "test")).toBeNull();
    expect(
      normalizeOmarchyTheme({
        mode: "dark",
        colors: { background: "url(file:///tmp/a)", foreground: "#ffffff", accent: "#ff0000" },
      }),
    ).toBeNull();
  });

  it("resolves a dark palette into readable surfaces, terminal colors, and a stable code identity", () => {
    const theme = parseOmarchyPalette(
      "mode\tdark\nbackground\t#0c0b0c\nforeground\t#FAFCFB\naccent\t#b59790\nmuted\t#584e51\nyellow\t#6b5e73",
      "custom",
      "JetBrainsMono Nerd Font",
    )!;
    const variant = omarchyThemeVariant(theme);
    expect(theme.font).toBe("JetBrainsMono Nerd Font");
    expect(variant.nativeBackground).toBe("#0c0b0c");
    expect(
      contrastRatio(variant.palette.mutedForeground, variant.palette.card),
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      contrastRatio(variant.palette.warning, variant.palette.background),
    ).toBeGreaterThanOrEqual(4.5);
    expect(variant.terminal.background).toBe(variant.nativeBackground);
    expect(omarchyCodeThemeName({ ...theme, name: "renamed" })).toBe(variant.codeTheme);
    expect(
      omarchyCodeThemeName({ ...theme, colors: { ...theme.colors, accent: "#aaff00" } }),
    ).not.toBe(variant.codeTheme);
  });

  it("retains readable text in a light palette", () => {
    const theme = parseOmarchyPalette(
      "mode\tlight\nbackground\t#ffffff\nforeground\t#eeeeee\naccent\t#aaccff",
      "light",
    )!;
    const { palette } = omarchyThemeVariant(theme);
    expect(contrastRatio(palette.foreground, palette.background)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(palette.primaryForeground, palette.primary)).toBeGreaterThanOrEqual(4.5);
  });
});
