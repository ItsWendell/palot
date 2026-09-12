/**
 * Three-tier macOS window chrome.
 *
 * macOS 26 and later use a native NSGlassEffectView. Older macOS versions use
 * Electron vibrancy. Other platforms and explicit opt-out use an opaque window.
 */

import type { BrowserWindow, BrowserWindowConstructorOptions } from "electron";
import {
  appearanceTheme,
  effectiveAppearanceTreatment,
  effectiveNativeGlass,
  NATIVE_GLASS_VARIANT_VALUES,
  type AppearanceColorScheme,
  type AppearanceNativeBackdrop,
  type AppearancePreferences,
  type WindowMaterialPreference,
} from "../shared/appearance-contract";
import type { WindowChromeTier } from "../shared/window-chrome";

export interface LiquidGlassViewOptions {
  cornerRadius?: number;
  tintColor?: string;
  opaque?: boolean;
  appearance?: AppearanceColorScheme | "system";
}

export interface LiquidGlassOptions extends LiquidGlassViewOptions {
  variant?: number;
  scrim?: 0 | 1;
  subdued?: 0 | 1;
}

export interface LiquidGlassModule {
  isGlassSupported(): boolean;
  addView(handle: Buffer, options?: LiquidGlassViewOptions): number;
  removeView?(id: number): void;
  unstable_setVariant?(id: number, variant: number): void;
  unstable_setScrim?(id: number, scrim: number): void;
  unstable_setSubdued?(id: number, subdued: number): void;
  setAppearance?(id: number, appearance: AppearanceColorScheme | "system"): void;
  setTintColor?(id: number, tintColor: string): void;
}

export interface LiquidGlassWindow {
  isDestroyed?(): boolean;
  once?(event: "closed", listener: () => void): unknown;
  setWindowButtonVisibility(visible: boolean): void;
  getNativeWindowHandle(): Buffer;
  setVibrancy(vibrancy: "menu" | "sidebar" | null): void;
}

interface LiquidGlassImport {
  default: LiquidGlassModule;
}

interface ChromeEnvironment {
  platform: NodeJS.Platform;
  disabled: boolean;
  glassSupported: boolean;
  preference?: WindowMaterialPreference;
  backdrop?: AppearanceNativeBackdrop;
  reducedTransparency?: boolean;
}

export interface WindowChromeResult {
  tier: WindowChromeTier;
  options: Partial<BrowserWindowConstructorOptions>;
}

export function nativeGlassOptions(
  preferences: AppearancePreferences,
  scheme: AppearanceColorScheme,
): LiquidGlassOptions {
  const glass = effectiveNativeGlass(preferences, scheme);
  const tint = effectiveAppearanceTreatment(preferences, scheme).native.tint;
  const options: LiquidGlassOptions = {
    appearance: scheme,
    variant: NATIVE_GLASS_VARIANT_VALUES[glass.variant],
  };
  const background = appearanceTheme(preferences, scheme).nativeBackground;
  const alpha = Math.round((tint / 100) * 255)
    .toString(16)
    .padStart(2, "0");
  return { ...options, tintColor: `${background}${alpha}` };
}

let glassImport: LiquidGlassImport | null = null;
let glassSupport: boolean | null = null;
let resolvedTier: WindowChromeTier = "opaque";
let resolvedVibrancy: "menu" | "sidebar" = "sidebar";
const activeGlassViews = new Map<LiquidGlassWindow, { id: number; module: LiquidGlassModule }>();
const observedWindows = new WeakSet<LiquidGlassWindow>();
let removalGeneration = 0;

export function getResolvedChromeTier(): WindowChromeTier {
  return resolvedTier;
}

export function setResolvedChromeTier(tier: WindowChromeTier): void {
  resolvedTier = tier;
}

export function selectWindowChromeTier(environment: ChromeEnvironment): WindowChromeTier {
  const backdrop =
    environment.preference === "opaque"
      ? "opaque"
      : environment.preference === "native"
        ? "adaptive"
        : (environment.backdrop ?? "adaptive");
  if (
    environment.disabled ||
    environment.reducedTransparency ||
    backdrop === "opaque" ||
    environment.platform !== "darwin"
  ) {
    return "opaque";
  }
  if (backdrop === "vibrancy-menu" || backdrop === "vibrancy-sidebar") return "vibrancy";
  return environment.glassSupported ? "liquid-glass" : "vibrancy";
}

async function loadLiquidGlass(): Promise<LiquidGlassImport | null> {
  if (process.platform !== "darwin") return null;
  if (glassImport) return glassImport;

  try {
    const moduleName = "electron-liquid-glass";
    glassImport = (await import(/* @vite-ignore */ moduleName)) as LiquidGlassImport;
    return glassImport;
  } catch (error) {
    console.warn("[window-chrome] Native Liquid Glass module could not load", error);
    return null;
  }
}

async function isLiquidGlassSupported(): Promise<boolean> {
  if (glassSupport !== null) return glassSupport;

  const module = await loadLiquidGlass();
  try {
    glassSupport = module?.default.isGlassSupported() ?? false;
  } catch (error) {
    console.warn("[window-chrome] Native Liquid Glass support check failed", error);
    glassSupport = false;
  }
  return glassSupport;
}

export async function resolveWindowChrome(
  preference: WindowMaterialPreference = "automatic",
  reducedTransparency = false,
  backdrop: AppearanceNativeBackdrop = "adaptive",
): Promise<WindowChromeResult> {
  const disabled = process.env.PALOT_DISABLE_GLASS === "1";
  const glassSupported = disabled ? false : await isLiquidGlassSupported();
  const tier = selectWindowChromeTier({
    platform: process.platform,
    disabled,
    glassSupported,
    preference,
    backdrop,
    reducedTransparency,
  });
  resolvedTier = tier;
  resolvedVibrancy = backdrop === "vibrancy-menu" ? "menu" : "sidebar";

  const macChrome =
    process.platform === "darwin"
      ? {
          titleBarStyle: "hiddenInset" as const,
          trafficLightPosition: { x: 16, y: 10 },
        }
      : {};

  if (tier === "liquid-glass") {
    console.info("[window-chrome] Using native Liquid Glass");
    return { tier, options: { ...macChrome, transparent: true } };
  }

  if (tier === "vibrancy") {
    console.info("[window-chrome] Using Electron vibrancy fallback");
    return {
      tier,
      options: {
        ...macChrome,
        vibrancy: resolvedVibrancy,
        visualEffectState: "active",
      },
    };
  }

  console.info("[window-chrome] Using opaque window chrome");
  return { tier, options: macChrome };
}

function useVibrancyFallback(window: LiquidGlassWindow): WindowChromeTier {
  removeWindowGlassView(window);
  if (window.isDestroyed?.()) return resolvedTier;
  try {
    window.setVibrancy(resolvedVibrancy);
    resolvedTier = "vibrancy";
  } catch (error) {
    console.error("[window-chrome] Electron vibrancy fallback failed", error);
    resolvedTier = "opaque";
  }
  return resolvedTier;
}

function applyUnstableGlassSetting(name: string, apply: (() => void) | undefined): void {
  if (!apply) return;
  try {
    apply();
  } catch (error) {
    console.warn(`[window-chrome] Native Liquid Glass ${name} setting failed`, error);
  }
}

function applyLiquidGlassSettings(
  module: LiquidGlassModule,
  viewId: number,
  options: LiquidGlassOptions,
): void {
  if (options.variant !== undefined) {
    applyUnstableGlassSetting("variant", () =>
      module.unstable_setVariant?.(viewId, options.variant!),
    );
  }
  if (options.scrim !== undefined) {
    applyUnstableGlassSetting("scrim", () => module.unstable_setScrim?.(viewId, options.scrim!));
  }
  if (options.subdued !== undefined) {
    applyUnstableGlassSetting("subdued", () =>
      module.unstable_setSubdued?.(viewId, options.subdued!),
    );
  }
  if (options.appearance !== undefined) {
    applyUnstableGlassSetting("appearance", () =>
      module.setAppearance?.(viewId, options.appearance!),
    );
  }
  if (options.tintColor !== undefined) {
    applyUnstableGlassSetting("tint color", () =>
      module.setTintColor?.(viewId, options.tintColor!),
    );
  }
}

export function updateLiquidGlassSettings(options: LiquidGlassOptions): void {
  for (const [window, installed] of activeGlassViews) {
    if (window.isDestroyed?.()) {
      removeWindowGlassView(window);
      continue;
    }
    applyLiquidGlassSettings(installed.module, installed.id, options);
  }
}

function removeWindowGlassView(window: LiquidGlassWindow): void {
  const installed = activeGlassViews.get(window);
  if (!installed) return;
  activeGlassViews.delete(window);
  applyUnstableGlassSetting("removal", () => installed.module.removeView?.(installed.id));
}

export function removeLiquidGlassView(): void {
  removalGeneration++;
  for (const window of activeGlassViews.keys()) removeWindowGlassView(window);
}

export function applyLiquidGlassView(
  window: LiquidGlassWindow,
  module: LiquidGlassModule,
  options: LiquidGlassOptions = {},
): WindowChromeTier {
  if (window.isDestroyed?.()) return resolvedTier;
  removeWindowGlassView(window);
  try {
    window.setWindowButtonVisibility(true);
    const { variant, scrim, subdued, ...viewOptions } = options;
    const viewId = module.addView(window.getNativeWindowHandle(), viewOptions);
    if (viewId === -1) {
      console.warn("[window-chrome] Native Liquid Glass returned -1, using vibrancy");
      return useVibrancyFallback(window);
    }

    activeGlassViews.set(window, { id: viewId, module });
    if (window.once && !observedWindows.has(window)) {
      observedWindows.add(window);
      window.once("closed", () => removeWindowGlassView(window));
    }
    applyLiquidGlassSettings(module, viewId, {
      appearance: viewOptions.appearance,
      tintColor: viewOptions.tintColor,
      variant,
      scrim,
      subdued,
    });

    resolvedTier = "liquid-glass";
    console.info(`[window-chrome] Native Liquid Glass installed with view ${viewId}`);
    return resolvedTier;
  } catch (error) {
    console.error("[window-chrome] Native Liquid Glass installation failed", error);
    return useVibrancyFallback(window);
  }
}

export async function installLiquidGlass(
  window: BrowserWindow,
  options: LiquidGlassOptions = {},
): Promise<WindowChromeTier> {
  if (window.isDestroyed() || resolvedTier !== "liquid-glass") return resolvedTier;

  const generation = removalGeneration;
  const module = await loadLiquidGlass();
  if (window.isDestroyed() || generation !== removalGeneration || resolvedTier !== "liquid-glass")
    return resolvedTier;
  if (!module) return useVibrancyFallback(window);

  return applyLiquidGlassView(window, module.default, options);
}
