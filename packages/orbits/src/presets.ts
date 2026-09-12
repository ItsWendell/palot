import type { ModeOpts } from "./engine/profiles.js";
import { BASE_PROFILES, scaleCounts, scaleRadii } from "./engine/profiles.js";
import type { OrbState } from "./types.js";

export type ModeKey =
  | "orbits"
  | "globe"
  | "rubik"
  | "wave"
  | "web"
  | "braid"
  | "ribbon"
  | "ring"
  | "morph";

export const STATE_TO_MODE: Record<OrbState, ModeKey> = {
  working: "orbits",
  searching: "globe",
  solving: "rubik",
  listening: "wave",
  connecting: "web",
  weaving: "braid",
  composing: "ribbon",
  breathing: "ring",
  shaping: "morph",
};

interface Preset {
  speed: number;
  count: number;
  size: number;
  extra?: ModeOpts;
}

type PresetSize = 64 | 20;

const PRESETS: Record<ModeKey, Record<PresetSize, Preset>> = {
  orbits: {
    64: { speed: 1.885, count: 1, size: 1 },
    20: { speed: 3.9, count: 0.238, size: 2.4 },
  },
  globe: {
    64: { speed: 2.015, count: 0.42, size: 1.15, extra: { scanMul: 4.08, dimBase: 0.45 } },
    20: { speed: 2.665, count: 0.105, size: 1.75, extra: { scanMul: 4.335, dimBase: 0.45 } },
  },
  rubik: {
    64: { speed: 1.82, count: 0.35, size: 1.05 },
    20: { speed: 1.95, count: 0.088, size: 1.9 },
  },
  wave: {
    64: { speed: 4.388, count: 0.341, size: 1 },
    20: { speed: 3.998, count: 0.105, size: 1.6 },
  },
  web: {
    64: { speed: 3.315, count: 1.35, size: 0.95 },
    20: { speed: 6.63, count: 0.25, size: 1.52 },
  },
  braid: {
    64: { speed: 1.625, count: 0.5, size: 1 },
    20: { speed: 2.75, count: 0.1125, size: 1.36 },
  },
  ribbon: {
    64: {
      speed: 2.34,
      count: 0.25,
      size: 0.85,
      extra: { spin: 0, bandMul: 3.9, wobMul: 1 },
    },
    20: {
      speed: 3.12,
      count: 0.051,
      size: 1.073,
      extra: { spin: 0, bandMul: 4.94, wobMul: 1 },
    },
  },
  ring: {
    64: {
      speed: 3.05,
      count: 0.25,
      size: 0.956,
      extra: { spin: 0, bandMul: 3.627, wobMul: 0.368 },
    },
    20: {
      speed: 3.58,
      count: 0.028,
      size: 1.622,
      extra: { spin: 0, bandMul: 3.968, wobMul: 0.565 },
    },
  },
  morph: {
    64: { speed: 2.405, count: 0.702, size: 0.395, extra: { spread: 1.4 } },
    20: { speed: 2.08, count: 0.53, size: 1.011, extra: { spread: 1.4 } },
  },
};

export interface ResolvedPreset {
  mode: ModeKey;
  speed: number;
  options: ModeOpts;
  presetSize: PresetSize;
}

const cache = new Map<string, ResolvedPreset>();

export function resolvePreset(state: OrbState, renderedSize: number): ResolvedPreset {
  const presetSize: PresetSize = renderedSize <= 32 ? 20 : 64;
  const key = `${state}-${presetSize}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const mode = STATE_TO_MODE[state];
  const preset = PRESETS[mode][presetSize];
  let options = { ...BASE_PROFILES[mode] };
  if (preset.count !== 1) options = scaleCounts(options, preset.count);
  if (preset.size !== 1) options = scaleRadii(options, preset.size);
  if (preset.extra) options = { ...options, ...preset.extra };
  const resolved = { mode, speed: preset.speed, options, presetSize };
  cache.set(key, resolved);
  return resolved;
}
