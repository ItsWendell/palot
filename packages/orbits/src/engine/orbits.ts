import { hashD, makeProj, paint, radiusScale } from "./core.js";
import type { Dot, ModeDraw } from "./types.js";

export const drawOrbits: ModeDraw = (context, size, time, dark, options) => {
  const center = size / 2;
  const radius = center * 0.82;
  const project = makeProj(time * 0.12, 0.3, center, center, 1);
  const radiusMultiplier = radiusScale(size, options.rsPow ?? 0.6);
  const dots: Dot[] = [];
  const orbitCount = options.orbitN ?? 12;
  const ghostCount = options.ghostN ?? 40;
  const particles = options.particles ?? 3;

  for (let orbit = 0; orbit < orbitCount; orbit += 1) {
    const hash1 = hashD(orbit, 1.7);
    const hash2 = hashD(orbit, 5.2);
    const hash3 = hashD(orbit, 8.9);
    const orbitRadius = radius * (0.45 + 0.52 * hash1);
    const theta = hash1 * 2 * Math.PI;
    const phi = Math.acos(2 * hash2 - 1);
    const normalX = Math.sin(phi) * Math.cos(theta);
    const normalY = Math.cos(phi);
    const normalZ = Math.sin(phi) * Math.sin(theta);
    let unitX = -normalY;
    let unitY = normalX;
    const unitZ = 0;
    const unitLength = Math.max(1e-6, Math.hypot(unitX, unitY));
    unitX /= unitLength;
    unitY /= unitLength;
    const vectorX = normalY * unitZ - normalZ * unitY;
    const vectorY = normalZ * unitX - normalX * unitZ;
    const vectorZ = normalX * unitY - normalY * unitX;
    const speed = (0.25 + 0.55 * hash3) * (hash3 > 0.5 ? 1 : -1);

    for (let index = 0; index < ghostCount; index += 1) {
      const angle = (index / ghostCount) * 2 * Math.PI;
      const [x, y, z] = project(
        (unitX * Math.cos(angle) + vectorX * Math.sin(angle)) * orbitRadius,
        (unitY * Math.cos(angle) + vectorY * Math.sin(angle)) * orbitRadius,
        (unitZ * Math.cos(angle) + vectorZ * Math.sin(angle)) * orbitRadius,
      );
      const depth = (z / orbitRadius + 1) / 2;
      dots.push({
        x,
        y,
        z,
        r: (options.ghostR ?? 0.9) * radiusMultiplier,
        white: 0.72,
        a: (options.ghostA ?? 0.5) * (0.4 + 0.6 * depth),
      });
    }

    for (let particle = 0; particle < particles; particle += 1) {
      const angle = time * speed + (particle / particles) * 2 * Math.PI + hash2 * 6;
      const [x, y, z] = project(
        (unitX * Math.cos(angle) + vectorX * Math.sin(angle)) * orbitRadius,
        (unitY * Math.cos(angle) + vectorY * Math.sin(angle)) * orbitRadius,
        (unitZ * Math.cos(angle) + vectorZ * Math.sin(angle)) * orbitRadius,
      );
      const depth = (z / orbitRadius + 1) / 2;
      dots.push({
        x,
        y,
        z,
        r: ((options.partR ?? 1.2) + (options.partRDepth ?? 1.6) * depth) * radiusMultiplier,
        white: 0.3 - 0.22 * depth,
      });
    }
  }
  paint(context, dots, dark, options.rMin);
};
