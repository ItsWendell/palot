/**
 * Where every task goes. One pure pass turns tasks and their statuses into the list the
 * column renders: "Needs you" and "Pinned" on top in every grouping, then the inbox proper
 * (or project and server groups), and the Working, Snoozed and Settled sections in the same
 * scroll. Working can instead dock at the bottom of the column. No task is ever shown twice.
 */

import type { Project, Server, Task } from "../types";
import { STATUS_RANK, needsYou, type Placement, type StatusKind, type TaskStatus } from "./status";

export type Grouping = "inbox" | "project" | "server";
/**
 * Where working tasks go. `dock` (the default): a shelf docked at the bottom of the column,
 * outside the list's scroll, so running tasks stay visible. `after-inbox` and
 * `under-needs-you`: an ordinary collapsible section in the list's one scroll. `list`: working
 * rows sit in the inbox under the unseen ones. In every placement Snoozed and Settled are
 * in-flow sections at the end.
 */
export type WorkingPlacement = "dock" | "after-inbox" | "under-needs-you" | "list";
export type ApprovalLines = 3 | 4;

/**
 * How an idle, read row says where it belongs: not at all (`title`), the project name before
 * the time (`inline`), a small project mark before the title (`mark`), or a second line with
 * project and branch (`two`).
 */
export type IdleRows = "title" | "inline" | "mark" | "two";

/**
 * The idle form in effect. Grouped by project, the project is already the group header, so
 * every form falls back to the title; "Two lines" keeps its height and shows the branch.
 */
export function effectiveIdleRows(idleRows: IdleRows, grouping: Grouping): IdleRows {
  if (grouping !== "project") return idleRows;
  return idleRows === "two" ? "two" : "title";
}

export type Ordering = "activity" | "created";
export type ShelfID = "pinned" | "working" | "snoozed" | "settled";
export type StateFilter = "needs-you" | "working" | "unseen" | "failed";

export const CHATS = "chats";

export interface Filters {
  /** A project id, `CHATS` for chats without a project, or null for every project. */
  project: string | null;
  states: readonly StateFilter[];
  server: string | null;
}

export const NO_FILTERS: Filters = { project: null, states: [], server: null };

export interface LayoutOptions {
  grouping: Grouping;
  workingPlacement: WorkingPlacement;
  ordering: Ordering;
  showSnoozed: boolean;
  showSettled: boolean;
  /** Keys of collapsed project and server groups. */
  collapsed: readonly string[];
  shelves: Readonly<Record<ShelfID, boolean>>;
  /** How many settled tasks are loaded; the shelf offers more on demand. */
  settledLimit: number;
  filters: Filters;
  /** Approval rows: the command shares a line with the buttons (3), or gets its own (4). */
  approvalLines: ApprovalLines;
  idleRows: IdleRows;
}

/** A working task stays on the Working shelf this long after it stops, so step gaps never jump. */
export const WORKING_EXIT_GRACE_MS = 2_000;

export const SIZES = {
  heading: 28,
  group: 28,
  spacer: 8,
  empty: 72,
  row: { 1: 34, 2: 50, 3: 82, 4: 104 },
  more: 30,
} as const;

export type RowLines = 1 | 2 | 3 | 4;

export interface RowEntry {
  type: "row";
  key: string;
  /** The section, group or shelf the row belongs to; order is held per container. */
  container: string;
  placement: Placement;
  lines: RowLines;
  size: number;
  depth: number;
}

export interface GroupEntry {
  type: "group";
  key: string;
  kind: "project" | "server";
  label: string;
  open: boolean;
  count: number;
  /** The most urgent status inside, shown while the group is collapsed. */
  rollup: StatusKind | null;
  projectID: string | null;
  serverID: string;
  online: boolean;
  /** The server group around a project group, when grouped by server. */
  parent: string | null;
  depth: number;
  size: number;
}

/** The header of an in-flow Working, Snoozed or Settled section. */
export interface ShelfEntry {
  type: "shelf";
  key: string;
  id: ShelfID;
  label: string;
  open: boolean;
  count: number;
  rollup: StatusKind | null;
  size: number;
}

export type ListEntry =
  | { type: "heading"; key: string; label: string; size: number }
  | GroupEntry
  | ShelfEntry
  | { type: "more"; key: string; shelf: ShelfID; count: number; size: number }
  | RowEntry
  | { type: "spacer"; key: string; size: number }
  | { type: "empty"; key: string; text: string; size: number };

export interface ShelfLayout {
  id: ShelfID;
  key: string;
  label: string;
  open: boolean;
  count: number;
  rollup: StatusKind | null;
  rows: RowEntry[];
}

export interface Layout {
  entries: ListEntry[];
  /** Docked shelves: Working when it docks and something runs; otherwise empty. */
  shelves: ShelfLayout[];
  /** Tasks in "Needs you", for the rail dot. */
  attention: number;
}

export interface LayoutInput {
  tasks: readonly Task[];
  statuses: Readonly<Record<string, TaskStatus>>;
  projects: readonly Project[];
  servers: readonly Server[];
  now: number;
  options: LayoutOptions;
}

export const shelfKey = (id: ShelfID) => `shelf:${id}`;
export const moreKey = (id: ShelfID) => `more:${id}`;
export const projectGroupKey = (projectID: string | null, serverID?: string) =>
  `group:project:${serverID ? `${serverID}/` : ""}${projectID ?? CHATS}`;
export const serverGroupKey = (serverID: string) => `group:server:${serverID}`;

/** Where one task sits, before grouping. Attention wins over every other placement. */
export function placeTask(
  task: Task,
  status: TaskStatus,
  now: number,
  options: Pick<LayoutOptions, "grouping" | "workingPlacement">,
): Placement {
  if (needsYou(status.kind) || (task.lingerUntil !== null && now < task.lingerUntil))
    return "needs-you";
  if (task.pinnedAt !== null) return "pinned";
  if (task.snoozedUntil !== null && task.snoozedUntil > now) return "snoozed";
  if (task.settledAt !== null) return "settled";
  const working =
    task.run !== null ||
    (task.runEndedAt !== null && now - task.runEndedAt < WORKING_EXIT_GRACE_MS);
  if (working && options.grouping === "inbox" && options.workingPlacement !== "list")
    return "working";
  return "inbox";
}

export function rowLines(
  placement: Placement,
  status: TaskStatus,
  approvalLines: ApprovalLines = 3,
  idleRows: IdleRows = "title",
): RowLines {
  if (placement === "needs-you" && status.kind === "approval") return approvalLines;
  if (placement === "needs-you" && STATUS_RANK[status.kind] <= 3) return 3;
  if (placement === "snoozed") return 2;
  // Settled stays a compact archive in every idle form.
  if (placement === "settled") return 1;
  if (status.kind !== "idle") return 2;
  return idleRows === "two" ? 2 : 1;
}

/** Whether a task passes the project, server and state filters. */
export function matchesFilters(task: Task, status: TaskStatus, filters: Filters): boolean {
  if (filters.server && task.serverID !== filters.server) return false;
  if (filters.project === CHATS && task.projectID !== null) return false;
  if (filters.project && filters.project !== CHATS && task.projectID !== filters.project)
    return false;
  if (filters.states.length === 0) return true;
  return filters.states.some((state) => {
    if (state === "needs-you") return needsYou(status.kind);
    if (state === "working") return status.kind === "working" || status.kind === "stale";
    if (state === "unseen") return status.kind === "unseen";
    return status.kind === "failed";
  });
}

/** When the wait began: the request's arrival, or the failure. Oldest wait comes first. */
function waitSince(task: Task): number {
  if (task.requests.length > 0)
    return Math.min(...task.requests.map((request) => request.arrivedAt));
  return task.attentionAt ?? task.activityAt;
}

export function buildLayout(input: LayoutInput): Layout {
  const { tasks, statuses, projects, servers, now, options } = input;
  const statusOf = (task: Task) => statuses[task.id]!;
  const recency = (task: Task) =>
    options.ordering === "created" ? task.createdAt : task.activityAt;
  const byRecency = (a: Task, b: Task) => recency(b) - recency(a);
  const byRank = (a: Task, b: Task) =>
    STATUS_RANK[statusOf(a).kind] - STATUS_RANK[statusOf(b).kind] || byRecency(a, b);

  const buckets: Record<Placement, Task[]> = {
    "needs-you": [],
    pinned: [],
    inbox: [],
    working: [],
    snoozed: [],
    settled: [],
  };
  const placements = new Map<string, Placement>();
  for (const task of tasks) {
    if (!matchesFilters(task, statusOf(task), options.filters)) continue;
    const placement = placeTask(task, statusOf(task), now, options);
    placements.set(task.id, placement);
    buckets[placement].push(task);
  }

  const row = (task: Task, container: string, depth = 0): RowEntry => {
    const placement = placements.get(task.id)!;
    const lines = rowLines(
      placement,
      statusOf(task),
      options.approvalLines,
      effectiveIdleRows(options.idleRows, options.grouping),
    );
    return {
      type: "row",
      key: task.id,
      container,
      placement,
      lines,
      size: SIZES.row[lines],
      depth,
    };
  };
  const entries: ListEntry[] = [];
  const section = (key: string, label: string, items: Task[]) => {
    if (items.length === 0) return;
    entries.push({ type: "heading", key: `heading:${key}`, label, size: SIZES.heading });
    for (const task of items) entries.push(row(task, key));
    entries.push({ type: "spacer", key: `spacer:${key}`, size: SIZES.spacer });
  };

  section(
    "needs-you",
    "Needs you",
    [...buckets["needs-you"]].sort((a, b) => waitSince(a) - waitSince(b)),
  );

  const collapsed = new Set(options.collapsed);
  const rollup = (items: Task[]) => mostUrgent(items.map((task) => statusOf(task).kind));

  const shelfItems = (id: ShelfID): Task[] => {
    if (id === "pinned")
      return [...buckets.pinned].sort((a, b) => (a.pinnedAt ?? 0) - (b.pinnedAt ?? 0));
    if (id === "working")
      return [...buckets.working].sort(
        (a, b) => (b.run?.startedAt ?? b.runEndedAt ?? 0) - (a.run?.startedAt ?? a.runEndedAt ?? 0),
      );
    if (id === "snoozed")
      return options.showSnoozed
        ? [...buckets.snoozed].sort((a, b) => (a.snoozedUntil ?? 0) - (b.snoozedUntil ?? 0))
        : [];
    return options.showSettled
      ? [...buckets.settled].sort((a, b) => (b.settledAt ?? 0) - (a.settledAt ?? 0))
      : [];
  };
  const SHELF_LABEL: Record<ShelfID, string> = {
    pinned: "Pinned",
    working: "Working",
    snoozed: "Snoozed",
    settled: "Settled",
  };
  const limitOf = (id: ShelfID) => (id === "settled" ? options.settledLimit : Infinity);

  /** An in-flow section: a header like a group's, then its rows when open. */
  const flowSection = (id: ShelfID) => {
    const items = shelfItems(id);
    if (items.length === 0) return;
    const key = shelfKey(id);
    const open = options.shelves[id];
    if (entries.length > 0 && entries.at(-1)?.type !== "spacer")
      entries.push({ type: "spacer", key: `spacer:${key}`, size: SIZES.spacer });
    entries.push({
      type: "shelf",
      key,
      id,
      label: SHELF_LABEL[id],
      open,
      count: items.length,
      rollup: open ? null : rollup(items),
      size: SIZES.group,
    });
    if (!open) return;
    const limit = limitOf(id);
    for (const task of items.slice(0, limit)) entries.push(row(task, key, 1));
    if (items.length > limit)
      entries.push({
        type: "more",
        key: moreKey(id),
        shelf: id,
        count: items.length - limit,
        size: SIZES.more,
      });
  };

  // Pinned collapses like the other sections, but always sits on top, under "Needs you".
  flowSection("pinned");

  if (options.workingPlacement === "under-needs-you") {
    flowSection("working");
    if (buckets.working.length > 0)
      entries.push({ type: "spacer", key: "spacer:after-working", size: SIZES.spacer });
  }

  if (options.grouping === "inbox") {
    const inbox = buckets.inbox;
    const unseen = inbox.filter((task) => statusOf(task).kind === "unseen");
    const working = inbox.filter((task) => task.run !== null && statusOf(task).kind !== "unseen");
    const rest = inbox.filter((task) => !unseen.includes(task) && !working.includes(task));
    const ordered = [
      ...unseen.sort((a, b) => b.activityAt - a.activityAt),
      ...working.sort((a, b) => b.run!.startedAt - a.run!.startedAt),
      ...rest.sort(byRecency),
    ];
    if (ordered.length === 0 && buckets["needs-you"].length === 0) {
      entries.push({
        type: "empty",
        key: "empty:inbox",
        text: "Inbox is clear",
        size: SIZES.empty,
      });
    }
    for (const task of ordered) entries.push(row(task, "inbox"));
  } else {
    const projectGroups = (serverID: string | null, parent: string | null, depth: number) => {
      const scoped = serverID
        ? buckets.inbox.filter((task) => task.serverID === serverID)
        : buckets.inbox;
      // A chat is a task with no project: "Chats" is a group like any other, placed first.
      const ids: (string | null)[] = [
        null,
        ...projects
          .filter((project) => !serverID || project.serverID === serverID)
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((project) => project.id),
      ];
      // Grouped across servers, two projects can share a name ("Global"); their server tells them apart.
      const names = new Map<string, number>();
      if (!serverID) {
        for (const project of projects) {
          const name = project.name.toLowerCase();
          names.set(name, (names.get(name) ?? 0) + 1);
        }
      }
      for (const projectID of ids) {
        const items = scoped.filter((task) => task.projectID === projectID).sort(byRank);
        if (items.length === 0) continue;
        const key = projectGroupKey(projectID, serverID ?? undefined);
        const open = !collapsed.has(key);
        const project = projects.find((candidate) => candidate.id === projectID);
        const server = servers.find(
          (candidate) => candidate.id === (serverID ?? items[0]!.serverID),
        );
        entries.push({
          type: "group",
          key,
          kind: "project",
          label: !project
            ? "Chats"
            : (names.get(project.name.toLowerCase()) ?? 0) > 1 && server
              ? `${project.name} · ${server.name}`
              : project.name,
          open,
          count: items.length,
          rollup: open ? null : rollup(items),
          projectID,
          serverID: server?.id ?? items[0]!.serverID,
          online: server?.online ?? true,
          parent,
          depth,
          size: SIZES.group,
        });
        if (open) for (const task of items) entries.push(row(task, key, depth + 1));
      }
    };
    if (options.grouping === "project") projectGroups(null, null, 0);
    else {
      for (const server of servers) {
        const items = buckets.inbox.filter((task) => task.serverID === server.id);
        if (items.length === 0) continue;
        const key = serverGroupKey(server.id);
        const open = !collapsed.has(key);
        entries.push({
          type: "group",
          key,
          kind: "server",
          label: server.name,
          open,
          count: items.length,
          rollup: open ? null : rollup(items),
          projectID: null,
          serverID: server.id,
          online: server.online,
          parent: null,
          depth: 0,
          size: SIZES.group,
        });
        if (open) projectGroups(server.id, key, 1);
      }
    }
  }
  if (options.workingPlacement === "after-inbox") flowSection("working");
  flowSection("snoozed");
  flowSection("settled");
  if (entries.at(-1)?.type === "spacer") entries.pop();

  // Docked, only Working leaves the scroll; with nothing running there is no dock at all.
  const shelves: ShelfLayout[] = [];
  const docked = options.workingPlacement === "dock" ? shelfItems("working") : [];
  if (docked.length > 0) {
    const key = shelfKey("working");
    const open = options.shelves.working;
    shelves.push({
      id: "working",
      key,
      label: SHELF_LABEL.working,
      open,
      count: docked.length,
      rollup: open ? null : rollup(docked),
      rows: open ? docked.map((task) => row(task, key)) : [],
    });
  }

  return { entries, shelves, attention: buckets["needs-you"].length };
}

/** The rollup mark: the most urgent thing inside, ignoring idle and stopped tasks. */
export function mostUrgent(kinds: readonly StatusKind[]): StatusKind | null {
  let best: StatusKind | null = null;
  for (const kind of kinds) {
    if (STATUS_RANK[kind] > STATUS_RANK.stale) continue;
    if (!best || STATUS_RANK[kind] < STATUS_RANK[best]) best = kind;
  }
  return best;
}

/** Every row in list order: the main list, then each open shelf. */
export function rowKeys(layout: Layout): string[] {
  return [
    ...layout.entries.flatMap((entry) => (entry.type === "row" ? [entry.key] : [])),
    ...layout.shelves.flatMap((shelf) => shelf.rows.map((row) => row.key)),
  ];
}

export function findRow(layout: Layout, key: string): RowEntry | null {
  for (const entry of layout.entries) if (entry.type === "row" && entry.key === key) return entry;
  for (const shelf of layout.shelves) for (const row of shelf.rows) if (row.key === key) return row;
  return null;
}
