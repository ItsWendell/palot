/** Main-process persistence and native synchronization for desktop appearance. */

import { BrowserWindow, nativeTheme, systemPreferences } from "electron";
import Store from "electron-store";
import { OmarchyAppearance } from "./omarchy-appearance";
import {
  DEFAULT_APPEARANCE_PREFERENCES,
  appearanceTheme,
  appearanceUpdateRequiresRestart,
  effectiveAppearanceTreatment,
  normalizeAppearancePreferences,
  type AppearanceColorScheme,
  type AppearancePreferences,
  type AppearanceUpdateInput,
  type AppearanceUpdateResult,
  type NativeSystemAppearance,
  type NativeSystemColors,
} from "../shared/appearance-contract";
import { IPC_CHANNELS } from "../shared/opencode-contract";
import {
  getResolvedChromeTier,
  installLiquidGlass,
  nativeGlassOptions,
  removeLiquidGlassView,
  setResolvedChromeTier,
  updateLiquidGlassSettings,
} from "./liquid-glass";

class AppearanceService {
  private readonly store = new Store<{ preferences?: AppearancePreferences }>({
    name: "appearance",
  });
  private listening = false;
  private nativeColorSubscriptions: number[] = [];
  private nativeWorkspaceSubscriptions: number[] = [];
  private resolvedScheme: AppearanceColorScheme | null = null;
  private liquidGlassSuspendedForReducedTransparency = false;
  private readonly desktopThemeListeners = new Set<() => void>();
  private readonly omarchy = new OmarchyAppearance((theme) => {
    const previous = this.preferences();
    if (JSON.stringify(previous.omarchyTheme) === JSON.stringify(theme)) return;
    const preferences = { ...previous, omarchyTheme: theme, systemPalette: "omarchy" as const };
    this.store.set("preferences", preferences);
    for (const listener of this.desktopThemeListeners) listener();
    this.applyMode(preferences);
    this.resolvedScheme = this.currentScheme(preferences);
    this.applyWindowBackground(preferences, this.resolvedScheme);
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed())
        window.webContents.send(IPC_CHANNELS.appearanceChanged, preferences);
    }
  });

  async initializeDesktopAppearance(): Promise<void> {
    await this.omarchy.start();
  }

  onDesktopThemeChanged(listener: () => void): () => void {
    this.desktopThemeListeners.add(listener);
    return () => this.desktopThemeListeners.delete(listener);
  }

  preferences(): AppearancePreferences {
    const stored = this.store.get("preferences");
    const preferences = normalizeAppearancePreferences({
      ...(stored ?? DEFAULT_APPEARANCE_PREFERENCES),
      systemPalette:
        process.platform === "darwin"
          ? "macos"
          : stored?.omarchyTheme && process.platform === "linux"
            ? "omarchy"
            : null,
      omarchyTheme: process.platform === "linux" ? stored?.omarchyTheme : null,
    });
    if (stored && JSON.stringify(stored) !== JSON.stringify(preferences)) {
      this.store.set("preferences", preferences);
    }
    return preferences;
  }

  hasStoredPreferences(): boolean {
    return this.store.has("preferences");
  }

  applyMode(preferences = this.preferences()): void {
    nativeTheme.themeSource =
      preferences.source === "system" && preferences.omarchyTheme
        ? preferences.omarchyTheme.mode
        : preferences.source === "system"
          ? "system"
          : preferences.mode;
  }

  start(): void {
    if (this.listening) return;
    this.listening = true;
    this.resolvedScheme = this.currentScheme(this.preferences());
    nativeTheme.on("updated", this.handleNativeThemeUpdated);
    if (process.platform === "darwin") {
      this.nativeColorSubscriptions = [
        "AppleColorPreferencesChangedNotification",
        "AppleAquaColorVariantChanged",
      ].map((notification) =>
        systemPreferences.subscribeNotification(notification, this.handleNativeColorsChanged),
      );
      this.nativeWorkspaceSubscriptions = [
        "NSWorkspaceAccessibilityDisplayOptionsDidChangeNotification",
      ].map((notification) =>
        systemPreferences.subscribeWorkspaceNotification(
          notification,
          this.handleNativeColorsChanged,
        ),
      );
    } else {
      systemPreferences.on("accent-color-changed", this.handleNativeColorsChanged);
    }
  }

  shutdown(): void {
    this.omarchy.stop();
    if (!this.listening) return;
    this.listening = false;
    nativeTheme.off("updated", this.handleNativeThemeUpdated);
    if (process.platform === "darwin") {
      for (const subscription of this.nativeColorSubscriptions) {
        systemPreferences.unsubscribeNotification(subscription);
      }
      this.nativeColorSubscriptions = [];
      for (const subscription of this.nativeWorkspaceSubscriptions) {
        systemPreferences.unsubscribeWorkspaceNotification(subscription);
      }
      this.nativeWorkspaceSubscriptions = [];
    } else {
      systemPreferences.off("accent-color-changed", this.handleNativeColorsChanged);
    }
  }

  update(input: AppearanceUpdateInput): AppearanceUpdateResult {
    const previous = this.preferences();
    const preferences = normalizeAppearancePreferences({
      ...input.preferences,
      omarchyTheme: previous.omarchyTheme,
      systemPalette: previous.systemPalette,
    });
    const resolvedScheme =
      preferences.source === "system" && preferences.omarchyTheme
        ? preferences.omarchyTheme.mode
        : input.resolvedScheme;
    const previousScheme = this.resolvedScheme ?? this.currentScheme(previous);
    const preferencesChanged = JSON.stringify(previous) !== JSON.stringify(preferences);
    const restartRequired =
      (process.platform === "linux" &&
        previous.linuxBackgroundOpacity < 100 !== preferences.linuxBackgroundOpacity < 100) ||
      appearanceUpdateRequiresRestart(previous, previousScheme, preferences, resolvedScheme);
    this.store.set("preferences", preferences);
    this.applyMode(preferences);
    this.resolvedScheme = resolvedScheme;
    if (
      previous.source !== preferences.source ||
      previous.followOmarchyFont !== preferences.followOmarchyFont
    )
      void this.omarchy.refresh();
    this.applyWindowBackground(preferences, resolvedScheme);
    updateLiquidGlassSettings(nativeGlassOptions(preferences, resolvedScheme));
    if (preferencesChanged) {
      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed()) {
          window.webContents.send(IPC_CHANNELS.appearanceChanged, preferences);
        }
      }
    }
    return { preferences, restartRequired };
  }

  backgroundColor(
    preferences: AppearancePreferences,
    scheme: AppearanceColorScheme,
    tier = getResolvedChromeTier(),
    reducedTransparency = nativeTheme.prefersReducedTransparency,
  ): string {
    if (
      process.platform === "linux" &&
      preferences.linuxBackgroundOpacity < 100 &&
      !reducedTransparency
    )
      return "#00000000";
    return tier === "opaque" || reducedTransparency
      ? appearanceTheme(preferences, scheme).nativeBackground
      : "#00000000";
  }

  nativeSystemAppearance(): NativeSystemAppearance {
    return {
      colors: this.nativeSystemColors(),
      increasedContrast: nativeTheme.shouldUseHighContrastColors,
      invertedColors: nativeTheme.shouldUseInvertedColorScheme,
      differentiateWithoutColor:
        process.platform === "darwin" && nativeTheme.shouldDifferentiateWithoutColor,
      reducedMotion: systemPreferences.getAnimationSettings().prefersReducedMotion,
    };
  }

  private nativeSystemColors(): NativeSystemColors {
    const normalize = (value: string, fallback: string) => {
      const color = value.startsWith("#") ? value : `#${value}`;
      return /^#[\da-f]{6}([\da-f]{2})?$/i.test(color) ? color : fallback;
    };
    const color = (name: Parameters<typeof systemPreferences.getColor>[0], fallback: string) => {
      try {
        return normalize(systemPreferences.getColor(name), fallback);
      } catch {
        return fallback;
      }
    };
    const systemColor = (
      name: Parameters<typeof systemPreferences.getSystemColor>[0],
      fallback: string,
    ) => {
      try {
        return normalize(systemPreferences.getSystemColor(name), fallback);
      } catch {
        return fallback;
      }
    };
    const dark = nativeTheme.shouldUseDarkColors;
    const accent = () => {
      const fallback = dark ? "#0a84ffff" : "#007affff";
      try {
        return normalize(systemPreferences.getAccentColor(), fallback);
      } catch {
        return fallback;
      }
    };

    return {
      accent: accent(),
      blue: systemColor("blue", dark ? "#0a84ffff" : "#007affff"),
      control: color("control", dark ? "#3a3a3cff" : "#f2f2f2ff"),
      controlBackground: color("control-background", dark ? "#2c2c2eff" : "#ffffffff"),
      controlText: color("control-text", dark ? "#f5f5f7ff" : "#1d1d1fff"),
      disabledControlText: color("disabled-control-text", dark ? "#777777ff" : "#999999ff"),
      green: systemColor("green", dark ? "#30d158ff" : "#34c759ff"),
      keyboardFocusIndicator: color("keyboard-focus-indicator", dark ? "#1b91ffff" : "#0067f4ff"),
      label: color("label", dark ? "#f5f5f7ff" : "#1d1d1fff"),
      link: color("link", dark ? "#419cffff" : "#0068daff"),
      orange: systemColor("orange", dark ? "#ff9f0aff" : "#ff9500ff"),
      placeholderText: color("placeholder-text", dark ? "#98989dff" : "#8e8e93ff"),
      purple: systemColor("purple", dark ? "#bf5af2ff" : "#af52deff"),
      quaternaryLabel: color("quaternary-label", dark ? "#545458ff" : "#c7c7ccff"),
      red: systemColor("red", dark ? "#ff453aff" : "#ff3b30ff"),
      secondaryLabel: color("secondary-label", dark ? "#98989dff" : "#6e6e73ff"),
      selectedControl: color("selected-control", dark ? "#545458ff" : "#d9d9d9ff"),
      selectedContentBackground: color(
        "selected-content-background",
        dark ? "#3f638bcc" : "#b3d7ffcc",
      ),
      selectedControlText: color("selected-control-text", "#ffffffff"),
      selectedText: color("selected-text", dark ? "#ffffffff" : "#000000ff"),
      selectedTextBackground: color("selected-text-background", dark ? "#3f638bcc" : "#b3d7ffcc"),
      separator: color("separator", dark ? "#54545899" : "#3c3c434a"),
      tertiaryLabel: color("tertiary-label", "#8e8e93ff"),
      text: color("text", dark ? "#f5f5f7ff" : "#1d1d1fff"),
      textBackground: color("text-background", dark ? "#1e1e1eff" : "#ffffffff"),
      underPageBackground: color("under-page-background", dark ? "#171717ff" : "#e8e8e8ff"),
      unemphasizedSelectedContentBackground: color(
        "unemphasized-selected-content-background",
        dark ? "#454545ff" : "#dcdcdcff",
      ),
      unemphasizedSelectedText: color(
        "unemphasized-selected-text",
        dark ? "#d1d1d6ff" : "#3a3a3cff",
      ),
      unemphasizedSelectedTextBackground: color(
        "unemphasized-selected-text-background",
        dark ? "#454545ff" : "#dcdcdcff",
      ),
      windowBackground: color("window-background", dark ? "#1e1e1eff" : "#ecececff"),
      windowFrameText: color("window-frame-text", dark ? "#f5f5f7ff" : "#1d1d1fff"),
    };
  }

  private applyWindowBackground(
    preferences: AppearancePreferences,
    scheme: AppearanceColorScheme,
  ): void {
    const color = this.backgroundColor(preferences, scheme);
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.setBackgroundColor(color);
    }
  }

  private currentScheme(preferences: AppearancePreferences): AppearanceColorScheme {
    if (preferences.source === "system" && preferences.omarchyTheme)
      return preferences.omarchyTheme.mode;
    return preferences.source === "system" || preferences.mode === "system"
      ? nativeTheme.shouldUseDarkColors
        ? "dark"
        : "light"
      : preferences.mode;
  }

  private broadcastNativeSystemColors(): void {
    const appearance = this.nativeSystemAppearance();
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send(IPC_CHANNELS.nativeSystemAppearanceChanged, appearance);
      }
    }
  }

  private readonly handleNativeColorsChanged = (): void => {
    this.broadcastNativeSystemColors();
  };

  private readonly handleNativeThemeUpdated = async (): Promise<void> => {
    const reduced = nativeTheme.prefersReducedTransparency;
    const preferences = this.preferences();
    const scheme = this.currentScheme(preferences);
    const treatment = effectiveAppearanceTreatment(preferences, scheme);
    let tier = getResolvedChromeTier();

    if (process.platform === "darwin" && tier === "liquid-glass" && reduced) {
      removeLiquidGlassView();
      this.liquidGlassSuspendedForReducedTransparency = true;
      tier = "opaque";
      setResolvedChromeTier(tier);
    } else if (process.platform === "darwin" && tier === "vibrancy" && reduced) {
      for (const window of BrowserWindow.getAllWindows()) {
        window.setVibrancy(null);
      }
      tier = "opaque";
      setResolvedChromeTier(tier);
    } else if (
      process.platform === "darwin" &&
      tier === "opaque" &&
      !reduced &&
      process.env.PALOT_DISABLE_GLASS !== "1" &&
      treatment.native.backdrop !== "opaque"
    ) {
      const windows = BrowserWindow.getAllWindows();
      const window = windows[0];
      if (this.liquidGlassSuspendedForReducedTransparency && window) {
        setResolvedChromeTier("liquid-glass");
        tier = await installLiquidGlass(window, nativeGlassOptions(preferences, scheme));
        this.liquidGlassSuspendedForReducedTransparency = false;
      } else {
        const vibrancy = treatment.native.backdrop === "vibrancy-menu" ? "menu" : "sidebar";
        for (const target of windows) target.setVibrancy(vibrancy);
        tier = "vibrancy";
        setResolvedChromeTier(tier);
      }
    } else if (!reduced && treatment.native.backdrop === "opaque") {
      this.liquidGlassSuspendedForReducedTransparency = false;
    }

    const background = this.backgroundColor(preferences, scheme, tier, reduced);
    updateLiquidGlassSettings(nativeGlassOptions(preferences, scheme));
    const appearance = this.nativeSystemAppearance();
    for (const window of BrowserWindow.getAllWindows()) {
      if (window.isDestroyed()) continue;
      window.setBackgroundColor(background);
      window.webContents.send(IPC_CHANNELS.reducedTransparencyChanged, reduced);
      window.webContents.send(IPC_CHANNELS.chromeTierChanged, tier);
      window.webContents.send(IPC_CHANNELS.nativeSystemAppearanceChanged, appearance);
    }
  };
}

let service: AppearanceService | null = null;

export function appearanceService(): AppearanceService {
  return (service ??= new AppearanceService());
}
