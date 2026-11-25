import { createContext, useContext, useMemo, type ReactElement, type ReactNode } from "react";
import { useStoreSelector } from "@/lib/task-list/store";
import type { Task } from "@/lib/task-list/types";
import type { TaskListController, TaskListState } from "./controller";

/** What the app's row menu gets besides the row: the list's own entries and its two callbacks. */
export interface RowMenuContext {
  /** Pin, Mark as read or unread, Settle or Move back: the list's entries for the menu's top. */
  items: ReactNode;
  snooze(until: number): void;
  rename(): void;
}

/** Wraps a row in the app's context menu; `row` is the trigger element. */
export type RenderRowMenu = (task: Task, row: ReactElement, menu: RowMenuContext) => ReactNode;

interface TaskListContextValue {
  controller: TaskListController;
  renderRowMenu: RenderRowMenu | null;
}

const TaskListContext = createContext<TaskListContextValue | null>(null);

export function TaskListProvider({
  controller,
  renderRowMenu = null,
  children,
}: {
  controller: TaskListController;
  renderRowMenu?: RenderRowMenu | null;
  children: ReactNode;
}) {
  // A stable value: rows read it, and a new object would re-render every one of them.
  const value = useMemo(() => ({ controller, renderRowMenu }), [controller, renderRowMenu]);
  return <TaskListContext.Provider value={value}>{children}</TaskListContext.Provider>;
}

function useTaskListContext(): TaskListContextValue {
  const value = useContext(TaskListContext);
  if (!value) throw new Error("Task list parts need a TaskListProvider");
  return value;
}

export function useController(): TaskListController {
  return useTaskListContext().controller;
}

export function useRenderRowMenu(): RenderRowMenu | null {
  return useTaskListContext().renderRowMenu;
}

/** Subscribes to one slice; return stored values or primitives, never fresh objects. */
export function useTaskList<T>(selector: (state: TaskListState) => T): T {
  return useStoreSelector(useController().store, selector);
}

/** Whether the last input was the keyboard: focus from a click does not hold the order. */
let keyboardModality = false;
if (typeof window !== "undefined") {
  window.addEventListener("keydown", () => (keyboardModality = true), true);
  window.addEventListener("pointerdown", () => (keyboardModality = false), true);
}
export function lastInputWasKeyboard() {
  return keyboardModality;
}
