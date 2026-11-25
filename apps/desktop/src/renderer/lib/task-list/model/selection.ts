/**
 * Multi-select: Mod+click toggles one row, Shift+click and Shift+arrows select a range from
 * the anchor. Only task rows are selectable; the order passed in is the rows' list order.
 */

export interface Selection {
  keys: readonly string[];
  /** Where a range starts; the last row clicked or toggled. */
  anchor: string | null;
}

export const NO_SELECTION: Selection = { keys: [], anchor: null };

export function isSelected(selection: Selection, key: string): boolean {
  return selection.keys.includes(key);
}

export function toggleSelection(selection: Selection, key: string): Selection {
  const keys = selection.keys.includes(key)
    ? selection.keys.filter((candidate) => candidate !== key)
    : [...selection.keys, key];
  return { keys, anchor: keys.length ? key : null };
}

/** Selects every row from the anchor (or `from` when there is none) through `key`. */
export function selectRange(
  selection: Selection,
  order: readonly string[],
  key: string,
  from: string | null = null,
): Selection {
  const anchor = selection.anchor ?? from ?? key;
  const start = order.indexOf(anchor);
  const end = order.indexOf(key);
  if (start === -1 || end === -1) return { keys: [key], anchor: key };
  const [low, high] = start <= end ? [start, end] : [end, start];
  return { keys: order.slice(low, high + 1), anchor };
}

/**
 * Shift+Up/Down from the focused row: extends the range to the neighbouring row and returns
 * where focus goes. Headers are skipped because `order` holds rows only.
 */
export function extendSelection(
  selection: Selection,
  order: readonly string[],
  focused: string,
  direction: 1 | -1,
): { selection: Selection; focus: string } {
  const index = order.indexOf(focused);
  if (index === -1) return { selection, focus: focused };
  const target = order[Math.max(0, Math.min(order.length - 1, index + direction))]!;
  return { selection: selectRange(selection, order, target, focused), focus: target };
}

/** Drops rows that no longer exist (settled away, filtered out). */
export function pruneSelection(selection: Selection, existing: ReadonlySet<string>): Selection {
  const keys = selection.keys.filter((key) => existing.has(key));
  if (keys.length === selection.keys.length) return selection;
  return {
    keys,
    anchor:
      selection.anchor && existing.has(selection.anchor) ? selection.anchor : (keys[0] ?? null),
  };
}
