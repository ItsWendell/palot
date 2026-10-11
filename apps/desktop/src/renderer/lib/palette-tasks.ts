import type { PalotSession } from "../../shared";

/** Number of recent tasks reachable with Alt+1…Alt+9 and shown on the empty palette. */
export const RECENT_TASK_LIMIT = 9;

export type PaletteTaskStatus = "running" | "attention" | "unread";

/** A root task plus the connection that owns it. */
export interface PaletteTask {
  session: PalotSession;
  /**
   * Owning connection profile. `null` means the focused connection when Palot has a single
   * connection; such tasks open through the default focused-connection navigation.
   */
  profileID: string | null;
  /** Runtime connection used for cache seeding and preloading, when known. */
  connectionID: string | null;
  /** Project label from the owning connection's catalog, when it is not the focused one. */
  projectName?: string | null;
  /** Server name shown beside the task when several connections exist. */
  serverName: string | null;
  connected: boolean;
  status?: PaletteTaskStatus;
}

export function paletteTaskKey(task: Pick<PaletteTask, "profileID" | "session">): string {
  return task.profileID === null ? task.session.id : `${task.profileID}/${task.session.id}`;
}

export function paletteTaskCommandID(task: Pick<PaletteTask, "profileID" | "session">): string {
  return `session.open:${paletteTaskKey(task)}`;
}

/**
 * Merges task lists into one recency-ordered list of root tasks. Tasks are identified by
 * owning profile and session ID, so equal session IDs on different servers stay separate.
 * Later lists win for the same task, which lets fresh search results replace stale rows
 * without dropping status from an earlier source.
 */
export function mergePaletteTasks(...lists: readonly (readonly PaletteTask[])[]): PaletteTask[] {
  const byKey = new Map<string, PaletteTask>();
  for (const list of lists) {
    for (const task of list) {
      if (task.session.parentID) continue;
      const key = paletteTaskKey(task);
      const previous = byKey.get(key);
      byKey.set(key, previous ? { ...task, status: task.status ?? previous.status } : task);
    }
  }
  return [...byKey.values()].toSorted(
    (left, right) =>
      right.session.updatedAt - left.session.updatedAt ||
      left.session.id.localeCompare(right.session.id) ||
      (left.profileID ?? "").localeCompare(right.profileID ?? ""),
  );
}

/**
 * Resolves Ctrl+Tab / Ctrl+Shift+Tab against the recent-task order. Returns the adjacent
 * task, wrapping at either end. Without a current task, next starts at the most recent
 * task and previous at the oldest.
 */
export function adjacentPaletteTask(
  tasks: readonly PaletteTask[],
  current: { sessionID: string | null; profileID: string | null },
  direction: 1 | -1,
): PaletteTask | null {
  if (tasks.length === 0) return null;
  const index = current.sessionID
    ? tasks.findIndex(
        (task) =>
          task.session.id === current.sessionID &&
          (task.profileID === null || task.profileID === current.profileID),
      )
    : -1;
  if (index === -1) return direction === 1 ? tasks[0]! : tasks.at(-1)!;
  const next = (index + direction + tasks.length) % tasks.length;
  return next === index ? null : tasks[next]!;
}
