import type { InboxSessionView } from "./session-inbox";

export type AnnouncedTask = Pick<InboxSessionView, "attention" | "running" | "failed"> & {
  id: string;
  title: string;
};
export function taskAnnouncementState(task: AnnouncedTask) {
  return task.attention ? "input" : task.running ? "working" : task.failed ? "failed" : "idle";
}
export function taskAnnouncement(previous: string | undefined, task: AnnouncedTask, open: boolean) {
  const next = taskAnnouncementState(task);
  // Initial hydration is silent. Background tasks only announce actionable changes.
  if (!previous || previous === next) return null;
  const text =
    next === "input"
      ? "needs your input"
      : next === "failed"
        ? "failed"
        : !open
          ? null
          : next === "working"
            ? "started working"
            : previous === "working" || previous === "input"
              ? "finished"
              : null;
  return text ? `${open ? "Open task" : task.title}: ${text}.` : null;
}
