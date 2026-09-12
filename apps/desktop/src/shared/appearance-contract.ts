/** Serializable appearance preferences and built-in theme catalog shared by main and renderer. */
import { normalizeOmarchyTheme, omarchyThemeVariant, type OmarchyTheme } from "./omarchy-theme";

export const APPEARANCE_MODES = ["system", "light", "dark"] as const;
export type AppearanceMode = (typeof APPEARANCE_MODES)[number];
export type AppearanceColorScheme = Exclude<AppearanceMode, "system">;

export const APPEARANCE_THEME_IDS = [
  "palot",
  "macos",
  "opencode",
  "tanstack",
  "pierre",
  "absolutely",
  "ayu",
  "catppuccin",
  "codex",
  "cursor",
  "dracula",
  "everforest",
  "github",
  "grok",
  "gruvbox",
  "linear",
  "lobster",
  "material",
  "matrix",
  "monokai",
  "night-owl",
  "nord",
  "notion",
  "one",
  "oscurange",
  "proof",
  "raycast",
  "rose-pine",
  "sentry",
  "solarized",
  "temple",
  "tokyo-night",
  "vercel",
  "vscode-plus",
  "xcode",
] as const;
export type AppearanceThemeID = (typeof APPEARANCE_THEME_IDS)[number];

export const CODE_THEME_IDS = ["follow", "pierre", "github", "min"] as const;
export type CodeThemeID = (typeof CODE_THEME_IDS)[number];

export const UI_FONT_IDS = [
  "system",
  "inter",
  "dm-sans",
  "ibm-plex-sans",
  "geist",
  "sf-pro",
  "avenir",
  "segoe",
] as const;
export type UIFontID = (typeof UI_FONT_IDS)[number];

export const CODE_FONT_IDS = [
  "system",
  "jetbrains-mono",
  "fira-code",
  "geist-mono",
  "sf-mono",
  "menlo",
  "monaco",
  "consolas",
] as const;
export type CodeFontID = (typeof CODE_FONT_IDS)[number];

export interface AppearanceFontOption {
  name: string;
  css: string;
  localFamilies: readonly string[];
  availability: "always" | "darwin" | "probe";
  source: "system" | "bundled";
}

export const WINDOW_MATERIALS = ["automatic", "opaque", "native"] as const;
export type WindowMaterialPreference = (typeof WINDOW_MATERIALS)[number];

export const SIDEBAR_MATERIALS = ["automatic", "solid", "translucent", "transparent"] as const;
export type SidebarMaterialPreference = (typeof SIDEBAR_MATERIALS)[number];

export type AppearanceNativeBackdrop =
  | "adaptive"
  | "liquid-glass"
  | "vibrancy-menu"
  | "vibrancy-sidebar"
  | "opaque";

export const NATIVE_GLASS_VARIANTS = ["regular", "clear"] as const;
export type NativeGlassVariant = (typeof NATIVE_GLASS_VARIANTS)[number];

export const NATIVE_GLASS_VARIANT_VALUES: Readonly<Record<NativeGlassVariant, number>> = {
  regular: 0,
  clear: 1,
};

export type NativeGlassVariantPreference = "theme" | NativeGlassVariant;
export type ThemeNumericPreference = "theme" | number;

export interface AppearanceNativeGlass {
  variant: NativeGlassVariant;
}

export const DEFAULT_NATIVE_GLASS: AppearanceNativeGlass = Object.freeze({
  variant: "regular",
});

export interface AppearancePreferences {
  version: 3;
  source: "palot" | "system";
  systemPalette: "macos" | "omarchy" | null;
  followOmarchyFont: boolean;
  alwaysShowScrollbars: boolean;
  linuxBackgroundOpacity: number;
  omarchyTheme: OmarchyTheme | null;
  mode: AppearanceMode;
  lightTheme: AppearanceThemeID;
  darkTheme: AppearanceThemeID;
  lightCodeTheme: CodeThemeID;
  darkCodeTheme: CodeThemeID;
  uiFont: UIFontID;
  codeFont: CodeFontID;
  uiFontSize: number;
  codeFontSize: number;
  terminalFontSize: number;
  lightContrast: number;
  darkContrast: number;
  glassOpacity: ThemeNumericPreference;
  contentOpacity: number;
  nativeGlassTint: ThemeNumericPreference;
  nativeGlassVariant: NativeGlassVariantPreference;
  windowMaterial: WindowMaterialPreference;
  sidebarMaterial: SidebarMaterialPreference;
}

export const DEFAULT_APPEARANCE_PREFERENCES: AppearancePreferences = Object.freeze({
  version: 3,
  source: "palot",
  systemPalette: null,
  followOmarchyFont: false,
  alwaysShowScrollbars: false,
  linuxBackgroundOpacity: 100,
  omarchyTheme: null,
  mode: "system",
  lightTheme: "palot",
  darkTheme: "palot",
  lightCodeTheme: "follow",
  darkCodeTheme: "follow",
  uiFont: "system",
  codeFont: "system",
  uiFontSize: 14,
  codeFontSize: 12,
  terminalFontSize: 13,
  lightContrast: 50,
  darkContrast: 50,
  glassOpacity: "theme",
  contentOpacity: 100,
  nativeGlassTint: "theme",
  nativeGlassVariant: "theme",
  windowMaterial: "automatic",
  sidebarMaterial: "automatic",
});

export interface AppearanceThemePalette {
  background: string;
  foreground: string;
  card: string;
  popover: string;
  primary: string;
  primaryForeground: string;
  muted: string;
  mutedForeground: string;
  accent: string;
  accentForeground: string;
  destructive: string;
  success: string;
  warning: string;
  info: string;
  border: string;
  input: string;
  ring: string;
  sidebar: string;
  sidebarForeground: string;
  sidebarPrimary?: string;
  sidebarPrimaryForeground?: string;
  sidebarAccent: string;
  sidebarBorder: string;
  codeBackground: string;
  codeForeground: string;
  selection: string;
}

export interface AppearanceTextTreatment {
  primary: string;
  secondary: string;
  tertiary: string;
  sidebarPrimary: string;
  sidebarSecondary: string;
  sidebarTertiary: string;
}

export const APPEARANCE_BLEND_SPACES = ["srgb", "oklch"] as const;
export type AppearanceBlendSpace = (typeof APPEARANCE_BLEND_SPACES)[number];

export interface AppearanceSurfaceRecipe {
  surface: string;
  opaqueSurface: string;
  opacity: number;
  blendSpace: AppearanceBlendSpace;
  blur: number;
  saturation: number;
}

export interface AppearanceSidebarTreatment extends AppearanceSurfaceRecipe {
  material: SidebarMaterialPreference;
  hover: string;
  selected: string;
}

export interface AppearanceNativeTreatment {
  backdrop: AppearanceNativeBackdrop;
  tint: number;
}

export interface AppearanceInteractionTreatment {
  hover: string;
  pressed: string;
  selected: string;
  selectedInactive: string;
  disabledForeground: string;
  placeholderForeground: string;
  linkForeground: string;
}

export interface AppearanceShapeTreatment {
  controlRadius: string;
  compactControlRadius: string;
  surfaceRadius: string;
  popoverRadius: string;
}

export interface AppearanceSurfaceTreatment {
  inspector: AppearanceSurfaceRecipe;
  composer: AppearanceSurfaceRecipe;
  popover: AppearanceSurfaceRecipe;
}

export interface AppearanceThemeSurfaceTreatment {
  inspector?: Partial<AppearanceSurfaceRecipe>;
  composer?: Partial<AppearanceSurfaceRecipe>;
  popover?: Partial<AppearanceSurfaceRecipe>;
}

export interface AppearanceThemeTreatment {
  text?: Partial<AppearanceTextTreatment>;
  interaction?: Partial<AppearanceInteractionTreatment>;
  shape?: Partial<AppearanceShapeTreatment>;
  sidebar?: Partial<AppearanceSidebarTreatment>;
  surfaces?: AppearanceThemeSurfaceTreatment;
  native?: Partial<AppearanceNativeTreatment>;
}

export interface ResolvedAppearanceTreatment {
  text: AppearanceTextTreatment;
  interaction: AppearanceInteractionTreatment;
  shape: AppearanceShapeTreatment;
  sidebar: AppearanceSidebarTreatment;
  surfaces: AppearanceSurfaceTreatment;
  native: AppearanceNativeTreatment;
}

export interface AppearanceTerminalPalette {
  background: string;
  foreground: string;
  cursor: string;
  cursorAccent: string;
  selectionBackground: string;
  selectionForeground: string;
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightMagenta: string;
  brightCyan: string;
  brightWhite: string;
}

export interface NativeSystemColors {
  accent: string;
  blue: string;
  control: string;
  controlBackground: string;
  controlText: string;
  disabledControlText: string;
  green: string;
  keyboardFocusIndicator: string;
  label: string;
  link: string;
  orange: string;
  placeholderText: string;
  purple: string;
  quaternaryLabel: string;
  red: string;
  secondaryLabel: string;
  selectedControl: string;
  selectedContentBackground: string;
  selectedControlText: string;
  selectedText: string;
  selectedTextBackground: string;
  separator: string;
  tertiaryLabel: string;
  text: string;
  textBackground: string;
  underPageBackground: string;
  unemphasizedSelectedContentBackground: string;
  unemphasizedSelectedText: string;
  unemphasizedSelectedTextBackground: string;
  windowBackground: string;
  windowFrameText: string;
}

export interface NativeSystemAppearance {
  colors: NativeSystemColors;
  increasedContrast: boolean;
  invertedColors: boolean;
  differentiateWithoutColor: boolean;
  reducedMotion: boolean;
}

export interface AppearanceThemeVariant {
  palette: AppearanceThemePalette;
  terminal: AppearanceTerminalPalette;
  codeTheme: string;
  nativeBackground: string;
  nativeGlass?: AppearanceNativeGlass;
  treatment?: AppearanceThemeTreatment;
}

export interface AppearanceThemeDefinition {
  id: AppearanceThemeID;
  name: string;
  description: string;
  light?: AppearanceThemeVariant;
  dark?: AppearanceThemeVariant;
}

function terminal(
  background: string,
  foreground: string,
  colors: readonly [
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
  ],
): AppearanceTerminalPalette {
  return {
    background,
    foreground,
    cursor: foreground,
    cursorAccent: background,
    selectionBackground: `${foreground}40`,
    selectionForeground: foreground,
    black: colors[0],
    red: colors[1],
    green: colors[2],
    yellow: colors[3],
    blue: colors[4],
    magenta: colors[5],
    cyan: colors[6],
    white: colors[7],
    brightBlack: colors[8],
    brightRed: colors[9],
    brightGreen: colors[10],
    brightYellow: colors[11],
    brightBlue: colors[12],
    brightMagenta: colors[13],
    brightCyan: colors[14],
    brightWhite: colors[15],
  };
}

/** Base colors expanded into Palot semantic surfaces and terminal colors. */
interface ThemePaletteInput {
  surface: string;
  ink: string;
  accent: string;
  success: string;
  destructive: string;
  info: string;
  editorBackground: string;
  editorForeground: string;
  codeTheme: string;
  nativeGlass?: AppearanceNativeGlass;
  treatment?: AppearanceThemeTreatment;
}

function colorMix(base: string, mix: string, amount: number): string {
  return `color-mix(in oklch, ${base} ${100 - amount}%, ${mix})`;
}

function contrastingText(hex: string): string {
  const value = hex.slice(1);
  const linear = (channel: number) => {
    const normalized = channel / 255;
    return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  };
  const [red, green, blue] = [0, 2, 4].map((offset) =>
    Number.parseInt(value.slice(offset, offset + 2), 16),
  ) as [number, number, number];
  const luminance = [red, green, blue].reduce((sum, channel, index) => {
    return sum + linear(channel) * ([0.2126, 0.7152, 0.0722] as const)[index]!;
  }, 0);
  return luminance > 0.42 ? "#0a0a0a" : "#ffffff";
}

function paletteVariant(
  scheme: AppearanceColorScheme,
  input: ThemePaletteInput,
): AppearanceThemeVariant {
  const light = scheme === "light";
  const raised = colorMix(input.surface, input.ink, light ? 3 : 6);
  const subtle = colorMix(input.surface, input.ink, light ? 7 : 12);
  const border = colorMix(input.surface, input.ink, light ? 16 : 22);
  const terminalColors = [
    light ? input.ink : raised,
    input.destructive,
    input.success,
    input.accent,
    input.accent,
    input.info,
    input.success,
    light ? border : input.ink,
    colorMix(input.ink, input.surface, 45),
    input.destructive,
    input.success,
    input.accent,
    input.accent,
    input.info,
    input.success,
    input.ink,
  ] as const;

  return {
    codeTheme: input.codeTheme,
    nativeBackground: input.surface,
    nativeGlass: input.nativeGlass,
    treatment: input.treatment,
    palette: {
      background: input.surface,
      foreground: input.ink,
      card: raised,
      popover: colorMix(input.surface, input.ink, light ? 1 : 9),
      primary: input.accent,
      primaryForeground: contrastingText(input.accent),
      muted: subtle,
      mutedForeground: colorMix(input.ink, input.surface, 44),
      accent: colorMix(input.surface, input.accent, light ? 12 : 18),
      accentForeground: input.ink,
      destructive: input.destructive,
      success: input.success,
      warning: input.accent,
      info: input.info,
      border,
      input: colorMix(input.surface, input.ink, light ? 24 : 30),
      ring: input.accent,
      sidebar: colorMix(input.surface, input.ink, light ? 4 : 6),
      sidebarForeground: input.ink,
      sidebarPrimary: input.accent,
      sidebarPrimaryForeground: contrastingText(input.accent),
      sidebarAccent: colorMix(input.surface, input.accent, light ? 10 : 16),
      sidebarBorder: border,
      codeBackground: input.editorBackground,
      codeForeground: input.editorForeground,
      selection: `${input.accent}38`,
    },
    terminal: terminal(input.editorBackground, input.editorForeground, terminalColors),
  };
}

const LIGHT_ANSI = [
  "#24292f",
  "#cf222e",
  "#116329",
  "#9a6700",
  "#0969da",
  "#8250df",
  "#1b7c83",
  "#6e7781",
  "#57606a",
  "#a40e26",
  "#1a7f37",
  "#bf8700",
  "#218bff",
  "#a475f9",
  "#3192aa",
  "#8c959f",
] as const;

const DARK_ANSI = [
  "#484f58",
  "#ff7b72",
  "#3fb950",
  "#d29922",
  "#58a6ff",
  "#bc8cff",
  "#39c5cf",
  "#b1bac4",
  "#6e7681",
  "#ffa198",
  "#56d364",
  "#e3b341",
  "#79c0ff",
  "#d2a8ff",
  "#56d4dd",
  "#f0f6fc",
] as const;

const OPENCODE_LIGHT_ANSI = [
  "#1a1a1a",
  "#d1383d",
  "#3d9a57",
  "#b0851f",
  "#3b7dd8",
  "#7b5bb6",
  "#318795",
  "#d4d4d4",
  "#8a8a8a",
  "#d1383d",
  "#3d9a57",
  "#d68c27",
  "#3b7dd8",
  "#7b5bb6",
  "#318795",
  "#ffffff",
] as const;

const OPENCODE_DARK_ANSI = [
  "#141414",
  "#e06c75",
  "#7fd88f",
  "#e5c07b",
  "#5c9cf5",
  "#9d7cd8",
  "#56b6c2",
  "#eeeeee",
  "#808080",
  "#e06c75",
  "#7fd88f",
  "#f5a742",
  "#5c9cf5",
  "#9d7cd8",
  "#56b6c2",
  "#ffffff",
] as const;

function cursorVariant(scheme: AppearanceColorScheme): AppearanceThemeVariant {
  const light = scheme === "light";
  const background = light ? "oklch(0.991 0 0)" : "oklch(0.209 0 0)";
  const foreground = light ? "oklch(0.191 0 0 / 0.922)" : "oklch(0.919 0 0 / 0.922)";
  const primary = light ? "oklch(0.565 0.098 243.005)" : "oklch(0.697 0.059 248.687)";
  const destructive = light ? "oklch(0.566 0.197 12.263)" : "oklch(0.628 0.194 8.387)";
  const success = light ? "oklch(0.565 0.11 164.499)" : "oklch(0.638 0.129 153.739)";
  const warning = light ? "oklch(0.661 0.121 71.707)" : "oklch(0.811 0.118 71.255)";
  const sidebar = light ? "oklch(0.964 0 0)" : "oklch(0.191 0 0)";

  return {
    codeTheme: light ? "light-plus" : "dark-plus",
    nativeBackground: light ? "#fdfdfd" : "#181818",
    palette: {
      background,
      foreground,
      card: background,
      popover: background,
      primary,
      primaryForeground: light ? "oklch(0.991 0 0)" : "oklch(0.226 0.013 264.284)",
      muted: light ? "oklch(0.191 0 0 / 0.078)" : "oklch(0.919 0 0 / 0.067)",
      mutedForeground: light ? "oklch(0.191 0 0 / 0.702)" : "oklch(0.919 0 0 / 0.553)",
      accent: light ? "oklch(0.191 0 0 / 0.078)" : "oklch(0.919 0 0 / 0.118)",
      accentForeground: foreground,
      destructive,
      success,
      warning,
      info: light ? "oklch(0.559 0.161 253.748)" : primary,
      border: light ? "oklch(0.191 0 0 / 0.122)" : "oklch(0.919 0 0 / 0.094)",
      input: light ? "oklch(0.191 0 0 / 0.2)" : "oklch(0.919 0 0 / 0.149)",
      ring: light ? "oklch(0.191 0 0 / 0.149)" : "oklch(0.919 0 0 / 0.149)",
      sidebar,
      sidebarForeground: foreground,
      sidebarPrimary: primary,
      sidebarPrimaryForeground: light ? "oklch(0.991 0 0)" : "oklch(0.226 0.013 264.284)",
      sidebarAccent: light ? "oklch(0.191 0 0 / 0.078)" : "oklch(0.919 0 0 / 0.118)",
      sidebarBorder: light ? "oklch(0.191 0 0 / 0.051)" : "oklch(0.919 0 0 / 0.039)",
      codeBackground: background,
      codeForeground: foreground,
      selection: light ? "oklch(0.191 0 0 / 0.141)" : "oklch(0.919 0 0 / 0.118)",
    },
    terminal: terminal(
      light ? "#fdfdfd" : "#181818",
      light ? "#2b2b2b" : "#e6e6e6",
      light ? LIGHT_ANSI : DARK_ANSI,
    ),
    treatment: {
      text: {
        primary: foreground,
        secondary: light ? "oklch(0.191 0 0 / 0.702)" : "oklch(0.919 0 0 / 0.553)",
        tertiary: light ? "oklch(0.191 0 0 / 0.478)" : "oklch(0.919 0 0 / 0.369)",
        sidebarPrimary: foreground,
        sidebarSecondary: light ? "oklch(0.191 0 0 / 0.702)" : "oklch(0.919 0 0 / 0.553)",
        sidebarTertiary: light ? "oklch(0.191 0 0 / 0.478)" : "oklch(0.919 0 0 / 0.369)",
      },
      sidebar: {
        surface: sidebar,
        opaqueSurface: sidebar,
        material: "translucent",
        opacity: light ? 27 : 59,
        blendSpace: "oklch",
        blur: 0,
        saturation: 1,
        hover: light ? "oklch(0.191 0 0 / 0.039)" : "oklch(0.919 0 0 / 0.067)",
        selected: light ? "oklch(0.191 0 0 / 0.078)" : "oklch(0.919 0 0 / 0.118)",
      },
      surfaces: {
        inspector: {
          surface: background,
          opaqueSurface: background,
          opacity: light ? 84 : 76,
          blendSpace: "oklch",
          blur: 0,
          saturation: 1,
        },
        composer: {
          surface: background,
          opaqueSurface: background,
          opacity: light ? 84 : 76,
          blendSpace: "oklch",
          blur: 0,
          saturation: 1,
        },
        popover: {
          surface: background,
          opaqueSurface: background,
          opacity: light ? 84 : 76,
          blendSpace: "oklch",
          blur: 0,
          saturation: 1,
        },
      },
      native: { backdrop: "vibrancy-sidebar", tint: 0 },
    },
  };
}

function grokVariant(scheme: AppearanceColorScheme): AppearanceThemeVariant {
  const light = scheme === "light";
  const background = light ? "#fcfcfc" : "#070707";
  const foreground = light ? "#141414" : "#fcfcfc";
  const ansi = light
    ? ([
        "#141414",
        "#c21d2e",
        "#009957",
        "#c27400",
        "#0c64c1",
        "#c22476",
        "#008f7e",
        "#fcfcfc",
        "#141414bd",
        "#ff263c",
        "#00c972",
        "#ff9800",
        "#1084fe",
        "#ff309b",
        "#00bca6",
        "#ffffff",
      ] as const)
    : ([
        "#181818",
        "#ff8c98",
        "#78e2b4",
        "#ffc878",
        "#80befe",
        "#ff91ca",
        "#78dbd0",
        "#f3f3f3",
        "#fcfcfcbd",
        "#ffebed",
        "#e8faf2",
        "#fff6e8",
        "#e9f4ff",
        "#ffecf6",
        "#e8f9f7",
        "#ffffff",
      ] as const);

  return {
    codeTheme: light ? "pierre-light-soft" : "pierre-dark-soft",
    nativeBackground: light ? "#fcfcfc" : "#0b0b0b",
    palette: {
      background,
      foreground,
      card: light ? "#f3f3f3" : "#151515",
      popover: light ? "#fcfcfc" : "#181818",
      primary: "#1084fe",
      primaryForeground: light ? "#fcfcfc" : "#141414",
      muted: light ? "#77777717" : "#7777772c",
      mutedForeground: light ? "#14141499" : "#fcfcfc99",
      accent: light ? "#7777772b" : "#77777752",
      accentForeground: foreground,
      destructive: light ? "#c21d2e" : "#ff5667",
      success: light ? "#009957" : "#38d591",
      warning: light ? "#c27400" : "#ffaf38",
      info: light ? "#0c64c1" : "#459ffe",
      border: light ? "#14141426" : "#fcfcfc26",
      input: light ? "#14141426" : "#fcfcfc26",
      ring: light ? "#459ffe" : "#0c64c1",
      sidebar: light ? "#f7f7f7" : "#111111",
      sidebarForeground: foreground,
      sidebarPrimary: "#1084fe",
      sidebarPrimaryForeground: light ? "#fcfcfc" : "#141414",
      sidebarAccent: light ? "#7777772b" : "#77777752",
      sidebarBorder: light ? "#1414141a" : "#fcfcfc1a",
      codeBackground: background,
      codeForeground: foreground,
      selection: light ? "#1084fe2b" : "#1084fe52",
    },
    terminal: terminal(background, foreground, ansi),
    treatment: {
      text: {
        primary: foreground,
        secondary: light ? "#14141499" : "#fcfcfc99",
        tertiary: light ? "#14141466" : "#fcfcfc66",
        sidebarPrimary: foreground,
        sidebarSecondary: light ? "#14141499" : "#fcfcfc99",
        sidebarTertiary: light ? "#14141466" : "#fcfcfc66",
      },
      sidebar: {
        surface: light ? "#f7f7f7" : "#111111",
        opaqueSurface: light ? "#f7f7f7" : "#111111",
        material: "solid",
        opacity: 100,
        blendSpace: "srgb",
        blur: 0,
        saturation: 1,
        hover: light ? "#77777717" : "#7777772c",
        selected: light ? "#7777772b" : "#77777752",
      },
      surfaces: {
        inspector: {
          surface: light ? "#f3f3f3" : "#151515",
          opaqueSurface: light ? "#f3f3f3" : "#151515",
          opacity: 100,
          blendSpace: "srgb",
          blur: 0,
          saturation: 1,
        },
        composer: {
          surface: light ? "#f3f3f3" : "#151515",
          opaqueSurface: light ? "#f3f3f3" : "#151515",
          opacity: 100,
          blendSpace: "srgb",
          blur: 0,
          saturation: 1,
        },
        popover: {
          surface: light ? "#fcfcfc" : "#181818",
          opaqueSurface: light ? "#fcfcfc" : "#181818",
          opacity: 100,
          blendSpace: "srgb",
          blur: 0,
          saturation: 1,
        },
      },
      native: { backdrop: "opaque", tint: 0 },
    },
  };
}

function macOSVariant(scheme: AppearanceColorScheme): AppearanceThemeVariant {
  const light = scheme === "light";
  const background = light ? "#ffffff" : "#1e1e1e";
  const foreground = light ? "#1d1d1f" : "#f5f5f7";
  const accent = light ? "#007aff" : "#0a84ff";
  const accentForeground = "#ffffff";
  const secondaryLabel = light ? "#6e6e73" : "#98989d";
  const textBackground = background;
  const controlBackground = light ? "#f2f2f2" : "#2c2c2e";
  const sidebarBackground = light ? "#f2f2f2" : "#282828";
  const separator = light ? "#d1d1d6" : "#48484a";
  const terminalBackground = light ? "#ffffff" : "#1e1e1e";
  const terminalForeground = light ? "#1d1d1f" : "#f5f5f7";

  return {
    codeTheme: light ? "macos-code-light" : "macos-code-dark",
    nativeBackground: sidebarBackground,
    palette: {
      background,
      foreground,
      card: controlBackground,
      popover: textBackground,
      primary: accent,
      primaryForeground: accentForeground,
      muted: controlBackground,
      mutedForeground: secondaryLabel,
      accent: light ? "#d9eaff" : "#27496d",
      accentForeground,
      destructive: light ? "#ff3b30" : "#ff453a",
      success: light ? "#34c759" : "#30d158",
      warning: light ? "#ff9500" : "#ff9f0a",
      info: accent,
      border: separator,
      input: light ? "#c7c7cc" : "#545458",
      ring: light ? "#0067f4" : "#1b91ff",
      sidebar: sidebarBackground,
      sidebarForeground: foreground,
      sidebarPrimary: accent,
      sidebarPrimaryForeground: accentForeground,
      sidebarAccent: light ? "#dedede" : "#454545",
      sidebarBorder: separator,
      codeBackground: textBackground,
      codeForeground: terminalForeground,
      selection: light ? "#b3d7ff" : "#3f638b",
    },
    terminal: terminal(terminalBackground, terminalForeground, light ? LIGHT_ANSI : DARK_ANSI),
    treatment: {
      text: {
        primary: foreground,
        secondary: secondaryLabel,
        tertiary: "#8e8e93",
        sidebarPrimary: foreground,
        sidebarSecondary: secondaryLabel,
        sidebarTertiary: "#8e8e93",
      },
      interaction: {
        hover: light ? "#e5e5e5" : "#3a3a3c",
        pressed: light ? "#d9d9d9" : "#545458",
        selected: light ? "#b3d7ff" : "#3f638b",
        selectedInactive: light ? "#dcdcdc" : "#454545",
        disabledForeground: light ? "#999999" : "#777777",
        placeholderForeground: light ? "#8e8e93" : "#98989d",
        linkForeground: light ? "#0068da" : "#419cff",
      },
      shape: {
        controlRadius: "7px",
        compactControlRadius: "5px",
        surfaceRadius: "12px",
        popoverRadius: "14px",
      },
      sidebar: {
        surface: sidebarBackground,
        opaqueSurface: sidebarBackground,
        material: "automatic",
        opacity: 67,
        blendSpace: "oklch",
        blur: 22,
        saturation: 1.14,
      },
      surfaces: {
        inspector: {
          surface: controlBackground,
          opaqueSurface: controlBackground,
          opacity: 88,
          blendSpace: "oklch",
          blur: 20,
          saturation: 1.8,
        },
        composer: {
          surface: controlBackground,
          opaqueSurface: controlBackground,
          opacity: 86,
          blendSpace: "oklch",
          blur: 20,
          saturation: 1.8,
        },
        popover: {
          surface: textBackground,
          opaqueSurface: textBackground,
          opacity: 90,
          blendSpace: "oklch",
          blur: 20,
          saturation: 1.8,
        },
      },
      native: { backdrop: "adaptive", tint: light ? 30 : 0 },
    },
  };
}

export const APPEARANCE_THEMES: Readonly<Record<AppearanceThemeID, AppearanceThemeDefinition>> = {
  palot: {
    id: "palot",
    name: "Palot",
    description: "Quiet neutral chrome with clear blue focus and balanced status colors.",
    light: {
      codeTheme: "pierre-light-soft",
      nativeBackground: "#f9fafb",
      palette: {
        background: "oklch(0.985 0.002 247.84)",
        foreground: "oklch(0.16 0.006 285.89)",
        card: "oklch(0.995 0.001 247.84)",
        popover: "oklch(0.995 0.001 247.84)",
        primary: "oklch(0.22 0.008 285.89)",
        primaryForeground: "oklch(0.985 0.002 247.84)",
        muted: "oklch(0.96 0.003 264.54)",
        mutedForeground: "oklch(0.54 0.012 264.36)",
        accent: "oklch(0.945 0.005 264.53)",
        accentForeground: "oklch(0.22 0.008 285.89)",
        destructive: "oklch(0.58 0.22 27.33)",
        success: "oklch(0.58 0.14 162.48)",
        warning: "oklch(0.63 0.13 78)",
        info: "oklch(0.62 0.17 252.37)",
        border: "oklch(0.91 0.006 264.53)",
        input: "oklch(0.89 0.008 264.53)",
        ring: "oklch(0.62 0.17 252.37)",
        sidebar: "oklch(0.965 0.004 264.54)",
        sidebarForeground: "oklch(0.19 0.007 285.89)",
        sidebarPrimary: "oklch(0.22 0.008 285.89)",
        sidebarPrimaryForeground: "oklch(0.985 0.002 247.84)",
        sidebarAccent: "oklch(0.925 0.008 264.53)",
        sidebarBorder: "oklch(0.89 0.008 264.53)",
        codeBackground: "oklch(0.985 0.002 247.84)",
        codeForeground: "oklch(0.16 0.006 285.89)",
        selection: "oklch(0.62 0.17 252.37 / 22%)",
      },
      terminal: terminal("#f8f8fa", "#25272c", LIGHT_ANSI),
    },
    dark: {
      codeTheme: "pierre-dark-soft",
      nativeBackground: "#111113",
      palette: {
        background: "oklch(0.14 0.004 285.82)",
        foreground: "oklch(0.96 0.002 286.35)",
        card: "oklch(0.17 0.005 285.82)",
        popover: "oklch(0.2 0.006 285.82)",
        primary: "oklch(0.92 0.004 286.32)",
        primaryForeground: "oklch(0.2 0.006 285.82)",
        muted: "oklch(0.22 0.006 285.82)",
        mutedForeground: "oklch(0.66 0.012 286.08)",
        accent: "oklch(0.25 0.008 285.82)",
        accentForeground: "oklch(0.96 0.002 286.35)",
        destructive: "oklch(0.7 0.19 22.22)",
        success: "oklch(0.72 0.15 162.48)",
        warning: "oklch(0.75 0.13 78)",
        info: "oklch(0.72 0.15 252.37)",
        border: "oklch(1 0 0 / 10%)",
        input: "oklch(1 0 0 / 14%)",
        ring: "oklch(0.7 0.15 252.37)",
        sidebar: "oklch(0.18 0.005 285.82)",
        sidebarForeground: "oklch(0.95 0.002 286.35)",
        sidebarPrimary: "oklch(0.72 0.15 252.37)",
        sidebarPrimaryForeground: "oklch(0.14 0.004 285.82)",
        sidebarAccent: "oklch(0.24 0.008 285.82)",
        sidebarBorder: "oklch(1 0 0 / 9%)",
        codeBackground: "oklch(0.17 0.005 285.82)",
        codeForeground: "oklch(0.96 0.002 286.35)",
        selection: "oklch(0.7 0.15 252.37 / 24%)",
      },
      terminal: terminal("#181a1e", "#e9eaed", DARK_ANSI),
    },
  },
  macos: {
    id: "macos",
    name: "macOS",
    description: "Native macOS semantic colors, accent color, and system contrast behavior.",
    light: macOSVariant("light"),
    dark: macOSVariant("dark"),
  },
  opencode: {
    id: "opencode",
    name: "OpenCode",
    description: "OpenCode's warm primary colors, neutral surfaces, and syntax palette.",
    light: {
      codeTheme: "opencode-light",
      nativeBackground: "#ffffff",
      palette: {
        background: "#ffffff",
        foreground: "#1a1a1a",
        card: "#fafafa",
        popover: "#ffffff",
        primary: "#3b7dd8",
        primaryForeground: "#ffffff",
        muted: "#f5f5f5",
        mutedForeground: "#8a8a8a",
        accent: "#ebebeb",
        accentForeground: "#1a1a1a",
        destructive: "#d1383d",
        success: "#3d9a57",
        warning: "#d68c27",
        info: "#318795",
        border: "#d4d4d4",
        input: "#b8b8b8",
        ring: "#3b7dd8",
        sidebar: "#fafafa",
        sidebarForeground: "#1a1a1a",
        sidebarPrimary: "#3b7dd8",
        sidebarPrimaryForeground: "#ffffff",
        sidebarAccent: "#f5f5f5",
        sidebarBorder: "#d4d4d4",
        codeBackground: "#fafafa",
        codeForeground: "#1a1a1a",
        selection: "#3b7dd830",
      },
      terminal: terminal("#fafafa", "#1a1a1a", OPENCODE_LIGHT_ANSI),
    },
    dark: {
      codeTheme: "opencode-dark",
      nativeBackground: "#0a0a0a",
      palette: {
        background: "#0a0a0a",
        foreground: "#eeeeee",
        card: "#141414",
        popover: "#1e1e1e",
        primary: "#fab283",
        primaryForeground: "#0a0a0a",
        muted: "#1e1e1e",
        mutedForeground: "#808080",
        accent: "#282828",
        accentForeground: "#eeeeee",
        destructive: "#e06c75",
        success: "#7fd88f",
        warning: "#f5a742",
        info: "#56b6c2",
        border: "#3c3c3c",
        input: "#484848",
        ring: "#fab283",
        sidebar: "#141414",
        sidebarForeground: "#eeeeee",
        sidebarPrimary: "#fab283",
        sidebarPrimaryForeground: "#0a0a0a",
        sidebarAccent: "#1e1e1e",
        sidebarBorder: "#3c3c3c",
        codeBackground: "#0a0a0a",
        codeForeground: "#eeeeee",
        selection: "#fab28338",
      },
      terminal: terminal("#0a0a0a", "#eeeeee", OPENCODE_DARK_ANSI),
    },
  },
  tanstack: {
    id: "tanstack",
    name: "TanStack",
    description: "Inspired by TanStack's warm neutrals, cyan actions, and category colors.",
    light: {
      codeTheme: "tanstack-light",
      nativeBackground: "#ffffff",
      palette: {
        background: "#ffffff",
        foreground: "#111111",
        card: "#ffffff",
        popover: "#ffffff",
        primary: "#003e53",
        primaryForeground: "#ffffff",
        muted: "#fafafa",
        mutedForeground: "#756c5b",
        accent: "#eeebd4",
        accentForeground: "#111111",
        destructive: "#5f1a06",
        success: "#1d4226",
        warning: "#624a00",
        info: "#003e53",
        border: "#eeebd4",
        input: "#aea691",
        ring: "#3aa3c4",
        sidebar: "#faf8f2",
        sidebarForeground: "#111111",
        sidebarPrimary: "#003e53",
        sidebarPrimaryForeground: "#ffffff",
        sidebarAccent: "#eeebd4",
        sidebarBorder: "#eae5d7",
        codeBackground: "#faf8f2",
        codeForeground: "#111111",
        selection: "#3aa3c438",
      },
      terminal: terminal("#faf8f2", "#111111", [
        "#111111",
        "#d3481b",
        "#39af46",
        "#ffa216",
        "#003e53",
        "#b64cc7",
        "#3aa3c4",
        "#eeebd4",
        "#756c5b",
        "#e06e49",
        "#69bc75",
        "#f4d648",
        "#61adbf",
        "#c56dcf",
        "#9cd5e2",
        "#ffffff",
      ]),
    },
    dark: {
      codeTheme: "tanstack-dark",
      nativeBackground: "#111111",
      palette: {
        background: "#111111",
        foreground: "#ffffff",
        card: "#1f1f1f",
        popover: "#2b2b2b",
        primary: "#3aa3c4",
        primaryForeground: "#031219",
        muted: "#1b1b1b",
        mutedForeground: "#aea691",
        accent: "#2b2b2b",
        accentForeground: "#ffffff",
        destructive: "#edaa8d",
        success: "#69bc75",
        warning: "#f4d648",
        info: "#9cd5e2",
        border: "#232323",
        input: "#2d2d2d",
        ring: "#61adbf",
        sidebar: "#1b1b1b",
        sidebarForeground: "#ffffff",
        sidebarPrimary: "#3aa3c4",
        sidebarPrimaryForeground: "#031219",
        sidebarAccent: "#2b2b2b",
        sidebarBorder: "#232323",
        codeBackground: "#111111",
        codeForeground: "#ffffff",
        selection: "#61adbf38",
      },
      terminal: terminal("#111111", "#ffffff", [
        "#111111",
        "#edaa8d",
        "#69bc75",
        "#f4d648",
        "#61adbf",
        "#c56dcf",
        "#9cd5e2",
        "#aea691",
        "#756c5b",
        "#e06e49",
        "#a2e1a9",
        "#fae884",
        "#9cd5e2",
        "#ca8ec5",
        "#d8f0f3",
        "#ffffff",
      ]),
    },
  },
  absolutely: {
    id: "absolutely",
    name: "Absolutely",
    description: "Warm ivory and charcoal surfaces with a soft terracotta accent.",
    light: paletteVariant("light", {
      surface: "#f9f9f7",
      ink: "#2d2d2b",
      accent: "#cc7d5e",
      success: "#00c853",
      destructive: "#ff5f38",
      info: "#cc7d5e",
      editorBackground: "#f9f9f7",
      editorForeground: "#2d2d2b",
      codeTheme: "absolutely-light",
    }),
    dark: paletteVariant("dark", {
      surface: "#2d2d2b",
      ink: "#f9f9f7",
      accent: "#cc7d5e",
      success: "#00c853",
      destructive: "#ff5f38",
      info: "#cc7d5e",
      editorBackground: "#2d2d2b",
      editorForeground: "#f9f9f7",
      codeTheme: "absolutely-dark",
    }),
  },
  ayu: {
    id: "ayu",
    name: "Ayu",
    description: "Deep blue-gray surfaces with warm amber accents and muted ink.",
    dark: paletteVariant("dark", {
      surface: "#10141c",
      ink: "#bfbdb6",
      accent: "#e6b450",
      success: "#70bf56",
      destructive: "#f26d78",
      info: "#d0a1ff",
      editorBackground: "#10141c",
      editorForeground: "#bfbdb6",
      codeTheme: "ayu-dark",
    }),
  },
  catppuccin: {
    id: "catppuccin",
    name: "Catppuccin",
    description: "Pastel lavender accents across creamy Latte and dark Mocha surfaces.",
    light: paletteVariant("light", {
      surface: "#eff1f5",
      ink: "#4c4f69",
      accent: "#8839ef",
      success: "#40a02b",
      destructive: "#d20f39",
      info: "#8839ef",
      editorBackground: "#eff1f5",
      editorForeground: "#4c4f69",
      codeTheme: "catppuccin-latte",
    }),
    dark: paletteVariant("dark", {
      surface: "#1e1e2e",
      ink: "#cdd6f4",
      accent: "#cba6f7",
      success: "#a6e3a1",
      destructive: "#f38ba8",
      info: "#cba6f7",
      editorBackground: "#1e1e2e",
      editorForeground: "#cdd6f4",
      codeTheme: "catppuccin-mocha",
    }),
  },
  codex: {
    id: "codex",
    name: "Codex",
    description: "Neutral surfaces, blue focus, and softly translucent sidebar treatments.",
    light: paletteVariant("light", {
      surface: "#ffffff",
      ink: "#0d0d0d",
      accent: "#0169cc",
      success: "#00a240",
      destructive: "#e02e2a",
      info: "#751ed9",
      editorBackground: "#ffffff",
      editorForeground: "#0d0d0d",
      codeTheme: "codex-light",
      nativeGlass: DEFAULT_NATIVE_GLASS,
      treatment: {
        text: {
          primary: "#1a1c1f",
          secondary: "rgb(26 28 31 / 70%)",
          tertiary: "rgb(26 28 31 / 50%)",
          sidebarPrimary: "#1a1c1f",
          sidebarSecondary: "rgb(26 28 31 / 70%)",
          sidebarTertiary: "rgb(26 28 31 / 50%)",
        },
        sidebar: {
          surface: "#f9f9f9",
          opaqueSurface: "#f9f9f9",
          material: "translucent",
          opacity: 67,
          blendSpace: "oklch",
          blur: 0,
          saturation: 1,
          hover: "rgb(26 28 31 / 6%)",
          selected: "rgb(26 28 31 / 10%)",
        },
        surfaces: {
          inspector: { opacity: 88, blendSpace: "oklch", blur: 0, saturation: 1 },
          composer: { opacity: 86, blendSpace: "oklch", blur: 14, saturation: 1.08 },
          popover: { opacity: 90, blendSpace: "oklch", blur: 14, saturation: 1.08 },
        },
        native: { backdrop: "vibrancy-menu", tint: 0 },
      },
    }),
    dark: paletteVariant("dark", {
      surface: "#181818",
      ink: "#fcfcfc",
      accent: "#0169cc",
      success: "#00a240",
      destructive: "#e02e2a",
      info: "#b06dff",
      editorBackground: "#111111",
      editorForeground: "#fcfcfc",
      codeTheme: "codex-dark",
      nativeGlass: DEFAULT_NATIVE_GLASS,
      treatment: {
        text: {
          primary: "#dfdfdf",
          secondary: "rgb(255 255 255 / 70%)",
          tertiary: "rgb(255 255 255 / 50%)",
          sidebarPrimary: "#dfdfdf",
          sidebarSecondary: "rgb(255 255 255 / 70%)",
          sidebarTertiary: "rgb(255 255 255 / 50%)",
        },
        sidebar: {
          surface: "#212121",
          opaqueSurface: "#171717",
          material: "translucent",
          opacity: 55,
          blendSpace: "srgb",
          blur: 0,
          saturation: 1,
          hover: "rgb(223 223 223 / 6%)",
          selected: "rgb(223 223 223 / 10%)",
        },
        surfaces: {
          inspector: { opacity: 88, blendSpace: "srgb", blur: 0, saturation: 1 },
          composer: { opacity: 86, blendSpace: "srgb", blur: 0, saturation: 1 },
          popover: { opacity: 90, blendSpace: "srgb", blur: 0, saturation: 1 },
        },
        native: { backdrop: "vibrancy-menu", tint: 0 },
      },
    }),
  },
  cursor: {
    id: "cursor",
    name: "Cursor",
    description:
      "Cursor Agent's compact neutral glass interface, separate from its VS Code editor.",
    light: cursorVariant("light"),
    dark: cursorVariant("dark"),
  },
  dracula: {
    id: "dracula",
    name: "Dracula",
    description: "Dark violet-gray surfaces with vivid pink, green, and purple highlights.",
    dark: paletteVariant("dark", {
      surface: "#282a36",
      ink: "#f8f8f2",
      accent: "#ff79c6",
      success: "#50fa7b",
      destructive: "#ff5555",
      info: "#ff79c6",
      editorBackground: "#282a36",
      editorForeground: "#f8f8f2",
      codeTheme: "dracula",
    }),
  },
  everforest: {
    id: "everforest",
    name: "Everforest",
    description: "Cream and forest-gray surfaces with soft green accents.",
    light: paletteVariant("light", {
      surface: "#fdf6e3",
      ink: "#5c6a72",
      accent: "#93b259",
      success: "#8da101",
      destructive: "#f85552",
      info: "#df69ba",
      editorBackground: "#fdf6e3",
      editorForeground: "#5c6a72",
      codeTheme: "everforest-light",
    }),
    dark: paletteVariant("dark", {
      surface: "#2d353b",
      ink: "#d3c6aa",
      accent: "#a7c080",
      success: "#a7c080",
      destructive: "#e67e80",
      info: "#d699b6",
      editorBackground: "#2d353b",
      editorForeground: "#d3c6aa",
      codeTheme: "everforest-dark",
    }),
  },
  gruvbox: {
    id: "gruvbox",
    name: "Gruvbox",
    description: "Warm cream and charcoal surfaces with muted teal accents.",
    light: paletteVariant("light", {
      surface: "#fbf1c7",
      ink: "#3c3836",
      accent: "#458588",
      success: "#3c3836",
      destructive: "#cc241d",
      info: "#b16286",
      editorBackground: "#fbf1c7",
      editorForeground: "#3c3836",
      codeTheme: "gruvbox-light-medium",
    }),
    dark: paletteVariant("dark", {
      surface: "#282828",
      ink: "#ebdbb2",
      accent: "#458588",
      success: "#ebdbb2",
      destructive: "#cc241d",
      info: "#b16286",
      editorBackground: "#282828",
      editorForeground: "#ebdbb2",
      codeTheme: "gruvbox-dark-medium",
    }),
  },
  linear: {
    id: "linear",
    name: "Linear",
    description: "Cool near-white and ink-black surfaces with indigo accents.",
    light: paletteVariant("light", {
      surface: "#fcfcfd",
      ink: "#1b1b1b",
      accent: "#5e6ad2",
      success: "#52a450",
      destructive: "#c94446",
      info: "#8160d8",
      editorBackground: "#f7f8fa",
      editorForeground: "#2a3140",
      codeTheme: "linear-light",
    }),
    dark: paletteVariant("dark", {
      surface: "#0f0f11",
      ink: "#e3e4e6",
      accent: "#606acc",
      success: "#69c967",
      destructive: "#ff7e78",
      info: "#c2a1ff",
      editorBackground: "#17181d",
      editorForeground: "#e6e9ef",
      codeTheme: "linear-dark",
    }),
  },
  lobster: {
    id: "lobster",
    name: "Lobster",
    description: "Deep navy surfaces with bright coral accents and green status colors.",
    dark: paletteVariant("dark", {
      surface: "#111827",
      ink: "#e4e4e7",
      accent: "#ff5c5c",
      success: "#22c55e",
      destructive: "#ff5c5c",
      info: "#3b82f6",
      editorBackground: "#111827",
      editorForeground: "#e4e4e7",
      codeTheme: "lobster-dark",
    }),
  },
  material: {
    id: "material",
    name: "Material",
    description: "Charcoal surfaces with pale teal accents and lavender highlights.",
    dark: paletteVariant("dark", {
      surface: "#212121",
      ink: "#eeffff",
      accent: "#80cbc4",
      success: "#c3e88d",
      destructive: "#f07178",
      info: "#c792ea",
      editorBackground: "#212121",
      editorForeground: "#eeffff",
      codeTheme: "material-theme-darker",
    }),
  },
  matrix: {
    id: "matrix",
    name: "Matrix",
    description: "Near-black green surfaces with luminous green accents and ink.",
    dark: paletteVariant("dark", {
      surface: "#040805",
      ink: "#b8ffca",
      accent: "#1eff5a",
      success: "#1eff5a",
      destructive: "#fa423e",
      info: "#1eff5a",
      editorBackground: "#040805",
      editorForeground: "#b8ffca",
      codeTheme: "matrix-dark",
    }),
  },
  monokai: {
    id: "monokai",
    name: "Monokai",
    description: "Warm charcoal surfaces with olive-gray accents and colorful syntax.",
    dark: paletteVariant("dark", {
      surface: "#272822",
      ink: "#f8f8f2",
      accent: "#99947c",
      success: "#86b42b",
      destructive: "#c4265e",
      info: "#8c6bc8",
      editorBackground: "#272822",
      editorForeground: "#f8f8f2",
      codeTheme: "monokai",
    }),
  },
  "night-owl": {
    id: "night-owl",
    name: "Night Owl",
    description: "Midnight blue surfaces with subdued blue-gray accents and pale ink.",
    dark: paletteVariant("dark", {
      surface: "#011627",
      ink: "#d6deeb",
      accent: "#44596b",
      success: "#c5e478",
      destructive: "#ef5350",
      info: "#c792ea",
      editorBackground: "#011627",
      editorForeground: "#d6deeb",
      codeTheme: "night-owl",
    }),
  },
  nord: {
    id: "nord",
    name: "Nord",
    description: "Cool slate surfaces with frost-blue accents and soft pastel status colors.",
    dark: paletteVariant("dark", {
      surface: "#2e3440",
      ink: "#d8dee9",
      accent: "#88c0d0",
      success: "#a3be8c",
      destructive: "#bf616a",
      info: "#b48ead",
      editorBackground: "#2e3440",
      editorForeground: "#d8dee9",
      codeTheme: "nord",
    }),
  },
  notion: {
    id: "notion",
    name: "Notion",
    description: "Clean white and charcoal surfaces with warm neutral ink and blue accents.",
    light: paletteVariant("light", {
      surface: "#ffffff",
      ink: "#37352f",
      accent: "#3183d8",
      success: "#008000",
      destructive: "#a31515",
      info: "#0000ff",
      editorBackground: "#ffffff",
      editorForeground: "#37352f",
      codeTheme: "notion-light",
    }),
    dark: paletteVariant("dark", {
      surface: "#191919",
      ink: "#d9d9d8",
      accent: "#3183d8",
      success: "#4ec9b0",
      destructive: "#fa423e",
      info: "#3183d8",
      editorBackground: "#191919",
      editorForeground: "#d9d9d8",
      codeTheme: "notion-dark",
    }),
  },
  one: {
    id: "one",
    name: "One",
    description: "Balanced near-white and slate surfaces with blue accents.",
    light: paletteVariant("light", {
      surface: "#fafafa",
      ink: "#383a42",
      accent: "#526fff",
      success: "#3bba54",
      destructive: "#e45649",
      info: "#526fff",
      editorBackground: "#fafafa",
      editorForeground: "#383a42",
      codeTheme: "one-light",
    }),
    dark: paletteVariant("dark", {
      surface: "#282c34",
      ink: "#abb2bf",
      accent: "#4d78cc",
      success: "#8cc265",
      destructive: "#e05561",
      info: "#c162de",
      editorBackground: "#282c34",
      editorForeground: "#abb2bf",
      codeTheme: "one-dark-pro",
    }),
  },
  oscurange: {
    id: "oscurange",
    name: "Oscurange",
    description: "Near-black surfaces with soft peach accents and blue highlights.",
    dark: paletteVariant("dark", {
      surface: "#0b0b0f",
      ink: "#e6e6e6",
      accent: "#f9b98c",
      success: "#40c977",
      destructive: "#fa423e",
      info: "#479ffa",
      editorBackground: "#0b0b0f",
      editorForeground: "#e6e6e6",
      codeTheme: "oscurange-dark",
    }),
  },
  proof: {
    id: "proof",
    name: "Proof",
    description: "Warm paper surfaces with dark olive ink and restrained green accents.",
    light: paletteVariant("light", {
      surface: "#f5f3ed",
      ink: "#2f312d",
      accent: "#3d755d",
      success: "#3d755d",
      destructive: "#ba2623",
      info: "#5f6ac2",
      editorBackground: "#f5f3ed",
      editorForeground: "#2f312d",
      codeTheme: "proof-light",
    }),
  },
  raycast: {
    id: "raycast",
    name: "Raycast",
    description: "Crisp white and near-black surfaces with coral-red accents.",
    light: paletteVariant("light", {
      surface: "#ffffff",
      ink: "#030303",
      accent: "#ff6363",
      success: "#006b4f",
      destructive: "#b12424",
      info: "#9a1b6e",
      editorBackground: "#ffffff",
      editorForeground: "#000000",
      codeTheme: "raycast-light",
    }),
    dark: paletteVariant("dark", {
      surface: "#101010",
      ink: "#fefefe",
      accent: "#ff6363",
      success: "#59d499",
      destructive: "#ff6363",
      info: "#cf2f98",
      editorBackground: "#141414",
      editorForeground: "#ffffff",
      codeTheme: "raycast-dark",
    }),
  },
  "rose-pine": {
    id: "rose-pine",
    name: "Rose Pine",
    description: "Warm Dawn and muted Moon surfaces with rose accents and lavender ink.",
    light: paletteVariant("light", {
      surface: "#faf4ed",
      ink: "#575279",
      accent: "#d7827e",
      success: "#56949f",
      destructive: "#797593",
      info: "#907aa9",
      editorBackground: "#faf4ed",
      editorForeground: "#575279",
      codeTheme: "rose-pine-dawn",
    }),
    dark: paletteVariant("dark", {
      surface: "#232136",
      ink: "#e0def4",
      accent: "#ea9a97",
      success: "#9ccfd8",
      destructive: "#908caa",
      info: "#c4a7e7",
      editorBackground: "#232136",
      editorForeground: "#e0def4",
      codeTheme: "rose-pine-moon",
    }),
  },
  sentry: {
    id: "sentry",
    name: "Sentry",
    description: "Deep plum surfaces with violet accents and mint status colors.",
    dark: paletteVariant("dark", {
      surface: "#2d2935",
      ink: "#e6dff9",
      accent: "#7055f6",
      success: "#8ee6d7",
      destructive: "#fa423e",
      info: "#7055f6",
      editorBackground: "#2d2935",
      editorForeground: "#e6dff9",
      codeTheme: "sentry-dark",
    }),
  },
  solarized: {
    id: "solarized",
    name: "Solarized",
    description: "Cream and deep teal surfaces with muted ink and warm accents.",
    light: paletteVariant("light", {
      surface: "#fdf6e3",
      ink: "#657b83",
      accent: "#b58900",
      success: "#859900",
      destructive: "#dc322f",
      info: "#d33682",
      editorBackground: "#fdf6e3",
      editorForeground: "#657b83",
      codeTheme: "solarized-light",
    }),
    dark: paletteVariant("dark", {
      surface: "#002b36",
      ink: "#839496",
      accent: "#d30102",
      success: "#859900",
      destructive: "#dc322f",
      info: "#d33682",
      editorBackground: "#002b36",
      editorForeground: "#839496",
      codeTheme: "solarized-dark",
    }),
  },
  temple: {
    id: "temple",
    name: "Temple",
    description: "Deep forest-green surfaces with bright yellow-green accents.",
    dark: paletteVariant("dark", {
      surface: "#02120c",
      ink: "#c7e6da",
      accent: "#e4f222",
      success: "#40c977",
      destructive: "#fa423e",
      info: "#e4f222",
      editorBackground: "#02120c",
      editorForeground: "#c7e6da",
      codeTheme: "temple-dark",
    }),
  },
  "tokyo-night": {
    id: "tokyo-night",
    name: "Tokyo Night",
    description: "Dark indigo surfaces with muted blue accents and lavender ink.",
    dark: paletteVariant("dark", {
      surface: "#1a1b26",
      ink: "#a9b1d6",
      accent: "#3d59a1",
      success: "#449dab",
      destructive: "#914c54",
      info: "#9d7cd8",
      editorBackground: "#1a1b26",
      editorForeground: "#a9b1d6",
      codeTheme: "tokyo-night",
    }),
  },
  "vscode-plus": {
    id: "vscode-plus",
    name: "VS Code Plus",
    description: "Classic white and charcoal editor surfaces with blue accents.",
    light: paletteVariant("light", {
      surface: "#ffffff",
      ink: "#000000",
      accent: "#007acc",
      success: "#008000",
      destructive: "#ee0000",
      info: "#0000ff",
      editorBackground: "#ffffff",
      editorForeground: "#000000",
      codeTheme: "light-plus",
    }),
    dark: paletteVariant("dark", {
      surface: "#1e1e1e",
      ink: "#d4d4d4",
      accent: "#007acc",
      success: "#369432",
      destructive: "#f44747",
      info: "#000080",
      editorBackground: "#1e1e1e",
      editorForeground: "#d4d4d4",
      codeTheme: "dark-plus",
    }),
  },
  xcode: {
    id: "xcode",
    name: "Xcode",
    description: "White and dark graphite surfaces with vivid blue accents.",
    light: paletteVariant("light", {
      surface: "#ffffff",
      ink: "#000000",
      accent: "#0e0eff",
      success: "#00a240",
      destructive: "#c41a16",
      info: "#0e0eff",
      editorBackground: "#ffffff",
      editorForeground: "#000000d9",
      codeTheme: "xcode-light",
    }),
    dark: paletteVariant("dark", {
      surface: "#1f1f24",
      ink: "#ffffff",
      accent: "#5482ff",
      success: "#67b7a4",
      destructive: "#fc6a5d",
      info: "#5482ff",
      editorBackground: "#1f1f24",
      editorForeground: "#ffffffd9",
      codeTheme: "xcode-dark",
    }),
  },
  vercel: {
    id: "vercel",
    name: "Vercel",
    description: "Minimal white and black surfaces with bright blue accents.",
    light: paletteVariant("light", {
      surface: "#ffffff",
      ink: "#171717",
      accent: "#006aff",
      success: "#28a948",
      destructive: "#eb001d",
      info: "#a100f8",
      editorBackground: "#ffffff",
      editorForeground: "#171717",
      codeTheme: "vercel-light",
    }),
    dark: paletteVariant("dark", {
      surface: "#000000",
      ink: "#ededed",
      accent: "#006efe",
      success: "#00ad3a",
      destructive: "#f13342",
      info: "#9540d5",
      editorBackground: "#000000",
      editorForeground: "#ededed",
      codeTheme: "vercel-dark",
    }),
  },
  pierre: {
    id: "pierre",
    name: "Pierre",
    description: "Soft violet neutrals tuned for file trees and dense code review.",
    light: {
      codeTheme: "pierre-light-soft",
      nativeBackground: "#faf9fc",
      palette: {
        background: "#faf9fc",
        foreground: "#2a2731",
        card: "#ffffff",
        popover: "#ffffff",
        primary: "#342e43",
        primaryForeground: "#fbfaff",
        muted: "#efedf4",
        mutedForeground: "#716b7d",
        accent: "#e5e0ed",
        accentForeground: "#312b3c",
        destructive: "#bf5260",
        success: "#398266",
        warning: "#9c6815",
        info: "#687dbe",
        border: "#ddd8e5",
        input: "#d2ccdc",
        ring: "#785eb8",
        sidebar: "#f0edf5",
        sidebarForeground: "#312d3b",
        sidebarAccent: "#e3deec",
        sidebarBorder: "#d8d2e0",
        codeBackground: "#f7f5fa",
        codeForeground: "#2b2733",
        selection: "#785eb832",
      },
      terminal: terminal("#f7f5fa", "#2b2733", LIGHT_ANSI),
    },
    dark: {
      codeTheme: "pierre-dark-soft",
      nativeBackground: "#18161d",
      palette: {
        background: "#18161d",
        foreground: "#f1edf5",
        card: "#201d26",
        popover: "#25212c",
        primary: "#eee9f3",
        primaryForeground: "#231f29",
        muted: "#29252f",
        mutedForeground: "#a7a0b0",
        accent: "#302a38",
        accentForeground: "#f1edf5",
        destructive: "#e6818e",
        success: "#77bd9b",
        warning: "#d5a454",
        info: "#98a9e7",
        border: "#39333f",
        input: "#433b4a",
        ring: "#ad94e4",
        sidebar: "#1e1b23",
        sidebarForeground: "#f0ebf4",
        sidebarAccent: "#302a38",
        sidebarBorder: "#37313e",
        codeBackground: "#1b181f",
        codeForeground: "#eee9f2",
        selection: "#ad94e43b",
      },
      terminal: terminal("#1b181f", "#eee9f2", DARK_ANSI),
    },
  },
  github: {
    id: "github",
    name: "GitHub",
    description: "Clean white and dark gray surfaces with familiar blue accents.",
    light: paletteVariant("light", {
      surface: "#ffffff",
      ink: "#1f2328",
      accent: "#0969da",
      success: "#1a7f37",
      destructive: "#cf222e",
      info: "#8250df",
      editorBackground: "#ffffff",
      editorForeground: "#1f2328",
      codeTheme: "github-light-default",
    }),
    dark: paletteVariant("dark", {
      surface: "#0d1117",
      ink: "#e6edf3",
      accent: "#1f6feb",
      success: "#3fb950",
      destructive: "#f85149",
      info: "#bc8cff",
      editorBackground: "#0d1117",
      editorForeground: "#e6edf3",
      codeTheme: "github-dark-default",
    }),
  },
  grok: {
    id: "grok",
    name: "Grok",
    description: "Grok Bot's high-contrast Sand interface with opaque layered surfaces.",
    light: grokVariant("light"),
    dark: grokVariant("dark"),
  },
};

export const CODE_THEME_OPTIONS: Readonly<
  Record<
    Exclude<CodeThemeID, "follow">,
    { name: string; light: string; dark: string; source: AppearanceThemeID }
  >
> = {
  pierre: {
    name: "Pierre Soft",
    light: "pierre-light-soft",
    dark: "pierre-dark-soft",
    source: "pierre",
  },
  github: {
    name: "GitHub",
    light: "github-light",
    dark: "github-dark",
    source: "github",
  },
  min: { name: "Min", light: "min-light", dark: "min-dark", source: "vercel" },
};

export const UI_FONT_OPTIONS: Readonly<Record<UIFontID, AppearanceFontOption>> = {
  system: {
    name: "System",
    css: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "Helvetica Neue", "Segoe UI", sans-serif',
    localFamilies: [],
    availability: "always",
    source: "system",
  },
  inter: {
    name: "Inter",
    css: '"Inter Variable", Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    localFamilies: ["Inter Variable"],
    availability: "always",
    source: "bundled",
  },
  "dm-sans": {
    name: "DM Sans",
    css: '"DM Sans Variable", "DM Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    localFamilies: ["DM Sans Variable"],
    availability: "always",
    source: "bundled",
  },
  "ibm-plex-sans": {
    name: "IBM Plex Sans",
    css: '"IBM Plex Sans Variable", "IBM Plex Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    localFamilies: ["IBM Plex Sans Variable"],
    availability: "always",
    source: "bundled",
  },
  geist: {
    name: "Geist",
    css: '"Geist Variable", Geist, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    localFamilies: ["Geist Variable"],
    availability: "always",
    source: "bundled",
  },
  "sf-pro": {
    name: "SF Pro",
    css: '"SF Pro Text", "SF Pro Display", -apple-system, BlinkMacSystemFont, sans-serif',
    localFamilies: ["SF Pro Text", "SF Pro Display"],
    availability: "darwin",
    source: "system",
  },
  avenir: {
    name: "Avenir Next",
    css: '"Avenir Next", Avenir, -apple-system, sans-serif',
    localFamilies: ["Avenir Next", "Avenir"],
    availability: "probe",
    source: "system",
  },
  segoe: {
    name: "Segoe UI",
    css: '"Segoe UI", system-ui, sans-serif',
    localFamilies: ["Segoe UI"],
    availability: "probe",
    source: "system",
  },
};

export const CODE_FONT_OPTIONS: Readonly<Record<CodeFontID, AppearanceFontOption>> = {
  system: {
    name: "System monospace",
    css: '"SF Mono", SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", ui-monospace, monospace',
    localFamilies: [],
    availability: "always",
    source: "system",
  },
  "jetbrains-mono": {
    name: "JetBrains Mono",
    css: '"JetBrains Mono Variable", "JetBrains Mono", "SF Mono", Menlo, Consolas, ui-monospace, monospace',
    localFamilies: ["JetBrains Mono Variable"],
    availability: "always",
    source: "bundled",
  },
  "fira-code": {
    name: "Fira Code",
    css: '"Fira Code Variable", "Fira Code", "SF Mono", Menlo, Consolas, ui-monospace, monospace',
    localFamilies: ["Fira Code Variable"],
    availability: "always",
    source: "bundled",
  },
  "geist-mono": {
    name: "Geist Mono",
    css: '"Geist Mono Variable", "Geist Mono", "SF Mono", Menlo, Consolas, ui-monospace, monospace',
    localFamilies: ["Geist Mono Variable"],
    availability: "always",
    source: "bundled",
  },
  "sf-mono": {
    name: "SF Mono",
    css: '"SF Mono", SFMono-Regular, Menlo, Monaco, Consolas, ui-monospace, monospace',
    localFamilies: ["SF Mono", "SFMono-Regular"],
    availability: "probe",
    source: "system",
  },
  menlo: {
    name: "Menlo",
    css: 'Menlo, "SF Mono", Monaco, ui-monospace, monospace',
    localFamilies: ["Menlo"],
    availability: "probe",
    source: "system",
  },
  monaco: {
    name: "Monaco",
    css: 'Monaco, Menlo, "SF Mono", ui-monospace, monospace',
    localFamilies: ["Monaco"],
    availability: "probe",
    source: "system",
  },
  consolas: {
    name: "Consolas",
    css: 'Consolas, "SF Mono", Menlo, ui-monospace, monospace',
    localFamilies: ["Consolas"],
    availability: "probe",
    source: "system",
  },
};

export function appearanceTheme(
  preferences: AppearancePreferences,
  scheme: AppearanceColorScheme,
): AppearanceThemeVariant {
  if (preferences.source === "system" && preferences.systemPalette === "macos")
    return APPEARANCE_THEMES.macos[scheme]!;
  if (preferences.source === "system" && preferences.omarchyTheme?.mode === scheme) {
    return omarchyThemeVariant(preferences.omarchyTheme);
  }
  const selected =
    APPEARANCE_THEMES[scheme === "light" ? preferences.lightTheme : preferences.darkTheme][scheme];
  return selected ?? APPEARANCE_THEMES.palot[scheme]!;
}

export function effectiveAppearanceTreatment(
  preferences: AppearancePreferences,
  scheme: AppearanceColorScheme,
): ResolvedAppearanceTreatment {
  const theme = appearanceTheme(preferences, scheme);
  const { palette } = theme;
  const interaction = `color-mix(in oklch, ${palette.sidebarForeground} ${scheme === "light" ? 8 : 11}%, transparent)`;
  const treatment = theme.treatment;
  const themeSidebarOpacity = treatment?.sidebar?.opacity ?? 67;
  const themeNativeTint = treatment?.native?.tint ?? 0;
  const themeBackdrop = treatment?.native?.backdrop ?? "adaptive";
  const explicitGlassOpacity =
    preferences.glassOpacity === "theme" ? null : preferences.glassOpacity;
  const sidebarOpacity = themeSidebarOpacity;
  const surfaceOpacity = (themeValue: number | undefined, offset: number) =>
    Math.min(
      100,
      Math.max(
        0,
        explicitGlassOpacity !== null
          ? explicitGlassOpacity + offset
          : (themeValue ?? sidebarOpacity + offset),
      ),
    );
  const compositeSurface = (
    input: Partial<AppearanceSurfaceRecipe> | undefined,
    defaultSurface: string,
    offset: number,
    defaultBlur: number,
    defaultSaturation: number,
  ): AppearanceSurfaceRecipe => {
    const surface = input?.surface ?? defaultSurface;
    return {
      surface,
      opaqueSurface: input?.opaqueSurface ?? surface,
      opacity: surfaceOpacity(input?.opacity, offset),
      blendSpace: input?.blendSpace ?? "oklch",
      blur: Math.max(0, input?.blur ?? defaultBlur),
      saturation: Math.max(0, input?.saturation ?? defaultSaturation),
    };
  };
  const sidebarSurface = treatment?.sidebar?.surface ?? palette.sidebar;

  return {
    text: {
      primary: treatment?.text?.primary ?? palette.foreground,
      secondary: treatment?.text?.secondary ?? palette.mutedForeground,
      tertiary:
        treatment?.text?.tertiary ?? `color-mix(in oklch, ${palette.foreground} 50%, transparent)`,
      sidebarPrimary: treatment?.text?.sidebarPrimary ?? palette.sidebarForeground,
      sidebarSecondary:
        treatment?.text?.sidebarSecondary ??
        `color-mix(in oklch, ${palette.sidebarForeground} 70%, transparent)`,
      sidebarTertiary:
        treatment?.text?.sidebarTertiary ??
        `color-mix(in oklch, ${palette.sidebarForeground} 50%, transparent)`,
    },
    interaction: {
      hover: treatment?.interaction?.hover ?? interaction,
      pressed:
        treatment?.interaction?.pressed ??
        `color-mix(in oklch, ${palette.foreground} ${scheme === "light" ? 12 : 16}%, transparent)`,
      selected: treatment?.interaction?.selected ?? palette.accent,
      selectedInactive: treatment?.interaction?.selectedInactive ?? palette.sidebarAccent,
      disabledForeground:
        treatment?.interaction?.disabledForeground ??
        `color-mix(in oklch, ${palette.foreground} 42%, transparent)`,
      placeholderForeground:
        treatment?.interaction?.placeholderForeground ?? palette.mutedForeground,
      linkForeground: treatment?.interaction?.linkForeground ?? palette.info,
    },
    shape: {
      controlRadius: treatment?.shape?.controlRadius ?? "0.5rem",
      compactControlRadius: treatment?.shape?.compactControlRadius ?? "0.375rem",
      surfaceRadius: treatment?.shape?.surfaceRadius ?? "0.75rem",
      popoverRadius: treatment?.shape?.popoverRadius ?? "1rem",
    },
    sidebar: {
      surface: sidebarSurface,
      opaqueSurface: treatment?.sidebar?.opaqueSurface ?? sidebarSurface,
      material:
        preferences.sidebarMaterial === "automatic"
          ? (treatment?.sidebar?.material ?? "automatic")
          : preferences.sidebarMaterial,
      opacity: sidebarOpacity,
      blendSpace: treatment?.sidebar?.blendSpace ?? "oklch",
      blur: Math.max(0, treatment?.sidebar?.blur ?? 22),
      saturation: Math.max(0, treatment?.sidebar?.saturation ?? 1.14),
      hover: treatment?.sidebar?.hover ?? `color-mix(in oklch, ${interaction} 72%, transparent)`,
      selected: treatment?.sidebar?.selected ?? interaction,
    },
    surfaces: {
      inspector: compositeSurface(treatment?.surfaces?.inspector, palette.card, 10, 0, 1),
      composer: compositeSurface(treatment?.surfaces?.composer, palette.card, 5, 14, 1.08),
      popover: compositeSurface(treatment?.surfaces?.popover, palette.popover, 15, 14, 1.08),
    },
    native: {
      backdrop:
        preferences.windowMaterial === "opaque"
          ? "opaque"
          : preferences.windowMaterial === "native"
            ? "adaptive"
            : themeBackdrop,
      tint: preferences.nativeGlassTint === "theme" ? themeNativeTint : preferences.nativeGlassTint,
    },
  };
}

export function appearanceUpdateRequiresRestart(
  previous: AppearancePreferences,
  previousScheme: AppearanceColorScheme,
  next: AppearancePreferences,
  nextScheme: AppearanceColorScheme,
): boolean {
  const previousNative = effectiveAppearanceTreatment(previous, previousScheme).native;
  const nextNative = effectiveAppearanceTreatment(next, nextScheme).native;
  return previousNative.backdrop !== nextNative.backdrop;
}

export function effectiveNativeGlass(
  preferences: AppearancePreferences,
  scheme: AppearanceColorScheme,
): AppearanceNativeGlass {
  const theme = appearanceTheme(preferences, scheme).nativeGlass ?? DEFAULT_NATIVE_GLASS;
  return {
    variant:
      preferences.nativeGlassVariant === "theme" ? theme.variant : preferences.nativeGlassVariant,
  };
}

export function effectiveCodeTheme(
  preferences: AppearancePreferences,
  scheme: AppearanceColorScheme,
): { name: string; terminal: AppearanceTerminalPalette } {
  const selected = scheme === "light" ? preferences.lightCodeTheme : preferences.darkCodeTheme;
  const app = appearanceTheme(preferences, scheme);
  if (selected === "follow") return { name: app.codeTheme, terminal: app.terminal };
  const option = CODE_THEME_OPTIONS[selected];
  return {
    name: option[scheme],
    terminal: APPEARANCE_THEMES[option.source][scheme]!.terminal,
  };
}

export function normalizeAppearancePreferences(value: unknown): AppearancePreferences {
  if (!value || typeof value !== "object") return { ...DEFAULT_APPEARANCE_PREFERENCES };
  const input = value as Partial<Record<keyof AppearancePreferences, unknown>>;
  const pick = <T extends string>(candidate: unknown, values: readonly T[], fallback: T): T =>
    typeof candidate === "string" && values.includes(candidate as T) ? (candidate as T) : fallback;
  const number = (candidate: unknown, min: number, max: number, fallback: number) =>
    typeof candidate === "number" && Number.isFinite(candidate)
      ? Math.min(max, Math.max(min, Math.round(candidate)))
      : fallback;
  const legacy = input.version !== 3;
  const themeNumber = (candidate: unknown, min: number, max: number, legacyDefault: number) => {
    if (candidate === "theme") return "theme";
    if (typeof candidate !== "number" || !Number.isFinite(candidate)) return "theme";
    const normalized = Math.min(max, Math.max(min, Math.round(candidate)));
    return legacy && normalized === legacyDefault ? "theme" : normalized;
  };
  const lightTheme = pick(
    input.lightTheme,
    APPEARANCE_THEME_IDS,
    DEFAULT_APPEARANCE_PREFERENCES.lightTheme,
  );
  const darkTheme = pick(
    input.darkTheme,
    APPEARANCE_THEME_IDS,
    DEFAULT_APPEARANCE_PREFERENCES.darkTheme,
  );
  return {
    version: 3,
    source: input.source === "system" ? "system" : "palot",
    systemPalette:
      input.systemPalette === "macos" || input.systemPalette === "omarchy"
        ? input.systemPalette
        : null,
    followOmarchyFont: input.followOmarchyFont === true,
    alwaysShowScrollbars: input.alwaysShowScrollbars === true,
    linuxBackgroundOpacity:
      typeof input.linuxBackgroundOpacity === "number" &&
      Number.isFinite(input.linuxBackgroundOpacity)
        ? Math.max(60, Math.min(100, input.linuxBackgroundOpacity))
        : 100,
    omarchyTheme: normalizeOmarchyTheme(input.omarchyTheme),
    mode: pick(input.mode, APPEARANCE_MODES, DEFAULT_APPEARANCE_PREFERENCES.mode),
    lightTheme: APPEARANCE_THEMES[lightTheme].light
      ? lightTheme
      : DEFAULT_APPEARANCE_PREFERENCES.lightTheme,
    darkTheme: APPEARANCE_THEMES[darkTheme].dark
      ? darkTheme
      : DEFAULT_APPEARANCE_PREFERENCES.darkTheme,
    lightCodeTheme: pick(
      input.lightCodeTheme,
      CODE_THEME_IDS,
      DEFAULT_APPEARANCE_PREFERENCES.lightCodeTheme,
    ),
    darkCodeTheme: pick(
      input.darkCodeTheme,
      CODE_THEME_IDS,
      DEFAULT_APPEARANCE_PREFERENCES.darkCodeTheme,
    ),
    uiFont: pick(input.uiFont, UI_FONT_IDS, DEFAULT_APPEARANCE_PREFERENCES.uiFont),
    codeFont: pick(input.codeFont, CODE_FONT_IDS, DEFAULT_APPEARANCE_PREFERENCES.codeFont),
    uiFontSize: number(input.uiFontSize, 13, 19, DEFAULT_APPEARANCE_PREFERENCES.uiFontSize),
    codeFontSize: number(input.codeFontSize, 10, 18, DEFAULT_APPEARANCE_PREFERENCES.codeFontSize),
    terminalFontSize: number(
      input.terminalFontSize,
      10,
      22,
      DEFAULT_APPEARANCE_PREFERENCES.terminalFontSize,
    ),
    lightContrast: number(
      input.lightContrast,
      0,
      100,
      DEFAULT_APPEARANCE_PREFERENCES.lightContrast,
    ),
    darkContrast: number(input.darkContrast, 0, 100, DEFAULT_APPEARANCE_PREFERENCES.darkContrast),
    glassOpacity: themeNumber(input.glassOpacity, 30, 100, 82),
    contentOpacity: number(
      input.contentOpacity,
      55,
      100,
      DEFAULT_APPEARANCE_PREFERENCES.contentOpacity,
    ),
    nativeGlassTint: themeNumber(input.nativeGlassTint, 0, 30, 0),
    nativeGlassVariant: pick(
      input.nativeGlassVariant,
      ["theme", ...NATIVE_GLASS_VARIANTS] as const,
      DEFAULT_APPEARANCE_PREFERENCES.nativeGlassVariant,
    ),
    windowMaterial: pick(
      input.windowMaterial,
      WINDOW_MATERIALS,
      DEFAULT_APPEARANCE_PREFERENCES.windowMaterial,
    ),
    sidebarMaterial: pick(
      input.sidebarMaterial,
      SIDEBAR_MATERIALS,
      DEFAULT_APPEARANCE_PREFERENCES.sidebarMaterial,
    ),
  };
}

export function isAppearancePreferences(value: unknown): value is AppearancePreferences {
  const normalized = normalizeAppearancePreferences(value);
  if (!value || typeof value !== "object") return false;
  return JSON.stringify(normalized) === JSON.stringify(value);
}

export interface AppearanceUpdateInput {
  preferences: AppearancePreferences;
  resolvedScheme: AppearanceColorScheme;
}

export interface AppearanceUpdateResult {
  preferences: AppearancePreferences;
  restartRequired: boolean;
}

export const APPEARANCE_ARGUMENT_PREFIX = "--palot-appearance=";
export const APPEARANCE_STORED_ARGUMENT = "--palot-appearance-stored";
export const REDUCED_TRANSPARENCY_ARGUMENT = "--palot-reduced-transparency";

export function serializeAppearancePreferences(preferences: AppearancePreferences): string {
  return `${APPEARANCE_ARGUMENT_PREFIX}${encodeURIComponent(JSON.stringify(preferences))}`;
}

export function parseAppearancePreferencesArgument(args: readonly string[]): AppearancePreferences {
  const raw = args
    .find((argument) => argument.startsWith(APPEARANCE_ARGUMENT_PREFIX))
    ?.slice(APPEARANCE_ARGUMENT_PREFIX.length);
  if (!raw) return { ...DEFAULT_APPEARANCE_PREFERENCES };
  try {
    return normalizeAppearancePreferences(JSON.parse(decodeURIComponent(raw)));
  } catch {
    return { ...DEFAULT_APPEARANCE_PREFERENCES };
  }
}

export function hasStoredAppearancePreferencesArgument(args: readonly string[]): boolean {
  return args.includes(APPEARANCE_STORED_ARGUMENT);
}
