import { APPEARANCE_THEME_IDS } from "../../shared/appearance-contract";
import { MAX_THEME_BYTES, normalizeCustomTheme, type CustomTheme } from "../../shared/custom-theme";

/** Strip JSONC comments and trailing commas without touching quoted content. */
function jsonc(source: string): unknown {
  let output = "";
  let quoted = false;
  for (let index = 0; index < source.length; index++) {
    const char = source[index]!;
    if (quoted) {
      output += char;
      if (char === "\\") output += source[++index] ?? "";
      else if (char === '"') quoted = false;
    } else if (char === '"') {
      quoted = true;
      output += char;
    } else if (char === "/" && source[index + 1] === "/") {
      while (index < source.length && source[index] !== "\n") index++;
      output += "\n";
    } else if (char === "/" && source[index + 1] === "*") {
      const end = source.indexOf("*/", index + 2);
      if (end === -1) throw new Error("Unterminated JSON comment");
      index = end + 1;
      output += " ";
    } else output += char;
  }
  let clean = "";
  quoted = false;
  for (let index = 0; index < output.length; index++) {
    const char = output[index]!;
    if (quoted) {
      clean += char;
      if (char === "\\") clean += output[++index] ?? "";
      else if (char === '"') quoted = false;
    } else {
      if (char === '"') quoted = true;
      if (char === "," && /^\s*[}\]]/.test(output.slice(index + 1))) continue;
      clean += char;
    }
  }
  return JSON.parse(clean.replace(/^\uFEFF/, ""));
}

const VSCODE_COLORS: Record<string, keyof CustomTheme["colors"]> = {
  "editor.background": "background",
  "editor.foreground": "foreground",
  "editorWidget.background": "popover",
  "panel.background": "card",
  "button.background": "primary",
  "button.foreground": "primaryForeground",
  "button.secondaryBackground": "muted",
  descriptionForeground: "mutedForeground",
  "list.activeSelectionBackground": "accent",
  "list.activeSelectionForeground": "accentForeground",
  focusBorder: "ring",
  "panel.border": "border",
  "input.border": "input",
  "sideBar.background": "sidebar",
  "sideBar.foreground": "sidebarForeground",
  "sideBar.border": "sidebarBorder",
  "list.hoverBackground": "sidebarAccent",
  errorForeground: "destructive",
  "editorError.foreground": "destructive",
  "editorWarning.foreground": "warning",
  "editorInfo.foreground": "info",
  "gitDecoration.addedResourceForeground": "success",
  "editor.selectionBackground": "selection",
};

export function importCustomTheme(source: string, id: CustomTheme["id"]): CustomTheme {
  if (source.length > MAX_THEME_BYTES || new TextEncoder().encode(source).length > MAX_THEME_BYTES)
    throw new Error("Theme JSON must be 256 KB or smaller");
  let parsed: unknown;
  try {
    parsed = jsonc(source);
  } catch {
    throw new Error("Enter valid JSON or JSONC");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("Theme must be a JSON object");
  const input = parsed as Record<string, unknown>;
  if (input.format === "palot-theme" && input.version === 1) {
    const theme = normalizeCustomTheme({ ...(input.theme as object), id }, APPEARANCE_THEME_IDS);
    if (!theme) throw new Error("Invalid Palot theme colors, name, or token rules");
    return theme;
  }
  if (input.include)
    throw new Error("Theme includes are not supported. Import a self-contained theme JSON.");
  if (!input.colors || typeof input.colors !== "object" || Array.isArray(input.colors))
    throw new Error("VS Code theme must contain a colors object");
  const colors: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input.colors)) {
    const role = VSCODE_COLORS[key];
    if (role && value !== null) colors[role] = value;
  }
  if (!Object.keys(colors).length) throw new Error("No supported VS Code colors found");
  if (colors.background) colors.codeBackground = colors.background;
  if (colors.foreground) colors.codeForeground = colors.foreground;
  const theme = normalizeCustomTheme(
    {
      id,
      name: input.name ?? "Imported theme",
      scheme: input.type === "light" ? "light" : "dark",
      base: "vscode-plus",
      colors,
      tokenColors: input.tokenColors ?? [],
    },
    APPEARANCE_THEME_IDS,
  );
  if (!theme)
    throw new Error(
      "Invalid theme: use hex colors, a name up to 80 characters, and valid tokenColors (up to 2048 rules)",
    );
  return theme;
}

export function exportCustomTheme(theme: CustomTheme): string {
  return JSON.stringify({ format: "palot-theme", version: 1, theme }, null, 2);
}
