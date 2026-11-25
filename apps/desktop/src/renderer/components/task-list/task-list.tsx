/**
 * The task column's body as one component: header, filter chips, the list with its sections,
 * the bulk bar, the snooze menu and quick look, and the footer. Driven by a `TaskListSource`;
 * the only app state it reads is what the caller passes in (`preferences`), and everything
 * else the app owns comes in through slots.
 */

import {
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  type ReactNode,
  type Ref,
} from "react";
import { cn } from "@/lib/cn";
import type { TaskListSource } from "@/lib/task-list/source";
import { TaskListController, type Notice } from "./controller";
import { TaskListProvider, type RenderRowMenu } from "./context";
import { ColumnFooter, ColumnHeader, FilterChips } from "./header";
import { useTaskListGlobalKeys } from "./keyboard";
import { ColumnBody } from "./list";
import { toastNotice } from "./notices";
import { QuickLook, SnoozeMenu } from "./overlays";
import { DEFAULT_TASK_LIST_PREFERENCES, type TaskListPreferences } from "./preferences";

const DEFAULT_COLUMN_PX = 272;

/** What the app can ask of a mounted list. */
export interface TaskListHandle {
  /** Every row in list order, as shown. */
  listOrder(): readonly string[];
  /** Focuses and scrolls to a task's row without opening it. */
  reveal(id: string): void;
}

export interface TaskListProps {
  source: TaskListSource;
  /** The remembered View knobs, ordering, filters and open sections (see `preferences.ts`). */
  preferences?: TaskListPreferences;
  onPreferencesChange?: (preferences: TaskListPreferences) => void;
  /** Wraps each row in the app's task menu; without it the list shows its own small menu. */
  renderRowMenu?: RenderRowMenu;
  /** The header's search button (the command palette); hidden without it. */
  onSearch?: () => void;
  /** Extra View menu entries after "Load older tasks" (Add project folder, Import task). */
  viewMenuItems?: ReactNode;
  /** Replaces the default connection line; `null` shows no footer. */
  footer?: ReactNode;
  /** Where notices and undo go; the app's toasts by default. */
  notify?: (notice: Notice) => void;
  /** Alt+Up/Down, Mod+Alt+A and Mod+1…9 from anywhere. On by default. */
  globalKeys?: boolean;
  className?: string;
  handleRef?: Ref<TaskListHandle>;
}

export function TaskList({
  source,
  preferences = DEFAULT_TASK_LIST_PREFERENCES,
  onPreferencesChange,
  renderRowMenu,
  onSearch,
  viewMenuItems,
  footer,
  notify = toastNotice,
  globalKeys = true,
  className,
  handleRef,
}: TaskListProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const latest = useRef({ onPreferencesChange, notify, preferences });
  latest.current = { onPreferencesChange, notify, preferences };
  const controller = useMemo(
    () =>
      new TaskListController(
        source,
        {
          preferences: latest.current.preferences,
          columnPx: DEFAULT_COLUMN_PX,
          onPreferencesChange: (next) => latest.current.onPreferencesChange?.(next),
        },
        (notice) => latest.current.notify(notice),
      ),
    [source],
  );
  useEffect(() => {
    controller.start();
    return () => controller.dispose();
  }, [controller]);

  // Stored preferences flow in; the controller ignores values equal to its own.
  useLayoutEffect(() => controller.setPreferences(preferences), [controller, preferences]);

  // The column's width picks three- or four-line approval rows.
  useLayoutEffect(() => {
    const element = rootRef.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const width = element.clientWidth;
      if (width > 0) controller.setPreferences(latest.current.preferences, width);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [controller]);

  useTaskListGlobalKeys(controller, globalKeys);
  useImperativeHandle(
    handleRef,
    () => ({ listOrder: () => controller.listOrder(), reveal: (id) => controller.reveal(id) }),
    [controller],
  );

  return (
    <TaskListProvider controller={controller} renderRowMenu={renderRowMenu ?? null}>
      <div
        ref={rootRef}
        data-slot="task-list"
        className={cn(
          "flex h-full min-h-0 w-full flex-col bg-sidebar text-sidebar-foreground",
          className,
        )}
      >
        <ColumnHeader onSearch={onSearch} viewMenuItems={viewMenuItems} />
        <FilterChips />
        <ColumnBody />
        {footer === undefined ? <ColumnFooter /> : footer}
        <SnoozeMenu />
        <QuickLook />
      </div>
    </TaskListProvider>
  );
}
