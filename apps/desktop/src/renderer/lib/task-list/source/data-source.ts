/** The `TaskListSource` over real data: a projector, its listeners, and the actions. */

import type { TaskListSource } from "../source";
import { createStore, type Store } from "../store";
import { createTaskListActions, type TaskActionDeps } from "./actions";
import { TaskListProjector, type ProjectionInput, type TaskMeta } from "./project";

/** A task waiting for the delete confirmation the app shows. */
export interface TaskDeleteRequest {
  taskID: string;
  title: string;
}

export type TaskListAppDeps = Omit<
  TaskActionDeps,
  "meta" | "openTaskID" | "listOrder" | "requestDelete"
>;

export interface TaskListDataSource extends TaskListSource {
  /** Feeds new data; listeners hear only when the snapshot changed. */
  update(input: ProjectionInput): void;
  /** The app's side of the actions; replaced on every render that changes them. */
  setDeps(deps: TaskListAppDeps): void;
  /**
   * Lets the list say which task comes after the open one, so settling it opens that task.
   * Without it, the next task follows today's Inbox order.
   */
  setListOrder(order: (() => readonly string[]) | null): void;
  /** The task `requestDelete` asked about, until the app confirms or cancels. */
  readonly deleteRequest: Store<{ pending: TaskDeleteRequest | null }>;
  meta(id: string): TaskMeta | undefined;
}

export function createTaskListDataSource(initial: TaskListAppDeps): TaskListDataSource {
  const projector = new TaskListProjector();
  const listeners = new Set<() => void>();
  const deleteRequest = createStore<{ pending: TaskDeleteRequest | null }>({ pending: null });
  let deps = initial;
  let listOrder: (() => readonly string[]) | null = null;
  const actions = createTaskListActions({
    meta: (id) => projector.meta(id),
    openTaskID: () => projector.snapshot.openTaskID,
    listOrder: () => listOrder?.() ?? projector.fallbackOrder,
    now: () => deps.now(),
    dispatch: (serverID, command) => deps.dispatch(serverID, command),
    openSession: (meta) => deps.openSession(meta),
    openWindow: (meta, options) =>
      options ? deps.openWindow(meta, options) : deps.openWindow(meta),
    reportError: (title, error) => deps.reportError(title, error),
    setUnreadMark: (serverID, sessionID, marked) => deps.setUnreadMark(serverID, sessionID, marked),
    markViewed: (meta, idleAt) => deps.markViewed(meta, idleAt),
    interrupt: (meta) => deps.interrupt(meta),
    replyPermission: (input) => deps.replyPermission(input),
    replyQuestion: (input) => deps.replyQuestion(input),
    rename: (meta, title) => deps.rename(meta, title),
    requestDelete: (meta) => deleteRequest.set({ pending: { taskID: meta.id, title: meta.title } }),
    loadOlder: () => deps.loadOlder(),
    startTask: (target) => deps.startTask(target),
    reconnect: (serverID) => deps.reconnect(serverID),
  });
  return {
    getSnapshot: () => projector.snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    actions,
    update(input) {
      const previous = projector.snapshot;
      if (projector.project(input) === previous) return;
      for (const listener of listeners) listener();
    },
    setDeps(next) {
      deps = next;
    },
    setListOrder(order) {
      listOrder = order;
    },
    deleteRequest,
    meta: (id) => projector.meta(id),
  };
}
