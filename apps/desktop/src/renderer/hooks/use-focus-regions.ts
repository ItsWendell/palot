import { useEffect } from "react";
import {
  isFocusRegionName,
  orderFocusRegions,
  pickFocusRegion,
  type FocusRegionDirection,
  type FocusRegionName,
} from "../lib/focus-regions";
import { matchesShortcut, shortcutKeys } from "../lib/keyboard-shortcuts";

const REGION_SELECTOR = "[data-focus-region]";
// Palot's modal surfaces; Base UI does not set aria-modal on them.
const MODAL_SELECTOR = [
  '[aria-modal="true"]',
  '[data-slot="dialog-content"]',
  '[data-slot="alert-dialog-content"]',
  '[data-slot="sheet-content"]',
  '[data-slot="drawer-content"]',
].join(", ");
const UNAVAILABLE_SELECTOR = '[inert], [hidden], [aria-hidden="true"]';
const TABBABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[contenteditable='true']",
  "[tabindex]:not([tabindex='-1'])",
].join(", ");

/** Where focus lands in a region that has no remembered element, most specific first. */
const PREFERRED_TARGETS: Record<FocusRegionName, readonly string[]> = {
  sidebar: ['[aria-current="page"]', "[data-sidebar-fluid-row] button"],
  transcript: [],
  composer: ['[aria-label="Message Palot"]', "[data-palot-composer-input]"],
  workbench: ['[role="tabpanel"]:not([hidden]):not([inert])', '[role="tab"][aria-selected="true"]'],
};

function regionName(element: Element): FocusRegionName | null {
  const name = element.getAttribute("data-focus-region");
  return isFocusRegionName(name) ? name : null;
}

function available(element: HTMLElement): boolean {
  if (!element.isConnected || element.closest(UNAVAILABLE_SELECTOR)) return false;
  // Collapsed panels fade out; Chromium reports them as not visible.
  if (typeof element.checkVisibility === "function") {
    return element.checkVisibility({ visibilityProperty: true, opacityProperty: true });
  }
  return true;
}

export function modalDialogOpen(root: ParentNode = document): boolean {
  return [...root.querySelectorAll<HTMLElement>(MODAL_SELECTOR)].some(
    (element) => element.isConnected && !element.hidden,
  );
}

/** Available regions in F6 order. */
export function focusRegions(root: ParentNode = document): HTMLElement[] {
  const regions = [...root.querySelectorAll<HTMLElement>(REGION_SELECTOR)].filter(
    (region) => regionName(region) !== null && available(region),
  );
  return orderFocusRegions(regions, (region) => regionName(region)!);
}

function candidates(region: HTMLElement, remembered: HTMLElement | undefined): HTMLElement[] {
  const name = regionName(region)!;
  const preferred = PREFERRED_TARGETS[name].flatMap((selector) => {
    const match = region.querySelector<HTMLElement>(selector);
    return match ? [match] : [];
  });
  return [
    ...(remembered ? [remembered] : []),
    ...preferred,
    ...(region.hasAttribute("tabindex") ? [region] : []),
    ...region.querySelectorAll<HTMLElement>(TABBABLE_SELECTOR),
  ];
}

function focusRegion(region: HTMLElement, remembered: HTMLElement | undefined): boolean {
  const document = region.ownerDocument;
  for (const candidate of new Set(candidates(region, remembered))) {
    if (!candidate.isConnected || !region.contains(candidate)) continue;
    if (candidate !== region && candidate.closest(UNAVAILABLE_SELECTOR) !== null) continue;
    candidate.focus();
    if (document.activeElement === candidate) return true;
  }
  return false;
}

/**
 * Moves focus to the next or previous available region. Returns false when no region could
 * take focus.
 */
export function moveFocusRegion(
  direction: FocusRegionDirection,
  remembered: WeakMap<Element, HTMLElement>,
  root: Document = document,
): boolean {
  const regions = focusRegions(root);
  const active = root.activeElement;
  const currentRegion = active?.closest<HTMLElement>(REGION_SELECTOR) ?? null;
  let current = currentRegion && regions.includes(currentRegion) ? currentRegion : null;
  // A region that cannot take focus (for example an empty task list) passes to the next.
  for (let attempt = 0; attempt < regions.length; attempt += 1) {
    const target = pickFocusRegion(regions, current, direction);
    if (!target || target === currentRegion) return false;
    if (focusRegion(target, remembered.get(target))) return true;
    current = target;
  }
  return false;
}

/**
 * F6 and Shift+F6 (rebindable) move focus between the task list, transcript, composer and
 * workbench. Listens in the capture phase on `window` so terminals and code editors, which
 * keep Tab, cannot swallow the key first. Mount once.
 */
export function useFocusRegions(): void {
  useEffect(() => {
    const remembered = new WeakMap<Element, HTMLElement>();
    const onFocusIn = (event: FocusEvent) => {
      if (!(event.target instanceof HTMLElement)) return;
      const region = event.target.closest(REGION_SELECTOR);
      if (region) remembered.set(region, event.target);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      const direction = matchesShortcut(event, shortcutKeys("focus.region.next"))
        ? "next"
        : matchesShortcut(event, shortcutKeys("focus.region.previous"))
          ? "previous"
          : null;
      if (!direction || modalDialogOpen()) return;
      if (!moveFocusRegion(direction, remembered)) return;
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener("focusin", onFocusIn, true);
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("focusin", onFocusIn, true);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, []);
}
