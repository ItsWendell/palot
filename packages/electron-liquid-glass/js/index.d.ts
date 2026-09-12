export type GlassAppearance = "system" | "light" | "dark";

export interface GlassOptions {
  cornerRadius?: number;
  tintColor?: string;
  opaque?: boolean;
  appearance?: GlassAppearance;
}

export interface LiquidGlass {
  isGlassSupported(): boolean;
  addView(handle: Buffer, options?: GlassOptions): number;
  removeView(id: number): void;
  unstable_setVariant(id: number, variant: number): void;
  unstable_setScrim(id: number, scrim: number): void;
  unstable_setSubdued(id: number, subdued: number): void;
  setAppearance(id: number, appearance: GlassAppearance): void;
  setTintColor(id: number, tintColor: string): void;
}

declare const liquidGlass: LiquidGlass;
export default liquidGlass;
