import { useEffect } from "react";

/** Presentation only: do not suspend OpenCode subscriptions or task attention. */
export function useDesktopPresentation(): void {
  useEffect(() => {
    const root = document.documentElement;
    const visibility = () => {
      root.dataset.documentVisible = String(!document.hidden);
    };
    visibility();
    document.addEventListener("visibilitychange", visibility);
    const timers = new Map<HTMLElement, ReturnType<typeof setTimeout>>();
    const scrolling = (event: Event) => {
      const element = event.target;
      if (
        !(element instanceof HTMLElement) ||
        !element.classList.contains("palot-native-scrollbar")
      )
        return;
      element.dataset.scrolling = "";
      clearTimeout(timers.get(element));
      timers.set(
        element,
        setTimeout(() => {
          delete element.dataset.scrolling;
          timers.delete(element);
        }, 900),
      );
    };
    document.addEventListener("scroll", scrolling, true);
    return () => {
      document.removeEventListener("visibilitychange", visibility);
      document.removeEventListener("scroll", scrolling, true);
      for (const [element, timer] of timers) {
        clearTimeout(timer);
        delete element.dataset.scrolling;
      }
    };
  }, []);
}
