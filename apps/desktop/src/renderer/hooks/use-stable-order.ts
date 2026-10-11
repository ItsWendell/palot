import { useCallback, useMemo, useState } from "react";

/**
 * Applies a held order to the latest items. Held items keep their relative
 * order with the latest data, removed items drop out, and new items take their
 * live position relative to the held items that follow them.
 */
export function applyStableOrder<T>(
  held: readonly string[],
  items: readonly T[],
  keyOf: (item: T) => string,
): T[] {
  const byKey = new Map(items.map((item) => [keyOf(item), item]));
  const kept = held.filter((key) => byKey.has(key));
  const keptKeys = new Set(kept);
  const insertBefore = new Map<string, T[]>();
  let pending: T[] = [];
  for (const item of items) {
    const key = keyOf(item);
    if (!keptKeys.has(key)) {
      pending.push(item);
      continue;
    }
    if (pending.length) insertBefore.set(key, pending);
    pending = [];
  }
  return [
    ...kept.flatMap((key) => [...(insertBefore.get(key) ?? []), byKey.get(key)!]),
    ...pending,
  ];
}

/**
 * Holds the rendered order of `items` while `frozen` is true and returns the
 * live order once it is released. Item data always stays current.
 */
export function useStableOrder<T>(
  items: readonly T[],
  keyOf: (item: T) => string,
  frozen: boolean,
): readonly T[] {
  const [held, setHeld] = useState<readonly string[] | null>(null);
  const ordered = useMemo(
    () => (frozen && held ? applyStableOrder(held, items, keyOf) : items),
    [frozen, held, items, keyOf],
  );
  // Remember the rendered order from this render (React's "adjust state while
  // rendering" pattern); it converges because a held order reproduces itself.
  if (!frozen) {
    if (held !== null) setHeld(null);
  } else if (held === null || !sameKeys(held, ordered, keyOf)) {
    setHeld(ordered.map(keyOf));
  }
  return ordered;
}

/** Freezes while the pointer is over the element that receives `freezeProps`. */
export function usePointerFreeze() {
  const [frozen, setFrozen] = useState(false);
  const onPointerEnter = useCallback(() => setFrozen(true), []);
  const onPointerLeave = useCallback(() => setFrozen(false), []);
  return { frozen, freezeProps: { onPointerEnter, onPointerLeave } };
}

function sameKeys<T>(keys: readonly string[], items: readonly T[], keyOf: (item: T) => string) {
  return keys.length === items.length && items.every((item, index) => keyOf(item) === keys[index]);
}
