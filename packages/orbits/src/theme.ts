import type { RefObject } from "react";
import { useEffect, useState } from "react";
import type { OrbTheme } from "./types.js";

function ancestorTheme(element: Element | null): boolean | null {
  let node = element;
  while (node) {
    const attribute = node.getAttribute("data-theme");
    if (attribute === "dark") return true;
    if (attribute === "light") return false;
    if (node.classList.contains("dark")) return true;
    if (node.classList.contains("light")) return false;
    node = node.parentElement;
  }
  return null;
}

function systemDark() {
  return typeof matchMedia === "undefined" || matchMedia("(prefers-color-scheme: dark)").matches;
}

export function useResolvedDark(theme: OrbTheme, hostRef: RefObject<Element | null>) {
  const [dark, setDark] = useState(true);

  useEffect(() => {
    if (theme === "dark") {
      setDark(true);
      return;
    }
    if (theme === "light") {
      setDark(false);
      return;
    }

    const resolve = () => setDark(ancestorTheme(hostRef.current) ?? systemDark());
    resolve();
    const media =
      typeof matchMedia === "undefined" ? null : matchMedia("(prefers-color-scheme: dark)");
    media?.addEventListener("change", resolve);

    const observer =
      typeof MutationObserver !== "undefined" && hostRef.current
        ? new MutationObserver(resolve)
        : null;
    observer?.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-theme"],
      subtree: true,
    });

    return () => {
      media?.removeEventListener("change", resolve);
      observer?.disconnect();
    };
  }, [hostRef, theme]);

  return dark;
}

export function useReducedMotion() {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    if (typeof matchMedia === "undefined") return;
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(media.matches);
    media.addEventListener("change", update);
    update();
    return () => media.removeEventListener("change", update);
  }, []);

  return reduced;
}
