import { fibDir, makeProj, paint, radiusScale } from "./core.js";
import type { Dot, ModeDraw } from "./types.js";

export const drawRibbon: ModeDraw = (context, size, time, dark, options) => {
  const center = size / 2;
  const radius = center * 0.78;
  const spin = options.spin ?? 1;
  const cameraTilt = 0.3;
  const project = makeProj(time * 0.1 * spin, cameraTilt, center, center, 1);
  const radiusMultiplier = radiusScale(size, options.rsPow ?? 0.6);
  const dots: Dot[] = [];
  const ghostCount = options.ghostN ?? 150;

  for (let index = 0; index < ghostCount; index += 1) {
    const direction = fibDir(index, ghostCount);
    const [x, y, z] = project(direction[0] * radius, direction[1] * radius, direction[2] * radius);
    const depth = (z / radius + 1) / 2;
    dots.push({ x, y, z, r: 0.8 * radiusMultiplier, white: 0.78, a: 0.1 + 0.22 * depth });
  }

  const yaw = time * 0.24 * spin;
  const tilt = options.faceOn ? -cameraTilt : 0.55 + 0.3 * Math.sin(time * 0.18) * spin;
  const unitX = Math.cos(yaw);
  const unitY = 0;
  const unitZ = Math.sin(yaw);
  const vectorX = -unitZ * Math.sin(tilt);
  const vectorY = Math.cos(tilt);
  const vectorZ = unitX * Math.sin(tilt);
  const normalX = unitY * vectorZ - unitZ * vectorY;
  const normalY = unitZ * vectorX - unitX * vectorZ;
  const normalZ = unitX * vectorY - unitY * vectorX;
  const wobbleAmplitude = 0.23 * (options.wobMul ?? 1);
  const baseRadius = options.faceOn ? radius / (1 + 0.85 * wobbleAmplitude) : radius;
  const baseLanes = options.lanes ?? 5;
  const segments = options.segs ?? 88;
  const lanes = Math.max(1, Math.round(baseLanes * (options.bandMul ?? 1)));

  for (let lane = 0; lane < lanes; lane += 1) {
    const laneOffset = (lane - (lanes - 1) / 2) * 0.075;
    const edge = Math.abs(lane - (lanes - 1) / 2) / Math.max(1, (lanes - 1) / 2);
    for (let segment = 0; segment < segments; segment += 1) {
      const angle = (segment / segments) * 2 * Math.PI;
      const wobble =
        (0.16 * Math.sin(angle * 3 - time * 1.7 + lane * 0.22) +
          0.07 * Math.sin(angle * 5 + time * 1.1)) *
        (options.wobMul ?? 1);
      const radial = options.faceOn ? 1 + wobble : 1;
      const offset = options.faceOn ? laneOffset : laneOffset + wobble;
      const x = unitX * Math.cos(angle) + vectorX * Math.sin(angle) + normalX * offset;
      const y = unitY * Math.cos(angle) + vectorY * Math.sin(angle) + normalY * offset;
      const z = unitZ * Math.cos(angle) + vectorZ * Math.sin(angle) + normalZ * offset;
      const length = Math.hypot(x, y, z);
      const renderedRadius = baseRadius * radial;
      const [projectedX, projectedY, depthValue] = project(
        (x / length) * renderedRadius,
        (y / length) * renderedRadius,
        (z / length) * renderedRadius,
      );
      const depth = (depthValue / radius + 1) / 2;
      dots.push({
        x: projectedX,
        y: projectedY,
        z: depthValue,
        r:
          ((options.rBase ?? 1.1) + (options.rDepth ?? 1.7) * depth) *
          (1 - 0.25 * edge) *
          radiusMultiplier,
        white: 0.52 - 0.44 * depth + 0.18 * edge,
        a: 0.4 + 0.6 * depth,
      });
    }
  }
  paint(context, dots, dark, options.rMin);
};
