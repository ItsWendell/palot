"use client";

// Fluid Functionalism list behavior for Base UI primitives whose rows are rendered by
// callers (menus, selects, comboboxes, tabs, toggle groups). Rows are discovered from the
// DOM instead of carrying explicit indices, so every existing call site keeps its markup.
// Behavior adapted from Fluid Functionalism's Dropdown and TabsSubtle (MIT, see
// THIRD_PARTY_NOTICES.md).

import { motion } from "motion/react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FocusEvent,
  type MouseEvent,
  type Ref,
  type RefCallback,
} from "react";

import {
  isOwnEvent,
  useFluidHover,
  type ItemRect,
  type UseFluidHoverReturn,
} from "@/hooks/use-fluid-hover";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { cn } from "@/lib/cn";
import { spring } from "@/lib/springs";

/** Set on every row a fluid list has registered. Rows without it keep their own fill. */
export const FLUID_ITEM_ATTR = "data-fluid-item";

/** Popup rows that Base UI highlights through `data-highlighted`. */
export const MENU_ITEM_SELECTOR =
  '[role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"]';
export const OPTION_ITEM_SELECTOR = '[role="option"]';

/**
 * Popup enter/exit on CSS transitions so Base UI keeps the popup mounted until the exit
 * finishes. Enter rides motion's `spring(0.16, 0)` (spring.moderate) rendered as a CSS
 * `linear()` curve; exit is the quicker spring.moderate.exit tween. The 4px slide follows
 * the resolved side. Reduced motion keeps only the fade.
 */
export const popupMotionClassName =
  "transition-[opacity,scale,translate] duration-350 ease-[linear(0,0.2794,0.6159,0.8186,0.9198,0.966,0.986,0.9943,0.9977,0.9991,0.9997,1)] data-starting-style:opacity-0 data-ending-style:opacity-0 data-ending-style:duration-120 data-ending-style:ease-out motion-safe:data-starting-style:scale-y-96 motion-safe:data-ending-style:scale-y-96 motion-safe:data-[side=bottom]:data-starting-style:-translate-y-1 motion-safe:data-[side=bottom]:data-ending-style:-translate-y-1 motion-safe:data-[side=top]:data-starting-style:translate-y-1 motion-safe:data-[side=top]:data-ending-style:translate-y-1";

/** One gliding fill behind popup rows; destructive rows tint it. */
export const popupHighlightClassName =
  "rounded-md [:has([data-fluid-hover-active][data-variant=destructive])>&]:bg-destructive/10 dark:[:has([data-fluid-hover-active][data-variant=destructive])>&]:bg-destructive/20";

/** Elements the pointer may cross between rows without dropping the highlight. */
const GAP_SELECTOR =
  '[role="separator"], [role="group"], [role="radiogroup"], [role="presentation"], [role="none"], [aria-hidden="true"]';

export interface UseFluidListOptions {
  /** Matches the list's rows inside the container, in visual order. */
  itemSelector: string;
  axis?: "x" | "y";
  /** Attribute the primitive sets on its highlighted row; the fluid highlight follows it. */
  highlightAttribute?: string;
  /** Rows the primitive reports as selected (tabs, toggles) for a selection pill. */
  isSelected?: (element: HTMLElement) => boolean;
  /** Move the highlight with real focus inside the list (tabs and toggle groups). */
  followFocus?: boolean;
  /**
   * Pointer over non-row content (a label, help text, an input) clears the highlight
   * instead of lighting the nearest row. Gaps, separators and group wrappers still glide.
   */
  clearOverContent?: boolean;
  /** Pixels past the first and last row along the axis before the highlight clears. */
  reach?: number;
}

export interface UseFluidListReturn<T extends HTMLElement> {
  /** Attach to the list container (the rows' positioned, scrolling ancestor). */
  ref: RefCallback<T>;
  hover: UseFluidHoverReturn;
  /** The selected row's index, when `isSelected` is given. */
  selectedIndex: number | null;
  handlers: {
    onMouseEnter: (event: MouseEvent) => void;
    onMouseMove: (event: MouseEvent) => void;
    onMouseLeave: (event: MouseEvent) => void;
    onClick: (event: MouseEvent) => void;
    onFocus?: (event: FocusEvent) => void;
    onBlur?: (event: FocusEvent) => void;
  };
}

function isDisabledRow(element: HTMLElement) {
  return element.getAttribute("aria-disabled") === "true" || element.hasAttribute("data-disabled");
}

export function useFluidList<T extends HTMLElement>(
  forwardedRef: Ref<T> | undefined,
  {
    itemSelector,
    axis = "y",
    highlightAttribute,
    isSelected,
    followFocus = false,
    clearOverContent = false,
    reach,
  }: UseFluidListOptions,
): UseFluidListReturn<T> {
  const containerRef = useRef<T | null>(null);
  // Popups mount their container after the component that owns this hook, so the DOM
  // node is state: discovery restarts whenever the container appears or changes.
  const [container, setContainer] = useState<T | null>(null);
  const ref = useCallback(
    (node: T | null) => {
      containerRef.current = node;
      setContainer(node);
      if (typeof forwardedRef === "function") forwardedRef(node);
      else if (forwardedRef) forwardedRef.current = node;
    },
    [forwardedRef],
  );
  const hover = useFluidHover(containerRef, { axis, isItemDisabled: isDisabledRow });
  const { registerItem, setActiveIndex } = hover;
  const {
    onMouseEnter: hoverEnter,
    onMouseMove: hoverMove,
    onMouseLeave: hoverLeave,
    onClick: hoverClick,
  } = hover.handlers;
  const elementsRef = useRef<HTMLElement[]>([]);
  const pointerInsideRef = useRef(false);
  // A row whose submenu is open keeps the highlight while the pointer crosses other rows
  // on its way there; Base UI's safe area keeps those rows from taking the highlight too.
  const pinnedRef = useRef<number | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const isSelectedRef = useRef(isSelected);
  useEffect(() => {
    isSelectedRef.current = isSelected;
  }, [isSelected]);

  const primitiveHighlight = useCallback(() => {
    if (!highlightAttribute) return -1;
    return elementsRef.current.findIndex((element) => element.hasAttribute(highlightAttribute));
  }, [highlightAttribute]);

  const sync = useCallback(() => {
    const elements = elementsRef.current;
    const selected = isSelectedRef.current;
    if (selected) {
      const index = elements.findIndex(selected);
      setSelectedIndex(index === -1 ? null : index);
    }
    if (!highlightAttribute) return;
    const pinned = elements.findIndex((element) => element.hasAttribute("data-popup-open"));
    pinnedRef.current = pinned === -1 ? null : pinned;
    const target = pinned === -1 ? primitiveHighlight() : pinned;
    if (target !== -1) setActiveIndex(target);
    else if (!pointerInsideRef.current) setActiveIndex(null);
  }, [highlightAttribute, primitiveHighlight, setActiveIndex]);

  const scan = useCallback(() => {
    const container = containerRef.current;
    const next = container
      ? Array.from(container.querySelectorAll<HTMLElement>(itemSelector))
      : ([] as HTMLElement[]);
    const previous = elementsRef.current;
    const kept = new Set(next);
    for (const element of previous) {
      if (!kept.has(element)) element.removeAttribute(FLUID_ITEM_ATTR);
    }
    for (let index = next.length; index < previous.length; index++) registerItem(index, null);
    next.forEach((element, index) => {
      if (previous[index] === element) return;
      if (previous[index]) registerItem(index, null);
      element.setAttribute(FLUID_ITEM_ATTR, "");
      registerItem(index, element);
    });
    elementsRef.current = next;
    sync();
  }, [containerRef, itemSelector, registerItem, sync]);

  useEffect(() => {
    if (!container) return;
    scan();
    let frame: number | null = null;
    const observer = new MutationObserver((records) => {
      if (records.some((record) => record.type === "childList")) {
        // Rows mount, unmount or reorder: rescan once per frame.
        if (frame === null) {
          frame = requestAnimationFrame(() => {
            frame = null;
            scan();
          });
        }
        return;
      }
      sync();
    });
    const attributeFilter = ["aria-selected", "aria-pressed", "data-popup-open"];
    if (highlightAttribute) attributeFilter.push(highlightAttribute);
    observer.observe(container, { subtree: true, childList: true, attributes: true, attributeFilter });
    return () => {
      observer.disconnect();
      if (frame !== null) cancelAnimationFrame(frame);
      const elements = elementsRef.current;
      elements.forEach((element, index) => {
        element.removeAttribute(FLUID_ITEM_ATTR);
        registerItem(index, null);
      });
      elementsRef.current = [];
    };
  }, [container, highlightAttribute, registerItem, scan, sync]);

  const outOfReach = useCallback(
    (event: MouseEvent) => {
      if (reach === undefined) return false;
      const elements = elementsRef.current;
      const first = elements[0];
      const last = elements.at(-1);
      if (!first || !last) return true;
      const start = first.getBoundingClientRect();
      const end = last.getBoundingClientRect();
      const point = axis === "x" ? event.clientX : event.clientY;
      const min = axis === "x" ? start.left : start.top;
      const max = axis === "x" ? end.right : end.bottom;
      return point < min - reach || point > max + reach;
    },
    [axis, reach],
  );

  const overContent = useCallback(
    (event: MouseEvent) => {
      if (!clearOverContent) return false;
      const container = containerRef.current;
      const target = event.target;
      if (!container || !(target instanceof Element) || target === container) return false;
      if (target.closest(itemSelector)) return false;
      if (target.matches(GAP_SELECTOR)) return false;
      return target.querySelector(itemSelector) === null;
    },
    [clearOverContent, containerRef, itemSelector],
  );

  const restorePrimitiveHighlight = useCallback(() => {
    const index = primitiveHighlight();
    if (index !== -1) setActiveIndex(index);
  }, [primitiveHighlight, setActiveIndex]);

  const onMouseEnter = useCallback(
    (event: MouseEvent) => {
      if (!isOwnEvent(event)) return;
      pointerInsideRef.current = true;
      if (pinnedRef.current === null) hoverEnter();
    },
    [hoverEnter],
  );

  const onMouseMove = useCallback(
    (event: MouseEvent) => {
      if (pinnedRef.current !== null) return;
      if (!isOwnEvent(event)) {
        // The pointer is over a layer portalled from a row (a tab's context menu). React
        // fires no mouseleave for it, so the list lets go here.
        if (pointerInsideRef.current) {
          pointerInsideRef.current = false;
          hoverLeave();
          restorePrimitiveHighlight();
        }
        return;
      }
      pointerInsideRef.current = true;
      if (overContent(event) || outOfReach(event)) {
        hoverLeave();
        return;
      }
      hoverMove(event);
    },
    [hoverLeave, hoverMove, outOfReach, overContent, restorePrimitiveHighlight],
  );

  const onMouseLeave = useCallback(
    (event: MouseEvent) => {
      if (!isOwnEvent(event)) return;
      pointerInsideRef.current = false;
      if (pinnedRef.current !== null) return;
      hoverLeave();
      // What stays lit is what Enter would activate.
      restorePrimitiveHighlight();
    },
    [hoverLeave, restorePrimitiveHighlight],
  );

  const onFocus = useCallback(
    (event: FocusEvent) => {
      if (!isOwnEvent(event) || !(event.target instanceof Element)) return;
      const row = event.target.closest<HTMLElement>(itemSelector);
      const index = row ? elementsRef.current.indexOf(row) : -1;
      if (index !== -1) setActiveIndex(index);
    },
    [itemSelector, setActiveIndex],
  );

  const onBlur = useCallback(
    (event: FocusEvent) => {
      if (!isOwnEvent(event)) return;
      if (containerRef.current?.contains(event.relatedTarget as Node | null)) return;
      if (!pointerInsideRef.current) setActiveIndex(null);
    },
    [containerRef, setActiveIndex],
  );

  return {
    ref,
    hover,
    selectedIndex,
    handlers: {
      onMouseEnter,
      onMouseMove,
      onMouseLeave,
      onClick: hoverClick,
      ...(followFocus ? { onFocus, onBlur } : {}),
    },
  };
}

/**
 * A popup list (menu, select, combobox): one gliding highlight that follows the pointer
 * and Base UI's `data-highlighted` row, so pointer and keyboard always light the same row.
 * `ref` goes on the rows' positioned wrapper (the highlight's container); the handlers go
 * on the popup so its padding counts as a gap between rows.
 */
export function useFluidPopupList<T extends HTMLElement>(
  itemSelector: string,
  forwardedRef?: Ref<T>,
) {
  return useFluidList(forwardedRef, {
    itemSelector,
    highlightAttribute: "data-highlighted",
    clearOverContent: true,
  });
}

type EventHandler = (event: never) => void;

/** Runs the caller's handler, then the fluid list's, for each handler the list needs. */
export function chainHandlers<P extends object>(
  props: P,
  handlers: Partial<Record<string, EventHandler>>,
): P {
  const merged: Record<string, unknown> = { ...(props as Record<string, unknown>) };
  for (const [key, handler] of Object.entries(handlers)) {
    if (!handler) continue;
    const own = merged[key];
    merged[key] =
      typeof own === "function"
        ? (event: never) => {
            (own as EventHandler)(event);
            handler(event);
          }
        : handler;
  }
  return merged as P;
}

const fade = { duration: 0.08 };

/**
 * The selected row's pill, sliding between rows on spring.moderate. It dims slightly
 * while another row is hovered, so the hover pill reads as a preview.
 */
export function FluidSelectionPill({
  rect,
  dimmed = false,
  className,
}: {
  rect: ItemRect | null | undefined;
  dimmed?: boolean;
  className?: string;
}) {
  const reduceMotion = useReducedMotion();
  if (!rect) return null;
  return (
    <motion.div
      data-slot="fluid-selection-pill"
      aria-hidden="true"
      className={cn("pointer-events-none absolute top-0 left-0 rounded-md", className)}
      initial={false}
      animate={{
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
        opacity: dimmed ? 0.8 : 1,
      }}
      transition={{ ...(reduceMotion ? { duration: 0 } : spring.moderate), opacity: fade }}
    />
  );
}
