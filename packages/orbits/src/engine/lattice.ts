import { angleDelta, hashD, makeProj, paint, radiusScale } from "./core.js";
import type { Dot, ModeDraw } from "./types.js";

interface Move {
  axis: 0 | 1 | 2;
  lo: number;
  hi: number;
  angle: number;
}

function solveCycle(time: number, count: number, slotDuration: number, rest: number) {
  const cycle = 2 * count * slotDuration + rest;
  const cycleTime = time % cycle;
  const amount = Array.from({ length: count }, () => 0);
  let active = -1;
  if (cycleTime < 2 * count * slotDuration) {
    const slot = Math.floor(cycleTime / slotDuration);
    const progress = (cycleTime - slot * slotDuration) / slotDuration;
    const clamped = Math.min(1, progress / 0.7);
    const eased = 1 - (1 - clamped) ** 3;
    if (slot < count) {
      for (let index = 0; index < slot; index += 1) amount[index] = 1;
      amount[slot] = eased;
      active = slot;
    } else {
      const reverse = 2 * count - 1 - slot;
      for (let index = 0; index < reverse; index += 1) amount[index] = 1;
      amount[reverse] = 1 - eased;
      active = reverse;
    }
  }
  return { active, amount };
}

function applyMoves(
  point: [number, number, number],
  moves: Move[],
  cycle: { amount: number[]; active: number },
): [number, number, number, boolean] {
  let [x, y, z] = point;
  let active = false;
  for (let index = 0; index < moves.length; index += 1) {
    if ((cycle.amount[index] ?? 0) <= 0) continue;
    const move = moves[index];
    if (!move) continue;
    const coordinate = move.axis === 0 ? x : move.axis === 1 ? y : z;
    if (coordinate < move.lo || coordinate >= move.hi) continue;
    if (index === cycle.active) active = true;
    const angle = move.angle * (cycle.amount[index] ?? 0);
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    if (move.axis === 0) {
      const nextY = y * cosine - z * sine;
      z = y * sine + z * cosine;
      y = nextY;
    } else if (move.axis === 1) {
      const nextX = x * cosine + z * sine;
      z = -x * sine + z * cosine;
      x = nextX;
    } else {
      const nextX = x * cosine - y * sine;
      y = x * sine + y * cosine;
      x = nextX;
    }
  }
  return [x, y, z, active];
}

function makeMoves(count: number) {
  const moves: Move[] = [];
  for (let index = 0; index < count; index += 1) {
    const axis = Math.min(2, Math.floor(hashD(index, 2.3) * 3)) as 0 | 1 | 2;
    const lo = -1 + 0.5 * Math.min(3, Math.floor(hashD(index, 5.9) * 4));
    const direction = hashD(index, 7.7) < 0.5 ? 1 : -1;
    moves.push({ axis, lo, hi: lo + 0.5, angle: (direction * Math.PI) / 2 });
  }
  return moves;
}

export const drawGlobe: ModeDraw = (context, size, time, dark, options) => {
  const spin = 0.5;
  const center = size / 2;
  const radius = center * 0.82;
  const tilt = 0.4 + 0.06 * Math.sin(time * 0.35);
  const project = makeProj(time * spin, tilt, center, center, radius);
  const scan = time * (spin + (1.7 - spin) * (options.scanMul ?? 1));
  const radiusMultiplier = radiusScale(size, options.rsPow ?? 0.6);
  const dimBase = options.dimBase ?? 1;
  const dots: Dot[] = [];
  const latitudeRings = options.latRings ?? 17;
  const longitudeDensity = options.lonDensity ?? 44;

  for (let latitudeIndex = 0; latitudeIndex <= latitudeRings; latitudeIndex += 1) {
    const latitude = -Math.PI / 2 + (latitudeIndex / latitudeRings) * Math.PI;
    const cosineLatitude = Math.cos(latitude);
    const sineLatitude = Math.sin(latitude);
    const longitudeCount = Math.max(1, Math.round(Math.abs(cosineLatitude) * longitudeDensity));
    for (let longitudeIndex = 0; longitudeIndex < longitudeCount; longitudeIndex += 1) {
      const longitude = (longitudeIndex / longitudeCount) * 2 * Math.PI;
      const [x, y, z] = project(
        cosineLatitude * Math.cos(longitude),
        sineLatitude,
        cosineLatitude * Math.sin(longitude),
      );
      const depth = (z + 1) / 2;
      const delta = angleDelta(longitude + time * spin, scan);
      const boost = Math.exp(-(delta * delta) / 0.18) * Math.max(0, z);
      dots.push({
        x,
        y,
        z,
        r:
          ((options.rBase ?? 0.6) +
            (options.rDepth ?? 1.7) * depth +
            (options.rBoost ?? 1) * boost) *
          radiusMultiplier,
        white: (options.inkFar ?? 0.62) - (options.inkSpan ?? 0.54) * depth,
        a: dimBase + (1 - dimBase) * Math.min(1, boost),
      });
    }
  }
  paint(context, dots, dark, options.rMin);
};

export const drawRubik: ModeDraw = (context, size, time, dark, options) => {
  const center = size / 2;
  const radius = center * 0.82;
  const project = makeProj(time * 0.55, 0.35 + 0.1 * Math.sin(time * 0.9), center, center, radius);
  const radiusMultiplier = radiusScale(size, options.rsPow ?? 0.6);
  const moveCount = options.moveCount ?? 14;
  const moves = makeMoves(moveCount);
  const cycle = solveCycle(time, moveCount, 0.42, 1.2);
  const dots: Dot[] = [];
  const latitudeRings = options.latRings ?? 15;
  const longitudeDensity = options.lonDensity ?? 40;

  for (let latitudeIndex = 0; latitudeIndex <= latitudeRings; latitudeIndex += 1) {
    const latitude = -Math.PI / 2 + (latitudeIndex / latitudeRings) * Math.PI;
    const cosineLatitude = Math.cos(latitude);
    const sineLatitude = Math.sin(latitude);
    const longitudeCount = Math.max(1, Math.round(Math.abs(cosineLatitude) * longitudeDensity));
    for (let longitudeIndex = 0; longitudeIndex < longitudeCount; longitudeIndex += 1) {
      const longitude = (longitudeIndex / longitudeCount) * 2 * Math.PI;
      const moved = applyMoves(
        [cosineLatitude * Math.cos(longitude), sineLatitude, cosineLatitude * Math.sin(longitude)],
        moves,
        cycle,
      );
      const [x, y, z] = project(moved[0], moved[1], moved[2]);
      const depth = (z + 1) / 2;
      dots.push({
        x,
        y,
        z,
        r:
          ((options.rBase ?? 0.6) +
            (options.rDepth ?? 1.7) * depth +
            (moved[3] ? (options.rActive ?? 0.3) : 0)) *
          radiusMultiplier,
        white: (options.inkFar ?? 0.62) - (options.inkSpan ?? 0.54) * depth - (moved[3] ? 0.14 : 0),
      });
    }
  }
  paint(context, dots, dark, options.rMin);
};

export const drawWave: ModeDraw = (context, size, time, dark, options) => {
  const center = size / 2;
  const radius = center * 0.874;
  const project = makeProj(time * 0.18, 0.38, center, center, 1);
  const radiusMultiplier = radiusScale(size, options.rsPow ?? 0.6);
  const dots: Dot[] = [];
  const rings = options.rings ?? 15;
  const longitudeDensity = options.lonDensity ?? 40;

  for (let ring = 0; ring <= rings; ring += 1) {
    const latitude = -Math.PI / 2 + (ring / rings) * Math.PI;
    const cosineLatitude = Math.cos(latitude);
    const sineLatitude = Math.sin(latitude);
    const wave =
      0.62 * Math.sin(time * 2.1 - ring * 0.52) + 0.38 * Math.sin(time * 1.27 + ring * 0.83);
    const ringRadius = radius * (0.88 + 0.105 * wave);
    const longitudeCount = Math.max(1, Math.round(Math.abs(cosineLatitude) * longitudeDensity));
    for (let longitudeIndex = 0; longitudeIndex < longitudeCount; longitudeIndex += 1) {
      const longitude = (longitudeIndex / longitudeCount) * 2 * Math.PI;
      const [x, y, z] = project(
        cosineLatitude * Math.cos(longitude) * ringRadius,
        sineLatitude * ringRadius,
        cosineLatitude * Math.sin(longitude) * ringRadius,
      );
      const depth = (z / radius + 1) / 2;
      const crest = Math.max(0, wave);
      dots.push({
        x,
        y,
        z,
        r:
          ((options.rBase ?? 0.6) + (options.rDepth ?? 1.7) * depth) *
          (1 + 0.4 * crest) *
          radiusMultiplier,
        white: 0.66 - 0.56 * depth - 0.1 * crest,
      });
    }
  }
  paint(context, dots, dark, options.rMin);
};
