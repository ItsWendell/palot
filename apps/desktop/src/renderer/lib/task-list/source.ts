import type { Project, Server, Task } from "./types";

/**
 * The seam between Palot's data and the task list. One implementation projects OpenCode sessions,
 * requests, triage and connections (every connected server) into these plain values; the list's
 * controller and components read nothing else. Arrays keep their identity while nothing in them
 * changed, and a task object keeps its identity while that task did not change, so a row
 * re-renders only for its own task.
 */
export interface TaskListSnapshot {
  tasks: readonly Task[];
  projects: readonly Project[];
  servers: readonly Server[];
  /** The task shown in the main area, if any. */
  openTaskID: string | null;
  /** More settled or older tasks can be loaded. */
  hasOlder: boolean;
  loadingOlder: boolean;
}

/** What "undo" restores after a triage step; opaque to the list. */
export type TaskUndo = () => void | Promise<void>;

/**
 * Every effect the list can have. Keys are task ids. Triage steps return an undo when one exists;
 * the list shows the toast. A rejected promise means the step did not happen and the list says so.
 */
export interface TaskListActions {
  /** `background` opens the new window without taking focus. */
  open(id: string, options?: { newWindow?: boolean; background?: boolean }): void;
  settle(ids: readonly string[]): Promise<TaskUndo | null>;
  unsettle(id: string): Promise<void>;
  snooze(ids: readonly string[], until: number): Promise<TaskUndo | null>;
  wake(id: string): Promise<void>;
  setPinned(id: string, pinned: boolean): Promise<TaskUndo | null>;
  setUnread(ids: readonly string[], unread: boolean): Promise<void>;
  stop(id: string): Promise<void>;
  /** Sends the task's last prompt again after a failure. */
  retry(id: string): Promise<void>;
  /** Answers on the server that owns the request, which may not be the focused one. */
  replyPermission(
    id: string,
    requestID: string,
    reply: "once" | "always" | "reject",
  ): Promise<void>;
  replyQuestion(id: string, requestID: string, answer: string): Promise<void>;
  rename(id: string, title: string): Promise<void>;
  /** Opens the app's delete confirmation. */
  requestDelete(id: string): void;
  loadOlder(): void;
  /**
   * Starts a task in a project, a chat when `projectID` is null, or a task wherever the app's
   * New task goes (Mod+N) when it is undefined.
   */
  startTask(projectID?: string | null): void;
  reconnect(serverID?: string): void;
}

export interface TaskListSource {
  getSnapshot(): TaskListSnapshot;
  subscribe(listener: () => void): () => void;
  actions: TaskListActions;
}
