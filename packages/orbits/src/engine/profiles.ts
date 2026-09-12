export interface ModeOpts {
  [key: string]: number | undefined;
}

const COUNT_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ["latRings", "lonDensity"],
  ["rings", "lonDensity"],
  ["lanes", "segs"],
];
const COUNT_KEYS = ["orbitN", "ghostN", "nodeN", "strandN", "signals"] as const;
const ICON_DENSITY_KEYS = ["iconD"] as const;
const RADIUS_KEYS = [
  "rBase",
  "rDepth",
  "rActive",
  "rDot",
  "ghostR",
  "partR",
  "partRDepth",
  "nodeR",
  "nodeRDepth",
] as const;

export function scaleCounts(options: ModeOpts, scale: number) {
  const output = { ...options };
  const completed = new Set<string>();
  const root = Math.sqrt(scale);
  for (const [a, b] of COUNT_PAIRS) {
    const valueA = output[a];
    const valueB = output[b];
    if (valueA != null && valueB != null && !completed.has(a) && !completed.has(b)) {
      output[a] = Math.max(2, Math.round(valueA * root));
      output[b] = Math.max(2, Math.round(valueB * root));
      completed.add(a);
      completed.add(b);
    }
  }
  for (const key of COUNT_KEYS) {
    const value = output[key];
    if (value != null && value !== 0 && !completed.has(key)) {
      output[key] = Math.max(1, Math.round(value * scale));
    }
  }
  for (const key of ICON_DENSITY_KEYS) {
    const value = output[key];
    if (value != null) output[key] = Math.max(0.02, value * scale);
  }
  return output;
}

export function scaleRadii(options: ModeOpts, scale: number) {
  const output = { ...options };
  for (const key of RADIUS_KEYS) {
    const value = output[key];
    if (value != null) output[key] = value * scale;
  }
  output.rSizeMul = (output.rSizeMul ?? 1) * scale;
  return output;
}

export const BASE_PROFILES: Record<string, ModeOpts> = {
  globe: {
    latRings: 17,
    lonDensity: 44,
    rBase: 0.6,
    rDepth: 1.7,
    rBoost: 1,
    inkFar: 0.62,
    inkSpan: 0.54,
    rsPow: 0.6,
    rMin: 0.3,
  },
  orbits: {
    orbitN: 12,
    ghostN: 40,
    ghostR: 0.9,
    ghostA: 0.5,
    particles: 3,
    partR: 1.2,
    partRDepth: 1.6,
    rsPow: 0.6,
    rMin: 0.3,
  },
  rubik: {
    latRings: 15,
    lonDensity: 40,
    moveCount: 14,
    rBase: 0.6,
    rDepth: 1.7,
    rActive: 0.3,
    inkFar: 0.62,
    inkSpan: 0.54,
    rsPow: 0.6,
    rMin: 0.3,
  },
  wave: {
    rings: 15,
    lonDensity: 40,
    rBase: 0.6,
    rDepth: 1.7,
    rsPow: 0.6,
    rMin: 0.3,
  },
  web: {
    nodeN: 30,
    thr: 0.72,
    signals: 5,
    nodeR: 1.4,
    nodeRDepth: 1.8,
    lineW: 0.8,
    rsPow: 0.6,
    rMin: 0.3,
  },
  braid: {
    strandN: 52,
    turns: 3,
    ghostN: 150,
    rBase: 1.2,
    rDepth: 1.8,
    rsPow: 0.6,
    rMin: 0.3,
  },
  ribbon: {
    lanes: 5,
    segs: 88,
    ghostN: 150,
    rBase: 1.1,
    rDepth: 1.7,
    rsPow: 0.6,
    rMin: 0.3,
  },
  ring: {
    lanes: 5,
    segs: 88,
    ghostN: 0,
    faceOn: 1,
    rBase: 1.1,
    rDepth: 1.7,
    rsPow: 0.6,
    rMin: 0.3,
  },
  morph: {
    rDot: 0.021,
    iconD: 1,
    rMin: 0.25,
  },
};
