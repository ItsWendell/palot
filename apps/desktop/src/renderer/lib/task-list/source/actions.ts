/**
 * The list's actions, once, for a task on any server. Triage goes through the existing
 * dispatcher (the focused profile's atom, other profiles' overview), so every surface sees the
 * same snapshot; replies and stops go to the connection that owns the task.
 */

import { SESSION_TRIAGE_BATCH_LIMIT } from "../../../../shared";
import type { OverviewTriageCommand } from "../../connection-overview";
import type { TaskListActions, TaskUndo } from "../source";
import { parseProjectKey } from "./ids";
import type { TaskMeta } from "./project";

export const OFFLINE_MESSAGE = "This connection is offline. Reconnect before changing its tasks.";
export const TRIAGE_UNAVAILABLE_MESSAGE = "Inbox state is not loaded yet. Try again in a moment.";

/** What the actions need from the app; the hook supplies the live versions. */
export interface TaskActionDeps {
  meta(id: string): TaskMeta | undefined;
  openTaskID(): string | null;
  /**
   * Task ids in the order the list shows them, for "settling the open task opens the next".
   * Falls back to today's Inbox order when the list has not said.
   */
  listOrder(): readonly string[];
  now(): number;
  dispatch(serverID: string, command: OverviewTriageCommand): Promise<unknown>;
  openSession(meta: TaskMeta): Promise<unknown>;
  openWindow(meta: TaskMeta, options?: { background?: boolean }): Promise<unknown>;
  /** Reports an action that has no promise to reject (open, open in a new window). */
  reportError(title: string, error: unknown): void;
  setUnreadMark(serverID: string, sessionID: string, marked: boolean): void;
  /** Records the view on the server, so OpenCode's own unread state clears too. */
  markViewed(meta: TaskMeta, idleAt: number): Promise<unknown>;
  interrupt(meta: TaskMeta & { connectionID: string }): Promise<unknown>;
  replyPermission(input: {
    connectionID: string;
    sessionID: string;
    requestID: string;
    reply: "once" | "always" | "reject";
  }): Promise<unknown>;
  replyQuestion(input: {
    connectionID: string;
    sessionID: string;
    requestID: string;
    answers: string[][];
  }): Promise<unknown>;
  rename(meta: TaskMeta & { connectionID: string }, title: string): Promise<unknown>;
  requestDelete(meta: TaskMeta): void;
  loadOlder(): void;
  /** `projectID` is OpenCode's own id on `serverID`; both null start a chat. */
  /** Undefined: the app's default New task destination. */
  startTask(target?: { serverID: string; projectID: string } | null): void;
  reconnect(serverID?: string): void;
}

function taskMeta(deps: TaskActionDeps, id: string): TaskMeta {
  const meta = deps.meta(id);
  if (!meta) throw new Error("This task is no longer in the list.");
  return meta;
}

function connected(meta: TaskMeta): TaskMeta & { connectionID: string } {
  if (!meta.online || !meta.connectionID) throw new Error(OFFLINE_MESSAGE);
  return meta as TaskMeta & { connectionID: string };
}

function triageable(meta: TaskMeta): TaskMeta {
  if (!meta.online) throw new Error(OFFLINE_MESSAGE);
  if (!meta.canTriage) throw new Error(TRIAGE_UNAVAILABLE_MESSAGE);
  return meta;
}

function groupByServer(metas: readonly TaskMeta[]): Map<string, TaskMeta[]> {
  const groups = new Map<string, TaskMeta[]>();
  for (const meta of metas) {
    const group = groups.get(meta.serverID);
    if (group) group.push(meta);
    else groups.set(meta.serverID, [meta]);
  }
  return groups;
}

function chunks<T>(items: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size)
    result.push(items.slice(index, index + size));
  return result;
}

/**
 * Runs one step per server and keeps the undos of the ones that happened. Rejects only when
 * nothing happened, so the list can say the step failed; a partial step still offers undo.
 */
async function perServer(
  metas: readonly TaskMeta[],
  step: (serverID: string, group: TaskMeta[]) => Promise<TaskUndo | null>,
): Promise<TaskUndo | null> {
  const results = await Promise.allSettled(
    [...groupByServer(metas)].map(([serverID, group]) => step(serverID, group)),
  );
  const undos = results.flatMap((result) =>
    result.status === "fulfilled" && result.value ? [result.value] : [],
  );
  const failed = results.find((result) => result.status === "rejected");
  if (failed && results.every((result) => result.status === "rejected")) throw failed.reason;
  if (undos.length === 0) return null;
  if (undos.length === 1) return undos[0]!;
  return async () => {
    await Promise.all(undos.map((undo) => undo()));
  };
}

/** Why a task cannot settle, in the words today's Inbox uses. */
function settleBlocker(meta: TaskMeta): string | null {
  if (meta.running) return "Task is still working";
  if (meta.needsInput) return "Task needs input";
  return meta.canSettle ? null : "Task cannot settle yet";
}

/** The task to open after the open one settles: next in list order, else the one before. */
export function nextOpenTask(
  order: readonly string[],
  openID: string,
  leaving: ReadonlySet<string>,
  available: (id: string) => boolean,
): string | null {
  const index = order.indexOf(openID);
  const candidate = (id: string) => !leaving.has(id) && id !== openID && available(id);
  if (index === -1) return order.find(candidate) ?? null;
  for (let at = index + 1; at < order.length; at++) if (candidate(order[at]!)) return order[at]!;
  for (let at = index - 1; at >= 0; at--) if (candidate(order[at]!)) return order[at]!;
  return null;
}

export function createTaskListActions(deps: TaskActionDeps): TaskListActions {
  const inbox = (meta: TaskMeta) =>
    deps.dispatch(meta.serverID, { type: "inbox", sessionID: meta.sessionID, at: deps.now() });

  const settleGroup = async (serverID: string, group: TaskMeta[]): Promise<TaskUndo> => {
    for (const batch of chunks(group, SESSION_TRIAGE_BATCH_LIMIT)) {
      const at = deps.now();
      await deps.dispatch(
        serverID,
        batch.length === 1
          ? {
              type: "settle",
              sessionID: batch[0]!.sessionID,
              at,
              through: batch[0]!.activityThrough,
            }
          : {
              type: "settle-many",
              at,
              trigger: "bulk",
              sessions: batch.map((meta) => ({
                sessionID: meta.sessionID,
                through: meta.activityThrough,
              })),
            },
      );
    }
    return async () => {
      for (const batch of chunks(group, SESSION_TRIAGE_BATCH_LIMIT)) {
        await (batch.length === 1
          ? inbox(batch[0]!)
          : deps.dispatch(serverID, {
              type: "inbox-many",
              at: deps.now(),
              sessionIDs: batch.map((meta) => meta.sessionID),
            }));
      }
    };
  };

  return {
    open(id, options) {
      const meta = deps.meta(id);
      if (!meta) return;
      const action = options?.newWindow
        ? options.background
          ? deps.openWindow(meta, { background: true })
          : deps.openWindow(meta)
        : deps.openSession(meta);
      void action.catch((error: unknown) =>
        deps.reportError(
          options?.newWindow ? "Could not open task in a new window" : "Could not open task",
          error,
        ),
      );
    },

    async settle(ids) {
      const metas = ids.map((id) => taskMeta(deps, id));
      const blocked = metas.map(settleBlocker);
      const settleable = metas.filter((meta, index) => !blocked[index]);
      if (settleable.length === 0) throw new Error(blocked.find(Boolean) ?? "Nothing to settle");
      for (const meta of settleable) triageable(meta);
      const openID = deps.openTaskID();
      const next =
        openID && settleable.some((meta) => meta.id === openID)
          ? nextOpenTask(
              deps.listOrder(),
              openID,
              new Set(settleable.map((meta) => meta.id)),
              (id) => {
                const candidate = deps.meta(id);
                return (
                  candidate !== undefined &&
                  (candidate.section === "inbox" || candidate.section === "pinned")
                );
              },
            )
          : null;
      const undo = await perServer(settleable, settleGroup);
      const nextMeta = next ? deps.meta(next) : undefined;
      if (nextMeta) void deps.openSession(nextMeta).catch(() => undefined);
      return undo;
    },

    async unsettle(id) {
      await inbox(triageable(taskMeta(deps, id)));
    },

    async snooze(ids, until) {
      const metas = ids.map((id) => triageable(taskMeta(deps, id)));
      return perServer(metas, async (serverID, group) => {
        for (const meta of group)
          await deps.dispatch(serverID, {
            type: "snooze",
            sessionID: meta.sessionID,
            at: deps.now(),
            until,
            through: meta.activityThrough,
          });
        return async () => {
          for (const meta of group) {
            const previous = meta.snoozedUntil;
            await deps.dispatch(
              serverID,
              previous !== null && previous > deps.now()
                ? {
                    type: "snooze",
                    sessionID: meta.sessionID,
                    at: deps.now(),
                    until: previous,
                    through: meta.activityThrough,
                  }
                : { type: "wake", sessionID: meta.sessionID, at: deps.now() },
            );
          }
        };
      });
    },

    async wake(id) {
      const meta = triageable(taskMeta(deps, id));
      await deps.dispatch(meta.serverID, {
        type: "wake",
        sessionID: meta.sessionID,
        at: deps.now(),
      });
    },

    async setPinned(id, pinned) {
      const meta = triageable(taskMeta(deps, id));
      if ((meta.pinnedAt !== null) === pinned) return null;
      const command = (value: boolean) =>
        deps.dispatch(meta.serverID, {
          type: value ? "pin" : "unpin",
          sessionID: meta.sessionID,
          at: deps.now(),
        });
      await command(pinned);
      return async () => {
        await command(!pinned);
      };
    },

    async setUnread(ids, unread) {
      const metas = ids.map((id) => taskMeta(deps, id));
      const views: Promise<unknown>[] = [];
      for (const meta of metas) {
        deps.setUnreadMark(meta.serverID, meta.sessionID, unread);
        // OpenCode cannot mark a task unread; marking read also records the view there.
        if (!unread && meta.serverUnread && meta.idleAt !== null && meta.online)
          views.push(deps.markViewed(meta, meta.idleAt));
      }
      await Promise.all(views);
    },

    async stop(id) {
      await deps.interrupt(connected(taskMeta(deps, id)));
    },

    // OpenCode has no "resend the last prompt", and Palot has no function that does it; open
    // the task so the person can retry from the composer.
    async retry(id) {
      const meta = taskMeta(deps, id);
      await deps.openSession(meta);
    },

    async replyPermission(id, requestID, reply) {
      const meta = connected(taskMeta(deps, id));
      await deps.replyPermission({
        connectionID: meta.connectionID,
        sessionID: meta.requestOwners.get(requestID) ?? meta.sessionID,
        requestID,
        reply,
      });
    },

    async replyQuestion(id, requestID, answer) {
      const meta = connected(taskMeta(deps, id));
      await deps.replyQuestion({
        connectionID: meta.connectionID,
        sessionID: meta.requestOwners.get(requestID) ?? meta.sessionID,
        requestID,
        answers: [[answer]],
      });
    },

    async rename(id, title) {
      const meta = connected(taskMeta(deps, id));
      const next = title.trim();
      if (!next) throw new Error("Task title cannot be empty");
      if (next === meta.title) return;
      await deps.rename(meta, next);
    },

    requestDelete(id) {
      const meta = deps.meta(id);
      if (meta) deps.requestDelete(meta);
    },

    loadOlder() {
      deps.loadOlder();
    },

    startTask(projectID) {
      if (projectID === undefined || projectID === null) {
        deps.startTask(projectID);
        return;
      }
      // Project ids in the list are owner-qualified; see `ids.ts`.
      deps.startTask(parseProjectKey(projectID));
    },

    reconnect(serverID) {
      deps.reconnect(serverID);
    },
  };
}
