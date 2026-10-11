import { useEffect, useRef, type ComponentProps, type FocusEvent, type MouseEvent } from "react";
import { isOwnEvent, useFluidHover, type UseFluidHoverOptions } from "../hooks/use-fluid-hover";
import { cn } from "../lib/cn";
import { FluidHoverHighlight } from "./ui/fluid-hover-highlight";
import { sidebarItemVariants } from "./ui/sidebar-styles";

const LIST_SELECTOR = "[data-sidebar-fluid-list]";
const ROW_SELECTOR = "[data-sidebar-fluid-row]";
const POPUP_OPEN_SELECTOR = "[data-popup-open]";

/** Spread onto a row's root element to join the nearest `SidebarFluidList`. */
export const sidebarFluidRowProps = { "data-sidebar-fluid-row": "" } as const;

/**
 * Row styling for rows inside a `SidebarFluidList`: the shared sidebar item without
 * its own hover fill, which the list's gliding highlight replaces. Selected
 * (`data-active`), pressed, and focus states stay on the row.
 */
export function sidebarFluidItemClass(className?: string) {
  return sidebarItemVariants({
    interactive: false,
    className: cn(
      "rounded-md outline-none transition-colors hover:bg-transparent hover:text-sidebar-foreground/95 active:bg-(--palot-sidebar-selected) data-active:hover:bg-(--palot-sidebar-selected) focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sidebar-ring",
      className,
    ),
  });
}

/**
 * For `InboxCardSurface` rows inside a `SidebarFluidList`: drops the card's own hover
 * fill and keeps a selected card's fill steady under the pointer.
 */
export const sidebarFluidCardClass =
  "hover:bg-transparent data-selected:hover:bg-(--palot-sidebar-selected)";

/**
 * Section chevrons stay quiet while their section is open and appear on label hover
 * or keyboard focus; a collapsed section keeps its chevron as the reopen cue. Opacity
 * only, so counts never shift.
 */
export function sectionChevronRevealClass(open: boolean) {
  return open
    ? "opacity-0 transition-[color,opacity] group-hover/section-label:opacity-100 group-focus-visible/section-label:opacity-100 group-hover/section-row:opacity-100 group-focus-within/section-row:opacity-100 pointer-coarse:opacity-100"
    : undefined;
}

type SidebarFluidListProps = ComponentProps<"div"> & {
  axis?: UseFluidHoverOptions["axis"];
  /** Task rows carry secondary actions, so gaps stay inert unless a list opts in. */
  gapClick?: UseFluidHoverOptions["gapClick"];
  highlightClassName?: string;
};

/**
 * One gliding hover fill for a group of sidebar rows (Fluid Functionalism's fluid
 * hover). Rows join by carrying `sidebarFluidRowProps` on their root; the list finds
 * them in DOM order after each render, so memoized rows need no extra props and a
 * reorder re-registers only the indices that changed. Keyboard focus moves the
 * highlight too, so focus and hover always agree.
 */
export function SidebarFluidList({
  axis = "y",
  gapClick = false,
  highlightClassName,
  className,
  children,
  onFocus,
  onBlur,
  onMouseEnter,
  onMouseLeave,
  onMouseMove,
  onClick,
  ...props
}: SidebarFluidListProps) {
  const ref = useRef<HTMLDivElement>(null);
  const hover = useFluidHover(ref, { axis, gapClick });
  const { registerItem, setActiveIndex, handlers } = hover;
  const rowsRef = useRef<HTMLElement[]>([]);
  const pointerInsideRef = useRef(false);

  // Rows change only when the parent renders new children, so a scan per children
  // change keeps registration in step without touching the DOM on hover renders.
  // Unchanged indices are left alone: every registration remeasures and briefly
  // hides the highlight.
  useEffect(() => {
    const container = ref.current;
    if (!container) return;
    const next = Array.from(container.querySelectorAll<HTMLElement>(ROW_SELECTOR)).filter(
      (row) => row.closest(LIST_SELECTOR) === container,
    );
    const previous = rowsRef.current;
    if (next.length === previous.length && next.every((row, index) => previous[index] === row))
      return;
    rowsRef.current = next;
    // Release every changed slot before claiming new ones, so a row that only moved
    // keeps its resize observation.
    previous.forEach((row, index) => {
      if (next[index] !== row) registerItem(index, null);
    });
    next.forEach((row, index) => {
      if (previous[index] !== row) registerItem(index, row);
    });
  }, [children, registerItem]);

  const popupOpen = () => ref.current?.querySelector(POPUP_OPEN_SELECTOR) != null;

  const handleMouseMove = (event: MouseEvent<HTMLDivElement>) => {
    onMouseMove?.(event);
    // A row's own menu is open: keep that row lit while the pointer works the menu.
    if (popupOpen()) return;
    handlers.onMouseMove(event);
  };
  const handleMouseEnter = (event: MouseEvent<HTMLDivElement>) => {
    onMouseEnter?.(event);
    pointerInsideRef.current = true;
    handlers.onMouseEnter();
  };
  const handleMouseLeave = (event: MouseEvent<HTMLDivElement>) => {
    onMouseLeave?.(event);
    pointerInsideRef.current = false;
    if (popupOpen()) return;
    handlers.onMouseLeave();
  };
  const handleClick = (event: MouseEvent<HTMLDivElement>) => {
    onClick?.(event);
    handlers.onClick(event);
  };
  const handleFocus = (event: FocusEvent<HTMLDivElement>) => {
    onFocus?.(event);
    if (!isOwnEvent(event) || !(event.target instanceof Element)) return;
    const row = event.target.closest<HTMLElement>(ROW_SELECTOR);
    if (!row || row.closest(LIST_SELECTOR) !== event.currentTarget) return;
    const index = rowsRef.current.indexOf(row);
    if (index !== -1) setActiveIndex(index);
  };
  const handleBlur = (event: FocusEvent<HTMLDivElement>) => {
    onBlur?.(event);
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    if (pointerInsideRef.current || popupOpen()) return;
    setActiveIndex(null);
  };

  return (
    <div
      {...props}
      ref={ref}
      data-sidebar-fluid-list=""
      className={cn("relative isolate", className)}
      onMouseMove={handleMouseMove}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onClick={handleClick}
      onFocus={handleFocus}
      onBlur={handleBlur}
    >
      {/* First child, behind the rows: `space-y-*` margins skip it, and selected
          rows paint their own fill above it. */}
      <FluidHoverHighlight
        hover={hover}
        className={cn("-z-10 bg-(--palot-sidebar-hover)", highlightClassName)}
      />
      {children}
    </div>
  );
}
