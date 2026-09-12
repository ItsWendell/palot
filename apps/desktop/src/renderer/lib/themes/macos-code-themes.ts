import githubDarkDefault from "@shikijs/themes/github-dark-default";
import githubLightDefault from "@shikijs/themes/github-light-default";
import type { ThemeRegistration } from "shiki";

function macOSCodeTheme(
  source: ThemeRegistration,
  name: string,
  background: string,
  foreground: string,
): ThemeRegistration {
  return {
    ...source,
    name,
    colors: {
      ...source.colors,
      foreground,
      "editor.background": background,
      "editor.foreground": foreground,
      "editorGroupHeader.tabsBackground": background,
      "panel.background": background,
      "sideBar.background": background,
      "sideBar.foreground": foreground,
    },
  };
}

export const macOSCodeThemes = {
  light: macOSCodeTheme(githubLightDefault, "macos-code-light", "#ffffff", "#1d1d1f"),
  dark: macOSCodeTheme(githubDarkDefault, "macos-code-dark", "#1e1e1e", "#f5f5f7"),
};
