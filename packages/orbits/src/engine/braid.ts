import { fibDir, frac, makeProj, paint, radiusScale } from "./core.js";
import type { Dot, ModeDraw } from "./types.js";

export const drawBraid: ModeDraw = (context, size, time, dark, options) => {
  const center = size / 2;
  const radius = center * 0.76;
  const project = makeProj(time * 0.4, 0.3, center, center, 1);
  const radiusMultiplier = radiusScale(size, options.rsPow ?? 0.6);
  const dots: Dot[] = [];
  const ghostCount = options.ghostN ?? 150;

  for (let index = 0; index < ghostCount; index += 1) {
    const direction = fibDir(index, ghostCount);
    const [x, y, z] = project(direction[0] * radius, direction[1] * radius, direction[2] * radius);
    const depth = (z / radius + 1) / 2;
    dots.push({ x, y, z, r: 0.8 * radiusMultiplier, white: 0.78, a: 0.1 + 0.22 * depth });
  }

  const strandCount = options.strandN ?? 52;
  const turns = options.turns ?? 3;
  for (let strand = 0; strand < 3; strand += 1) {
    const phase = (strand / 3) * 2 * Math.PI;
    for (let index = 0; index < strandCount; index += 1) {
      const unit = (frac(index / strandCount + time * 0.045) * 2 - 1) * 0.96;
      const surface = Math.sqrt(Math.max(0, 1 - unit * unit));
      const endFade = Math.min(1, (1 - Math.abs(unit)) / 0.1);
      const angle = unit * Math.PI * turns + phase;
      const weave = 1 + 0.075 * Math.sin(unit * Math.PI * turns * 2 + phase * 2 + time * 0.8);
      const ringRadius = surface * radius * weave;
      const [x, y, z] = project(
        Math.cos(angle) * ringRadius,
        unit * radius * weave,
        Math.sin(angle) * ringRadius,
      );
      const depth = (z / radius + 1) / 2;
      dots.push({
        x,
        y,
        z,
        r: ((options.rBase ?? 1.2) + (options.rDepth ?? 1.8) * depth) * radiusMultiplier,
        white: 0.55 - 0.45 * depth,
        a: endFade * (0.45 + 0.55 * depth),
      });
    }
  }
  paint(context, dots, dark, options.rMin);
};
