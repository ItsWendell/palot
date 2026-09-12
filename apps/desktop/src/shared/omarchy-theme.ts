/** Validated Omarchy palette, shared by native backgrounds and renderer surfaces. */
import type { AppearanceThemeVariant } from "./appearance-contract";

const COLOR_KEYS = [
  "background",
  "foreground",
  "accent",
  "selection",
  "muted",
  "dark_background",
  "lighter_background",
  "red",
  "green",
  "yellow",
  "blue",
  "magenta",
  "cyan",
  "bright_red",
  "bright_green",
  "bright_yellow",
  "bright_blue",
  "bright_magenta",
  "bright_cyan",
] as const;
type ColorKey = (typeof COLOR_KEYS)[number];
export interface OmarchyTheme {
  name: string;
  mode: "light" | "dark";
  colors: Partial<Record<ColorKey, string>> &
    Record<"background" | "foreground" | "accent", string>;
  font?: string;
  rounding?: number;
}

export function normalizeOmarchyTheme(value: unknown): OmarchyTheme | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Partial<OmarchyTheme>;
  if (input.mode !== "light" && input.mode !== "dark") return null;
  if (!input.colors || typeof input.colors !== "object") return null;
  const colors: Partial<Record<ColorKey, string>> = {};
  for (const key of COLOR_KEYS) {
    const color = input.colors[key];
    if (typeof color === "string" && /^#[\da-f]{6}$/i.test(color))
      colors[key] = color.toLowerCase();
  }
  if (!colors.background || !colors.foreground || !colors.accent) return null;
  return {
    name:
      typeof input.name === "string"
        ? [...input.name]
            .filter((character) => character.charCodeAt(0) >= 32)
            .join("")
            .slice(0, 100)
        : "Omarchy",
    mode: input.mode,
    colors: colors as OmarchyTheme["colors"],
    ...(typeof input.rounding === "number" && Number.isFinite(input.rounding) && input.rounding >= 0
      ? { rounding: Math.min(32, input.rounding) }
      : {}),
    ...(typeof input.font === "string" && /^[\p{L}\p{N} ._+-]{1,100}$/u.test(input.font)
      ? { font: input.font }
      : {}),
  };
}

export function parseOmarchyPalette(
  output: string,
  name: string,
  font?: string,
): OmarchyTheme | null {
  const values = Object.fromEntries(output.split("\n").map((line) => line.split("\t", 2)));
  return normalizeOmarchyTheme({ name, mode: values.mode, colors: values, font });
}

function rgb(color: string): number[] {
  return [1, 3, 5].map((start) => parseInt(color.slice(start, start + 2), 16));
}

function mix(a: string, b: string, weight: number): string {
  const end = rgb(b);
  return `#${rgb(a)
    .map((value, index) =>
      Math.round(value * (1 - weight) + end[index]! * weight)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

function luminance(color: string): number {
  const channels = rgb(color)
    .map((value) => value / 255)
    .map((value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
  return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
}

export function contrastRatio(a: string, b: string): number {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

function readable(color: string, background: string): string {
  if (contrastRatio(color, background) >= 4.5) return color;
  const target =
    contrastRatio("#ffffff", background) > contrastRatio("#000000", background)
      ? "#ffffff"
      : "#000000";
  for (let weight = 0.1; weight <= 1; weight += 0.1) {
    const candidate = mix(color, target, weight);
    if (contrastRatio(candidate, background) >= 4.5) return candidate;
  }
  return target;
}

export function omarchyCodeThemeName(theme: OmarchyTheme): string {
  // Content-addressed names prevent Shiki and worker caches from keeping an old palette.
  let hash = 2166136261;
  for (const char of JSON.stringify([theme.mode, theme.colors]))
    hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return `omarchy-${theme.mode}-${(hash >>> 0).toString(16)}`;
}

export function omarchyThemeVariant(theme: OmarchyTheme): AppearanceThemeVariant {
  const c = theme.colors;
  const bg = c.background;
  const fg = readable(c.foreground, bg);
  const surface = mix(bg, fg, 0.04);
  const selection = c.selection ?? mix(bg, c.accent, 0.25);
  const primary = readable(c.accent, bg);
  const border = mix(bg, fg, 0.2);
  const red = c.red ?? "#d46b6b";
  const green = c.green ?? "#78ac87";
  const yellow = c.yellow ?? "#c9a668";
  const blue = c.blue ?? c.accent;
  const magenta = c.magenta ?? "#b99bd1";
  const cyan = c.cyan ?? "#77bac0";
  return {
    nativeBackground: bg,
    codeTheme: omarchyCodeThemeName(theme),
    palette: {
      background: bg,
      foreground: fg,
      card: surface,
      popover: surface,
      primary,
      primaryForeground: readable(bg, primary),
      muted: surface,
      mutedForeground: readable(mix(bg, fg, 0.65), surface),
      accent: selection,
      accentForeground: readable(fg, selection),
      destructive: readable(red, bg),
      success: readable(green, bg),
      warning: readable(yellow, bg),
      info: readable(blue, bg),
      border,
      input: border,
      ring: primary,
      sidebar: bg,
      sidebarForeground: fg,
      sidebarAccent: selection,
      sidebarBorder: border,
      codeBackground: bg,
      codeForeground: fg,
      selection,
    },
    terminal: {
      background: bg,
      foreground: fg,
      cursor: fg,
      cursorAccent: bg,
      selectionBackground: selection,
      selectionForeground: readable(fg, selection),
      black: bg,
      red,
      green,
      yellow,
      blue,
      magenta,
      cyan,
      white: fg,
      brightBlack: mix(bg, fg, 0.55),
      brightRed: c.bright_red ?? red,
      brightGreen: c.bright_green ?? green,
      brightYellow: c.bright_yellow ?? yellow,
      brightBlue: c.bright_blue ?? blue,
      brightMagenta: c.bright_magenta ?? magenta,
      brightCyan: c.bright_cyan ?? cyan,
      brightWhite: fg,
    },
  };
}
