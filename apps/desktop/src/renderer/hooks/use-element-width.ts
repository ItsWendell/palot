import { useLayoutEffect, useState } from "react";

/** Border-box width of an element, following resizes of its allocated space. */
export function useElementWidth(element: Element | null): number {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    if (!element) return;
    setWidth(element.getBoundingClientRect().width);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries.at(-1);
      if (entry) setWidth(entry.borderBoxSize?.[0]?.inlineSize ?? entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  return width;
}
