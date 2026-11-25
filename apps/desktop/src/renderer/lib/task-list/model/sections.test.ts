import { describe, expect, it } from "vitest";
import type { Project, Server, Task } from "../types";
import { makeTask, NOW, running } from "./fixtures.test-support";
import {
  buildLayout,
  effectiveIdleRows,
  NO_FILTERS,
  projectGroupKey,
  rowKeys,
  WORKING_EXIT_GRACE_MS,
  type Layout,
  type LayoutOptions,
} from "./sections";
import { taskStatus, type TaskStatus } from "./status";

const SERVERS: Server[] = [
  { id: "local", name: "This Mac", online: true, lastSeenAt: null },
  { id: "devbox", name: "build-box", online: false, lastSeenAt: NOW - 60_000 },
];
const PROJECTS: Project[] = [
  { id: "palot", name: "palot", serverID: "local" },
  { id: "docs", name: "docs", serverID: "local" },
  { id: "infra", name: "infra", serverID: "devbox" },
];
const OPTIONS: LayoutOptions = {
  grouping: "inbox",
  workingPlacement: "dock",
  ordering: "activity",
  showSnoozed: true,
  showSettled: true,
  collapsed: [],
  shelves: { pinned: true, working: true, snoozed: false, settled: true },
  settledLimit: 20,
  filters: NO_FILTERS,
  approvalLines: 3,
  idleRows: "title",
};

const request = (arrivedAgo: number) => ({
  id: `r${arrivedAgo}`,
  kind: "permission" as const,
  arrivedAt: NOW - arrivedAgo,
  summary: "bun test",
  detail: "bun test",
  rule: "bun test *",
  from: null,
});

function layout(tasks: Task[], options: Partial<LayoutOptions> = {}, now = NOW): Layout {
  const statuses: Record<string, TaskStatus> = {};
  for (const task of tasks) {
    const server = SERVERS.find((item) => item.id === task.serverID)!;
    statuses[task.id] = taskStatus(task, {
      now,
      liveDetail: true,
      serverOnline: server.online,
      serverLastSeenAt: server.lastSeenAt,
    });
  }
  return buildLayout({
    tasks,
    statuses,
    projects: PROJECTS,
    servers: SERVERS,
    now,
    options: { ...OPTIONS, ...options },
  });
}

const sections = (result: Layout) =>
  result.entries.flatMap((entry) =>
    // Pinned is a collapsible section now, but it still reads as a heading here.
    entry.type === "heading" || (entry.type === "shelf" && entry.id === "pinned")
      ? [`# ${entry.label}`]
      : entry.type === "row"
        ? [entry.key]
        : [],
  );

describe("buildLayout grouped as Inbox", () => {
  const tasks = [
    makeTask({ id: "idle-old", activityAt: NOW - 5 * 3_600_000 }),
    makeTask({ id: "idle-new", activityAt: NOW - 3_600_000 }),
    makeTask({ id: "unseen", unread: true, activityAt: NOW - 2 * 3_600_000 }),
    makeTask({ id: "waiting-new", requests: [request(60_000)] }),
    makeTask({ id: "waiting-old", requests: [request(600_000)] }),
    makeTask({ id: "failed", failure: "rate limit", attentionAt: NOW - 120_000 }),
    makeTask({ id: "pinned", pinnedAt: NOW - 1_000 }),
    makeTask({ id: "working", ...running(30_000) }),
    makeTask({ id: "settled", settledAt: NOW - 1_000 }),
    makeTask({ id: "snoozed", snoozedUntil: NOW + 3_600_000 }),
  ];

  it("puts Needs you on top, oldest wait first, then Pinned, then unseen and idle by recency", () => {
    expect(sections(layout(tasks))).toEqual([
      "# Needs you",
      "waiting-old",
      "failed",
      "waiting-new",
      "# Pinned",
      "pinned",
      "unseen",
      "idle-new",
      "idle-old",
      // Settled stays in the flow at the end; only Working docks.
      "settled",
    ]);
  });

  it("keeps working tasks on the docked shelf, or under the unseen ones in the list", () => {
    const shelf = layout(tasks);
    expect(shelf.shelves.map((item) => [item.id, item.rows.map((row) => row.key)])).toEqual([
      ["working", ["working"]],
    ]);
    const list = layout(tasks, { workingPlacement: "list" });
    const inbox = list.entries.flatMap((entry) =>
      entry.type === "row" && entry.container === "inbox" ? [entry.key] : [],
    );
    expect(inbox).toEqual(["unseen", "working", "idle-new", "idle-old"]);
  });

  it("never shows a task twice", () => {
    const keys = rowKeys(
      layout(tasks, { shelves: { pinned: true, working: true, snoozed: true, settled: true } }),
    );
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toHaveLength(tasks.length);
  });

  it("gives idle rows one line, rows with news two, and requests three", () => {
    const lines = Object.fromEntries(
      layout(tasks).entries.flatMap((entry) =>
        entry.type === "row" ? [[entry.key, entry.lines]] : [],
      ),
    );
    expect(lines).toMatchObject({
      "idle-new": 1,
      unseen: 2,
      "waiting-old": 3,
      failed: 3,
      pinned: 1,
    });
  });

  it("keeps a stopped run on the Working shelf for the exit grace, then moves it", () => {
    const stopped = makeTask({ id: "done", unread: true, runEndedAt: NOW - 500 });
    expect(layout([stopped]).shelves[0]?.rows.map((row) => row.key)).toEqual(["done"]);
    const later = layout([stopped], {}, NOW - 500 + WORKING_EXIT_GRACE_MS);
    expect(later.shelves).toEqual([]);
    expect(sections(later)).toEqual(["done"]);
  });

  it("holds an answered task in Needs you while it lingers", () => {
    const answered = makeTask({ id: "a", ...running(10_000), lingerUntil: NOW + 1_000 });
    expect(sections(layout([answered]))).toEqual(["# Needs you", "a"]);
    expect(layout([answered], {}, NOW + 1_000).shelves[0]?.rows.map((row) => row.key)).toEqual([
      "a",
    ]);
  });

  it("says the inbox is clear while work continues on the shelf", () => {
    const result = layout([makeTask({ id: "w", ...running(5_000) })]);
    expect(result.entries.map((entry) => entry.type)).toEqual(["empty"]);
    expect(result.shelves[0]?.count).toBe(1);
  });

  it("shows a closed shelf's most urgent state as one rollup mark", () => {
    const quiet = makeTask({ id: "q", ...running(60 * 60_000, 20 * 60_000) });
    const busy = makeTask({ id: "b", ...running(60_000) });
    const shelf = layout([quiet, busy], {
      shelves: { pinned: true, working: false, snoozed: false, settled: false },
    }).shelves[0]!;
    expect(shelf.rows).toEqual([]);
    expect(shelf.rollup).toBe("working");
  });
});

describe("buildLayout grouped by project and server", () => {
  const tasks = [
    makeTask({ id: "p-idle", projectID: "palot" }),
    makeTask({ id: "p-unseen", projectID: "palot", unread: true, activityAt: NOW - 9_000_000 }),
    makeTask({ id: "d-working", projectID: "docs", ...running(5_000) }),
    makeTask({ id: "chat", projectID: null }),
    makeTask({
      id: "i-waiting",
      projectID: "infra",
      serverID: "devbox",
      requests: [request(1_000)],
    }),
    makeTask({ id: "i-run", projectID: "infra", serverID: "devbox", ...running(5_000) }),
  ];

  it("keeps Needs you on top, Chats first, and orders each group by rank", () => {
    const result = layout(tasks, { grouping: "project" });
    const outline = result.entries.flatMap((entry) =>
      entry.type === "group" ? [`[${entry.label}]`] : entry.type === "row" ? [entry.key] : [],
    );
    expect(outline).toEqual([
      "i-waiting",
      "[Chats]",
      "chat",
      "[docs]",
      "d-working",
      "[infra]",
      "i-run",
      "[palot]",
      "p-unseen",
      "p-idle",
    ]);
  });

  it("names the server beside a project name another server also uses", () => {
    const tasks = [
      makeTask({ id: "a", projectID: "global-local", serverID: "local" }),
      makeTask({ id: "b", projectID: "global-devbox", serverID: "devbox" }),
      makeTask({ id: "c", projectID: "palot", serverID: "local" }),
    ];
    const result = buildLayout({
      tasks,
      statuses: Object.fromEntries(
        tasks.map((task) => [
          task.id,
          taskStatus(task, {
            now: NOW,
            liveDetail: true,
            serverOnline: true,
            serverLastSeenAt: null,
          }),
        ]),
      ),
      projects: [
        ...PROJECTS,
        { id: "global-local", name: "Global", serverID: "local" },
        { id: "global-devbox", name: "Global", serverID: "devbox" },
      ],
      servers: SERVERS,
      now: NOW,
      options: { ...OPTIONS, grouping: "project" },
    });
    const labels = result.entries.flatMap((entry) => (entry.type === "group" ? [entry.label] : []));
    expect(labels).toEqual(
      expect.arrayContaining(["Global · This Mac", "Global · build-box", "palot"]),
    );
  });

  it("collapses a group to one header with a rollup mark", () => {
    const result = layout(tasks, { grouping: "project", collapsed: [projectGroupKey("palot")] });
    const palot = result.entries.find((entry) => entry.type === "group" && entry.label === "palot");
    expect(palot).toMatchObject({ open: false, count: 2, rollup: "unseen" });
    expect(rowKeys(result)).not.toContain("p-idle");
  });

  it("nests projects under servers, and an offline server's running rows are stale", () => {
    const result = layout(tasks, { grouping: "server" });
    const groups = result.entries.flatMap((entry) =>
      entry.type === "group" ? [`${entry.kind}:${entry.label}:${entry.online}`] : [],
    );
    expect(groups).toEqual([
      "server:This Mac:true",
      "project:Chats:true",
      "project:docs:true",
      "project:palot:true",
      "server:build-box:false",
      "project:infra:false",
    ]);
    const statuses = taskStatus(tasks[5]!, {
      now: NOW,
      liveDetail: true,
      serverOnline: false,
      serverLastSeenAt: NOW,
    });
    expect(statuses.kind).toBe("stale");
  });

  it("filters by project, state and server everywhere, Needs you included", () => {
    const onlyDocs = layout(tasks, { filters: { ...NO_FILTERS, project: "docs" } });
    expect(rowKeys(onlyDocs)).toEqual(["d-working"]);
    const needsYou = layout(tasks, { filters: { ...NO_FILTERS, states: ["needs-you"] } });
    expect(rowKeys(needsYou)).toEqual(["i-waiting"]);
    const chats = layout(tasks, { filters: { ...NO_FILTERS, project: "chats" } });
    expect(rowKeys(chats)).toEqual(["chat"]);
  });
});

describe("Working, Snoozed and Settled placements", () => {
  const tasks = [
    makeTask({ id: "waiting", requests: [request(60_000)] }),
    makeTask({ id: "pinned", pinnedAt: NOW - 1_000 }),
    makeTask({ id: "idle" }),
    makeTask({ id: "working", ...running(30_000) }),
    makeTask({ id: "snoozed", snoozedUntil: NOW + 3_600_000 }),
    ...Array.from({ length: 3 }, (_, index) =>
      makeTask({ id: `settled-${index}`, settledAt: NOW - index * 1_000 }),
    ),
  ];
  const outline = (result: Layout) =>
    result.entries.flatMap((entry) =>
      entry.type === "heading"
        ? [`# ${entry.label}`]
        : entry.type === "shelf"
          ? [`[${entry.label}${entry.open ? "" : " closed"}]`]
          : entry.type === "more"
            ? [`more ${entry.count}`]
            : entry.type === "row"
              ? [entry.key]
              : [],
    );

  it("puts the sections after the inbox in the list's flow, nothing docked", () => {
    const result = layout(tasks, {
      workingPlacement: "after-inbox",
      shelves: { pinned: true, working: true, snoozed: false, settled: false },
    });
    expect(result.shelves).toEqual([]);
    expect(outline(result)).toEqual([
      "# Needs you",
      "waiting",
      "[Pinned]",
      "pinned",
      "idle",
      "[Working]",
      "working",
      "[Snoozed closed]",
      "[Settled closed]",
    ]);
  });

  it("collapses Pinned to its header with a count, like the other sections", () => {
    const result = layout(tasks, {
      workingPlacement: "after-inbox",
      shelves: { pinned: false, working: true, snoozed: false, settled: false },
    });
    expect(outline(result).slice(0, 4)).toEqual([
      "# Needs you",
      "waiting",
      "[Pinned closed]",
      "idle",
    ]);
    const pinned = result.entries.find((entry) => entry.type === "shelf" && entry.id === "pinned");
    expect(pinned).toMatchObject({ count: 1, open: false });
  });

  it("puts Working directly under Needs you and Pinned, before the inbox rows", () => {
    const result = layout(tasks, { workingPlacement: "under-needs-you" });
    expect(outline(result).slice(0, 7)).toEqual([
      "# Needs you",
      "waiting",
      "[Pinned]",
      "pinned",
      "[Working]",
      "working",
      "idle",
    ]);
  });

  it("loads Settled a page at a time in flow too", () => {
    const result = layout(tasks, {
      workingPlacement: "after-inbox",
      shelves: { pinned: true, working: false, snoozed: false, settled: true },
      settledLimit: 2,
    });
    expect(outline(result).slice(-4)).toEqual(["[Settled]", "settled-0", "settled-1", "more 1"]);
    expect(outline(result)).toContain("[Working closed]");
  });

  it("docks only Working; Snoozed and Settled stay in flow at the end", () => {
    const docked = layout(tasks, {
      shelves: { pinned: true, working: true, snoozed: false, settled: false },
    });
    expect(docked.shelves.map((shelf) => [shelf.id, shelf.rows.map((row) => row.key)])).toEqual([
      ["working", ["working"]],
    ]);
    expect(outline(docked)).not.toContain("working");
    expect(outline(docked).slice(-3)).toEqual(["idle", "[Snoozed closed]", "[Settled closed]"]);
    const list = layout(tasks, {
      workingPlacement: "list",
      shelves: { pinned: true, working: true, snoozed: false, settled: false },
    });
    expect(list.shelves).toEqual([]);
    expect(outline(list).slice(-4)).toEqual([
      "working",
      "idle",
      "[Snoozed closed]",
      "[Settled closed]",
    ]);
  });
});

describe("row forms", () => {
  it("gives idle rows a second line only in the two-line form", () => {
    const idle = [makeTask({ id: "i" })];
    const lines = (options: Partial<LayoutOptions>) =>
      layout(idle, options).entries.find((entry) => entry.type === "row");
    expect(lines({ idleRows: "inline" })).toMatchObject({ lines: 1, size: 34 });
    expect(lines({ idleRows: "two" })).toMatchObject({ lines: 2, size: 50 });
  });

  it("falls back to the title when grouped by project, where the header names the project", () => {
    expect(effectiveIdleRows("inline", "project")).toBe("title");
    expect(effectiveIdleRows("mark", "project")).toBe("title");
    expect(effectiveIdleRows("two", "project")).toBe("two");
    expect(effectiveIdleRows("mark", "server")).toBe("mark");
  });

  it("gives approval rows a fourth line for the command when asked", () => {
    const waiting = [makeTask({ id: "a", requests: [request(60_000)] })];
    const row = layout(waiting, { approvalLines: 4 }).entries.find((entry) => entry.type === "row");
    expect(row).toMatchObject({ lines: 4, size: 104 });
  });
});
