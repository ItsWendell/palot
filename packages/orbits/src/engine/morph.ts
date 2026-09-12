import { paint } from "./core.js";
import type { Dot, ModeDraw } from "./types.js";

type Path = (fraction: number) => [number, number];

function smooth(value: number) {
  return value * value * (3 - 2 * value);
}

function polygonPath(vertices: ReadonlyArray<readonly [number, number]>): Path {
  const lengths: number[] = [];
  let total = 0;
  for (let index = 0; index < vertices.length; index += 1) {
    const first = vertices[index];
    const second = vertices[(index + 1) % vertices.length];
    if (!first || !second) continue;
    const length = Math.hypot(second[0] - first[0], second[1] - first[1]);
    lengths.push(length);
    total += length;
  }
  return (fraction) => {
    let target = fraction * total;
    let index = 0;
    while (target > (lengths[index] ?? 0) && index < vertices.length - 1) {
      target -= lengths[index] ?? 0;
      index += 1;
    }
    const first = vertices[index] ?? [0, 0];
    const second = vertices[(index + 1) % vertices.length] ?? first;
    const length = lengths[index] ?? 0;
    const local = length ? Math.min(1, target / length) : 0;
    return [first[0] + (second[0] - first[0]) * local, first[1] + (second[1] - first[1]) * local];
  };
}

const CIRCLE: Path = (fraction) => {
  const angle = -Math.PI / 2 + fraction * 2 * Math.PI;
  return [Math.cos(angle) * 0.24, Math.sin(angle) * 0.24];
};
const TRIANGLE = polygonPath([
  [0, -0.26],
  [0.24, 0.16],
  [-0.24, 0.16],
]);
const SQUARE = polygonPath([
  [0, -0.2],
  [0.2, -0.2],
  [0.2, 0.2],
  [-0.2, 0.2],
  [-0.2, -0.2],
]);
const CYCLE = [CIRCLE, TRIANGLE, SQUARE];
const HOLD = 1.4;
const MORPH = 0.9;
const SEGMENT = HOLD + MORPH;

export const drawMorph: ModeDraw = (context, size, time, dark, options) => {
  const cycleTime = time % (SEGMENT * CYCLE.length);
  const cycleIndex = Math.floor(cycleTime / SEGMENT);
  const localTime = cycleTime - cycleIndex * SEGMENT;
  const transition = localTime > HOLD ? smooth((localTime - HOLD) / MORPH) : 0;
  const spread = options.spread ?? 1;
  const firstPath = CYCLE[cycleIndex] ?? CIRCLE;
  const secondPath = CYCLE[(cycleIndex + 1) % CYCLE.length] ?? CIRCLE;
  const samples = 160;
  const points: Array<[number, number]> = [];

  for (let index = 0; index < samples; index += 1) {
    const fraction = index / samples;
    const first = firstPath(fraction);
    const second = secondPath(fraction);
    points.push([
      (first[0] + (second[0] - first[0]) * transition) * spread,
      (first[1] + (second[1] - first[1]) * transition) * spread,
    ]);
  }

  const lengths: number[] = [];
  let total = 0;
  for (let index = 0; index < samples; index += 1) {
    const first = points[index];
    const second = points[(index + 1) % samples];
    if (!first || !second) continue;
    const length = Math.hypot(second[0] - first[0], second[1] - first[1]);
    lengths.push(length);
    total += length;
  }

  const count = Math.max(6, Math.round(34 * (options.iconD ?? 1)));
  const radius = (options.rDot ?? 0.021) * 1.35 * spread;
  const pulse = 1 + 0.02 * Math.sin(localTime * 3.1);
  const dots: Dot[] = [];
  const center = size / 2;
  let segment = 0;
  let accumulated = 0;

  for (let index = 0; index < count; index += 1) {
    const target = (index / count) * total;
    while (accumulated + (lengths[segment] ?? 0) < target && segment < samples - 1) {
      accumulated += lengths[segment] ?? 0;
      segment += 1;
    }
    const first = points[segment] ?? [0, 0];
    const second = points[(segment + 1) % samples] ?? first;
    const length = lengths[segment] ?? 0;
    const local = length ? Math.min(1, (target - accumulated) / length) : 0;
    const x = (first[0] + (second[0] - first[0]) * local) * pulse;
    const y = (first[1] + (second[1] - first[1]) * local) * pulse;
    dots.push({
      x: center + x * size,
      y: center + y * size,
      z: 0,
      r: Math.max(0.35, radius * size),
      white: 0.1,
    });
  }
  paint(context, dots, dark, options.rMin);
};
