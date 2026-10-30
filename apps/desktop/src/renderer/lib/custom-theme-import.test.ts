import { expect, it } from "vitest";
import {
  appearanceTheme,
  DEFAULT_APPEARANCE_PREFERENCES,
  normalizeAppearancePreferences,
  parseAppearancePreferencesArgument,
  serializeAppearancePreferences,
} from "../../shared/appearance-contract";
import { MAX_THEME_BYTES, customCodeThemeName } from "../../shared/custom-theme";
import { textMateToZedTheme } from "./code-theme-convert";
import { exportCustomTheme, importCustomTheme } from "./custom-theme-import";

const fixture = `{
  // VS Code JSONC
  "name": "Ocean", "type": "dark",
  "colors": {"editor.background":"#112233", "editor.foreground":"#eeeeee", "button.background":"#66aaff", "sideBar.background":"#101820", "focusBorder":"#ffaa00", "errorForeground":"#ff6655",},
  "tokenColors": [{"scope":"keyword", "settings":{"foreground":"#ff9900", "fontStyle":"bold"}},],
}`;

it("imports UI colors and TextMate syntax, persists and round-trips exported themes", () => {
  const theme = importCustomTheme(fixture, "custom:ocean");
  const preferences = normalizeAppearancePreferences({
    ...DEFAULT_APPEARANCE_PREFERENCES,
    customThemes: [theme],
    darkTheme: theme.id,
  });
  const variant = appearanceTheme(preferences, "dark");
  expect(variant.palette).toMatchObject({
    background: "#112233",
    foreground: "#eeeeee",
    primary: "#66aaff",
    ring: "#ffaa00",
    destructive: "#ff6655",
  });
  expect(variant.codeTheme).toBe(customCodeThemeName(theme));
  expect(textMateToZedTheme({ tokenColors: theme.tokenColors }).style.syntax?.keyword).toEqual({
    color: "#ff9900",
    font_weight: 700,
  });
  expect(importCustomTheme(exportCustomTheme(theme), "custom:copy")).toEqual({
    ...theme,
    id: "custom:copy",
  });
  expect(normalizeAppearancePreferences({ ...preferences, customThemes: [] }).darkTheme).toBe(
    "palot",
  );
  expect(normalizeAppearancePreferences({ ...preferences, lightTheme: theme.id }).lightTheme).toBe(
    "palot",
  );
});

it("rejects oversized, malformed, external, or unsafe input without accepting CSS payloads", () => {
  for (const source of [
    "[1]",
    "{",
    "x".repeat(MAX_THEME_BYTES + 1),
    '{"include":"./base.json"}',
    '{"colors":{"editor.background":"url(https://example.com)"}}',
    '{"colors":{"editor.foreground":"#ffffff"},"tokenColors":"tokens.json"}',
    '{"colors":{"editor.foreground":"#ffffff"},"tokenColors":[{"settings":null}]}',
  ])
    expect(() => importCustomTheme(source, "custom:test")).toThrow();
  expect(
    importCustomTheme(
      '{"name":"// still a name", "colors":{"editor.background":"#abc"}}',
      "custom:test",
    ).name,
  ).toBe("// still a name");
});

it("keeps large imported syntax rules out of the native startup argument", () => {
  const theme = importCustomTheme(
    JSON.stringify({
      colors: { "editor.background": "#112233" },
      tokenColors: Array.from({ length: 1500 }, () => ({
        scope: "keyword.control.example-language",
        settings: { foreground: "#ffaa00", fontStyle: "bold" },
      })),
    }),
    "custom:large",
  );
  const preferences = normalizeAppearancePreferences({
    ...DEFAULT_APPEARANCE_PREFERENCES,
    customThemes: [theme],
    darkTheme: theme.id,
  });
  expect(preferences.customThemes[0]?.tokenColors).toHaveLength(1500);
  const argument = serializeAppearancePreferences(preferences);
  expect(argument.length).toBeLessThan(64 * 1024);
  const startup = parseAppearancePreferencesArgument([argument]);
  expect(startup.darkTheme).toBe(theme.id);
  expect(startup.customThemes[0]?.colors.background).toBe("#112233");
  expect(startup.customThemes[0]?.tokenColors).toBeUndefined();
});
