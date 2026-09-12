/**
 * React wrapper adapted from thinking-orbs by Jakub Antalik.
 * The upstream project is MIT licensed. See THIRD_PARTY_NOTICES.md.
 */

import { useEffect, useRef } from "react";
import { MODE_DRAWS } from "./engine/registry.js";
import { resolvePreset } from "./presets.js";
import { useReducedMotion, useResolvedDark } from "./theme.js";
import type { OrbState, ThinkingOrbProps } from "./types.js";

export const ORB_STATES: OrbState[] = [
  "working",
  "searching",
  "solving",
  "listening",
  "connecting",
  "weaving",
  "composing",
  "breathing",
  "shaping",
];

export const ORB_LABELS: Record<OrbState, string> = {
  working: "Working…",
  searching: "Searching…",
  solving: "Solving…",
  listening: "Listening…",
  connecting: "Connecting…",
  weaving: "Weaving…",
  composing: "Composing…",
  breathing: "Thinking…",
  shaping: "Shaping…",
};

function applyTint(context: CanvasRenderingContext2D, size: number, tint: string) {
  context.save();
  context.globalCompositeOperation = "source-atop";
  context.globalAlpha = 0.62;
  context.fillStyle = tint;
  context.fillRect(0, 0, size, size);
  context.restore();
}

export function ThinkingOrb({
  state = "working",
  size = 64,
  theme = "auto",
  speed = 1,
  paused = false,
  tint,
  style,
  "aria-label": ariaLabel,
  ...canvasProps
}: ThinkingOrbProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const dark = useResolvedDark(theme, canvasRef);
  const reducedMotion = useReducedMotion();
  const safeSize = Math.max(12, Math.min(320, size));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const pixelRatio = Math.min(
      2,
      (typeof devicePixelRatio !== "undefined" && devicePixelRatio) || 1,
    );
    canvas.width = Math.round(safeSize * pixelRatio);
    canvas.height = Math.round(safeSize * pixelRatio);
    const context = canvas.getContext("2d");
    if (!context) return;

    const preset = resolvePreset(state, safeSize);
    const draw = MODE_DRAWS[preset.mode];
    const effectiveSpeed = preset.speed * Math.max(0.1, speed);
    const frame = (time: number) => {
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      context.clearRect(0, 0, safeSize, safeSize);
      draw(context, safeSize, time, dark, preset.options);
      if (tint) applyTint(context, safeSize, tint);
    };

    if (reducedMotion) {
      frame(0.6);
      return;
    }

    let animationFrame = 0;
    let running = false;
    const loop = () => {
      frame((performance.now() / 1000) * effectiveSpeed);
      if (running) animationFrame = requestAnimationFrame(loop);
    };
    const start = () => {
      if (running || paused) return;
      running = true;
      animationFrame = requestAnimationFrame(loop);
    };
    const stop = () => {
      running = false;
      cancelAnimationFrame(animationFrame);
    };

    frame((performance.now() / 1000) * effectiveSpeed);
    let visible = true;
    const observer =
      typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver(([entry]) => {
            visible = entry?.isIntersecting ?? true;
            if (visible && document.visibilityState !== "hidden") start();
            else stop();
          });
    observer?.observe(canvas);
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") stop();
      else if (visible) start();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    if (!observer) start();

    return () => {
      stop();
      observer?.disconnect();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [dark, paused, reducedMotion, safeSize, speed, state, tint]);

  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label={ariaLabel ?? ORB_LABELS[state]}
      style={{ width: safeSize, height: safeSize, display: "block", ...style }}
      {...canvasProps}
    />
  );
}
