/** Duration labels for the transcript, in narrow units (`1h 2m 5s`). */

/**
 * Elapsed time in whole seconds, floored so a live clock never runs ahead. Zero units are
 * dropped, as `Intl.DurationFormat` does with narrow units: `42s`, `2m`, `1h 5s`, and `0s` for
 * nothing at all.
 */
export function formatElapsed(ms: number): string {
  const total = Number.isFinite(ms) ? Math.max(0, Math.floor(ms / 1_000)) : 0;
  const hours = Math.floor(total / 3_600);
  const minutes = Math.floor((total % 3_600) / 60);
  const seconds = total % 60;
  const units = [
    ...(hours > 0 ? [`${hours}h`] : []),
    ...(minutes > 0 ? [`${minutes}m`] : []),
    ...(seconds > 0 ? [`${seconds}s`] : []),
  ];
  return units.length > 0 ? units.join(" ") : "0s";
}

/**
 * A tool call's duration: milliseconds under a second, tenths of a second under ten seconds,
 * then the same as `formatElapsed`. Values are floored like `formatElapsed`.
 */
export function formatDurationPrecise(ms: number): string {
  const value = Number.isFinite(ms) ? Math.max(0, ms) : 0;
  if (value < 1_000) return `${Math.floor(value)}ms`;
  if (value < 10_000) {
    const tenths = Math.floor(value / 100);
    return tenths % 10 === 0 ? `${tenths / 10}s` : `${(tenths / 10).toFixed(1)}s`;
  }
  return formatElapsed(value);
}
