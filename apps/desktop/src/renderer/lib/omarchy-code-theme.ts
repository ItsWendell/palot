import type { ThemeRegistration } from "shiki";
import { omarchyThemeVariant, type OmarchyTheme } from "../../shared/omarchy-theme";

export function createOmarchyCodeTheme(theme: OmarchyTheme): ThemeRegistration {
  const { palette: p, terminal: t, codeTheme } = omarchyThemeVariant(theme);
  return {
    name: codeTheme,
    type: theme.mode,
    colors: {
      foreground: p.foreground,
      "editor.background": p.background,
      "editor.foreground": p.foreground,
      "editor.selectionBackground": p.selection,
      "editor.lineHighlightBackground": p.card,
      "editorLineNumber.foreground": p.mutedForeground,
      "sideBar.background": p.sidebar,
      "sideBar.foreground": p.sidebarForeground,
      "list.activeSelectionBackground": p.selection,
      "list.activeSelectionForeground": p.accentForeground,
      "list.hoverBackground": p.card,
      "gitDecoration.addedResourceForeground": p.success,
      "gitDecoration.modifiedResourceForeground": p.warning,
      "gitDecoration.deletedResourceForeground": p.destructive,
      "diffEditor.insertedTextBackground": `${t.green}25`,
      "diffEditor.removedTextBackground": `${t.red}25`,
    },
    tokenColors: [
      {
        scope: ["comment", "punctuation.definition.comment"],
        settings: { foreground: p.mutedForeground },
      },
      { scope: ["string", "constant.other.symbol"], settings: { foreground: p.success } },
      { scope: ["keyword", "storage"], settings: { foreground: p.primary } },
      { scope: ["constant.numeric", "constant.language"], settings: { foreground: p.warning } },
      { scope: ["entity.name.function", "support.function"], settings: { foreground: p.info } },
      {
        scope: ["entity.name.type", "support.type", "entity.name.tag"],
        settings: { foreground: t.cyan },
      },
      { scope: ["invalid"], settings: { foreground: p.destructive } },
    ],
  };
}
