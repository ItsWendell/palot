/**
 * The launcher's panel content: the rows `+`, `/`, `@` and `$` share. Focus stays in the
 * composer's text field, which points at the highlighted row through
 * `aria-activedescendant`; this list never takes focus. It fills the composer's panel slot:
 * the header and the kept-draft line stay put while the rows scroll between them.
 */

import {
  Archive,
  AtSign,
  Bot,
  Check,
  ChevronLeft,
  ChevronRight,
  Columns3,
  FileClock,
  FileOutput,
  FileText,
  FolderSymlink,
  GitCompareArrows,
  MessageSquareText,
  Paperclip,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Shrink,
  SquareSlash,
  SquareTerminal,
  Trash2,
  WandSparkles,
  type LucideIcon,
} from "lucide-react";
import { motion } from "motion/react";
import { memo, useCallback, useLayoutEffect, useRef, useState, type ComponentProps } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FluidHoverHighlight } from "@/components/ui/fluid-hover-highlight";
import { Kbd, ShortcutKbd } from "@/components/ui/kbd";
import { useFluidHover, useRegisterFluidHoverItem } from "@/hooks/use-fluid-hover";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { cn } from "@/lib/cn";
import { formatShortcut, shortcutPlatform } from "@/lib/keyboard-shortcuts";
import { spring } from "@/lib/springs";
import type { LauncherIcon, LauncherItem } from "./launcher-items";
import {
  canDelete,
  highlightedItem,
  type LauncherEvent,
  type LauncherState,
} from "./launcher-state";
import type { LauncherView } from "./launcher-view";

/** Mod+Backspace removes the highlighted row where rows can be deleted. */
const DELETE_KEYS = ["Mod", "Backspace"];

const ICONS: Record<LauncherIcon, LucideIcon> = {
  attach: Paperclip,
  shell: SquareTerminal,
  "send-to-models": Columns3,
  outputs: FileClock,
  stash: Archive,
  commands: SquareSlash,
  skills: WandSparkles,
  mention: AtSign,
  output: FileOutput,
  command: SquareSlash,
  skill: WandSparkles,
  file: FileText,
  task: MessageSquareText,
  agent: Bot,
  reference: FolderSymlink,
  review: GitCompareArrows,
  compact: Shrink,
  approvals: Shield,
  "approval-defaults": ShieldCheck,
  "approval-full": ShieldAlert,
};

/**
 * The DOM id of an item's row, for the text field's `aria-activedescendant`. Characters
 * outside `[A-Za-z0-9-]` are escaped by code point, so distinct item ids never collide.
 */
export function launcherOptionId(listId: string, itemId: string): string {
  const safe = itemId.replace(/[^A-Za-z0-9-]/g, (char) => `_${char.codePointAt(0)!.toString(16)}_`);
  return `${listId}-option-${safe}`;
}

interface LauncherListProps extends Omit<ComponentProps<"div">, "children" | "id"> {
  /** The listbox's id: the text field names it in `aria-controls`; row ids derive from it. */
  listId: string;
  state: LauncherState;
  view: LauncherView;
  onEvent(event: LauncherEvent): void;
}

export function LauncherList({
  listId,
  state,
  view,
  onEvent,
  className,
  ...props
}: LauncherListProps) {
  const reduceMotion = useReducedMotion();
  const level = state.status === "open" ? (state.category ?? "root") : "root";
  const depth = level === "root" ? 0 : 1;
  // Drilling in slides from the right, going back from the left; the first level shown
  // appears with the panel, not after it.
  const [motionState, setMotionState] = useState({ level, depth, direction: 0 });
  if (motionState.level !== level) {
    setMotionState({ level, depth, direction: depth >= motionState.depth ? 1 : -1 });
  }
  const direction = motionState.direction;

  return (
    <div
      data-slot="launcher"
      data-level={level === "root" ? "root" : "category"}
      data-source={state.status === "open" ? state.source.type : undefined}
      className={cn("flex min-h-0 flex-col", className)}
      {...props}
    >
      {view.title ? (
        <div
          data-slot="launcher-header"
          className="flex h-9 shrink-0 items-center gap-1.5 border-b border-border/60 px-2"
        >
          {view.canGoBack ? (
            <Button
              variant="ghost"
              size="icon-xs"
              tabIndex={-1}
              aria-label="Back"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onEvent({ type: "back" })}
            >
              <ChevronLeft aria-hidden="true" />
            </Button>
          ) : (
            <span className="w-1" />
          )}
          <span className="min-w-0 flex-1 truncate text-compact font-medium">{view.title}</span>
          <span className="shrink-0 pr-1.5 text-meta text-muted-foreground">
            {view.items.some(canDelete) ? `${formatShortcut(DELETE_KEYS)} to delete · ` : ""}
            {view.canGoBack ? "Esc to go back" : "Esc to close"}
          </span>
        </div>
      ) : null}
      {/* A plain scroller: the rows re-render per keystroke, which a fade area would re-measure. */}
      <div
        data-slot="launcher-body"
        className="palot-native-scrollbar min-h-0 shrink overflow-y-auto overscroll-contain"
      >
        <motion.div
          key={level}
          className="flex min-h-0 flex-col"
          initial={
            direction === 0
              ? false
              : reduceMotion
                ? { opacity: 0 }
                : { opacity: 0, x: 12 * direction }
          }
          animate={{ opacity: 1, x: 0 }}
          transition={reduceMotion ? { duration: spring.fast.duration } : spring.moderate}
        >
          {view.notice ? (
            <p
              data-slot="launcher-notice"
              className="m-0 px-3.5 pt-2.5 pb-1 text-meta text-muted-foreground"
            >
              {view.notice}
            </p>
          ) : null}
          <LauncherRows listId={listId} state={state} view={view} onEvent={onEvent} />
          <LauncherStatus view={view} />
        </motion.div>
      </div>
      {view.keptDraft ? (
        <p
          data-slot="launcher-draft"
          className="m-0 flex shrink-0 items-center gap-1.5 border-t border-border/60 px-3.5 py-2 text-meta text-muted-foreground"
        >
          <span className="shrink-0">Draft kept:</span>
          <span className="min-w-0 truncate text-foreground/70">{view.keptDraft}</span>
          <span className="shrink-0">· back when you close</span>
        </p>
      ) : null}
    </div>
  );
}

function LauncherStatus({ view }: { view: LauncherView }) {
  if (view.error) {
    return (
      <p
        data-slot="launcher-status"
        role="alert"
        className="m-0 px-3.5 py-2.5 text-meta text-destructive"
      >
        {view.error}
      </p>
    );
  }
  if (view.loading) {
    return (
      <p
        data-slot="launcher-status"
        role="status"
        className="m-0 px-3.5 py-2.5 text-meta text-muted-foreground"
      >
        Searching…
      </p>
    );
  }
  if (view.empty) {
    return (
      <p
        data-slot="launcher-status"
        role="status"
        className="m-0 px-4 py-6 text-center text-compact text-muted-foreground"
      >
        {view.empty}
      </p>
    );
  }
  return null;
}

function LauncherRows({
  listId,
  state,
  view,
  onEvent,
}: {
  listId: string;
  state: LauncherState;
  view: LauncherView;
  onEvent(event: LauncherEvent): void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const hover = useFluidHover(listRef);
  const { activeIndex, setActiveIndex, registerItem, measureItems } = hover;
  const highlighted = highlightedItem(state, view.items);
  const targetIndex = highlighted ? view.items.indexOf(highlighted) : null;
  const highlightedID = highlighted?.id ?? null;
  // Rows stay memoized: a delete reads the list it happened in from here.
  const itemsRef = useRef(view.items);
  useLayoutEffect(() => {
    itemsRef.current = view.items;
  });
  const onDelete = useCallback(
    (item: LauncherItem) => onEvent({ type: "delete", item, items: itemsRef.current }),
    [onEvent],
  );

  // The reducer owns the highlight; the gliding fill only follows it.
  useLayoutEffect(() => {
    if (activeIndex !== targetIndex) setActiveIndex(targetIndex);
  }, [activeIndex, setActiveIndex, targetIndex]);

  // Section labels and status rows move rows without resizing them; re-read the rects.
  const layoutKey = view.sections
    .map((section) => `${section.label ?? ""}:${section.items.map((item) => item.id).join(",")}`)
    .join("|");
  useLayoutEffect(() => {
    measureItems();
  }, [layoutKey, measureItems]);

  useLayoutEffect(() => {
    if (!highlightedID) return;
    document
      .getElementById(launcherOptionId(listId, highlightedID))
      ?.scrollIntoView?.({ block: "nearest" });
  }, [highlightedID, listId]);

  if (!view.items.length) return null;

  let index = -1;
  return (
    <div
      ref={listRef}
      id={listId}
      role="listbox"
      aria-label={view.title ?? "Add to message"}
      data-slot="launcher-list"
      className="relative p-1.5"
    >
      <FluidHoverHighlight hover={hover} className="rounded-lg" />
      {view.sections.map((section, sectionIndex) => {
        const rows = section.items.map((item) => {
          index += 1;
          return (
            <LauncherRow
              key={item.id}
              id={launcherOptionId(listId, item.id)}
              index={index}
              item={item}
              active={item.id === highlightedID}
              registerItem={registerItem}
              onEvent={onEvent}
              onDelete={onDelete}
            />
          );
        });
        if (!section.label) {
          return (
            <div key={section.id} role="presentation" className="not-first:mt-1">
              {rows}
            </div>
          );
        }
        const labelID = `${listId}-group-${sectionIndex}`;
        return (
          <div
            key={section.id}
            role="group"
            aria-labelledby={labelID}
            data-slot="launcher-section"
            className="not-first:mt-1"
          >
            <div
              id={labelID}
              className="px-2 pt-2 pb-1 text-meta font-medium text-muted-foreground"
            >
              {section.label}
            </div>
            {rows}
          </div>
        );
      })}
    </div>
  );
}

const LauncherRow = memo(function LauncherRow({
  id,
  index,
  item,
  active,
  registerItem,
  onEvent,
  onDelete,
}: {
  id: string;
  index: number;
  item: LauncherItem;
  active: boolean;
  registerItem: (index: number, element: HTMLElement | null) => void;
  onEvent(event: LauncherEvent): void;
  onDelete(item: LauncherItem): void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useRegisterFluidHoverItem(registerItem, index, ref);
  const Icon = ICONS[item.icon];
  return (
    <div
      ref={ref}
      id={id}
      role="option"
      aria-selected={active}
      aria-disabled={item.disabled || undefined}
      aria-current={item.current || undefined}
      data-slot="launcher-item"
      data-kind={item.kind}
      data-highlighted={active ? "" : undefined}
      data-disabled={item.disabled ? "" : undefined}
      title={item.tooltip}
      className="group/launcher-item relative flex h-8 cursor-default items-center gap-2.5 rounded-lg px-2 text-sm select-none data-disabled:opacity-50"
      // Only a moving pointer claims the highlight: rows that scroll or re-render under a
      // resting pointer get movement-free events, which must not take it from the keyboard.
      onPointerMove={(event) => {
        if (active || item.disabled) return;
        if (event.movementX || event.movementY) onEvent({ type: "highlight", id: item.id });
      }}
      // The text field keeps focus.
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => onEvent({ type: "pick", item })}
    >
      <span
        aria-hidden="true"
        className="flex size-6 shrink-0 items-center justify-center rounded-md border border-border/70 bg-muted/50 text-muted-foreground transition-colors group-data-highlighted/launcher-item:text-foreground"
      >
        <Icon className="size-3.5" />
      </span>
      {item.descriptionOverflow === "start" ? (
        // The title keeps its width; the folder gives way from its start, so the part nearest
        // the file stays in view.
        <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
          <span data-slot="launcher-item-title" className="min-w-0 shrink truncate">
            {item.title}
          </span>
          {item.description ? (
            <>
              {" "}
              <span
                data-slot="launcher-item-description"
                data-overflow="start"
                dir="rtl"
                className="min-w-0 flex-1 truncate text-left text-muted-foreground"
              >
                <bdi dir="ltr">{item.description}</bdi>
              </span>
            </>
          ) : null}
        </span>
      ) : (
        <span className="min-w-0 flex-1 truncate">
          <span data-slot="launcher-item-title">{item.title}</span>
          {item.description ? (
            <span data-slot="launcher-item-description" className="text-muted-foreground">
              {" "}
              {item.description}
            </span>
          ) : null}
        </span>
      )}
      {item.current ? (
        <>
          <Check aria-hidden="true" className="size-3.5 shrink-0 text-foreground" />
          <span className="sr-only">, current</span>
        </>
      ) : null}
      {item.badge ? (
        <Badge variant="neutral" size="sm">
          {item.badge}
        </Badge>
      ) : null}
      {item.shortcut ? <ShortcutKbd keys={item.shortcut} className="shrink-0" /> : null}
      {item.hint ? (
        <Kbd className="shrink-0" aria-hidden="true">
          {item.hint}
        </Kbd>
      ) : null}
      {item.action.type === "drill" ? (
        <ChevronRight aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
      ) : null}
      {canDelete(item) ? (
        // Shown while the row is hovered or highlighted, as a queued message's actions are.
        <div
          data-slot="launcher-item-actions"
          className="flex shrink-0 items-center opacity-0 transition-opacity group-hover/launcher-item:opacity-100 group-data-highlighted/launcher-item:opacity-100 motion-reduce:transition-none"
        >
          <Button
            variant="ghost"
            size="icon-xs"
            tabIndex={-1}
            aria-label="Delete stashed prompt"
            aria-keyshortcuts={
              shortcutPlatform() === "mac" ? "Meta+Backspace" : "Control+Backspace"
            }
            onMouseDown={(event) => event.preventDefault()}
            onClick={(event) => {
              // The row's own click restores the prompt.
              event.stopPropagation();
              onDelete(item);
            }}
          >
            <Trash2 aria-hidden="true" />
          </Button>
        </div>
      ) : null}
    </div>
  );
});
