import { AnimatePresence, motion } from "motion/react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
  type RefObject,
} from "react";
import type { SidebarMode } from "../../shared";
import { useReducedMotion } from "../hooks/use-reduced-motion";
import { cn } from "../lib/cn";
import { spring } from "../lib/springs";

/** Hover intent before a rail button or the hot edge peeks the hidden column. */
export const SIDEBAR_PEEK_OPEN_DELAY_MS = 250;
/** Grace period after the pointer leaves the rail and the peek before it closes. */
export const SIDEBAR_PEEK_CLOSE_DELAY_MS = 200;
/** A peek never grows wider than this, whatever the saved column width. */
export const SIDEBAR_PEEK_MAX_WIDTH = 360;
/** Pointer slack around the rail and the peek, so a near miss does not close it. */
const PEEK_HIT_SLOP = 8;

export interface SidebarPeekController {
  /** The peeked view, or null while nothing is peeking. */
  view: SidebarMode | null;
  /** Hover intent on a view: peek it after the intent delay, or switch to it now. */
  requestPeek(view: SidebarMode): void;
  /** The pointer left before the intent delay ran out. Leaves an open peek alone. */
  cancelPendingPeek(): void;
  scheduleClose(): void;
  cancelScheduledClose(): void;
  close(): void;
}

/**
 * Collapsed-column peek state (Fluid Functionalism's `peek="hover"`). One timer
 * serves every intent and dismissal, so crossing from a trigger into the peek
 * cancels whatever the trigger armed. Peeking is local state: it never pins the
 * column or touches the persisted navigation preference.
 */
export function useSidebarPeek(enabled: boolean): SidebarPeekController {
  const [view, setView] = useState<SidebarMode | null>(null);
  const viewRef = useRef<SidebarMode | null>(null);
  const timerRef = useRef<number | null>(null);
  // Pinning the column, compact mode, or leaving the workspace ends a peek in the
  // same render; the effect below retires any timer that would reopen it.
  if (!enabled && view !== null) setView(null);
  useLayoutEffect(() => {
    viewRef.current = view;
  }, [view]);

  const cancelTimer = useCallback(() => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);
  useEffect(() => {
    if (!enabled) cancelTimer();
  }, [cancelTimer, enabled]);
  useEffect(() => cancelTimer, [cancelTimer]);

  const requestPeek = useCallback(
    (next: SidebarMode) => {
      if (!enabled) return;
      cancelTimer();
      if (viewRef.current !== null) {
        setView(next);
        return;
      }
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        setView(next);
      }, SIDEBAR_PEEK_OPEN_DELAY_MS);
    },
    [cancelTimer, enabled],
  );
  const cancelPendingPeek = useCallback(() => {
    if (viewRef.current === null) cancelTimer();
  }, [cancelTimer]);
  const close = useCallback(() => {
    cancelTimer();
    setView(null);
  }, [cancelTimer]);
  const scheduleClose = useCallback(() => {
    cancelTimer();
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      setView(null);
    }, SIDEBAR_PEEK_CLOSE_DELAY_MS);
  }, [cancelTimer]);

  return {
    view: enabled ? view : null,
    requestPeek,
    cancelPendingPeek,
    scheduleClose,
    cancelScheduledClose: cancelTimer,
    close,
  };
}

/** Something opened from inside the peek (a row menu, a dialog) owns the pointer. */
function peekBusy(overlay: HTMLElement | null) {
  if (overlay?.querySelector("[data-popup-open]")) return true;
  return document.querySelector("[role='dialog'], [role='alertdialog']") !== null;
}

function within(element: Element | null, x: number, y: number) {
  if (!element) return false;
  const box = element.getBoundingClientRect();
  return (
    x >= box.left - PEEK_HIT_SLOP &&
    x <= box.right + PEEK_HIT_SLOP &&
    y >= box.top - PEEK_HIT_SLOP &&
    y <= box.bottom + PEEK_HIT_SLOP
  );
}

/**
 * The hidden task column shown as a floating, non-modal overlay beside the rail.
 * Closes when the pointer leaves both the rail and the overlay, on Escape, on an
 * outside press, and once a row inside is chosen. Focus is never trapped; keyboard
 * users pin the column from the rail instead.
 */
export function SidebarPeek({
  peek,
  railRef,
  left,
  width,
  label,
  children,
}: {
  peek: SidebarPeekController;
  /** The rail column: the pointer may travel anywhere over it without closing the peek. */
  railRef: RefObject<HTMLElement | null>;
  left: number;
  width: number;
  label: string;
  children: ReactNode;
}) {
  const overlayRef = useRef<HTMLElement>(null);
  const reduceMotion = useReducedMotion();
  const { view, close, scheduleClose, cancelScheduledClose } = peek;
  const open = view !== null;

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      // Escape inside a field (an inline rename) belongs to that field.
      if (event.target instanceof Element && event.target.closest("input, textarea")) return;
      if (peekBusy(overlayRef.current)) return;
      close();
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && (overlayRef.current?.contains(target) || railRef.current?.contains(target)))
        return;
      if (peekBusy(overlayRef.current)) return;
      close();
    };
    // Held by geometry rather than enter/leave: a tooltip or menu portalled over the
    // peek steals hit-testing without the pointer ever leaving it.
    let inside = true;
    const onPointerMove = (event: PointerEvent) => {
      const nowInside =
        within(overlayRef.current, event.clientX, event.clientY) ||
        within(railRef.current, event.clientX, event.clientY);
      if (nowInside) {
        inside = true;
        cancelScheduledClose();
      } else if (inside && !peekBusy(overlayRef.current)) {
        inside = false;
        scheduleClose();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("pointermove", onPointerMove);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("pointermove", onPointerMove);
    };
  }, [cancelScheduledClose, close, open, railRef, scheduleClose]);

  // Choosing a row (its primary button, not a secondary action) ends the peek.
  const onClick = (event: MouseEvent<HTMLElement>) => {
    if (!(event.target instanceof Element)) return;
    const row = event.target.closest("[data-sidebar-fluid-row]");
    const button = event.target.closest("button");
    if (row && button && row.querySelector("button") === button) close();
  };

  const offset = reduceMotion ? 0 : -12;
  return (
    <AnimatePresence>
      {open ? (
        <motion.aside
          key="sidebar-peek"
          ref={overlayRef}
          aria-label={label}
          data-sidebar-peek=""
          className={cn(
            "palot-sidebar-peek absolute bottom-0 z-30 flex min-h-0 overflow-hidden rounded-r-lg border border-l-0 border-sidebar-border shadow-lg",
            "top-(--shell-header-height)",
          )}
          style={{ left, width }}
          initial={{ opacity: 0, x: offset }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: offset, transition: spring.slow.exit }}
          transition={
            reduceMotion ? spring.slow.exit : { ...spring.slow, opacity: spring.slow.exit }
          }
          onClick={onClick}
        >
          {children}
        </motion.aside>
      ) : null}
    </AnimatePresence>
  );
}
