/**
 * An in-memory `TaskListSource` for tests and the showcase: actions change its tasks the way
 * the real source would, record their calls, and can be made to fail. Not used by the app.
 */

import type {
  TaskListActions,
  TaskListSnapshot,
  TaskListSource,
  TaskUndo,
} from "@/lib/task-list/source";
import type { Project, Server, Task } from "@/lib/task-list/types";

export interface FixtureCall {
  action: keyof TaskListActions;
  args: unknown[];
}

export interface FixtureSource extends TaskListSource {
  calls: FixtureCall[];
  /** Replaces tasks by id (or adds them); other tasks keep their objects. */
  update(tasks: readonly Task[]): void;
  set(snapshot: Partial<TaskListSnapshot>): void;
  /** The next call of `action` rejects with this message. */
  failNext(action: keyof TaskListActions, message?: string): void;
  /** Effects wait for `release()` instead of applying at once. */
  hold(held: boolean): void;
  release(): Promise<void>;
}

export function createFixtureSource(input: {
  tasks: readonly Task[];
  projects?: readonly Project[];
  servers?: readonly Server[];
  openTaskID?: string | null;
  hasOlder?: boolean;
}): FixtureSource {
  let snapshot: TaskListSnapshot = {
    tasks: input.tasks,
    projects: input.projects ?? [],
    servers: input.servers ?? [{ id: "local", name: "This Mac", online: true, lastSeenAt: null }],
    openTaskID: input.openTaskID ?? null,
    hasOlder: input.hasOlder ?? false,
    loadingOlder: false,
  };
  const listeners = new Set<() => void>();
  const calls: FixtureCall[] = [];
  const failures = new Map<string, string>();
  let held = false;
  let queue: (() => void)[] = [];

  const emit = () => {
    for (const listener of listeners) listener();
  };
  const set = (patch: Partial<TaskListSnapshot>) => {
    snapshot = { ...snapshot, ...patch };
    emit();
  };
  const patchTasks = (ids: readonly string[], patch: (task: Task) => Partial<Task>) => {
    const wanted = new Set(ids);
    set({
      tasks: snapshot.tasks.map((task) =>
        wanted.has(task.id) ? { ...task, ...patch(task) } : task,
      ),
    });
  };
  const restore =
    (previous: readonly Task[]): TaskUndo =>
    () => {
      const byID = new Map(previous.map((task) => [task.id, task]));
      set({ tasks: snapshot.tasks.map((task) => byID.get(task.id) ?? task) });
    };
  const tasksOf = (ids: readonly string[]) =>
    snapshot.tasks.filter((task) => ids.includes(task.id));

  /** Records the call, then fails, waits for release, or applies the effect. */
  function effect<T>(action: keyof TaskListActions, args: unknown[], apply: () => T): Promise<T> {
    calls.push({ action, args });
    const failure = failures.get(action);
    if (failure !== undefined) {
      failures.delete(action);
      return Promise.reject(new Error(failure));
    }
    if (!held) return Promise.resolve(apply());
    return new Promise<T>((resolve) => queue.push(() => resolve(apply())));
  }

  const actions: TaskListActions = {
    open(id, options) {
      calls.push({ action: "open", args: [id, options] });
      if (options?.newWindow) return;
      snapshot = { ...snapshot, openTaskID: id };
      patchTasks([id], () => ({ unread: false }));
    },
    settle: (ids) =>
      effect("settle", [ids], () => {
        const undo = restore(tasksOf(ids));
        const now = Date.now();
        patchTasks(ids, () => ({
          settledAt: now,
          unread: false,
          pinnedAt: null,
          snoozedUntil: null,
        }));
        return undo;
      }),
    unsettle: (id) => effect("unsettle", [id], () => patchTasks([id], () => ({ settledAt: null }))),
    snooze: (ids, until) =>
      effect("snooze", [ids, until], () => {
        const undo = restore(tasksOf(ids));
        patchTasks(ids, () => ({ snoozedUntil: until, pinnedAt: null }));
        return undo;
      }),
    wake: (id) =>
      effect("wake", [id], () =>
        patchTasks([id], () => ({ snoozedUntil: null, activityAt: Date.now() })),
      ),
    setPinned: (id, pinned) =>
      effect("setPinned", [id, pinned], () => {
        const undo = restore(tasksOf([id]));
        const now = Date.now();
        patchTasks([id], () =>
          pinned ? { pinnedAt: now, settledAt: null, snoozedUntil: null } : { pinnedAt: null },
        );
        return undo;
      }),
    setUnread: (ids, unread) =>
      effect("setUnread", [ids, unread], () => patchTasks(ids, () => ({ unread }))),
    stop: (id) =>
      effect("stop", [id], () => {
        const now = Date.now();
        patchTasks([id], () => ({
          run: null,
          runEndedAt: now,
          stopped: true,
          requests: [],
          subagents: 0,
        }));
      }),
    retry: (id) =>
      effect("retry", [id], () => {
        const now = Date.now();
        patchTasks([id], () => ({
          failure: null,
          attentionAt: null,
          run: { startedAt: now, lastUpdateAt: now, detail: "Retrying the last step" },
        }));
      }),
    replyPermission: (id, requestID, reply) =>
      effect("replyPermission", [id, requestID, reply], () => answer(id, requestID)),
    replyQuestion: (id, requestID, text) =>
      effect("replyQuestion", [id, requestID, text], () => answer(id, requestID)),
    rename: (id, title) => effect("rename", [id, title], () => patchTasks([id], () => ({ title }))),
    requestDelete(id) {
      calls.push({ action: "requestDelete", args: [id] });
    },
    loadOlder() {
      calls.push({ action: "loadOlder", args: [] });
    },
    startTask(projectID) {
      calls.push({ action: "startTask", args: [projectID] });
    },
    reconnect(serverID) {
      calls.push({ action: "reconnect", args: [serverID] });
      const now = Date.now();
      set({
        servers: snapshot.servers.map((server) =>
          serverID === undefined || server.id === serverID
            ? { ...server, online: true, lastSeenAt: null }
            : server,
        ),
        tasks: snapshot.tasks.map((task) =>
          task.run ? { ...task, run: { ...task.run, lastUpdateAt: now } } : task,
        ),
      });
    },
  };

  function answer(id: string, requestID: string) {
    const now = Date.now();
    patchTasks([id], (task) => {
      const requests = task.requests.filter((request) => request.id !== requestID);
      return {
        requests,
        requestIndex: Math.min(task.requestIndex, Math.max(0, requests.length - 1)),
        attentionAt: requests.length ? task.attentionAt : null,
        run: task.run
          ? { ...task.run, lastUpdateAt: now }
          : { startedAt: now, lastUpdateAt: now, detail: null },
      };
    });
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    actions,
    calls,
    update(tasks) {
      const byID = new Map(tasks.map((task) => [task.id, task]));
      const known = new Set(snapshot.tasks.map((task) => task.id));
      set({
        tasks: [
          ...snapshot.tasks.map((task) => byID.get(task.id) ?? task),
          ...tasks.filter((task) => !known.has(task.id)),
        ],
      });
    },
    set,
    failNext(action, message = "Server said no") {
      failures.set(action, message);
    },
    hold(next) {
      held = next;
    },
    async release() {
      const pending = queue;
      queue = [];
      for (const run of pending) run();
      await Promise.resolve();
    },
  };
}
