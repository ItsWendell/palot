import type {
  AppearanceColorScheme,
  AppearanceThemePalette,
  BuiltinAppearanceThemeID,
} from "./appearance-contract";

export const MAX_THEME_BYTES = 256 * 1024;
export const MAX_CUSTOM_THEMES = 32;
export interface CustomTokenRule {
  scope?: string | string[];
  settings: { foreground?: string; background?: string; fontStyle?: string };
}
export interface CustomTheme {
  id: `custom:${string}`;
  name: string;
  scheme: AppearanceColorScheme;
  base: BuiltinAppearanceThemeID;
  colors: Partial<AppearanceThemePalette>;
  tokenColors?: CustomTokenRule[];
}

export const THEME_COLOR_ROLES = [
  "background",
  "foreground",
  "card",
  "popover",
  "primary",
  "primaryForeground",
  "muted",
  "mutedForeground",
  "accent",
  "accentForeground",
  "destructive",
  "success",
  "warning",
  "info",
  "border",
  "input",
  "ring",
  "sidebar",
  "sidebarForeground",
  "sidebarPrimary",
  "sidebarPrimaryForeground",
  "sidebarAccent",
  "sidebarBorder",
  "codeBackground",
  "codeForeground",
  "selection",
] as const satisfies readonly (keyof AppearanceThemePalette)[];

export function isThemeColor(value: unknown): value is string {
  return (
    typeof value === "string" && /^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(value)
  );
}

/** Only literal colors and bounded TextMate rules cross the native preference boundary. */
export function normalizeCustomTheme(
  value: unknown,
  bases: readonly BuiltinAppearanceThemeID[],
): CustomTheme | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (
    typeof input.id !== "string" ||
    !/^custom:[a-zA-Z0-9-]{1,80}$/.test(input.id) ||
    typeof input.name !== "string" ||
    !input.name.trim() ||
    input.name.length > 80 ||
    (input.scheme !== "light" && input.scheme !== "dark") ||
    !bases.includes(input.base as BuiltinAppearanceThemeID) ||
    !input.colors ||
    typeof input.colors !== "object" ||
    Array.isArray(input.colors)
  )
    return null;
  const colors: CustomTheme["colors"] = {};
  for (const [key, color] of Object.entries(input.colors)) {
    if (
      !THEME_COLOR_ROLES.includes(key as (typeof THEME_COLOR_ROLES)[number]) ||
      !isThemeColor(color)
    )
      return null;
    colors[key as keyof AppearanceThemePalette] = color;
  }
  let tokenColors: CustomTokenRule[] | undefined;
  if (input.tokenColors !== undefined) {
    if (!Array.isArray(input.tokenColors) || input.tokenColors.length > 2048) return null;
    tokenColors = [];
    for (const item of input.tokenColors) {
      if (!item || typeof item !== "object" || !item.settings || typeof item.settings !== "object")
        return null;
      const scope = item.scope;
      const validScope = (value: unknown) => typeof value === "string" && value.length <= 2048;
      if (
        scope !== undefined &&
        !(
          validScope(scope) ||
          (Array.isArray(scope) && scope.length <= 64 && scope.every(validScope))
        )
      )
        return null;
      const settings: CustomTokenRule["settings"] = {};
      for (const key of ["foreground", "background"] as const) {
        if (item.settings[key] !== undefined) {
          if (!isThemeColor(item.settings[key])) return null;
          settings[key] = item.settings[key];
        }
      }
      if (item.settings.fontStyle !== undefined) {
        if (
          typeof item.settings.fontStyle !== "string" ||
          !/^(?:(?:italic|bold|underline|strikethrough)\s*)*$/.test(item.settings.fontStyle)
        )
          return null;
        settings.fontStyle = item.settings.fontStyle;
      }
      tokenColors.push({ ...(scope !== undefined ? { scope } : {}), settings });
    }
  }
  const theme: CustomTheme = {
    id: input.id as CustomTheme["id"],
    name: input.name.trim(),
    scheme: input.scheme,
    base: input.base as BuiltinAppearanceThemeID,
    colors,
    ...(tokenColors ? { tokenColors } : {}),
  };
  return new TextEncoder().encode(JSON.stringify(theme)).length <= MAX_THEME_BYTES ? theme : null;
}

export function customCodeThemeName(theme: CustomTheme): string {
  let hash = 2166136261;
  for (const character of JSON.stringify(theme))
    hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return `palot-${theme.id.replace(":", "-")}-${(hash >>> 0).toString(36)}`;
}
