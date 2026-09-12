import type { CanvasHTMLAttributes, CSSProperties } from "react";

/** The nine animation states provided by the package. */
export type OrbState =
  | "working"
  | "searching"
  | "solving"
  | "listening"
  | "connecting"
  | "weaving"
  | "composing"
  | "breathing"
  | "shaping";

/**
 * Rendered size in CSS pixels. The engine is tuned for 64px and 20px.
 * Other values use the nearest tuned profile and render at the requested size.
 */
export type OrbSize = number;

export type OrbTheme = "auto" | "dark" | "light";

export interface ThinkingOrbProps extends Omit<
  CanvasHTMLAttributes<HTMLCanvasElement>,
  "color" | "height" | "style" | "width"
> {
  /** Which animation to show. @default "working" */
  state?: OrbState;
  /** Size in CSS pixels. @default 64 */
  size?: OrbSize;
  /** Theme mode. @default "auto" */
  theme?: OrbTheme;
  /** Animation speed multiplier. @default 1 */
  speed?: number;
  /** Freeze the animation on the current frame. @default false */
  paused?: boolean;
  /** Optional color wash. Monochrome is used when this is omitted. */
  tint?: string;
  style?: CSSProperties;
}
