import { useEffect, useState } from "react";

/**
 * True once the element has come within `rootMargin` of the viewport, and from then on. Heavier
 * Usage sections wait for it before loading. Without IntersectionObserver it is true at once.
 */
export function useSeenInView<T extends Element>(rootMargin = "240px") {
  const [node, setNode] = useState<T | null>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    if (seen || !node) return;
    if (typeof IntersectionObserver === "undefined") {
      setSeen(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setSeen(true);
      },
      { rootMargin },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [node, rootMargin, seen]);
  return [setNode, seen] as const;
}
