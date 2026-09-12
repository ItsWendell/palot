import type { ModeOpts } from "./profiles.js";

export type { Dot, Line } from "./core.js";

export type ModeDraw = (
  context: CanvasRenderingContext2D,
  size: number,
  time: number,
  dark: boolean,
  options: ModeOpts,
) => void;
