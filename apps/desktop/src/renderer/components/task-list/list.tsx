/**
 * The column body: one tree with roving focus across sections, groups and the Working, Snoozed
 * and Settled sections. The main list is one virtualised scroll (only the rows near the
 * viewport are mounted); it holds its order while the pointer or keyboard is in it, and
 * anchors the scroll to the row under the pointer or the focused row when rows land above.
 * Working can instead dock at the bottom of the column, under the main list's scroll.
 */

import { ChevronDown, ChevronRight, Plus, Server } from "lucide-react";
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from "react";
import { Button } from "@/components/ui/button";
import { FluidHoverHighlight } from "@/components/ui/fluid-hover-highlight";
import { ScrollAreaRoot, ScrollBar, ScrollViewport } from "@/components/ui/scroll-area";
import {
  sidebarSectionLabelVariants,
  sidebarSectionTriggerVariants,
} from "@/components/ui/sidebar-styles";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useInboxSweep } from "@/hooks/use-inbox-sweep";
import { prefersReducedMotion } from "@/hooks/use-reduced-motion";
import { cn } from "@/lib/cn";
import {
  entryStarts,
  MOVE_DURATION_MS,
  travelOffset,
  visibleRange,
} from "@/lib/task-list/model/order";
import { SIZES, type GroupEntry, type ListEntry } from "@/lib/task-list/model/sections";
import { canSettle, type StatusKind } from "@/lib/task-list/model/status";
import { lastInputWasKeyboard, useController, useTaskList } from "./context";
import { BulkBar } from "./bulk-bar";
import { StatusMark } from "./marks";
import { TaskRow } from "./task-row";

const EASE = "cubic-bezier(0.2, 0, 0, 1)";
/** How long a scroll request waits for its task to reach the list. */
const SCROLL_REQUEST_WAIT_MS = 2_000;

/** Scrolls the least that shows the entry, with a little room past the edge it crossed. */
function scrollEntryIntoView(element: HTMLElement, top: number, size: number) {
  const bottom = top + size;
  if (top < element.scrollTop) element.scrollTop = Math.max(0, top - 8);
  else if (bottom > element.scrollTop + element.clientHeight)
    element.scrollTop = bottom - element.clientHeight + 8;
}

export function ColumnBody() {
  const controller = useController();
  const bodyRef = useRef<HTMLDivElement>(null);
  const focusRequest = useTaskList((state) => state.focusRequest);
  const tasks = useTaskList((state) => state.tasks);
  const sweepItems = useMemo(() => Object.values(tasks), [tasks]);
  const sweep = useInboxSweep({
    items: sweepItems,
    keyOf: (task) => task.id,
    canSettle: (task) => canSettle(task) && task.settledAt === null,
    settle: (items) => controller.settle(items.map((task) => task.id)),
  });

  // DOM focus follows the roving key after keyboard moves and actions, unless the person is
  // working somewhere else (the toolbar, a field).
  useLayoutEffect(() => {
    if (focusRequest === 0) return;
    const body = bodyRef.current;
    const key = controller.state.focusKey;
    if (!body || !key) return;
    const active = document.activeElement;
    const elsewhere =
      active &&
      active !== document.body &&
      !body.contains(active) &&
      !active.closest("[data-slot$='-content'], [role='menu']");
    if (elsewhere) return;
    const target = body.querySelector<HTMLElement>(`[data-focus-key="${CSS.escape(key)}"]`);
    if (!target) return;
    target.focus({ preventScroll: true });
    if (!target.closest("[data-main-list]")) target.scrollIntoView({ block: "nearest" });
  }, [controller, focusRequest]);

  const onKeyDown = useListKeys();

  // A focused row that changes place (the Working shelf into "Needs you") is a new element;
  // when focus fell to the page because of that, it follows the row.
  const layout = useTaskList((state) => state.layout);
  const hadFocus = useRef(false);
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!bodyRef.current?.contains(event.target as Node)) hadFocus.current = false;
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => window.removeEventListener("pointerdown", onPointerDown, true);
  }, []);
  useLayoutEffect(() => {
    const active = document.activeElement;
    if (!hadFocus.current || (active && active !== document.body)) return;
    const key = controller.state.focusKey;
    const target = key
      ? bodyRef.current?.querySelector<HTMLElement>(`[data-focus-key="${CSS.escape(key)}"]`)
      : null;
    target?.focus({ preventScroll: true });
  }, [controller, layout]);

  // The row's own context menu sets data-popup-open on the row while it is open; the list
  // keeps that row lit and its actions shown until the menu closes.
  const menuObserver = useRef<MutationObserver | null>(null);
  useEffect(() => () => menuObserver.current?.disconnect(), []);

  return (
    <div
      ref={bodyRef}
      role="tree"
      aria-label="Tasks"
      aria-multiselectable="true"
      data-slot="task-list-body"
      className="relative flex min-h-0 flex-1 flex-col"
      onPointerEnter={() => controller.setPointerInside(true)}
      onPointerLeave={() => controller.setPointerInside(false)}
      onKeyDown={onKeyDown}
      onFocus={() => {
        hadFocus.current = true;
        controller.setKeyboardFocus(lastInputWasKeyboard());
      }}
      onBlur={(event) => {
        const next = event.relatedTarget as Node | null;
        if (next && !event.currentTarget.contains(next)) hadFocus.current = false;
        if (!event.currentTarget.contains(next)) controller.setKeyboardFocus(false);
      }}
      onContextMenuCapture={(event) => {
        const row = (event.target as Element).closest<HTMLElement>("[data-row-key]");
        if (!row) return;
        const key = row.dataset.rowKey!;
        controller.setMenuKey(key);
        menuObserver.current?.disconnect();
        const observer = new MutationObserver(() => {
          if (row.isConnected && row.hasAttribute("data-popup-open")) return;
          observer.disconnect();
          if (controller.state.menuKey === key) controller.setMenuKey(null);
        });
        observer.observe(row, { attributes: true, attributeFilter: ["data-popup-open"] });
        menuObserver.current = observer;
      }}
      {...sweep}
    >
      {/* The bulk bar floats over the bottom of the main list, above the dock. */}
      <div className="relative flex min-h-0 flex-1 flex-col">
        <MainList />
        <BulkBar />
      </div>
      <WorkingDock />
    </div>
  );
}

/** The row keys: arrows, J/K, Home/End, Left/Right, and the triage letters. */
function useListKeys() {
  const controller = useController();
  return useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement;
      // Only the focused row or header itself; buttons and fields inside keep their keys.
      if (!target.dataset.focusKey || event.metaKey || event.ctrlKey || event.altKey) return;
      const state = controller.state;
      const key = target.dataset.focusKey;
      const task = state.tasks[key];
      const selectionKeys = state.selection.keys.includes(key) ? [...state.selection.keys] : [key];
      const handled = () => {
        event.preventDefault();
        event.stopPropagation();
      };
      switch (event.key) {
        case "ArrowDown":
        case "j":
        case "J":
          handled();
          if (event.shiftKey && event.key === "ArrowDown") controller.extend(1);
          else controller.move("next");
          return;
        case "ArrowUp":
        case "k":
        case "K":
          handled();
          if (event.shiftKey && event.key === "ArrowUp") controller.extend(-1);
          else controller.move("previous");
          return;
        case "Home":
          handled();
          controller.move("first");
          return;
        case "End":
          handled();
          controller.move("last");
          return;
        case "ArrowLeft":
          handled();
          controller.step("left");
          return;
        case "ArrowRight":
          handled();
          controller.step("right");
          return;
        case "Escape":
          if (state.quickLook) controller.setQuickLook(null);
          else if (state.selection.keys.length) controller.clearSelection();
          else return;
          handled();
          return;
      }
      if (!task) {
        if (event.key === "Enter" || event.key === " ") {
          handled();
          if (key.startsWith("more:")) controller.loadOlder();
          else controller.toggleGroup(key);
        }
        return;
      }
      switch (event.key.toLowerCase()) {
        case "enter":
          handled();
          controller.open(key);
          return;
        case " ":
          handled();
          controller.setQuickLook(state.quickLook === key ? null : key);
          return;
        case "e":
          handled();
          void controller.settle(selectionKeys);
          return;
        case "s":
          handled();
          controller.openSnoozeMenu(selectionKeys, key);
          return;
        case "p":
          handled();
          void controller.togglePin(key);
          return;
        case "u":
          handled();
          void controller.toggleUnread(key);
          return;
        case "a":
          handled();
          void controller.allow(key);
          return;
        case "d":
          handled();
          void controller.deny(key);
          return;
        case "f2":
          handled();
          controller.startRename(key);
          return;
      }
    },
    [controller],
  );
}

// Main list ----------------------------------------------------------------------------------

// Memoised: the column body re-renders on task changes (for the sweep); the list does not.
const MainList = memo(function MainList() {
  const entries = useTaskList((state) => state.layout.entries);
  const focusKey = useTaskList((state) => state.focusKey);
  const focusRequest = useTaskList((state) => state.focusRequest);
  const scrollRequest = useTaskList((state) => state.scrollRequest);
  const keyboardFocus = useTaskList((state) => state.keyboardFocus);
  const pinnedKeys = useTaskList((state) => state.quickLook ?? state.renaming ?? state.menuKey);
  const menuKey = useTaskList((state) => state.menuKey ?? state.quickLook);
  const selecting = useTaskList((state) => state.selection.keys.length > 0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ top: 0, height: 600, width: 256 });
  const [hoverKey, setHoverKey] = useState<string | null>(null);
  const [session, setSession] = useState(0);
  const hoverRef = useRef<string | null>(null);
  hoverRef.current = hoverKey;

  const starts = useMemo(() => entryStarts(entries), [entries]);
  const sizes = useMemo(() => entries.map((entry) => entry.size), [entries]);
  const total = (starts.at(-1) ?? 0) + (sizes.at(-1) ?? 0);
  const indexByKey = useMemo(
    () => new Map(entries.map((entry, index) => [entry.key, index])),
    [entries],
  );

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const measure = () =>
      setViewport({
        top: element.scrollTop,
        height: element.clientHeight,
        width: element.clientWidth,
      });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Keyboard moves bring the focused entry into view before focus lands on it.
  useLayoutEffect(() => {
    const element = scrollRef.current;
    const index = focusKey ? indexByKey.get(focusKey) : undefined;
    if (!element || index === undefined || focusRequest === 0) return;
    scrollEntryIntoView(element, starts[index]!, sizes[index]!);
    // Only on a focus request, not on every layout change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusRequest]);

  // A task opened from outside the list (palette, route, notification) scrolls into view; focus
  // stays where it is. A task the app just created may reach the list a little later.
  const pendingScroll = useRef<{ seq: number; key: string; at: number } | null>(null);
  const lastScrollSeq = useRef(0);
  useLayoutEffect(() => {
    if (scrollRequest && scrollRequest.seq !== lastScrollSeq.current) {
      lastScrollSeq.current = scrollRequest.seq;
      pendingScroll.current = { ...scrollRequest, at: Date.now() };
    }
    const pending = pendingScroll.current;
    const element = scrollRef.current;
    if (!pending || !element) return;
    if (Date.now() - pending.at > SCROLL_REQUEST_WAIT_MS) {
      pendingScroll.current = null;
      return;
    }
    const index = indexByKey.get(pending.key);
    if (index === undefined) return;
    pendingScroll.current = null;
    scrollEntryIntoView(element, starts[index]!, sizes[index]!);
  }, [scrollRequest, indexByKey, starts, sizes]);

  useFlipAndAnchor(
    scrollRef,
    entries,
    starts,
    () => hoverRef.current ?? (keyboardFocus ? focusKey : null),
  );

  const range = visibleRange(starts, sizes, viewport.top, viewport.height);
  const mounted = new Set<number>();
  if (range) for (let index = range[0]; index <= range[1]; index++) mounted.add(index);
  // The focused row and any row with an open popup stay mounted while scrolled away.
  for (const key of [focusKey, pinnedKeys]) {
    const index = key ? indexByKey.get(key) : undefined;
    if (index !== undefined) mounted.add(index);
  }
  const mountedRows = [...mounted].filter((index) => entries[index]?.type === "row").length;

  // A row whose menu or quick look is open stays lit while the pointer works the popup.
  const highlightKey = menuKey ?? hoverKey ?? (keyboardFocus ? focusKey : null);
  const highlightIndex = highlightKey ? indexByKey.get(highlightKey) : undefined;
  const highlightEntry = highlightIndex !== undefined ? entries[highlightIndex] : undefined;
  const highlightRect =
    highlightEntry?.type === "row"
      ? {
          top: starts[highlightIndex!]! + 1,
          left: 8,
          width: Math.max(0, viewport.width - 16),
          height: highlightEntry.size - 2,
        }
      : null;

  // The app's overlay scrollbar instead of the native one: the viewport is the scroller the
  // virtualiser measures and listens to; the thumb floats over the rows' right gutter.
  return (
    <ScrollAreaRoot
      data-slot="task-list-scroll"
      className="relative flex min-h-0 flex-1 flex-col overflow-hidden"
    >
      <ScrollViewport
        ref={scrollRef}
        data-main-list=""
        data-scroll-viewport=""
        data-rows-mounted={mountedRows}
        // The rows are the tree's tab stops; the scroller itself is not one.
        tabIndex={-1}
        className="relative min-h-0 flex-1 overscroll-contain outline-none"
        style={{ overflowX: "hidden", overflowY: "auto" }}
        onScroll={(event) => {
          const top = event.currentTarget.scrollTop;
          setViewport((current) => ({ ...current, top }));
        }}
        onPointerMove={(event) => {
          const row = (event.target as Element).closest<HTMLElement>("[data-row-key]");
          const key = row?.dataset.rowKey ?? null;
          if (key !== hoverRef.current) setHoverKey(key);
        }}
        onPointerEnter={() => setSession((value) => value + 1)}
        onPointerLeave={() => setHoverKey(null)}
      >
        <div className="relative isolate" style={{ height: Math.max(total, 1) }}>
          <FluidHoverHighlight
            rect={highlightRect}
            session={session}
            className="-z-10 bg-(--palot-sidebar-hover)"
          />
          {[...mounted]
            .sort((a, b) => a - b)
            .map((index) => (
              <Entry key={entries[index]!.key} entry={entries[index]!} top={starts[index]!} />
            ))}
        </div>
        {/* Room for the bulk bar, so the last rows can scroll out from under it. */}
        <div className={selecting ? "h-11" : "h-2"} aria-hidden="true" />
      </ScrollViewport>
      <ScrollBar />
    </ScrollAreaRoot>
  );
});

const Entry = memo(function Entry({ entry, top }: { entry: ListEntry; top: number }) {
  if (entry.type === "row")
    return (
      <TaskRow
        rowKey={entry.key}
        placement={entry.placement}
        lines={entry.lines}
        size={entry.size}
        top={top}
        level={entry.depth + 1}
      />
    );
  const style: CSSProperties = { position: "absolute", top, height: entry.size, left: 0, right: 0 };
  if (entry.type === "group") return <GroupHeader entry={entry} style={style} />;
  if (entry.type === "shelf")
    return (
      <ShelfHeader
        shelfKey={entry.key}
        label={entry.label}
        open={entry.open}
        count={entry.count}
        rollup={entry.rollup}
        style={style}
      />
    );
  if (entry.type === "more")
    return <MoreEntry entryKey={entry.key} count={entry.count} style={style} />;
  if (entry.type === "heading")
    return (
      <div data-entry-key={entry.key} role="presentation" className="px-2" style={style}>
        <div className={cn(sidebarSectionLabelVariants(), "h-full px-2 pt-2")}>{entry.label}</div>
      </div>
    );
  if (entry.type === "empty")
    return (
      <div
        data-entry-key={entry.key}
        role="presentation"
        className="flex items-center justify-center px-4 text-compact text-sidebar-foreground/45"
        style={style}
      >
        {entry.text}
      </div>
    );
  return <div data-entry-key={entry.key} role="presentation" style={style} />;
});

function GroupHeader({ entry, style }: { entry: GroupEntry; style: CSSProperties }) {
  const controller = useController();
  const tabbable = useTaskList((state) => state.focusKey === entry.key);
  return (
    <div
      role="treeitem"
      aria-level={entry.depth + 1}
      aria-expanded={entry.open}
      aria-label={`${entry.label}${entry.kind === "server" ? `, ${entry.online ? "connected" : "offline"}` : ""}, ${entry.count} tasks`}
      tabIndex={tabbable ? 0 : -1}
      data-focus-key={entry.key}
      data-entry-key={entry.key}
      className="group/section-row px-2 outline-none"
      style={style}
      onFocus={(event) => {
        if (event.target === event.currentTarget)
          controller.focus(entry.key, lastInputWasKeyboard());
      }}
      onClick={() => {
        controller.focus(entry.key, false);
        controller.toggleGroup(entry.key);
      }}
    >
      <div
        className={cn(
          sidebarSectionTriggerVariants(),
          "group/section-label h-full gap-1.5 group-focus-visible/section-row:text-sidebar-foreground group-focus-visible/section-row:ring-2 group-focus-visible/section-row:ring-sidebar-ring group-focus-visible/section-row:ring-inset",
          entry.kind === "server" ? "text-sidebar-foreground/80" : "pl-2",
        )}
      >
        {entry.kind === "server" ? (
          <Server className="size-3 shrink-0 text-sidebar-foreground/50" aria-hidden="true" />
        ) : null}
        <span className="truncate">{entry.label}</span>
        {entry.kind === "server" ? (
          <span
            className={cn(
              "shrink-0 text-micro font-normal",
              entry.online ? "text-sidebar-foreground/40" : "text-warning",
            )}
          >
            {entry.online ? "Connected" : "Offline"}
          </span>
        ) : null}
        {entry.rollup ? <StatusMark kind={entry.rollup} className="size-3.5" /> : null}
        <span className="ml-auto flex items-center gap-1">
          {entry.kind === "project" ? (
            <NewTaskInGroup projectID={entry.projectID} label={entry.label} />
          ) : null}
          <span className="w-5 text-right text-micro font-normal text-sidebar-foreground/40 tabular-nums">
            {entry.count}
          </span>
          <Chevron open={entry.open} />
        </span>
      </div>
    </div>
  );
}

/** "+" on a project group starts a task there; on "Chats" it starts a new chat. */
function NewTaskInGroup({ projectID, label }: { projectID: string | null; label: string }) {
  const controller = useController();
  const action = projectID ? `New task in ${label}` : "New chat";
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-xs"
            tabIndex={-1}
            aria-label={action}
            className="text-sidebar-foreground/50 opacity-0 transition-opacity group-hover/section-row:opacity-100 group-focus-visible/section-row:opacity-100 hover:text-sidebar-foreground"
            onClick={(event) => {
              event.stopPropagation();
              controller.startTask(projectID);
            }}
          />
        }
      >
        <Plus aria-hidden="true" />
      </TooltipTrigger>
      <TooltipContent>{action}</TooltipContent>
    </Tooltip>
  );
}

function Chevron({ open }: { open: boolean }) {
  return open ? (
    <ChevronDown
      className="size-3 shrink-0 text-sidebar-foreground/40 opacity-0 transition-opacity group-hover/section-row:opacity-100 group-focus-visible/section-row:opacity-100"
      aria-hidden="true"
    />
  ) : (
    <ChevronRight className="size-3 shrink-0 text-sidebar-foreground/40" aria-hidden="true" />
  );
}

/**
 * Released rows glide to their new place (150 ms, at most 40 px of travel); rows landing above
 * keep the row under the pointer, or the focused row, where it was.
 */
function useFlipAndAnchor(
  scrollRef: React.RefObject<HTMLDivElement | null>,
  entries: readonly ListEntry[],
  starts: readonly number[],
  anchorKey: () => string | null,
) {
  const previous = useRef<{ starts: Map<string, number>; scrollTop: number } | null>(null);
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const next = new Map(entries.map((entry, index) => [entry.key, starts[index]!]));
    const before = previous.current;
    if (before) {
      const scrollBefore = element.scrollTop;
      const anchor = anchorKey();
      const anchorBefore = anchor ? before.starts.get(anchor) : undefined;
      const anchorAfter = anchor ? next.get(anchor) : undefined;
      if (
        anchorBefore !== undefined &&
        anchorAfter !== undefined &&
        anchorBefore !== anchorAfter &&
        anchorBefore >= scrollBefore
      ) {
        element.scrollTop = scrollBefore + (anchorAfter - anchorBefore);
      }
      if (!prefersReducedMotion()) {
        for (const node of element.querySelectorAll<HTMLElement>("[data-entry-key]")) {
          const key = node.dataset.entryKey!;
          const was = before.starts.get(key);
          const now = next.get(key);
          if (now === undefined) continue;
          if (was === undefined) {
            node.animate([{ opacity: 0 }, { opacity: 1 }], {
              duration: MOVE_DURATION_MS,
              easing: EASE,
            });
            continue;
          }
          const offset = travelOffset(was - before.scrollTop, now - element.scrollTop);
          if (offset === 0) continue;
          node.animate([{ transform: `translateY(${offset}px)` }, { transform: "none" }], {
            duration: MOVE_DURATION_MS,
            easing: EASE,
          });
        }
      }
    }
    previous.current = { starts: next, scrollTop: element.scrollTop };
    // Scrolling moves everything together; keep the reference scroll position current.
    const onScroll = () => {
      if (previous.current) previous.current.scrollTop = element.scrollTop;
    };
    element.addEventListener("scroll", onScroll, { passive: true });
    return () => element.removeEventListener("scroll", onScroll);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries]);
}

// Working dock -------------------------------------------------------------------------------

/** Header and four two-line rows; beyond that the dock scrolls inside itself. */
const DOCK_MAX_PX = SIZES.group + 4 * SIZES.row[2];

/**
 * Working, docked under the main list so running tasks stay in view however long the inbox
 * is. Absent while nothing runs. Open, it shows its rows up to about four, and never more than
 * a third of the body on a short window; collapsed, the header with its count and rollup.
 */
const WorkingDock = memo(function WorkingDock() {
  const shelf = useTaskList((state) => state.layout.shelves.find((item) => item.id === "working"));
  const focusKey = useTaskList((state) => state.focusKey);
  const keyboardFocus = useTaskList((state) => state.keyboardFocus);
  const menuKey = useTaskList((state) => state.menuKey ?? state.quickLook);
  const [hoverKey, setHoverKey] = useState<string | null>(null);
  const [session, setSession] = useState(0);
  const [width, setWidth] = useState(256);
  const contentRef = useRef<HTMLDivElement>(null);
  const rows = shelf?.rows ?? [];
  const starts = useMemo(() => entryStarts(rows), [rows]);

  useLayoutEffect(() => {
    const element = contentRef.current;
    if (!element) return;
    const measure = () => setWidth(element.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [shelf?.open]);

  if (!shelf) return null;
  const highlightKey = menuKey ?? hoverKey ?? (keyboardFocus ? focusKey : null);
  const highlightIndex = rows.findIndex((row) => row.key === highlightKey);
  const highlightRect =
    highlightIndex === -1
      ? null
      : {
          top: starts[highlightIndex]! + 1,
          left: 8,
          width: Math.max(0, width - 16),
          height: rows[highlightIndex]!.size - 2,
        };
  const total = (starts.at(-1) ?? 0) + (rows.at(-1)?.size ?? 0);

  return (
    <div
      data-slot="task-list-dock"
      data-open={shelf.open || undefined}
      className="flex flex-none flex-col border-t border-sidebar-border/60"
      style={{ maxHeight: `min(${DOCK_MAX_PX}px, 33%)` }}
    >
      <ShelfHeader
        shelfKey={shelf.key}
        label={shelf.label}
        open={shelf.open}
        count={shelf.count}
        rollup={shelf.rollup}
        className="flex-none"
        style={{ height: SIZES.group }}
      />
      {shelf.open ? (
        <ScrollAreaRoot className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
          <ScrollViewport
            data-scroll-viewport=""
            tabIndex={-1}
            className="relative min-h-0 flex-1 overscroll-contain outline-none"
            style={{ overflowX: "hidden", overflowY: "auto" }}
            onPointerMove={(event) => {
              const row = (event.target as Element).closest<HTMLElement>("[data-row-key]");
              const key = row?.dataset.rowKey ?? null;
              if (key !== hoverKey) setHoverKey(key);
            }}
            onPointerEnter={() => setSession((value) => value + 1)}
            onPointerLeave={() => setHoverKey(null)}
          >
            <div ref={contentRef} className="relative isolate" style={{ height: total }}>
              <FluidHoverHighlight
                rect={highlightRect}
                session={session}
                className="-z-10 bg-(--palot-sidebar-hover)"
              />
              {rows.map((row, index) => (
                <TaskRow
                  key={row.key}
                  rowKey={row.key}
                  placement={row.placement}
                  lines={row.lines}
                  size={row.size}
                  top={starts[index]!}
                  level={2}
                />
              ))}
            </div>
          </ScrollViewport>
          <ScrollBar />
        </ScrollAreaRoot>
      ) : null}
    </div>
  );
});

/** A Working, Snoozed or Settled header, in the list's flow or on the dock. */
function ShelfHeader({
  shelfKey,
  label,
  open,
  count,
  rollup,
  className,
  style,
}: {
  shelfKey: string;
  label: string;
  open: boolean;
  count: number;
  rollup: StatusKind | null;
  className?: string;
  style: CSSProperties;
}) {
  const controller = useController();
  const tabbable = useTaskList((state) => state.focusKey === shelfKey);
  return (
    <div
      role="treeitem"
      aria-expanded={open}
      aria-level={1}
      aria-label={`${label}, ${count}`}
      tabIndex={tabbable ? 0 : -1}
      data-focus-key={shelfKey}
      data-entry-key={style.position === "absolute" ? shelfKey : undefined}
      className={cn("group/section-row px-2 outline-none", className)}
      style={style}
      onFocus={(event) => {
        if (event.target === event.currentTarget)
          controller.focus(shelfKey, lastInputWasKeyboard());
      }}
      onClick={() => {
        controller.focus(shelfKey, false);
        controller.toggleGroup(shelfKey);
      }}
    >
      <div
        className={cn(
          sidebarSectionTriggerVariants(),
          "h-full gap-1.5 pl-2 group-focus-visible/section-row:text-sidebar-foreground group-focus-visible/section-row:ring-2 group-focus-visible/section-row:ring-sidebar-ring group-focus-visible/section-row:ring-inset",
        )}
      >
        <span className="truncate">{label}</span>
        {rollup ? <StatusMark kind={rollup} className="size-3.5" /> : null}
        <span className="ml-auto flex items-center gap-1">
          <span className="w-5 text-right text-micro font-normal text-sidebar-foreground/40 tabular-nums">
            {count}
          </span>
          <Chevron open={open} />
        </span>
      </div>
    </div>
  );
}

/** "Load 20 older · 43 more" at the end of an in-flow Settled section; a roving stop. */
function MoreEntry({
  entryKey,
  count,
  style,
}: {
  entryKey: string;
  count: number;
  style: CSSProperties;
}) {
  const controller = useController();
  const tabbable = useTaskList((state) => state.focusKey === entryKey);
  return (
    <div
      role="treeitem"
      aria-level={2}
      aria-label={`Load older settled tasks, ${count} more`}
      tabIndex={tabbable ? 0 : -1}
      data-focus-key={entryKey}
      data-entry-key={entryKey}
      className="group/more px-2 outline-none"
      style={style}
      onFocus={(event) => {
        if (event.target === event.currentTarget)
          controller.focus(entryKey, lastInputWasKeyboard());
      }}
      onClick={() => controller.loadOlder()}
    >
      <div className="flex h-full cursor-pointer items-center rounded-md px-2 text-meta text-sidebar-foreground/55 hover:bg-(--palot-sidebar-hover) hover:text-sidebar-foreground/80 group-focus-visible/more:ring-2 group-focus-visible/more:ring-sidebar-ring group-focus-visible/more:ring-inset">
        Load {Math.min(20, count)} older · {count} more
      </div>
    </div>
  );
}
