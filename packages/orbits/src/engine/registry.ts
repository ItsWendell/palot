import type { ModeKey } from "../presets.js";
import { drawBraid } from "./braid.js";
import { drawGlobe, drawRubik, drawWave } from "./lattice.js";
import { drawMorph } from "./morph.js";
import { drawOrbits } from "./orbits.js";
import { drawRibbon } from "./ribbon.js";
import type { ModeDraw } from "./types.js";
import { drawWeb } from "./web.js";

export const MODE_DRAWS: Record<ModeKey, ModeDraw> = {
  orbits: drawOrbits,
  globe: drawGlobe,
  rubik: drawRubik,
  wave: drawWave,
  web: drawWeb,
  braid: drawBraid,
  ribbon: drawRibbon,
  ring: drawRibbon,
  morph: drawMorph,
};
