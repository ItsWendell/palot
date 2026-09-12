import {
  fibDir,
  frac,
  hashD,
  lerp,
  makeProj,
  paint,
  paintLines,
  radiusScale,
  vnoise,
} from "./core.js";
import type { Dot, Line, ModeDraw } from "./types.js";

export const drawWeb: ModeDraw = (context, size, time, dark, options) => {
  const center = size / 2;
  const radius = center * 0.8 * (options.spread ?? 1);
  const project = makeProj(time * 0.12, 0.32, center, center, radius);
  const radiusMultiplier = radiusScale(size, options.rsPow ?? 0.6);
  const nodeCount = options.nodeN ?? 30;
  const threshold = options.thr ?? 0.72;
  const nodeRadius = options.nodeR ?? 1.4;
  const nodeDepthRadius = options.nodeRDepth ?? 1.8;
  const nodes: Array<[number, number, number]> = [];

  for (let index = 0; index < nodeCount; index += 1) {
    const direction = fibDir(index, nodeCount);
    const x = direction[0] + 0.3 * (vnoise(index * 0.31 + 9, time * 0.24) - 0.5) * 2;
    const y = direction[1] + 0.3 * (vnoise(index * 0.53 + 27, time * 0.21) - 0.5) * 2;
    const z = direction[2] + 0.3 * (vnoise(index * 0.77 + 55, time * 0.27) - 0.5) * 2;
    const length = Math.hypot(x, y, z);
    nodes.push([x / length, y / length, z / length]);
  }

  const lines: Line[] = [];
  const dots: Dot[] = [];
  for (let first = 0; first < nodeCount; first += 1) {
    const firstNode = nodes[first];
    if (!firstNode) continue;
    for (let second = first + 1; second < nodeCount; second += 1) {
      const secondNode = nodes[second];
      if (!secondNode) continue;
      const distance = Math.hypot(
        firstNode[0] - secondNode[0],
        firstNode[1] - secondNode[1],
        firstNode[2] - secondNode[2],
      );
      if (distance >= threshold) continue;
      const [x1, y1, z1] = project(...firstNode);
      const [x2, y2, z2] = project(...secondNode);
      const depth = ((z1 + z2) / 2 + 1) / 2;
      lines.push({
        x1,
        y1,
        x2,
        y2,
        white: 0.42,
        a: (1 - distance / threshold) * (0.3 + 0.55 * depth),
        w: Math.max(0.6, (options.lineW ?? 0.8) * radiusMultiplier),
      });
    }
  }

  for (let index = 0; index < nodeCount; index += 1) {
    const node = nodes[index];
    if (!node) continue;
    const [x, y, z] = project(...node);
    const depth = (z + 1) / 2;
    const pulse = 1 + 0.25 * Math.sin(time * 1.4 + index * 2.7);
    dots.push({
      x,
      y,
      z,
      r: (nodeRadius + nodeDepthRadius * depth) * pulse * radiusMultiplier,
      white: 0.55 - 0.45 * depth,
    });
  }

  const signalCount = options.signals ?? 5;
  for (let signal = 0; signal < signalCount; signal += 1) {
    const segment = Math.floor(time * 0.55 + signal * 7.31);
    const firstIndex = Math.floor(hashD(segment, signal * 3.1 + 1.7) * nodeCount);
    const secondIndex = Math.floor(hashD(segment, signal * 5.7 + 4.2) * nodeCount);
    const firstNode = nodes[firstIndex];
    const secondNode = nodes[secondIndex];
    if (firstIndex === secondIndex || !firstNode || !secondNode) continue;
    const fraction = frac(time * 0.55 + signal * 7.31);
    const x = lerp(firstNode[0], secondNode[0], fraction);
    const y = lerp(firstNode[1], secondNode[1], fraction);
    const z = lerp(firstNode[2], secondNode[2], fraction);
    const length = Math.max(1e-6, Math.hypot(x, y, z));
    const [projectedX, projectedY, depthValue] = project(x / length, y / length, z / length);
    const depth = (depthValue + 1) / 2;
    dots.push({
      x: projectedX,
      y: projectedY,
      z: depthValue,
      r: (nodeRadius * 1.5 + nodeDepthRadius * depth) * radiusMultiplier,
      white: 0.05,
      a: 0.5 + 0.5 * depth,
    });
  }

  paintLines(context, lines, dark);
  paint(context, dots, dark, options.rMin);
};
