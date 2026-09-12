import {
  APPEARANCE_THEMES,
  CODE_FONT_OPTIONS,
  CODE_THEME_OPTIONS,
  UI_FONT_OPTIONS,
  appearanceTheme,
  effectiveAppearanceTreatment,
  effectiveCodeTheme,
  type AppearanceColorScheme,
  type AppearancePreferences,
  type AppearanceSurfaceRecipe,
  type ResolvedAppearanceTreatment,
  type AppearanceTerminalPalette,
  type NativeSystemAppearance,
  type NativeSystemColors,
} from "../../shared";
import { registerOmarchyCodeTheme } from "./theme-catalog";

export interface ResolvedAppearance {
  preferences: AppearancePreferences;
  scheme: AppearanceColorScheme;
  themeID: string;
  codeThemeName: string;
  codeThemePair: { light: string; dark: string };
  terminal: AppearanceTerminalPalette;
  treatment: ResolvedAppearanceTreatment;
  uiFontFamily: string;
  codeFontFamily: string;
}

const THEME_STYLE_ID = "palot-theme";
let appearanceRevision = 0;

function contrastColor(
  color: string,
  background: string,
  foreground: string,
  contrast: number,
  maximumMix: number,
): string {
  if (contrast === 50) return color;
  const target = contrast > 50 ? foreground : background;
  const amount = (Math.abs(contrast - 50) / 50) * maximumMix;
  return `color-mix(in oklch, ${color} ${100 - amount}%, ${target})`;
}

export function applySidebarMaterialToRoot(root = document.documentElement): void {
  const preference = root.dataset.sidebarPreference ?? "automatic";
  const chromeTier = root.dataset.chromeTier ?? "opaque";
  if (root.dataset.reducedTransparency === "true") {
    root.dataset.sidebarMaterial = "solid";
    return;
  }
  root.dataset.sidebarMaterial =
    preference === "automatic" ? (chromeTier === "opaque" ? "solid" : "translucent") : preference;
}

export function applyNativeSystemColorsToRoot(
  colors: NativeSystemColors,
  root = document.documentElement,
): void {
  for (const [name, value] of Object.entries(colors)) {
    const cssName = name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
    root.style.setProperty(`--native-${cssName}`, value);
  }
}

export function applyNativeSystemAppearanceToRoot(
  appearance: NativeSystemAppearance,
  root = document.documentElement,
): void {
  applyNativeSystemColorsToRoot(appearance.colors, root);
  root.dataset.increasedContrast = String(appearance.increasedContrast);
  root.dataset.invertedColors = String(appearance.invertedColors);
  root.dataset.differentiateWithoutColor = String(appearance.differentiateWithoutColor);
  root.dataset.reducedMotion = String(appearance.reducedMotion);
}

function codeThemeName(preferences: AppearancePreferences, scheme: AppearanceColorScheme): string {
  return effectiveCodeTheme(preferences, scheme).name;
}

export function compositeSurfaceBackground(treatment: AppearanceSurfaceRecipe): string {
  if (treatment.opacity <= 0) return "transparent";
  if (treatment.opacity >= 100) return treatment.surface;
  return `color-mix(in ${treatment.blendSpace}, ${treatment.surface} ${treatment.opacity}%, transparent)`;
}

function adjustedCompositeSurface(
  treatment: AppearanceSurfaceRecipe,
  source: string,
  adjusted: string,
): AppearanceSurfaceRecipe {
  return {
    ...treatment,
    surface: treatment.surface === source ? adjusted : treatment.surface,
    opaqueSurface: treatment.opaqueSurface === source ? adjusted : treatment.opaqueSurface,
  };
}

export function resolveAppearance(
  preferences: AppearancePreferences,
  scheme: AppearanceColorScheme,
): ResolvedAppearance {
  if (preferences.source === "system" && preferences.omarchyTheme)
    registerOmarchyCodeTheme(preferences.omarchyTheme);
  const themeID =
    preferences.source === "system" && preferences.systemPalette
      ? preferences.systemPalette
      : scheme === "light"
        ? preferences.lightTheme
        : preferences.darkTheme;
  const code = effectiveCodeTheme(preferences, scheme);
  return {
    preferences,
    scheme,
    themeID,
    codeThemeName: code.name,
    codeThemePair: {
      light: codeThemeName(preferences, "light"),
      dark: codeThemeName(preferences, "dark"),
    },
    terminal: code.terminal,
    treatment: effectiveAppearanceTreatment(preferences, scheme),
    uiFontFamily: UI_FONT_OPTIONS[preferences.uiFont].css,
    codeFontFamily:
      preferences.source === "system" &&
      preferences.followOmarchyFont &&
      preferences.omarchyTheme?.font
        ? `"${preferences.omarchyTheme.font}", ${CODE_FONT_OPTIONS[preferences.codeFont].css}`
        : CODE_FONT_OPTIONS[preferences.codeFont].css,
  };
}

export function applyAppearanceToRoot(resolved: ResolvedAppearance): void {
  const root = document.documentElement;
  const { palette } = appearanceTheme(resolved.preferences, resolved.scheme);
  const { treatment } = resolved;
  const contrast =
    resolved.scheme === "light"
      ? resolved.preferences.lightContrast
      : resolved.preferences.darkContrast;
  const card = contrastColor(palette.card, palette.background, palette.foreground, contrast, 10);
  const popover = contrastColor(
    palette.popover,
    palette.background,
    palette.foreground,
    contrast,
    12,
  );
  const inspectorSurface = adjustedCompositeSurface(
    treatment.surfaces.inspector,
    palette.card,
    card,
  );
  const composerSurface = adjustedCompositeSurface(treatment.surfaces.composer, palette.card, card);
  const popoverSurface = adjustedCompositeSurface(
    treatment.surfaces.popover,
    palette.popover,
    popover,
  );
  const contentOpacity = resolved.preferences.contentOpacity;
  const contentHeaderOpacity = Math.min(100, contentOpacity + 4);
  const translucentContent = `color-mix(in oklch, ${palette.background} ${contentOpacity}%, transparent)`;
  const translucentContentHeader = `color-mix(in oklch, ${palette.background} ${contentHeaderOpacity}%, transparent)`;
  const commandBlendSpace = popoverSurface.blendSpace;
  const variables: Record<string, string> = {
    "--background": palette.background,
    "--foreground": treatment.text.primary,
    "--text-secondary": treatment.text.secondary,
    "--text-tertiary": treatment.text.tertiary,
    "--card": card,
    "--card-foreground": treatment.text.primary,
    "--popover": popover,
    "--popover-foreground": treatment.text.primary,
    "--primary": palette.primary,
    "--primary-foreground": palette.primaryForeground,
    "--secondary": contrastColor(
      palette.muted,
      palette.background,
      palette.foreground,
      contrast,
      20,
    ),
    "--secondary-foreground": treatment.text.primary,
    "--muted": contrastColor(palette.muted, palette.background, palette.foreground, contrast, 20),
    "--muted-foreground": treatment.text.secondary,
    "--accent": treatment.interaction.hover,
    "--accent-foreground": treatment.text.primary,
    "--control-hover": treatment.interaction.hover,
    "--control-pressed": treatment.interaction.pressed,
    "--control-selected": treatment.interaction.selected,
    "--control-selected-inactive": treatment.interaction.selectedInactive,
    "--disabled-foreground": treatment.interaction.disabledForeground,
    "--placeholder-foreground": treatment.interaction.placeholderForeground,
    "--link-foreground": treatment.interaction.linkForeground,
    "--destructive": palette.destructive,
    "--border": contrastColor(palette.border, palette.background, palette.foreground, contrast, 58),
    "--input": contrastColor(palette.input, palette.background, palette.foreground, contrast, 48),
    "--ring": palette.ring,
    "--success": palette.success,
    "--warning": palette.warning,
    "--info": palette.info,
    "--sidebar": treatment.sidebar.opaqueSurface,
    "--sidebar-foreground": treatment.text.sidebarPrimary,
    "--sidebar-secondary-foreground": treatment.text.sidebarSecondary,
    "--sidebar-tertiary-foreground": treatment.text.sidebarTertiary,
    "--sidebar-primary": palette.sidebarPrimary ?? palette.ring,
    "--sidebar-primary-foreground": palette.sidebarPrimaryForeground ?? palette.primaryForeground,
    "--sidebar-accent": treatment.sidebar.selected,
    "--sidebar-accent-foreground": treatment.text.sidebarPrimary,
    "--sidebar-border": contrastColor(
      palette.sidebarBorder,
      treatment.sidebar.surface,
      treatment.text.sidebarPrimary,
      contrast,
      58,
    ),
    "--sidebar-ring": palette.ring,
    "--code-background": resolved.terminal.background,
    "--code-foreground": resolved.terminal.foreground,
    "--code-selection": resolved.terminal.selectionBackground,
    "--selection": palette.selection,
    "--theme-font-ui": resolved.uiFontFamily,
    "--theme-font-code": resolved.codeFontFamily,
    "--theme-ui-font-size": `${resolved.preferences.uiFontSize}px`,
    "--theme-code-font-size": `${resolved.preferences.codeFontSize}px`,
    "--theme-terminal-font-size": `${resolved.preferences.terminalFontSize}px`,
    "--control-radius": treatment.shape.controlRadius,
    "--compact-control-radius": treatment.shape.compactControlRadius,
    "--surface-radius": treatment.shape.surfaceRadius,
    "--popover-radius": treatment.shape.popoverRadius,
    "--glass-sidebar-opacity": `${treatment.sidebar.opacity}%`,
    "--sidebar-background-opaque": treatment.sidebar.opaqueSurface,
    "--sidebar-background-translucent": compositeSurfaceBackground(treatment.sidebar),
    "--glass-sidebar-blur": `${treatment.sidebar.blur}px`,
    "--glass-sidebar-saturation": String(treatment.sidebar.saturation),
    "--palot-sidebar-hover": treatment.sidebar.hover,
    "--palot-sidebar-selected": treatment.sidebar.selected,
    "--glass-inspector-opacity": `${inspectorSurface.opacity}%`,
    "--glass-inspector-blur": `${inspectorSurface.blur}px`,
    "--glass-inspector-saturation": String(inspectorSurface.saturation),
    "--inspector-background-opaque": inspectorSurface.opaqueSurface,
    "--inspector-background-translucent": compositeSurfaceBackground(inspectorSurface),
    "--glass-composer-opacity": `${composerSurface.opacity}%`,
    "--glass-composer-blur": `${composerSurface.blur}px`,
    "--glass-composer-saturation": String(composerSurface.saturation),
    "--composer-background-opaque": composerSurface.opaqueSurface,
    "--composer-background-translucent": compositeSurfaceBackground(composerSurface),
    "--glass-popover-opacity": `${popoverSurface.opacity}%`,
    "--glass-popover-blur": `${popoverSurface.blur}px`,
    "--glass-popover-saturation": String(popoverSurface.saturation),
    "--popover-background-opaque": popoverSurface.opaqueSurface,
    "--popover-background-translucent": compositeSurfaceBackground(popoverSurface),
    "--command-background-opaque": popoverSurface.opaqueSurface,
    "--command-background-translucent": compositeSurfaceBackground(popoverSurface),
    "--command-surface-strong": `color-mix(in ${commandBlendSpace}, ${popoverSurface.surface} 88%, ${treatment.text.primary} 4%)`,
    "--command-backdrop": `color-mix(in oklch, ${palette.background} ${resolved.scheme === "light" ? 18 : 30}%, transparent)`,
    "--content-surface-opacity": `${contentOpacity}%`,
    "--content-header-opacity": `${contentHeaderOpacity}%`,
    "--content-background-opaque": palette.background,
    "--content-background-translucent": translucentContent,
    "--content-header-background-opaque": palette.background,
    "--content-header-background-translucent": translucentContentHeader,
  };

  let style = document.getElementById(THEME_STYLE_ID);
  if (!(style instanceof HTMLStyleElement)) {
    style = document.createElement("style");
    style.id = THEME_STYLE_ID;
    document.head.append(style);
  }
  style.textContent = `:root[data-theme][data-resolved-theme] {\n${Object.entries(variables)
    .map(([name, value]) => `  ${name}: ${value};`)
    .join("\n")}\n}`;
  root.dataset.appearance = resolved.preferences.mode;
  root.dataset.scrollbars = resolved.preferences.alwaysShowScrollbars ? "always" : "auto";
  root.dataset.linuxTranslucent = String(resolved.preferences.linuxBackgroundOpacity < 100);
  root.style.setProperty(
    "--linux-window-background",
    `color-mix(in srgb, ${palette.background} ${resolved.preferences.linuxBackgroundOpacity}%, transparent)`,
  );
  root.style.setProperty(
    "--linux-sidebar-background",
    `color-mix(in srgb, ${palette.sidebar} ${resolved.preferences.linuxBackgroundOpacity}%, transparent)`,
  );
  const desktopRounding =
    resolved.preferences.source === "system"
      ? resolved.preferences.omarchyTheme?.rounding
      : undefined;
  root.dataset.desktopShape = String(desktopRounding !== undefined);
  if (desktopRounding !== undefined)
    root.style.setProperty("--desktop-surface-radius", `${Math.min(16, desktopRounding)}px`);
  else root.style.removeProperty("--desktop-surface-radius");
  root.dataset.resolvedTheme = resolved.scheme;
  root.dataset.theme = resolved.themeID;
  root.dataset.codeTheme = resolved.codeThemeName;
  root.dataset.uiFont = resolved.preferences.uiFont;
  root.dataset.sidebarPreference = treatment.sidebar.material;
  applySidebarMaterialToRoot(root);
  root.dataset.windowMaterial = resolved.preferences.windowMaterial;
  root.dataset.nativeBackdrop = treatment.native.backdrop;
  root.dataset.contentTranslucent = String(resolved.preferences.contentOpacity < 100);
  root.dataset.themeRevision = String(++appearanceRevision);
  root.style.colorScheme = resolved.scheme;
}

export function themePreview(themeID: keyof typeof APPEARANCE_THEMES) {
  return APPEARANCE_THEMES[themeID];
}

export function codeThemeLabel(id: AppearancePreferences["lightCodeTheme"]): string {
  return id === "follow" ? "Follow app palette" : CODE_THEME_OPTIONS[id].name;
}
