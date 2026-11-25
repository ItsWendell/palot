/**
 * The task list's one controller: list state (focus, selection, the order hold, open
 * sections and groups, notices and undo, the request guard and linger, quick look, rename,
 * the numbers overlay) over the tasks a `TaskListSource` gives. Rules live in
 * `lib/task-list/model/`; every effect goes through `source.actions`. Ported from the sidebar
 * prototype's `state/controller.ts`.
 *
 * Effects show at once: an action patches the row optimistically, the patch stays until the
 * source reports that task again (or a short grace after the action resolves), and an action
 * that rejects drops the patch, so the row is back as it was, and says so.
 */

import {
  focusAfterRemoval,
  focusKeys,
  moveFocus,
  treeStep,
  type FocusMove,
} from "@/lib/task-list/model/focus";
import { holdLayout, isHeld, orderSignature, SETTLE_WINDOW_MS } from "@/lib/task-list/model/order";
import {
  buildLayout,
  findRow,
  matchesFilters,
  rowKeys,
  shelfKey,
  type Filters,
  type Layout,
  type LayoutOptions,
  type Ordering,
  type ShelfID,
} from "@/lib/task-list/model/sections";
import {
  NO_SELECTION,
  extendSelection,
  pruneSelection,
  selectRange,
  toggleSelection,
  type Selection,
} from "@/lib/task-list/model/selection";
import {
  canSettle,
  currentRequest,
  sameStatus,
  taskStatus,
  type TaskStatus,
} from "@/lib/task-list/model/status";
import {
  DEFAULT_VIEW,
  NO_EXPERIMENTS,
  resolveView,
  type ViewKnobs,
} from "@/lib/task-list/model/view";
import { tickClock } from "@/lib/task-list/clock";
import type { TaskListSnapshot, TaskListSource, TaskUndo } from "@/lib/task-list/source";
import { createStore, type Store } from "@/lib/task-list/store";
import type { Project, Server, Task } from "@/lib/task-list/types";
import type { TaskListPreferences } from "./preferences";

/** A request that appeared this recently ignores keys and clicks (the composer's guard). */
export const REQUEST_GUARD_MS = 1_500;
/** An answered row stays in "Needs you" this long, showing its new state, before it moves. */
export const ANSWER_LINGER_MS = 1_200;
/** After an action resolves, its optimistic patch waits this long for the source to catch up. */
export const OPTIMISTIC_GRACE_MS = 3_000;
const SETTLED_PAGE = 20;

export interface Notice {
  title: string;
  description?: string;
  type?: "success" | "error" | "info";
  undo?: () => void | Promise<void>;
}

export interface TaskListState {
  /** Source tasks with the list's optimistic patches and lingers applied. */
  tasks: Readonly<Record<string, Task>>;
  statuses: Readonly<Record<string, TaskStatus>>;
  servers: readonly Server[];
  projects: readonly Project[];
  options: LayoutOptions;
  view: ViewKnobs;
  /** The layout on screen: the live layout with the held order applied. */
  layout: Layout;
  held: boolean;
  openTaskID: string | null;
  hasOlder: boolean;
  loadingOlder: boolean;
  focusKey: string | null;
  /** Bumped when DOM focus should follow `focusKey` (keyboard moves, after an action). */
  focusRequest: number;
  /**
   * Scroll this task's row into view without moving focus: set when the app opens a task the
   * list did not (the palette, a route, a notification), and for the open task on mount.
   */
  scrollRequest: { key: string; seq: number } | null;
  keyboardFocus: boolean;
  selection: Selection;
  quickLook: string | null;
  /** Rows the snooze menu acts on, opened with S, the row's clock or the bulk bar. */
  snoozeMenu: { keys: string[]; anchor: string } | null;
  renaming: string | null;
  menuKey: string | null;
  /** Mod held for 200 ms: the first nine rows show their numbers. */
  numbersShown: boolean;
  jumpKeys: readonly string[];
  /** A or D pressed during the guard; the row says so briefly. */
  guarded: { key: string; at: number } | null;
}

export interface ControllerSettings {
  preferences: TaskListPreferences;
  columnPx: number;
  /** Called when the person changes a preference, so the app can remember it. */
  onPreferencesChange?(preferences: TaskListPreferences): void;
}

interface Overlay {
  /** The source's task when the patch was made; a different object means the source moved on. */
  base: Task;
  patch: Partial<Task>;
  pending: number;
  timer: number | null;
}

const EMPTY_LAYOUT: Layout = { entries: [], shelves: [], attention: 0 };

export class TaskListController {
  readonly store: Store<TaskListState>;
  private pointerInside = false;
  private lastChangeAt = 0;
  private liveSignature = "";
  private releaseTimer: number | null = null;
  private interval: number | null = null;
  private timers = new Set<number>();
  private unsubscribe: (() => void) | null = null;
  private disposed = true;
  private columnPx: number;
  private preferences: TaskListPreferences;
  private readonly onPreferencesChange?: (preferences: TaskListPreferences) => void;
  private snapshot: TaskListSnapshot;
  private overlays = new Map<string, Overlay>();
  private lingers = new Map<string, number>();
  private merged = new Map<
    string,
    { source: Task; patch: Partial<Task> | null; linger: number | null; hidden: number; task: Task }
  >();
  /** Requests the server accepted a reply for; hidden until the source drops them. */
  private answered = new Set<string>();
  /** When the list first saw each request; the guard counts from the later of this and its arrival. */
  private requestSeenAt = new Map<string, number>();

  constructor(
    readonly source: TaskListSource,
    settings: ControllerSettings,
    private readonly notify: (notice: Notice) => void,
  ) {
    this.preferences = settings.preferences;
    this.onPreferencesChange = settings.onPreferencesChange;
    this.columnPx = settings.columnPx;
    this.snapshot = source.getSnapshot();
    // Requests already waiting when the list mounts did not just appear: only their arrival counts.
    for (const task of this.snapshot.tasks)
      for (const request of task.requests) this.requestSeenAt.set(request.id, request.arrivedAt);
    const prefs = settings.preferences;
    const resolved = resolveView(prefs.view, NO_EXPERIMENTS, settings.columnPx);
    const options: LayoutOptions = {
      ...resolved,
      ordering: prefs.ordering,
      showSnoozed: prefs.showSnoozed,
      showSettled: prefs.showSettled,
      collapsed: prefs.collapsed,
      shelves: prefs.shelves,
      settledLimit: SETTLED_PAGE,
      filters: prefs.filters,
    };
    this.store = createStore<TaskListState>({
      tasks: this.mergeTasks(),
      statuses: {},
      servers: this.snapshot.servers,
      projects: this.snapshot.projects,
      options,
      view: prefs.view,
      layout: EMPTY_LAYOUT,
      held: false,
      openTaskID: this.snapshot.openTaskID,
      hasOlder: this.snapshot.hasOlder,
      loadingOlder: this.snapshot.loadingOlder,
      focusKey: this.snapshot.openTaskID,
      focusRequest: 0,
      scrollRequest: this.snapshot.openTaskID ? { key: this.snapshot.openTaskID, seq: 1 } : null,
      keyboardFocus: false,
      selection: NO_SELECTION,
      quickLook: null,
      snoozeMenu: null,
      renaming: null,
      menuKey: null,
      numbersShown: false,
      jumpKeys: [],
      guarded: null,
    });
    this.recompute(true);
  }

  /** Safe to call again after `dispose` (React's strict mode remounts effects). */
  start() {
    if (!this.disposed) return;
    this.disposed = false;
    this.unsubscribe = this.source.subscribe(() => this.syncSource());
    this.syncSource();
    tickClock();
    this.interval = window.setInterval(() => {
      tickClock();
      this.recompute();
    }, 1_000);
  }

  dispose() {
    this.disposed = true;
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (this.interval !== null) window.clearInterval(this.interval);
    this.interval = null;
    for (const timer of this.timers) window.clearTimeout(timer);
    this.timers.clear();
    for (const overlay of this.overlays.values())
      if (overlay.timer !== null) window.clearTimeout(overlay.timer);
    if (this.releaseTimer !== null) window.clearTimeout(this.releaseTimer);
    this.releaseTimer = null;
  }

  get state() {
    return this.store.get();
  }

  private later(callback: () => void, ms: number): number {
    const timer = window.setTimeout(() => {
      this.timers.delete(timer);
      if (!this.disposed) callback();
    }, ms);
    this.timers.add(timer);
    return timer;
  }

  // Source ----------------------------------------------------------------------------------

  private syncSource() {
    const previous = this.snapshot;
    const next = this.source.getSnapshot();
    this.snapshot = next;
    if (next.tasks !== previous.tasks) {
      // A task the source reported again ends its patch, unless an action on it is still out.
      const byID = new Map(next.tasks.map((task) => [task.id, task]));
      for (const [id, overlay] of this.overlays) {
        const task = byID.get(id);
        if (!task) this.dropOverlay(id);
        else if (task !== overlay.base) {
          if (overlay.pending === 0) this.dropOverlay(id);
          else overlay.base = task;
        }
      }
    }
    // A task the list opened itself is already its open task; anything else came from the app
    // and gets scrolled to.
    const openedElsewhere =
      next.openTaskID !== previous.openTaskID &&
      next.openTaskID !== null &&
      next.openTaskID !== this.state.openTaskID;
    this.store.set((state) => ({
      tasks: this.mergeTasks(),
      servers: next.servers,
      projects: next.projects,
      hasOlder: next.hasOlder,
      loadingOlder: next.loadingOlder,
      // A new open task from the app wins; otherwise keep the one the list just opened.
      ...(next.openTaskID !== previous.openTaskID ? { openTaskID: next.openTaskID } : {}),
      ...(openedElsewhere
        ? {
            scrollRequest: {
              key: next.openTaskID!,
              seq: (state.scrollRequest?.seq ?? 0) + 1,
            },
          }
        : {}),
    }));
    this.recompute();
  }

  /**
   * Source tasks with patches, lingers and answered requests hidden; an untouched task keeps
   * the source's object, and a touched one keeps its merged object while nothing changed.
   */
  private mergeTasks(): Record<string, Task> {
    const tasks: Record<string, Task> = {};
    const seen = new Set<string>();
    const requests = new Set<string>();
    for (const source of this.snapshot.tasks) {
      seen.add(source.id);
      let hidden = 0;
      for (const request of source.requests) {
        requests.add(request.id);
        if (!this.requestSeenAt.has(request.id)) this.requestSeenAt.set(request.id, Date.now());
        if (this.answered.has(request.id)) hidden += 1;
      }
      const patch = this.overlays.get(source.id)?.patch ?? null;
      const linger = this.lingers.get(source.id) ?? null;
      if (!patch && linger === null && hidden === 0) {
        this.merged.delete(source.id);
        tasks[source.id] = source;
        continue;
      }
      const cached = this.merged.get(source.id);
      if (
        cached &&
        cached.source === source &&
        cached.patch === patch &&
        cached.linger === linger &&
        cached.hidden === hidden
      ) {
        tasks[source.id] = cached.task;
        continue;
      }
      let task: Task = { ...source, ...patch };
      if (linger !== null) task.lingerUntil = linger;
      if (hidden > 0) {
        // A reply the server took but has not reported yet never shows its request again.
        const pending = task.requests.filter((request) => !this.answered.has(request.id));
        task = {
          ...task,
          requests: pending,
          requestIndex: Math.min(task.requestIndex, Math.max(0, pending.length - 1)),
        };
      }
      this.merged.set(source.id, { source, patch, linger, hidden, task });
      tasks[source.id] = task;
    }
    for (const id of this.merged.keys()) if (!seen.has(id)) this.merged.delete(id);
    for (const id of this.requestSeenAt.keys())
      if (!requests.has(id)) this.requestSeenAt.delete(id);
    for (const id of this.answered) if (!requests.has(id)) this.answered.delete(id);
    return tasks;
  }

  private refreshTasks() {
    this.store.set({ tasks: this.mergeTasks() });
  }

  private patch(ids: readonly string[], patch: (task: Task) => Partial<Task>) {
    for (const id of ids) {
      const base = this.snapshot.tasks.find((task) => task.id === id);
      const current = this.state.tasks[id];
      if (!base || !current) continue;
      const overlay = this.overlays.get(id);
      const next = patch(current);
      if (overlay) {
        if (overlay.timer !== null) window.clearTimeout(overlay.timer);
        overlay.timer = null;
        overlay.patch = { ...overlay.patch, ...next };
        overlay.pending += 1;
      } else this.overlays.set(id, { base, patch: next, pending: 1, timer: null });
    }
    this.refreshTasks();
  }

  private dropOverlay(id: string) {
    const overlay = this.overlays.get(id);
    if (!overlay) return;
    if (overlay.timer !== null) window.clearTimeout(overlay.timer);
    this.overlays.delete(id);
  }

  private settleOverlays(ids: readonly string[], ok: boolean) {
    for (const id of ids) {
      const overlay = this.overlays.get(id);
      if (!overlay) continue;
      if (!ok) {
        this.dropOverlay(id);
        continue;
      }
      overlay.pending = Math.max(0, overlay.pending - 1);
      if (overlay.pending > 0) continue;
      const current = this.snapshot.tasks.find((task) => task.id === id);
      if (current && current !== overlay.base) {
        this.dropOverlay(id);
        continue;
      }
      overlay.timer = window.setTimeout(() => {
        if (this.overlays.get(id) !== overlay) return;
        this.overlays.delete(id);
        this.refreshTasks();
        this.recompute();
      }, OPTIMISTIC_GRACE_MS);
    }
    if (!this.disposed) {
      this.refreshTasks();
      this.recompute();
    }
  }

  /**
   * Runs one effect: the optimistic patch now, the source's action, then the patch's release.
   * A rejection restores the rows and shows `failure`; a resolved undo (or `fallbackUndo`)
   * becomes the notice's Undo.
   */
  private run<T>(
    ids: readonly string[],
    patch: ((task: Task) => Partial<Task>) | null,
    action: () => Promise<T>,
    report: { failure: string; notice?: (result: T) => Notice | null },
  ): Promise<void> {
    if (patch) {
      this.patch(ids, patch);
      this.recompute();
    }
    let promise: Promise<T>;
    try {
      promise = Promise.resolve(action());
    } catch (error) {
      promise = Promise.reject(error);
    }
    return promise.then(
      (result) => {
        this.settleOverlays(ids, true);
        const notice = report.notice?.(result);
        if (notice) this.notify(notice);
      },
      (error: unknown) => {
        this.settleOverlays(ids, false);
        this.notify({
          type: "error",
          title: report.failure,
          description: error instanceof Error ? error.message : undefined,
        });
      },
    );
  }

  // Derivation ------------------------------------------------------------------------------

  private statusContext(task: Task, now: number) {
    const server = this.state.servers.find((candidate) => candidate.id === task.serverID);
    return {
      now,
      // Not a setting: a row says what the agent is doing whenever the source knows.
      liveDetail: true,
      serverOnline: server?.online ?? true,
      serverLastSeenAt: server?.lastSeenAt ?? null,
    };
  }

  /**
   * Statuses, the live layout, the hold and focus, in one pass. Unchanged statuses keep their
   * object, so a row whose task did not change never re-renders.
   */
  recompute(force = false) {
    const now = Date.now();
    const state = this.state;
    let statusesChanged = false;
    const statuses: Record<string, TaskStatus> = {};
    for (const task of Object.values(state.tasks)) {
      const next = taskStatus(task, this.statusContext(task, now));
      const previous = state.statuses[task.id];
      if (previous && sameStatus(previous, next)) statuses[task.id] = previous;
      else {
        statuses[task.id] = next;
        statusesChanged = true;
      }
    }
    if (Object.keys(statuses).length !== Object.keys(state.statuses).length) statusesChanged = true;

    const live = buildLayout({
      tasks: Object.values(state.tasks),
      statuses,
      projects: state.projects,
      servers: state.servers,
      now,
      options: state.options,
    });
    const signature = orderSignature(live);
    if (signature !== this.liveSignature) {
      this.liveSignature = signature;
      this.lastChangeAt = now;
      this.scheduleRelease();
    }
    const held = isHeld({
      pointerInside: this.pointerInside,
      keyboardInside: state.keyboardFocus,
      now,
      lastChangeAt: force ? 0 : this.lastChangeAt,
    });
    const layout = held && state.layout.entries.length ? holdLayout(state.layout, live) : live;
    const sameLayout = layoutSignature(layout) === layoutSignature(state.layout);

    const keys = focusKeys(sameLayout ? state.layout : layout);
    let focusKey = state.focusKey;
    let focusRequest = state.focusRequest;
    if (focusKey === null || (state.layout.entries.length === 0 && !keys.includes(focusKey)))
      focusKey = keys[0] ?? null;
    else if (!keys.includes(focusKey)) {
      focusKey = focusAfterRemoval(focusKeys(state.layout), focusKey, keys);
      focusRequest += 1;
    }
    const rows = new Set(rowKeys(layout));
    const selection = pruneSelection(state.selection, rows);
    const jump = rowKeys(sameLayout ? state.layout : layout).slice(0, 9);

    this.store.set({
      ...(statusesChanged || force ? { statuses } : {}),
      ...(sameLayout ? {} : { layout }),
      held,
      focusKey,
      focusRequest,
      selection,
      jumpKeys: sameKeys(jump, state.jumpKeys) ? state.jumpKeys : jump,
      quickLook: state.quickLook && rows.has(state.quickLook) ? state.quickLook : null,
    });
  }

  private scheduleRelease() {
    if (this.releaseTimer !== null) window.clearTimeout(this.releaseTimer);
    this.releaseTimer = window.setTimeout(() => {
      this.releaseTimer = null;
      if (!this.disposed) this.recompute();
    }, SETTLE_WINDOW_MS + 20);
  }

  // Pointer and focus inside the list --------------------------------------------------------

  setPointerInside(inside: boolean) {
    if (this.pointerInside === inside) return;
    this.pointerInside = inside;
    this.recompute();
  }

  /** Keyboard focus on a row holds the order; focus from a click does not. */
  setKeyboardFocus(value: boolean) {
    if (this.state.keyboardFocus === value) return;
    this.store.set({ keyboardFocus: value });
    this.recompute();
  }

  focus(key: string, keyboard: boolean) {
    this.store.set({ focusKey: key, keyboardFocus: keyboard });
  }

  /** Puts DOM focus back on a row, after a field inside it closes. */
  focusRow(key: string) {
    this.store.set({ focusKey: key });
    this.requestFocus(true);
  }

  private requestFocus(keyboard: boolean) {
    this.store.set((state) => ({ focusRequest: state.focusRequest + 1, keyboardFocus: keyboard }));
  }

  move(move: FocusMove) {
    const keys = focusKeys(this.state.layout);
    const next = moveFocus(keys, this.state.focusKey, move);
    if (!next) return;
    this.store.set({ focusKey: next, quickLook: null });
    this.requestFocus(true);
  }

  /** Left/Right on the focused key: collapse, expand, or step to the parent header. */
  step(direction: "left" | "right") {
    const key = this.state.focusKey;
    if (!key) return;
    const step = treeStep(this.state.layout, key, direction);
    if (step.type === "focus") {
      this.store.set({ focusKey: step.key });
      this.requestFocus(true);
    } else if (step.type === "toggle") this.toggleGroup(step.key, step.open);
  }

  extend(direction: 1 | -1) {
    const key = this.state.focusKey;
    const order = rowKeys(this.state.layout);
    if (!key || !order.includes(key)) return this.move(direction === 1 ? "next" : "previous");
    const result = extendSelection(this.state.selection, order, key, direction);
    this.store.set({ selection: result.selection, focusKey: result.focus });
    this.requestFocus(true);
  }

  // Groups, sections and preferences ---------------------------------------------------------

  toggleGroup(key: string, open?: boolean) {
    const shelves = this.state.options.shelves;
    const shelfID = (Object.keys(shelves) as ShelfID[]).find((id) => shelfKey(id) === key);
    if (shelfID) {
      this.updatePreferences({ shelves: { ...shelves, [shelfID]: open ?? !shelves[shelfID] } });
      return;
    }
    const collapsed = new Set(this.state.options.collapsed);
    const shouldOpen = open ?? collapsed.has(key);
    if (shouldOpen) collapsed.delete(key);
    else collapsed.add(key);
    this.updatePreferences({ collapsed: [...collapsed] });
  }

  setAllGroups(open: boolean) {
    const groups = this.state.layout.entries.flatMap((entry) =>
      entry.type === "group" ? [entry.key] : [],
    );
    this.updatePreferences({
      collapsed: open ? [] : groups,
      shelves: { pinned: open, working: open, snoozed: open, settled: open },
    });
  }

  setView(view: Partial<ViewKnobs>) {
    this.updatePreferences({ view: { ...this.preferences.view, ...view } });
  }

  resetView() {
    this.updatePreferences({ view: DEFAULT_VIEW });
  }

  setOrdering(ordering: Ordering) {
    this.updatePreferences({ ordering });
  }

  setFilters(update: (filters: Filters) => Filters) {
    this.updatePreferences({ filters: update(this.preferences.filters) });
  }

  setShow(patch: { showSnoozed?: boolean; showSettled?: boolean }) {
    this.updatePreferences(patch);
  }

  /** A person's change: applied and reported to the app. */
  private updatePreferences(patch: Partial<TaskListPreferences>) {
    const next = { ...this.preferences, ...patch };
    this.applyPreferences(next);
    this.onPreferencesChange?.(next);
  }

  /** The app's stored preferences, or the column width, changed; equal values change nothing. */
  setPreferences(preferences: TaskListPreferences, columnPx = this.columnPx) {
    if (samePreferences(preferences, this.preferences) && columnPx === this.columnPx) return;
    this.columnPx = columnPx;
    this.applyPreferences(preferences);
  }

  private applyPreferences(preferences: TaskListPreferences) {
    this.preferences = preferences;
    const resolved = resolveView(preferences.view, NO_EXPERIMENTS, this.columnPx);
    const options = this.state.options;
    const next: LayoutOptions = {
      ...options,
      ...resolved,
      ordering: preferences.ordering,
      showSnoozed: preferences.showSnoozed,
      showSettled: preferences.showSettled,
      filters: sameFilters(options.filters, preferences.filters)
        ? options.filters
        : preferences.filters,
      shelves: sameRecord(options.shelves, preferences.shelves)
        ? options.shelves
        : preferences.shelves,
      collapsed: sameKeys(options.collapsed, preferences.collapsed)
        ? options.collapsed
        : preferences.collapsed,
    };
    const view = sameRecord(this.state.view, preferences.view) ? this.state.view : preferences.view;
    if (sameRecord(options, next) && view === this.state.view) return;
    this.store.set({ options: sameRecord(options, next) ? options : next, view });
    this.recompute();
  }

  loadOlder() {
    const options = this.state.options;
    if (!options.shelves.settled || !options.showSettled)
      this.updatePreferences({
        shelves: { ...options.shelves, settled: true },
        showSettled: true,
      });
    const loaded = this.state.layout.entries.find(
      (entry) => entry.type === "more" && entry.shelf === "settled",
    );
    if (loaded) {
      // Settled tasks already here come first; the source only when they run out.
      this.store.set((state) => ({
        options: { ...state.options, settledLimit: state.options.settledLimit + SETTLED_PAGE },
      }));
      this.recompute();
      return;
    }
    this.source.actions.loadOlder();
  }

  // Task actions ----------------------------------------------------------------------------

  /**
   * Moves focus to the row after the acted one, so a keyboard pass never has to look for its
   * place again. `prefer` narrows the candidates (the next "Needs you" row after an answer).
   */
  private advanceFocus(
    keys: readonly string[],
    before: readonly string[],
    prefer?: (key: string) => boolean,
  ) {
    const focused = this.state.focusKey;
    if (focused === null || !keys.includes(focused)) return;
    const after = focusKeys(this.state.layout);
    const index = before.indexOf(focused);
    const candidate = (key: string) => after.includes(key) && !keys.includes(key);
    const pick = (test: (key: string) => boolean) =>
      before.slice(index + 1).find(test) ?? before.slice(0, index).reverse().find(test);
    const next =
      (prefer ? pick((key) => candidate(key) && prefer(key)) : undefined) ??
      pick(candidate) ??
      (after.includes(focused) ? focused : (after[0] ?? null));
    this.store.set({ focusKey: next });
    this.requestFocus(this.state.keyboardFocus);
  }

  private act<T>(
    keys: readonly string[],
    patch: ((task: Task) => Partial<Task>) | null,
    action: () => Promise<T>,
    report: { failure: string; notice?: (result: T) => Notice | null },
    options: { advance?: boolean; prefer?: (key: string) => boolean } = {},
  ): Promise<void> {
    const before = focusKeys(this.state.layout);
    const done = this.run(keys, patch, action, report);
    this.recompute();
    if (options.advance !== false) this.advanceFocus(keys, before, options.prefer);
    return done;
  }

  open(id: string, options?: { newWindow?: boolean; background?: boolean }) {
    // Before the source hears of it, so its echo is not mistaken for the app opening a task.
    if (!options?.newWindow)
      this.store.set({ openTaskID: id, quickLook: null, selection: NO_SELECTION });
    this.source.actions.open(id, options);
  }

  settle(keys: readonly string[]) {
    const ids = keys.filter((key) => this.state.tasks[key] && canSettle(this.state.tasks[key]!));
    if (ids.length === 0) {
      this.notify({ title: "Nothing to settle", description: "Working and waiting tasks stay." });
      return Promise.resolve();
    }
    const title =
      ids.length === 1
        ? `Settled “${this.state.tasks[ids[0]!]!.title}”`
        : `Settled ${ids.length} tasks`;
    const now = Date.now();
    this.store.set({ selection: NO_SELECTION });
    return this.act(
      ids,
      () => ({ settledAt: now, unread: false, pinnedAt: null, snoozedUntil: null }),
      () => this.source.actions.settle(ids),
      {
        failure: ids.length === 1 ? "Could not settle the task" : "Could not settle the tasks",
        notice: (undo) => ({
          type: "success",
          title,
          undo: this.undoWith(undo, () =>
            Promise.all(ids.map((id) => this.source.actions.unsettle(id))),
          ),
        }),
      },
    );
  }

  snooze(keys: readonly string[], until: number) {
    const ids = keys.filter((key) => this.state.tasks[key]);
    this.store.set({ selection: NO_SELECTION, snoozeMenu: null });
    if (ids.length === 0) return Promise.resolve();
    const choice = new Intl.DateTimeFormat(undefined, {
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
    }).format(until);
    return this.act(
      ids,
      () => ({ snoozedUntil: until, pinnedAt: null }),
      () => this.source.actions.snooze(ids, until),
      {
        failure: "Could not snooze",
        notice: (undo) => ({
          type: "success",
          title: ids.length === 1 ? "Snoozed" : `Snoozed ${ids.length} tasks`,
          description: `Back ${choice}`,
          undo: this.undoWith(undo, () =>
            Promise.all(ids.map((id) => this.source.actions.wake(id))),
          ),
        }),
      },
    );
  }

  /** The S key, the row's clock and the bulk bar open the snooze menu. */
  openSnoozeMenu(keys: string[], anchor: string) {
    this.store.set({ snoozeMenu: { keys, anchor } });
  }

  closeSnoozeMenu() {
    if (this.state.snoozeMenu) this.store.set({ snoozeMenu: null });
  }

  wake(key: string) {
    const until = this.state.tasks[key]?.snoozedUntil ?? null;
    return this.act(
      [key],
      () => ({ snoozedUntil: null, activityAt: Date.now() }),
      () => this.source.actions.wake(key),
      {
        failure: "Could not wake the task",
        notice: () => ({
          type: "success",
          title: "Woken",
          undo:
            until !== null
              ? () => this.source.actions.snooze([key], until).then(() => {})
              : undefined,
        }),
      },
    );
  }

  unsettle(key: string) {
    return this.act(
      [key],
      () => ({ settledAt: null }),
      () => this.source.actions.unsettle(key),
      {
        failure: "Could not move the task back",
        notice: () => ({
          type: "success",
          title: "Moved back to the inbox",
          undo: () => this.source.actions.settle([key]).then(() => {}),
        }),
      },
    );
  }

  togglePin(key: string) {
    const task = this.state.tasks[key];
    if (!task) return Promise.resolve();
    const pinned = task.pinnedAt === null;
    const now = Date.now();
    return this.act(
      [key],
      () => (pinned ? { pinnedAt: now, settledAt: null, snoozedUntil: null } : { pinnedAt: null }),
      () => this.source.actions.setPinned(key, pinned),
      {
        failure: pinned ? "Could not pin the task" : "Could not unpin the task",
        notice: (undo) => ({
          type: "success",
          title: pinned ? "Pinned" : "Unpinned",
          undo: this.undoWith(undo, () => this.source.actions.setPinned(key, !pinned)),
        }),
      },
    );
  }

  toggleUnread(key: string) {
    const task = this.state.tasks[key];
    if (!task) return Promise.resolve();
    return this.setUnread([key], !task.unread);
  }

  setUnread(keys: readonly string[], unread: boolean) {
    const ids = keys.filter((key) => this.state.tasks[key]);
    const previous = new Map(ids.map((id) => [id, this.state.tasks[id]!.unread]));
    this.store.set({ selection: NO_SELECTION });
    if (ids.length === 0) return Promise.resolve();
    return this.act(
      ids,
      () => ({ unread }),
      () => this.source.actions.setUnread(ids, unread),
      {
        failure: unread ? "Could not mark as unread" : "Could not mark as read",
        notice: () => ({
          type: "success",
          title:
            ids.length === 1
              ? unread
                ? "Marked as unread"
                : "Marked as read"
              : `Marked ${ids.length} tasks as ${unread ? "unread" : "read"}`,
          undo: () => {
            const back = ids.filter((id) => previous.get(id) !== unread);
            return back.length ? this.source.actions.setUnread(back, !unread) : undefined;
          },
        }),
      },
      { advance: ids.length === 1 },
    );
  }

  /** Unread tasks that pass the current filters, whatever section they sit in. */
  unreadInView(): string[] {
    return unreadInView(this.state);
  }

  /** "Mark all as read": every unread task in the current filter, with one undo. */
  markAllRead() {
    const ids = this.unreadInView();
    if (ids.length === 0) return Promise.resolve();
    return this.setUnread(ids, false);
  }

  stop(key: string) {
    const task = this.state.tasks[key];
    if (!task?.run) return Promise.resolve();
    const now = Date.now();
    return this.run(
      [key],
      () => ({
        run: null,
        runEndedAt: now,
        stopped: true,
        activityAt: now,
        requests: [],
        subagents: 0,
      }),
      () => this.source.actions.stop(key),
      { failure: "Could not stop the task", notice: () => ({ title: `Stopped “${task.title}”` }) },
    );
  }

  retry(key: string) {
    const now = Date.now();
    this.linger(key);
    return this.act(
      [key],
      () => ({
        failure: null,
        stopped: false,
        run: { startedAt: now, lastUpdateAt: now, detail: "Retrying the last step" },
        activityAt: now,
      }),
      () => this.source.actions.retry(key),
      { failure: "Could not retry" },
      { prefer: (other) => this.inNeedsYou(other) },
    );
  }

  /** The guard counts from the later of the request's arrival and when the list first saw it. */
  armedAt(requestID: string, arrivedAt: number): number {
    return Math.max(arrivedAt, this.requestSeenAt.get(requestID) ?? arrivedAt) + REQUEST_GUARD_MS;
  }

  private guardPassed(task: Task): boolean {
    const request = currentRequest(task);
    return !request || Date.now() >= this.armedAt(request.id, request.arrivedAt);
  }

  private inNeedsYou(key: string): boolean {
    return findRow(this.state.layout, key)?.placement === "needs-you";
  }

  /** An answered row stays in "Needs you", showing its new state, then moves on. */
  private linger(key: string) {
    this.lingers.set(key, Date.now() + ANSWER_LINGER_MS);
    this.later(() => {
      this.lingers.delete(key);
      this.refreshTasks();
      this.recompute();
    }, ANSWER_LINGER_MS + 30);
  }

  /** Answers the current request on the server that owns it. */
  private resolveRequest(
    key: string,
    detail: string | null,
    reply: (requestID: string) => Promise<void>,
    labels: { done: string; failure: string },
  ) {
    const task = this.state.tasks[key];
    const request = task && currentRequest(task);
    if (!task || !request) return Promise.resolve();
    const now = Date.now();
    const requests = task.requests.filter((candidate) => candidate.id !== request.id);
    if (requests.length === 0) this.linger(key);
    return this.act(
      [key],
      (current) => ({
        requests,
        requestIndex: Math.min(current.requestIndex, Math.max(0, requests.length - 1)),
        run: current.run
          ? { ...current.run, lastUpdateAt: now, detail: detail ?? current.run.detail }
          : { startedAt: now, lastUpdateAt: now, detail },
      }),
      () =>
        reply(request.id).then(() => {
          this.answered.add(request.id);
        }),
      { failure: labels.failure, notice: () => ({ title: labels.done }) },
      { advance: requests.length === 0, prefer: (other) => this.inNeedsYou(other) },
    );
  }

  allow(key: string, options: { always?: boolean } = {}) {
    const task = this.state.tasks[key];
    const request = task && currentRequest(task);
    if (!task || request?.kind !== "permission") return Promise.resolve();
    if (!this.guardPassed(task)) return Promise.resolve(this.guard(key));
    const always = Boolean(options.always && request.rule);
    return this.resolveRequest(
      key,
      `Running ${request.summary}`,
      (requestID) =>
        this.source.actions.replyPermission(key, requestID, always ? "always" : "once"),
      {
        done: always ? `Always allowed ${request.rule}` : `Allowed ${request.summary}`,
        failure: "Could not allow the request",
      },
    );
  }

  deny(key: string) {
    const task = this.state.tasks[key];
    const request = task && currentRequest(task);
    if (!task || request?.kind !== "permission") return Promise.resolve();
    if (!this.guardPassed(task)) return Promise.resolve(this.guard(key));
    return this.resolveRequest(
      key,
      "Handling the answer",
      (requestID) => this.source.actions.replyPermission(key, requestID, "reject"),
      { done: `Denied ${request.summary}`, failure: "Could not deny the request" },
    );
  }

  answer(key: string, text: string) {
    const task = this.state.tasks[key];
    const request = task && currentRequest(task);
    if (!task || request?.kind !== "question") return Promise.resolve();
    if (!this.guardPassed(task)) return Promise.resolve(this.guard(key));
    return this.resolveRequest(
      key,
      "Continuing with your answer",
      (requestID) => this.source.actions.replyQuestion(key, requestID, text),
      { done: `Answered “${text}”`, failure: "Could not send the answer" },
    );
  }

  /** "1 of 3": which pending request the row shows is list state, kept as a patch. */
  pageRequest(key: string, delta: 1 | -1) {
    const task = this.state.tasks[key];
    if (!task || task.requests.length < 2) return;
    const count = task.requests.length;
    const base = this.snapshot.tasks.find((candidate) => candidate.id === key);
    if (!base) return;
    const overlay = this.overlays.get(key);
    const requestIndex = (task.requestIndex + delta + count) % count;
    if (overlay) overlay.patch = { ...overlay.patch, requestIndex };
    else this.overlays.set(key, { base, patch: { requestIndex }, pending: 0, timer: null });
    this.refreshTasks();
    this.recompute();
  }

  private guard(key: string) {
    const at = Date.now();
    this.store.set({ guarded: { key, at } });
    this.later(() => {
      if (this.state.guarded?.at === at) this.store.set({ guarded: null });
    }, 1_600);
  }

  rename(key: string, title: string) {
    const trimmed = title.trim();
    const previous = this.state.tasks[key]?.title;
    this.store.set({ renaming: null });
    if (!trimmed || trimmed === previous || previous === undefined) return Promise.resolve();
    return this.run(
      [key],
      () => ({ title: trimmed }),
      () => this.source.actions.rename(key, trimmed),
      {
        failure: "Could not rename the task",
        notice: () => ({
          type: "success",
          title: "Renamed",
          undo: () => this.source.actions.rename(key, previous),
        }),
      },
    );
  }

  startRename(key: string | null) {
    this.store.set({ renaming: key });
  }

  requestDelete(key: string) {
    this.source.actions.requestDelete(key);
  }

  startTask(projectID?: string | null) {
    this.source.actions.startTask(projectID);
  }

  reconnect(serverID?: string) {
    this.source.actions.reconnect(serverID);
  }

  /** The source's undo when it gave one, else the inverse action. */
  private undoWith(undo: TaskUndo | null, inverse: () => Promise<unknown>): () => Promise<void> {
    return async () => {
      try {
        if (undo) await undo();
        else await inverse();
      } catch (error) {
        this.notify({
          type: "error",
          title: "Could not undo",
          description: error instanceof Error ? error.message : undefined,
        });
      }
    };
  }

  // Selection, quick look and numbers ---------------------------------------------------------

  toggleSelect(key: string) {
    this.store.set((state) => ({
      selection: toggleSelection(state.selection, key),
      focusKey: key,
    }));
  }

  selectTo(key: string) {
    const from = this.state.focusKey ?? this.state.openTaskID;
    this.store.set((state) => ({
      selection: selectRange(state.selection, rowKeys(state.layout), key, from),
      focusKey: key,
    }));
  }

  clearSelection() {
    this.store.set({ selection: NO_SELECTION });
  }

  setQuickLook(key: string | null) {
    this.store.set({ quickLook: key });
  }

  setMenuKey(key: string | null) {
    if (this.state.menuKey !== key) this.store.set({ menuKey: key });
  }

  showNumbers(shown: boolean) {
    if (this.state.numbersShown !== shown) this.store.set({ numbersShown: shown });
  }

  jumpTo(index: number) {
    const key = this.state.jumpKeys[index - 1];
    if (!key) return;
    this.open(key);
    this.store.set({ focusKey: key });
    this.requestFocus(true);
  }

  /** Alt+Up/Down: the previous or next task in list order, opened. */
  openAdjacent(delta: 1 | -1) {
    const order = rowKeys(this.state.layout);
    if (order.length === 0) return;
    const index = order.indexOf(this.state.openTaskID ?? "");
    const next = order[index === -1 ? 0 : (index + delta + order.length) % order.length]!;
    this.open(next);
    this.store.set({ focusKey: next });
    this.requestFocus(this.state.keyboardFocus);
  }

  /** Every row in list order, as shown; settling the open task opens the one after it. */
  listOrder(): readonly string[] {
    return rowKeys(this.state.layout);
  }

  /** Focuses a task's row and scrolls it into view, without opening it (a notification asked). */
  reveal(id: string) {
    if (!focusKeys(this.state.layout).includes(id)) return;
    this.store.set({ focusKey: id });
    this.requestFocus(false);
  }

  /** Mod+Shift+S: settles the open task like E on its row; the source opens the next one. */
  settleOpen() {
    const open = this.state.openTaskID;
    if (open === null) return Promise.resolve();
    return this.settle([open]);
  }

  /** Mod+Alt+A: the next task in "Needs you" after the open one. */
  openNextNeedingYou() {
    const order = this.state.layout.entries.flatMap((entry) =>
      entry.type === "row" && entry.placement === "needs-you" ? [entry.key] : [],
    );
    if (order.length === 0) {
      this.notify({ title: "Nothing needs you" });
      return;
    }
    const index = order.indexOf(this.state.openTaskID ?? "");
    const next = order[(index + 1) % order.length]!;
    this.open(next);
    this.store.set({ focusKey: next });
    this.requestFocus(true);
  }
}

export function unreadInView(
  state: Pick<TaskListState, "tasks" | "statuses" | "options">,
): string[] {
  const ids: string[] = [];
  for (const task of Object.values(state.tasks)) {
    const status = state.statuses[task.id];
    if (task.unread && status && matchesFilters(task, status, state.options.filters))
      ids.push(task.id);
  }
  return ids;
}

function sameKeys(a: readonly string[], b: readonly string[]) {
  return a.length === b.length && a.every((key, index) => key === b[index]);
}

function sameRecord<T extends object>(a: T, b: T): boolean {
  const keys = Object.keys(a) as (keyof T)[];
  return keys.length === Object.keys(b).length && keys.every((key) => Object.is(a[key], b[key]));
}

function sameFilters(a: Filters, b: Filters): boolean {
  return a.project === b.project && a.server === b.server && sameKeys(a.states, b.states);
}

function samePreferences(a: TaskListPreferences, b: TaskListPreferences): boolean {
  return (
    sameRecord(a.view, b.view) &&
    a.ordering === b.ordering &&
    a.showSnoozed === b.showSnoozed &&
    a.showSettled === b.showSettled &&
    sameFilters(a.filters, b.filters) &&
    sameRecord(a.shelves, b.shelves) &&
    sameKeys(a.collapsed, b.collapsed)
  );
}

/** Everything about the layout that changes what is drawn, as one string. */
function layoutSignature(layout: Layout): string {
  const parts: string[] = [];
  for (const entry of layout.entries) {
    if (entry.type === "row")
      parts.push(
        `r${entry.key}|${entry.container}|${entry.placement}|${entry.lines}|${entry.depth}`,
      );
    else if (entry.type === "group")
      parts.push(
        `g${entry.key}|${entry.label}|${entry.open}|${entry.count}|${entry.rollup}|${entry.online}`,
      );
    else if (entry.type === "shelf")
      parts.push(`s${entry.key}|${entry.open}|${entry.count}|${entry.rollup}`);
    else if (entry.type === "more") parts.push(`m${entry.key}|${entry.count}`);
    else parts.push(`${entry.type}${entry.key}`);
  }
  // The docked Working shelf: its header and rows, apart from the main list.
  for (const shelf of layout.shelves) {
    parts.push(`d${shelf.key}|${shelf.open}|${shelf.count}|${shelf.rollup}`);
    for (const row of shelf.rows) parts.push(`r${row.key}|${row.placement}|${row.lines}`);
  }
  parts.push(`a${layout.attention}`);
  return parts.join("\n");
}
