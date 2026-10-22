import { createThemeCatalog } from "@pierre/theming";
import { createTheme, themes } from "@pierre/theming/themes";
import { registerCustomTheme, resolveTheme, type DiffsTheme } from "@pierre/diffs";
import { CODE_HIGHLIGHTER } from "./code-highlighter";
import { textMateToZedTheme } from "./code-theme-convert";
import type { AppearancePreferences } from "../../shared";
import { effectiveCodeTheme } from "../../shared";
import { builtinCodeThemes } from "./themes/builtin-code-themes";
import { createOmarchyCodeTheme } from "./omarchy-code-theme";
import { omarchyCodeThemeName, type OmarchyTheme } from "../../shared/omarchy-theme";

const curatedThemes = themes.pick([
  "pierre-light-soft",
  "pierre-dark-soft",
  "github-light",
  "github-dark",
  "ayu-dark",
  "catppuccin-latte",
  "catppuccin-mocha",
  "dracula",
  "everforest-light",
  "everforest-dark",
  "github-light-default",
  "github-dark-default",
  "gruvbox-light-medium",
  "gruvbox-dark-medium",
  "material-theme-darker",
  "monokai",
  "night-owl",
  "nord",
  "one-light",
  "one-dark-pro",
  "rose-pine-dawn",
  "rose-pine-moon",
  "solarized-light",
  "solarized-dark",
  "tokyo-night",
  "light-plus",
  "dark-plus",
  "min-light",
  "min-dark",
]);

// Curated themes ship as Zed themes in @pierre/highlights and resolve by name. Palot's own
// themes register Zed loaders, converted from their TextMate sources where needed.
const customThemes = builtinCodeThemes.map((theme) => {
  registerCustomTheme(theme.name, theme.load, "zed");
  return createTheme(theme);
});

export const codeThemeCatalog = createThemeCatalog({
  themes: [curatedThemes, ...customThemes],
  defaultLightThemeName: "pierre-light-soft",
  defaultDarkThemeName: "pierre-dark-soft",
});

const omarchyThemes = new Set<string>();

export function registerOmarchyCodeTheme(theme: OmarchyTheme): void {
  const name = omarchyCodeThemeName(theme);
  if (omarchyThemes.has(name)) return;
  const code = textMateToZedTheme(createOmarchyCodeTheme(theme), name);
  omarchyThemes.add(name);
  registerCustomTheme(name, async () => code, "zed");
}

/** Resolves a code theme the way every Palot code view renders it. */
export function resolveCodeTheme(name: string): Promise<DiffsTheme> {
  return resolveTheme(name, CODE_HIGHLIGHTER);
}

export async function prepareCodeThemes(preferences: AppearancePreferences): Promise<void> {
  if (preferences.omarchyTheme) registerOmarchyCodeTheme(preferences.omarchyTheme);
  const names = [
    effectiveCodeTheme(preferences, "light").name,
    effectiveCodeTheme(preferences, "dark").name,
  ];
  await Promise.all([...new Set(names)].map(resolveCodeTheme));
}
