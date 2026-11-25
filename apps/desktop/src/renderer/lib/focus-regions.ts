/**
 * The major areas F6 and Shift+F6 move keyboard focus between, in order. Containers declare
 * their area with `data-focus-region`.
 */
export const FOCUS_REGIONS = ["sidebar", "transcript", "composer", "workbench"] as const;

export type FocusRegionName = (typeof FOCUS_REGIONS)[number];
export type FocusRegionDirection = "next" | "previous";

export function isFocusRegionName(value: unknown): value is FocusRegionName {
  return FOCUS_REGIONS.includes(value as FocusRegionName);
}

/** Sorts regions into F6 order. Regions sharing a name keep their given (document) order. */
export function orderFocusRegions<T>(
  regions: readonly T[],
  nameOf: (region: T) => FocusRegionName,
): T[] {
  return regions.toSorted(
    (left, right) => FOCUS_REGIONS.indexOf(nameOf(left)) - FOCUS_REGIONS.indexOf(nameOf(right)),
  );
}

/**
 * The region F6 moves to from `current`, wrapping at either end. `regions` holds only the
 * available regions, in order. Without a current region, next starts at the first and
 * previous at the last.
 */
export function pickFocusRegion<T>(
  regions: readonly T[],
  current: T | null,
  direction: FocusRegionDirection,
): T | null {
  if (regions.length === 0) return null;
  const index = current === null ? -1 : regions.indexOf(current);
  if (index === -1) return direction === "next" ? regions[0]! : regions.at(-1)!;
  const step = direction === "next" ? 1 : -1;
  return regions[(index + step + regions.length) % regions.length]!;
}
