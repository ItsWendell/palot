/**
 * Order stability. While the list is held, rows keep the order they were drawn in: a row that
 * leaves its container disappears at once, a new row takes its sorted slot, and moves within a
 * container wait for the release. Changing container (rising into "Needs you", leaving the
 * Working shelf) is never held, so attention is never delayed.
 */

import type { Layout, ListEntry, RowEntry } from "./sections";

/** Rows hold this long after the last change, so a burst of updates settles once. */
export const SETTLE_WINDOW_MS = 3_000;
/** Released rows travel at most this far, so a long jump reads as a nudge, not a flight. */
export const MAX_TRAVEL_PX = 40;
export const MOVE_DURATION_MS = 150;

export interface HoldInputs {
  pointerInside: boolean;
  /** Keyboard focus is on a row (pointer focus from a click does not hold the list). */
  keyboardInside: boolean;
  now: number;
  /** When the live order last changed. */
  lastChangeAt: number;
}

export function isHeld({ pointerInside, keyboardInside, now, lastChangeAt }: HoldInputs): boolean {
  return pointerInside || keyboardInside || now - lastChangeAt < SETTLE_WINDOW_MS;
}

/**
 * Applies a held order to the live keys: held keys keep their relative order, removed keys
 * drop out, and new keys take their live position relative to the held keys after them.
 * (The rule the old Inbox used while the pointer was over it.)
 */
export function holdOrder(held: readonly string[], live: readonly string[]): string[] {
  const liveSet = new Set(live);
  const kept = held.filter((key) => liveSet.has(key));
  const keptSet = new Set(kept);
  const insertBefore = new Map<string, string[]>();
  let pending: string[] = [];
  for (const key of live) {
    if (!keptSet.has(key)) {
      pending.push(key);
      continue;
    }
    if (pending.length) insertBefore.set(key, pending);
    pending = [];
  }
  return [...kept.flatMap((key) => [...(insertBefore.get(key) ?? []), key]), ...pending];
}

function rowsByContainer(layout: Layout): Map<string, string[]> {
  const result = new Map<string, string[]>();
  const add = (row: RowEntry) => {
    const list = result.get(row.container) ?? [];
    list.push(row.key);
    result.set(row.container, list);
  };
  for (const entry of layout.entries) if (entry.type === "row") add(entry);
  for (const shelf of layout.shelves) shelf.rows.forEach(add);
  return result;
}

function reorderRows(rows: RowEntry[], held: readonly string[] | undefined): RowEntry[] {
  if (!held || rows.length < 2) return rows;
  const byKey = new Map(rows.map((row) => [row.key, row]));
  return holdOrder(
    held,
    rows.map((row) => row.key),
  ).map((key) => byKey.get(key)!);
}

/** The live layout with each container's rows in the previously displayed order. */
export function holdLayout(displayed: Layout, live: Layout): Layout {
  const held = rowsByContainer(displayed);
  const entries: ListEntry[] = [];
  let run: RowEntry[] = [];
  const flush = () => {
    if (run.length) entries.push(...reorderRows(run, held.get(run[0]!.container)));
    run = [];
  };
  for (const entry of live.entries) {
    if (entry.type === "row" && (run.length === 0 || run[0]!.container === entry.container)) {
      run.push(entry);
      continue;
    }
    flush();
    if (entry.type === "row") run.push(entry);
    else entries.push(entry);
  }
  flush();
  return {
    ...live,
    entries,
    shelves: live.shelves.map((shelf) => ({
      ...shelf,
      rows: reorderRows(shelf.rows, held.get(shelf.key)),
    })),
  };
}

/** The rows and their containers, as one comparable signature. */
export function orderSignature(layout: Layout): string {
  const parts: string[] = [];
  for (const entry of layout.entries) parts.push(entry.key);
  for (const shelf of layout.shelves) {
    parts.push(shelf.key);
    for (const row of shelf.rows) parts.push(row.key);
  }
  return parts.join("\n");
}

/** How far a released row starts from its new place: the real distance, capped. */
export function travelOffset(before: number, after: number, max = MAX_TRAVEL_PX): number {
  const delta = before - after;
  return Math.max(-max, Math.min(max, delta));
}

/** Cumulative top of each entry. */
export function entryStarts(entries: readonly { size: number }[]): number[] {
  const starts: number[] = [];
  let top = 0;
  for (const entry of entries) {
    starts.push(top);
    top += entry.size;
  }
  return starts;
}

/**
 * The entries to mount for a scroll position: those that intersect the viewport plus an
 * overscan on each side. Returns an inclusive index range, or null for an empty list.
 */
export function visibleRange(
  starts: readonly number[],
  sizes: readonly number[],
  scrollTop: number,
  viewport: number,
  overscan = 6,
): [number, number] | null {
  if (starts.length === 0) return null;
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (starts[middle]! <= scrollTop) low = middle;
    else high = middle - 1;
  }
  let last = low;
  while (last < starts.length - 1 && starts[last]! + sizes[last]! < scrollTop + viewport) last++;
  return [Math.max(0, low - overscan), Math.min(starts.length - 1, last + overscan)];
}
