import { useSyncExternalStore } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

function subscribe(callback: () => void) {
  const query = window.matchMedia?.(QUERY);
  query?.addEventListener("change", callback);
  // AppearanceSync mirrors the native accessibility preference onto the root.
  const observer = new MutationObserver(callback);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-reduced-motion"],
  });
  return () => {
    query?.removeEventListener("change", callback);
    observer.disconnect();
  };
}

/** The current reduced-motion preference, for event handlers that animate imperatively. */
export function prefersReducedMotion(): boolean {
  return (
    window.matchMedia?.(QUERY).matches === true ||
    document.documentElement.dataset.reducedMotion === "true"
  );
}

/**
 * Whether motion should drop travel and keep only fades. Honours both the CSS media
 * query and the native accessibility preference, which can disagree on Linux.
 */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, prefersReducedMotion, () => false);
}
