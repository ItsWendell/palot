import { useState } from "react";

// Frozen in place, so it can stand in for an empty list of any element type.
const EMPTY_LIST: never[] = [];
Object.freeze(EMPTY_LIST);

/** Structural equality for plain data: primitives, arrays and plain objects. */
export function samePlainValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (typeof left !== "object" || typeof right !== "object" || left === null || right === null) {
    return false;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => samePlainValue(value, right[index]))
    );
  }
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const keys = Object.keys(leftRecord);
  return (
    keys.length === Object.keys(rightRecord).length &&
    keys.every(
      (key) => Object.hasOwn(rightRecord, key) && samePlainValue(leftRecord[key], rightRecord[key]),
    )
  );
}

/**
 * Returns the value from an earlier render while `next` stays equal to it, so
 * memoised children that compare by identity skip renders for equal content.
 */
export function useStableValue<T>(next: T, equal: (held: T, next: T) => boolean): T {
  const [held, setHeld] = useState(next);
  if (held === next || equal(held, next)) return held;
  // React's "adjust state while rendering" pattern: the next render returns `next` as held.
  setHeld(next);
  return next;
}

/**
 * A list of plain view objects that keeps its identity while its content is
 * unchanged. Every empty list is the same frozen array.
 */
export function useStableList<T>(next: T[]): T[] {
  return useStableValue(next.length === 0 ? EMPTY_LIST : next, samePlainValue);
}
