import type { Task } from "../types";

export const NOW = Date.UTC(2026, 10, 11, 12, 0, 0);

export function makeTask(partial: Partial<Task> & Pick<Task, "id">): Task {
  return {
    title: partial.id,
    projectID: "palot",
    serverID: "local",
    branch: null,
    createdAt: NOW - 3_600_000,
    activityAt: NOW - 600_000,
    run: null,
    runEndedAt: null,
    requests: [],
    requestIndex: 0,
    failure: null,
    stopped: false,
    unread: false,
    summary: null,
    pinnedAt: null,
    snoozedUntil: null,
    settledAt: null,
    pr: null,
    subagents: 0,
    schedule: null,
    lastAnswer: "",
    attentionAt: null,
    lingerUntil: null,
    ...partial,
  };
}

export function running(startedAgo: number, quietFor = 1_000, detail: string | null = null) {
  return { run: { startedAt: NOW - startedAgo, lastUpdateAt: NOW - quietFor, detail } };
}
