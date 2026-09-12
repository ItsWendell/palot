/**
 * Dotted 3D canvas primitives adapted from thinking-orbs by Jakub Antalik.
 * The upstream project is MIT licensed. See THIRD_PARTY_NOTICES.md.
 */

export interface Dot {
  x: number;
  y: number;
  z: number;
  r: number;
  white: number;
  a?: number;
}

export interface Line {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  white: number;
  a?: number;
  w: number;
}

export type Projector = (x: number, y: number, z: number) => [number, number, number];

export function lerp(a: number, b: number, fraction: number) {
  return a + (b - a) * fraction;
}

export function frac(value: number) {
  return value - Math.floor(value);
}

export function hashD(a: number, b: number) {
  const hash = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
  return hash - Math.floor(hash);
}

export function vnoise(x: number, y: number) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  let fx = x - xi;
  let fy = y - yi;
  fx = fx * fx * (3 - 2 * fx);
  fy = fy * fy * (3 - 2 * fy);
  const a = hashD(xi, yi);
  const b = hashD(xi + 1, yi);
  const c = hashD(xi, yi + 1);
  const d = hashD(xi + 1, yi + 1);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

export function fibDir(index: number, count: number): [number, number, number] {
  const golden = Math.PI * (3 - Math.sqrt(5));
  const y = 1 - (2 * (index + 0.5)) / count;
  const radius = Math.sqrt(1 - y * y);
  const angle = index * golden;
  return [radius * Math.cos(angle), y, radius * Math.sin(angle)];
}

export function angleDelta(a: number, b: number) {
  return Math.atan2(Math.sin(a - b), Math.cos(a - b));
}

export function makeProj(
  yaw: number,
  tilt: number,
  centerX: number,
  centerY: number,
  scale: number,
): Projector {
  const sinTilt = Math.sin(tilt);
  const cosTilt = Math.cos(tilt);
  const sinYaw = Math.sin(yaw);
  const cosYaw = Math.cos(yaw);
  return (x, y, z) => {
    const rotatedX = x * cosYaw + z * sinYaw;
    const rotatedZ = -x * sinYaw + z * cosYaw;
    const rotatedY = y * cosTilt - rotatedZ * sinTilt;
    const depth = y * sinTilt + rotatedZ * cosTilt;
    return [centerX + rotatedX * scale, centerY - rotatedY * scale, depth];
  };
}

export function paint(
  context: CanvasRenderingContext2D,
  dots: Dot[],
  dark: boolean,
  minimumRadius = 0.3,
) {
  dots.sort((a, b) => a.z - b.z);
  for (const dot of dots) {
    const alpha = dot.a ?? 1;
    if (alpha < 0.02) continue;
    const white = Math.min(1, Math.max(0, dot.white));
    const gray = Math.round((dark ? 1 - white : white) * 255);
    context.fillStyle = `rgba(${gray},${gray},${gray},${alpha})`;
    context.beginPath();
    context.arc(dot.x, dot.y, Math.max(minimumRadius, dot.r), 0, Math.PI * 2);
    context.fill();
  }
}

export function paintLines(context: CanvasRenderingContext2D, lines: Line[], dark: boolean) {
  for (const line of lines) {
    const alpha = line.a ?? 1;
    if (alpha < 0.02) continue;
    const white = Math.min(1, Math.max(0, line.white));
    const gray = Math.round((dark ? 1 - white : white) * 255);
    context.strokeStyle = `rgba(${gray},${gray},${gray},${alpha})`;
    context.lineWidth = line.w;
    context.beginPath();
    context.moveTo(line.x1, line.y1);
    context.lineTo(line.x2, line.y2);
    context.stroke();
  }
}

export function radiusScale(size: number, power: number) {
  return (size / 300) ** power;
}
