import type { ConnectionOverview } from "./connection-overview";

export interface RunningLocalTask {
  id: string;
  title: string;
}

/**
 * Root tasks working on the local OpenCode service, as the task list counts them: a task runs
 * while it or one of its subagents does. Restarting or replacing the service stops all of them.
 */
export function runningLocalTasks(
  connections: readonly Pick<ConnectionOverview, "profile" | "inbox">[],
): RunningLocalTask[] {
  const seen = new Set<string>();
  const tasks: RunningLocalTask[] = [];
  for (const connection of connections) {
    if (connection.profile.kind !== "local") continue;
    const { pinned, inbox, snoozed, settled } = connection.inbox;
    for (const row of [...pinned, ...inbox, ...snoozed, ...settled]) {
      if (!row.running || seen.has(row.session.id)) continue;
      seen.add(row.session.id);
      tasks.push({ id: row.session.id, title: row.session.title?.trim() || "Untitled task" });
    }
  }
  return tasks;
}

/** "3 tasks are working" or "1 task is working". */
export function runningTasksSentence(count: number): string {
  return count === 1 ? "1 task is working" : `${count} tasks are working`;
}
