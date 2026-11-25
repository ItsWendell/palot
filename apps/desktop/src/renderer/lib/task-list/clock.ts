import { useSyncExternalStore } from "react";

/**
 * One shared clock for every live duration. Only the small text leaves that print a duration
 * subscribe to it, so a ticking second never re-renders a row.
 */
let now = Date.now();
const listeners = new Set<() => void>();

export function tickClock(value = Date.now()) {
  now = value;
  for (const listener of listeners) listener();
}

export function clockNow(): number {
  return now;
}

export function subscribeClock(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useClock(): number {
  return useSyncExternalStore(subscribeClock, clockNow);
}
