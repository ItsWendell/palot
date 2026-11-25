import type { FileDiffMetadata } from "@pierre/diffs";
import type { CodeViewHandle } from "@pierre/diffs/react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import { cn } from "../../lib/cn";
import {
  layoutRailMarks,
  railScrollTop,
  type DiffItemMarks,
  type DiffRailItem,
  type DiffRailMatch,
  type RailMark,
} from "../../lib/diff-change-markers";
import type { DiffLayout } from "../../lib/diff-layout";

/** What the rail reads from a diff scroller. All values are in logical scroll pixels. */
export interface DiffRailSource {
  scrollTop(): number;
  scrollHeight(): number;
  viewportHeight(): number;
  items(): DiffRailItem[];
  scrollTo(top: number): void;
}

const MARK_CLASS: Record<RailMark["kind"], string> = {
  added: "right-0.5 left-0.5 bg-success/60",
  removed: "right-0.5 left-0.5 bg-destructive/60",
  modified: "right-0.5 left-0.5 bg-muted-foreground/55",
  match: "inset-x-0 z-10 bg-warning",
};
const MARK_LABEL: Record<RailMark["kind"], string> = {
  added: "Added",
  removed: "Removed",
  modified: "Changed",
  match: "Match",
};
/** Pointer distance, in rail pixels, within which a mark counts as hovered. */
const HOVER_TOLERANCE = 3;

interface RailState {
  marks: RailMark[];
  scrollHeight: number;
  scrollable: boolean;
}

const EMPTY_STATE: RailState = { marks: [], scrollHeight: 0, scrollable: false };

/**
 * A thin rail beside a diff scroller showing where changes sit across the whole review:
 * added, removed and changed blocks, find matches while Find is open, and the visible
 * window. Pressing or dragging on the rail scrolls there; hovering a mark names its file
 * and line. Marks come from hunk metadata, and scrolling only moves the viewport box
 * (one style write per frame), so the diff never re-renders for the rail.
 */
export function DiffChangeRail({
  container,
  source,
  layout,
  expandUnchanged,
  matches,
  layoutKey,
  className,
}: {
  /** The scroll container; its scroll and size changes drive the rail. */
  container: HTMLElement | null;
  source: DiffRailSource;
  layout: DiffLayout;
  expandUnchanged: boolean;
  /** Find matches to show, or none while Find is closed. */
  matches?: readonly DiffRailMatch[];
  /** Changes whenever items, folding or layout change, to place marks again. */
  layoutKey: unknown;
  className?: string;
}) {
  const sourceRef = useRef(source);
  useLayoutEffect(() => {
    sourceRef.current = source;
  });
  const [state, setState] = useState<RailState>(EMPTY_STATE);
  const [hover, setHover] = useState<{ y: number; label: string } | null>(null);
  const railRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const cache = useMemo(() => new WeakMap<FileDiffMetadata, Map<string, DiffItemMarks>>(), []);
  const placedHeight = useRef(-1);
  const frame = useRef(0);
  const dragging = useRef(false);

  const place = useCallback(() => {
    const current = sourceRef.current;
    const scrollHeight = current.scrollHeight();
    const viewportHeight = current.viewportHeight();
    placedHeight.current = scrollHeight;
    const scrollable = scrollHeight > viewportHeight + 1;
    setState({
      marks: scrollable
        ? layoutRailMarks(current.items(), { layout, expandUnchanged }, matches, cache)
        : [],
      scrollHeight,
      scrollable,
    });
  }, [cache, expandUnchanged, layout, matches]);

  const paintViewport = useCallback(() => {
    frame.current = 0;
    const current = sourceRef.current;
    const scrollHeight = current.scrollHeight();
    // Items measured since the last placement move every mark; place them again.
    if (Math.abs(scrollHeight - placedHeight.current) > 0.5) place();
    const box = viewportRef.current;
    if (!box || scrollHeight <= 0) return;
    const top = (current.scrollTop() / scrollHeight) * 100;
    const height = Math.min(100, (current.viewportHeight() / scrollHeight) * 100);
    box.style.top = `${top}%`;
    box.style.height = `${height}%`;
  }, [place]);

  const schedule = useCallback(() => {
    if (frame.current) return;
    frame.current = requestAnimationFrame(paintViewport);
  }, [paintViewport]);

  useEffect(() => {
    place();
  }, [layoutKey, place]);

  useEffect(() => {
    if (!container) return;
    container.addEventListener("scroll", schedule, { passive: true });
    const observer = new ResizeObserver(schedule);
    observer.observe(container);
    for (const child of container.children) observer.observe(child);
    schedule();
    return () => {
      container.removeEventListener("scroll", schedule);
      observer.disconnect();
      cancelAnimationFrame(frame.current);
      frame.current = 0;
    };
  }, [container, schedule]);

  // The viewport box mounts with the rail; paint it before the first frame shows it.
  useLayoutEffect(() => {
    if (state.scrollable) paintViewport();
  }, [paintViewport, state.scrollable]);

  const scrollToPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const current = sourceRef.current;
    current.scrollTo(
      railScrollTop(
        event.clientY - rect.top,
        rect.height,
        current.scrollHeight(),
        current.viewportHeight(),
      ),
    );
  };

  const hovered = (event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.height <= 0 || state.scrollHeight <= 0) return null;
    const y = event.clientY - rect.top;
    const scale = rect.height / state.scrollHeight;
    let best: RailMark | null = null;
    let bestDistance = HOVER_TOLERANCE;
    for (const mark of state.marks) {
      const top = mark.top * scale;
      const bottom = Math.max(top + 2, (mark.top + mark.height) * scale);
      const distance = y < top ? top - y : y > bottom ? y - bottom : 0;
      // Matches sit above changes, so prefer them at equal distance.
      if (distance < bestDistance || (distance === bestDistance && mark.kind === "match")) {
        best = mark;
        bestDistance = distance;
      }
    }
    return best ? { y, label: `${MARK_LABEL[best.kind]} · ${best.itemID}:${best.line}` } : null;
  };

  if (!state.scrollable) return null;
  const percent = (value: number) => `${(value / state.scrollHeight) * 100}%`;
  return (
    <div
      ref={railRef}
      aria-hidden="true"
      data-slot="diff-change-rail"
      data-file-navigation-ignore=""
      className={cn(
        "relative w-2 shrink-0 cursor-pointer touch-none border-l border-border/60 bg-muted/25 select-none",
        className,
      )}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        dragging.current = true;
        event.currentTarget.setPointerCapture(event.pointerId);
        setHover(null);
        scrollToPointer(event);
      }}
      onPointerMove={(event) => {
        if (dragging.current) scrollToPointer(event);
        else setHover(hovered(event));
      }}
      onPointerUp={(event) => {
        dragging.current = false;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
      }}
      onPointerCancel={() => {
        dragging.current = false;
      }}
      onPointerLeave={() => setHover(null)}
    >
      {state.marks.map((mark, index) => (
        <div
          key={index}
          data-kind={mark.kind}
          className={cn(
            "pointer-events-none absolute min-h-0.5 rounded-[1px]",
            MARK_CLASS[mark.kind],
          )}
          style={{ top: percent(mark.top), height: percent(mark.height) }}
        />
      ))}
      <div
        ref={viewportRef}
        data-slot="diff-change-rail-viewport"
        className="pointer-events-none absolute inset-x-0 z-20 border-y border-foreground/25 bg-foreground/8"
      />
      {hover ? (
        <div
          className="pointer-events-none absolute right-full z-30 mr-1 -translate-y-1/2 rounded-md border border-border/80 bg-popover px-2 py-1 text-meta leading-none whitespace-nowrap text-popover-foreground shadow-md"
          style={{ top: hover.y }}
        >
          {hover.label}
        </div>
      ) : null}
    </div>
  );
}

/** Reads a virtualized `CodeView`'s layout for the rail. */
export function codeViewRailSource(
  codeView: RefObject<CodeViewHandle<undefined, undefined> | null>,
  items: readonly { id: string; fileDiff: FileDiffMetadata | null; collapsed: boolean }[],
  metrics: { headerHeight: number; gap: number; paddingBottom: number },
): DiffRailSource {
  // Test doubles of the handle may omit getInstance; the rail then stays hidden.
  const instance = () => codeView.current?.getInstance?.();
  return {
    scrollTop: () => instance()?.getScrollTop() ?? 0,
    scrollHeight: () => instance()?.getScrollHeight() ?? 0,
    viewportHeight: () => instance()?.getHeight() ?? 0,
    scrollTo: (top) =>
      codeView.current?.scrollTo({ type: "position", position: top, behavior: "instant" }),
    items: () => {
      const view = instance();
      if (!view) return [];
      const end = view.getScrollHeight() - metrics.paddingBottom;
      const tops = items.map((item) => view.getTopForItem(item.id));
      return items.flatMap((item, index) => {
        const top = tops[index];
        if (top === undefined) return [];
        const next = tops.slice(index + 1).find((value) => value !== undefined);
        const bottom = next === undefined ? end : next - metrics.gap;
        return [
          {
            id: item.id,
            top,
            height: Math.max(0, bottom - top),
            headerHeight: metrics.headerHeight,
            fileDiff: item.fileDiff,
            collapsed: item.collapsed,
          },
        ];
      });
    },
  };
}

/** Reads a plain scroll container holding one fully rendered diff. */
export function elementRailSource(
  element: HTMLElement | null,
  id: string,
  fileDiff: FileDiffMetadata | null,
  headerHeight = 0,
): DiffRailSource {
  return {
    scrollTop: () => element?.scrollTop ?? 0,
    scrollHeight: () => element?.scrollHeight ?? 0,
    viewportHeight: () => element?.clientHeight ?? 0,
    scrollTo: (top) => element?.scrollTo({ top, behavior: "instant" }),
    items: () =>
      element
        ? [
            {
              id,
              top: 0,
              height: element.scrollHeight,
              headerHeight,
              fileDiff,
              collapsed: false,
            },
          ]
        : [],
  };
}
