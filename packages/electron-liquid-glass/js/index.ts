import { EventEmitter } from "events";
import { execSync } from "child_process";
import { GlassMaterialVariant } from "./variants.js";

// Load the native addon using the 'bindings' module
// This will look for the compiled .node file in various places
import native from "./native-loader.js";

export interface GlassOptions {
  cornerRadius?: number;
  tintColor?: string;
  opaque?: boolean;
  appearance?: GlassAppearance;
}

export type GlassAppearance = "system" | "light" | "dark";

export interface LiquidGlassNative {
  addView(handle: Buffer, options: GlassOptions): number;
  removeView(id: number): void;
  setVariant(id: number, variant: GlassMaterialVariant): void;
  setScrimState(id: number, scrim: number): void;
  setSubduedState(id: number, subdued: number): void;
  setAppearance(id: number, appearance: GlassAppearance): void;
  setTintColor(id: number, tintColor: string): void;
}

// Create a nice JavaScript wrapper
class LiquidGlass extends EventEmitter {
  private _addon?: LiquidGlassNative;
  private _isGlassSupported: boolean | undefined;

  // Instance property for easy access to variants
  readonly GlassMaterialVariant: typeof GlassMaterialVariant = GlassMaterialVariant;

  constructor() {
    super();

    try {
      if (!this.isMacOS()) {
        return;
      }

      // Native addon uses liquid glass (macOS 26+)
      // or falls back to legacy blur as needed.
      this._addon = new native.LiquidGlassNative();
    } catch (err) {
      console.error(
        "electron-liquid-glass failed to load its native addon – liquid glass functionality will be disabled.",
        err,
      );
    }
  }

  private isMacOS(): boolean {
    return process.platform === "darwin";
  }

  /**
   * Check if liquid glass is supported on the current platform
   * @returns true if liquid glass is supported on the current platform
   */
  public isGlassSupported(): boolean {
    if (this._isGlassSupported !== undefined) return this._isGlassSupported;

    const supported =
      this.isMacOS() &&
      Number(execSync("sw_vers -productVersion").toString().trim().split(".")[0]) >= 26;

    this._isGlassSupported = supported;
    return supported;
  }

  /**
   * Wrap the Electron window with a glass / vibrancy view.
   *
   * ⚠️ Will gracefully fall back to legacy macOS blur if liquid glass is not supported.
   * @param handle BrowserWindow.getNativeWindowHandle()
   * @param options Glass effect options
   * @returns id – can be used for future API (remove/update), -1 if not supported
   */
  addView(handle: Buffer, options: GlassOptions = {}): number {
    if (!Buffer.isBuffer(handle)) {
      throw new Error("[liquidGlass.addView] handle must be a Buffer");
    }

    if (!this._addon) {
      // unavailable on this platform
      return -1;
    }

    return this._addon.addView(handle, options);
  }

  removeView(id: number): void {
    if (!this._addon || typeof this._addon.removeView !== "function") return;
    this._addon.removeView(id);
  }

  private setVariant(id: number, variant: GlassMaterialVariant): void {
    if (!this._addon || typeof this._addon.setVariant !== "function") return;
    this._addon.setVariant(id, variant);
  }

  unstable_setVariant(id: number, variant: GlassMaterialVariant): void {
    this.setVariant(id, variant);
  }

  unstable_setScrim(id: number, scrim: number): void {
    if (!this._addon || typeof this._addon.setScrimState !== "function") return;
    this._addon.setScrimState(id, scrim);
  }

  unstable_setSubdued(id: number, subdued: number): void {
    if (!this._addon || typeof this._addon.setSubduedState !== "function") return;
    this._addon.setSubduedState(id, subdued);
  }

  setAppearance(id: number, appearance: GlassAppearance): void {
    if (!this._addon || typeof this._addon.setAppearance !== "function") return;
    this._addon.setAppearance(id, appearance);
  }

  setTintColor(id: number, tintColor: string): void {
    if (!this._addon || typeof this._addon.setTintColor !== "function") return;
    this._addon.setTintColor(id, tintColor);
  }
}

// Create and export the singleton instance
// The class constructor handles platform checks internally
const liquidGlass: LiquidGlass = new LiquidGlass();

export default liquidGlass;
