import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { cn } from "../lib/cn";
import { PalotMark } from "./palot-mark";
import "./palot-beacon.css";

const MOTION_QUERY = "(prefers-reduced-motion: no-preference) and (any-pointer: fine)";

function subscribeMotion(callback: () => void) {
  const query = window.matchMedia(MOTION_QUERY);
  query.addEventListener("change", callback);
  // AppearanceSync publishes the native accessibility preference on the root.
  const observer = new MutationObserver(callback);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-reduced-motion"],
  });
  return () => {
    query.removeEventListener("change", callback);
    observer.disconnect();
  };
}

function motionAllowed() {
  return (
    window.matchMedia(MOTION_QUERY).matches &&
    document.documentElement.dataset.reducedMotion !== "true"
  );
}

/** An invited gesture, not a busy indicator. Pointer updates never re-render React. */
export function PalotBeacon({ className }: { className?: string }) {
  const ref = useRef<HTMLButtonElement>(null);
  const enabled = useSyncExternalStore(subscribeMotion, motionAllowed, () => false);
  const [gesture, setGesture] = useState<"idle" | "hello" | "orbit">("idle");
  const [spinning, setSpinning] = useState(false);

  useEffect(() => {
    if (enabled) return;
    setGesture("idle");
    setSpinning(false);
  }, [enabled]);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    let frame = 0;
    let point: { x: number; y: number } | null = null;

    function reset() {
      cancelAnimationFrame(frame);
      frame = 0;
      point = null;
      element!.style.removeProperty("--beacon-look-x");
      element!.style.removeProperty("--beacon-look-y");
      element!.style.removeProperty("--beacon-lean");
    }

    reset();
    if (!enabled || gesture !== "idle" || spinning) return;

    function update() {
      frame = 0;
      if (!point) return;
      const bounds = element!.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return;
      const dx = point.x - (bounds.left + (bounds.width * 36.5) / 64);
      const dy = point.y - (bounds.top + (bounds.height * 28) / 64);
      const distance = Math.max(240, Math.hypot(dx, dy));
      element!.style.setProperty("--beacon-look-x", `${(dx / distance) * 2.5}px`);
      element!.style.setProperty("--beacon-look-y", `${(dy / distance) * 2.25}px`);
      element!.style.setProperty("--beacon-lean", `${(dx / distance) * 6}deg`);
    }

    function move(event: PointerEvent) {
      if (event.pointerType !== "mouse" || document.hidden) {
        reset();
        return;
      }
      point = { x: event.clientX, y: event.clientY };
      if (!frame) frame = requestAnimationFrame(update);
    }

    function leave(event: PointerEvent) {
      if (event.relatedTarget === null) reset();
    }

    window.addEventListener("pointermove", move, { passive: true });
    window.addEventListener("pointerout", leave);
    window.addEventListener("blur", reset);
    window.addEventListener("scroll", reset, true);
    document.addEventListener("visibilitychange", reset);
    return () => {
      reset();
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerout", leave);
      window.removeEventListener("blur", reset);
      window.removeEventListener("scroll", reset, true);
      document.removeEventListener("visibilitychange", reset);
    };
  }, [enabled, gesture, spinning]);

  return (
    <button
      ref={ref}
      type="button"
      aria-label="Say hello to Palot"
      disabled={!enabled}
      data-palot-beacon
      data-gesture={enabled ? gesture : "idle"}
      data-spinning={enabled && spinning}
      className={cn(
        "palot-beacon window-no-drag size-14 shrink-0 rounded-lg text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-default",
        className,
      )}
      onPointerEnter={(event) => {
        if (enabled && event.pointerType === "mouse" && gesture === "idle" && !spinning) {
          setGesture(Math.random() < 0.5 ? "hello" : "orbit");
        }
      }}
      onClick={() => {
        if (!enabled || spinning) return;
        if (gesture === "idle") setGesture("hello");
        setSpinning(true);
      }}
      onAnimationEnd={(event) => {
        if (event.animationName === "palot-beacon-spin") setSpinning(false);
        if (
          event.animationName === "palot-beacon-hello-loop" ||
          event.animationName === "palot-beacon-orbit-loop"
        ) {
          setGesture("idle");
        }
      }}
    >
      <PalotMark className="size-full text-inherit" />
    </button>
  );
}
