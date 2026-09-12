import { memo, useSyncExternalStore } from "react";

export interface ElapsedTimeProps {
  startedAt: number | null;
  completedAt: number | null;
  running: boolean;
  fallbackDurationMs?: number | null;
  titlePrefix?: string;
}

// All live counters in this renderer share a clock. Only the leaf components
// subscribe, so ticks do not invalidate cards or their transcript parents.
const listeners = new Set<() => void>();
let now = Date.now();
let interval: ReturnType<typeof setInterval> | undefined;

function refreshClock() {
  const next = Date.now();
  if (next === now) return;
  now = next;
  for (const listener of listeners) listener();
}

function stopClock() {
  if (interval === undefined) return;
  clearInterval(interval);
  interval = undefined;
}

function syncVisibility() {
  if (document.visibilityState !== "visible") {
    stopClock();
    return;
  }
  refreshClock();
  if (interval === undefined && listeners.size > 0) {
    interval = setInterval(refreshClock, 1_000);
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    document.addEventListener("visibilitychange", syncVisibility);
    refreshClock();
    syncVisibility();
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size > 0) return;
    stopClock();
    document.removeEventListener("visibilitychange", syncVisibility);
  };
}

function getSnapshot() {
  return now;
}

function isFiniteNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function Duration({ durationMs, titlePrefix }: { durationMs: number; titlePrefix?: string }) {
  const seconds = Math.floor(Math.max(0, durationMs) / 1_000);
  const formatted = seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  return (
    <span
      className="inline-block min-w-[8ch] shrink-0 text-right whitespace-nowrap tabular-nums"
      title={titlePrefix ? `${titlePrefix} ${formatted}` : undefined}
    >
      {formatted}
    </span>
  );
}

function RunningElapsedTime({
  startedAt,
  titlePrefix,
}: {
  startedAt: number;
  titlePrefix?: string;
}) {
  const currentTime = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return <Duration durationMs={currentTime - startedAt} titlePrefix={titlePrefix} />;
}

export const ElapsedTime = memo(function ElapsedTime({
  startedAt,
  completedAt,
  running,
  fallbackDurationMs,
  titlePrefix,
}: ElapsedTimeProps) {
  // A resumed run must never display a previous completion or fallback duration.
  if (running) {
    return isFiniteNumber(startedAt) ? (
      <RunningElapsedTime startedAt={startedAt} titlePrefix={titlePrefix} />
    ) : null;
  }

  const durationMs =
    isFiniteNumber(startedAt) && isFiniteNumber(completedAt)
      ? completedAt - startedAt
      : fallbackDurationMs;
  return isFiniteNumber(durationMs) ? (
    <Duration durationMs={durationMs} titlePrefix={titlePrefix} />
  ) : null;
});
