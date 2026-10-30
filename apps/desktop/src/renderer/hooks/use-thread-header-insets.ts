import { useLayoutEffect, useState } from "react";

/** Keep window controls clear without inheriting per-resize values through the transcript. */
export function useThreadHeaderInsets() {
  const [header, setHeader] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const workspace = header?.closest<HTMLElement>("[data-palot-workspace]");
    const chrome = workspace?.querySelector<HTMLElement>(".window-chrome-cluster");
    const trailing = workspace?.querySelector<HTMLElement>(".window-trailing-controls");
    const center = workspace?.querySelector<HTMLElement>('[data-shell-panel="center"]');
    const navigation = workspace?.querySelector<HTMLElement>('[data-shell-panel="navigation"]');
    if (!header || !workspace || !chrome || !trailing || !center || !navigation) return;

    let leading: string | undefined;
    let trailingInset: string | undefined;
    const measure = () => {
      // Finish geometry reads before writing either property: even a header-only
      // invalidation must not force a second style/layout pass in this callback.
      const rect = center.getBoundingClientRect();
      const nextLeading = `${Math.max(18, chrome.getBoundingClientRect().right - rect.left + 12)}px`;
      const nextTrailing = `${Math.max(12, rect.right - trailing.getBoundingClientRect().left + 12)}px`;
      if (leading !== nextLeading) {
        header.style.setProperty("--thread-header-leading-inset", nextLeading);
        leading = nextLeading;
      }
      if (trailingInset !== nextTrailing) {
        header.style.setProperty("--thread-header-trailing-inset", nextTrailing);
        trailingInset = nextTrailing;
      }
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    for (const element of [workspace, chrome, trailing, center, navigation])
      observer.observe(element);
    return () => observer.disconnect();
  }, [header]);
  return setHeader;
}
