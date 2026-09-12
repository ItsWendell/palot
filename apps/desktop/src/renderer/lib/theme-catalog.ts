import { createThemeCatalog, createThemeResolver } from "@pierre/theming";
import { normalizeThemeColors } from "@pierre/theming/color";
import { createTheme, themes } from "@pierre/theming/themes";
import { registerCustomTheme } from "@pierre/diffs";
import type { ThemeRegistration } from "shiki";
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

const customThemes = builtinCodeThemes.map((theme) => {
  registerCustomTheme(theme.name, theme.load);
  return createTheme(theme);
});

export const codeThemeCatalog = createThemeCatalog({
  themes: [curatedThemes, ...customThemes],
  defaultLightThemeName: "pierre-light-soft",
  defaultDarkThemeName: "pierre-dark-soft",
});

const codeThemeResolver = createThemeResolver<ThemeRegistration>();
const normalizedCodeThemes = new Set<string>();
const omarchyThemes = new Map<string, ThemeRegistration>();

export function registerOmarchyCodeTheme(theme: OmarchyTheme): void {
  const name = omarchyCodeThemeName(theme);
  if (omarchyThemes.has(name)) return;
  const code = createOmarchyCodeTheme(theme);
  omarchyThemes.set(name, code);
  registerCustomTheme(name, async () => code);
}
codeThemeCatalog.registerInto(codeThemeResolver);

export async function resolveCodeTheme(name: string): Promise<ThemeRegistration> {
  const theme = omarchyThemes.get(name) ?? (await codeThemeResolver.resolveTheme(name));
  if (!normalizedCodeThemes.has(name)) {
    normalizeThemeColors(theme);
    normalizedCodeThemes.add(name);
  }
  return theme;
}

export async function prepareCodeThemes(preferences: AppearancePreferences): Promise<void> {
  if (preferences.omarchyTheme) registerOmarchyCodeTheme(preferences.omarchyTheme);
  const names = [
    effectiveCodeTheme(preferences, "light").name,
    effectiveCodeTheme(preferences, "dark").name,
  ];
  await Promise.all([...new Set(names)].map(resolveCodeTheme));
}
