import { useSyncExternalStore } from "react";

/**
 * A minimal external store. Components subscribe to one slice through a selector and
 * re-render only when that slice changes, so one task's new status sentence re-renders that
 * task's row and nothing else. (Copied from the composer prototype.)
 */
export interface Store<S> {
  get(): S;
  set(update: Partial<S> | ((state: S) => Partial<S>)): void;
  subscribe(listener: () => void): () => void;
}

export function createStore<S extends object>(initial: S): Store<S> {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set(update) {
      const patch = typeof update === "function" ? update(state) : update;
      let changed = false;
      for (const key of Object.keys(patch) as (keyof S)[]) {
        if (!Object.is(state[key], patch[key])) {
          changed = true;
          break;
        }
      }
      if (!changed) return;
      state = { ...state, ...patch };
      for (const listener of listeners) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** Selectors must return stored values or primitives; a fresh object would loop. */
export function useStoreSelector<S, T>(store: Store<S>, selector: (state: S) => T): T {
  return useSyncExternalStore(store.subscribe, () => selector(store.get()));
}
