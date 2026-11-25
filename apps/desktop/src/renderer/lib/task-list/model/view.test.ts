import { describe, expect, it } from "vitest";
import type { Project, Server } from "../types";
import { makeTask, NOW, running } from "./fixtures.test-support";
import { rowFields, type RowFields } from "./row";
import { buildLayout, findRow, NO_FILTERS, type Layout } from "./sections";
import { taskStatus, type TaskStatus } from "./status";
import {
  customizedKnobs,
  DEFAULT_VIEW,
  describeView,
  NO_EXPERIMENTS,
  resolveView,
  type RowDetail,
  type ViewKnobs,
  type WorkingKnob,
} from "./view";
import type { Grouping } from "./sections";

const SERVERS: Server[] = [{ id: "local", name: "This Mac", online: true, lastSeenAt: null }];
const PROJECTS: Project[] = [{ id: "palot", name: "palot", serverID: "local" }];

const TASKS = [
  makeTask({
    id: "a",
    ...running(60_000),
    requests: [
      {
        id: "r",
        kind: "permission",
        arrivedAt: NOW - 30_000,
        summary: "bun test",
        detail: "bun test",
        rule: "bun test *",
        from: null,
      },
    ],
  }),
  makeTask({ id: "p", pinnedAt: NOW - 1_000 }),
  makeTask({ id: "u", unread: true, activityAt: NOW - 600_000 }),
  makeTask({ id: "w", ...running(30_000) }),
  makeTask({ id: "i", branch: "feature/x", activityAt: NOW - 3_600_000 }),
  // A chat is a task with no project.
  makeTask({ id: "c", projectID: null, activityAt: NOW - 7_200_000 }),
  makeTask({ id: "z", snoozedUntil: NOW + 3_600_000 }),
  makeTask({ id: "s", settledAt: NOW - 1_000 }),
];

function layoutFor(knobs: ViewKnobs): { layout: Layout; statuses: Record<string, TaskStatus> } {
  const resolved = resolveView(knobs, NO_EXPERIMENTS, 272);
  const statuses = Object.fromEntries(
    TASKS.map((task) => [
      task.id,
      taskStatus(task, { now: NOW, liveDetail: true, serverOnline: true, serverLastSeenAt: null }),
    ]),
  );
  const layout = buildLayout({
    tasks: TASKS,
    statuses,
    projects: PROJECTS,
    servers: SERVERS,
    now: NOW,
    options: {
      ...resolved,
      ordering: "activity",
      showSnoozed: true,
      showSettled: true,
      collapsed: [],
      shelves: { pinned: true, working: true, snoozed: false, settled: false },
      settledLimit: 20,
      filters: NO_FILTERS,
    },
  });
  return { layout, statuses };
}

/** The list's flow, then "|" and each docked shelf. */
function outline(layout: Layout): string {
  return [
    ...layout.entries.flatMap((entry) => {
      if (entry.type === "heading") return [`#${entry.label}`];
      if (entry.type === "group") return [`[${entry.label}]`];
      if (entry.type === "shelf") return [`[${entry.label}${entry.open ? "" : "-"}]`];
      if (entry.type === "row") return [entry.key];
      return [];
    }),
    ...layout.shelves.flatMap((shelf) => [
      "|",
      `[${shelf.label}${shelf.open ? "" : "-"}]`,
      ...shelf.rows.map((row) => row.key),
    ]),
  ].join(" ");
}

const TOP = "#Needs you a [Pinned] p";
const SHELVES = "[Snoozed-] [Settled-]";
const GROUPS = "[Chats] c [palot] u w i";
const ORDER: Record<Grouping, Record<WorkingKnob, string>> = {
  inbox: {
    dock: `${TOP} u i c ${SHELVES} | [Working] w`,
    "after-inbox": `${TOP} u i c [Working] w ${SHELVES}`,
    "under-needs-you": `${TOP} [Working] w u i c ${SHELVES}`,
    list: `${TOP} u w i c ${SHELVES}`,
  },
  // Grouped by project or server, working tasks live in their project.
  project: {
    dock: `${TOP} ${GROUPS} ${SHELVES}`,
    "after-inbox": `${TOP} ${GROUPS} ${SHELVES}`,
    "under-needs-you": `${TOP} ${GROUPS} ${SHELVES}`,
    list: `${TOP} ${GROUPS} ${SHELVES}`,
  },
  server: {
    dock: `${TOP} [This Mac] ${GROUPS} ${SHELVES}`,
    "after-inbox": `${TOP} [This Mac] ${GROUPS} ${SHELVES}`,
    "under-needs-you": `${TOP} [This Mac] ${GROUPS} ${SHELVES}`,
    list: `${TOP} [This Mac] ${GROUPS} ${SHELVES}`,
  },
};

type Fields = RowFields & { lines: number };
const status = (context: RowFields["context"]): Fields => ({
  lines: 2,
  mark: false,
  trailing: "status",
  second: "status",
  context,
});
const FIELDS: Record<Grouping, Record<RowDetail, { idle: Fields; working: Fields }>> = {
  inbox: {
    compact: {
      idle: { lines: 1, mark: false, trailing: "project-time", second: "none", context: "none" },
      working: status("project-branch"),
    },
    comfortable: {
      idle: { lines: 2, mark: false, trailing: "time", second: "project-branch", context: "none" },
      working: status("project-branch"),
    },
  },
  // The project is the group header: Compact drops it, Comfortable keeps just the branch.
  project: {
    compact: {
      idle: { lines: 1, mark: false, trailing: "time", second: "none", context: "none" },
      working: status("branch"),
    },
    comfortable: {
      idle: { lines: 2, mark: false, trailing: "time", second: "branch", context: "none" },
      working: status("branch"),
    },
  },
  server: {
    compact: {
      idle: { lines: 1, mark: false, trailing: "project-time", second: "none", context: "none" },
      working: status("branch"),
    },
    comfortable: {
      idle: { lines: 2, mark: false, trailing: "time", second: "project-branch", context: "none" },
      working: status("branch"),
    },
  },
};

const COMBINATIONS: ViewKnobs[] = (["inbox", "project", "server"] as const).flatMap((grouping) =>
  (["dock", "under-needs-you", "after-inbox", "list"] as const).flatMap((working) =>
    (["compact", "comfortable"] as const).map((rowDetail) => ({ grouping, working, rowDetail })),
  ),
);

describe("the three View knobs", () => {
  it.each(COMBINATIONS)("orders sections for %o", (knobs) => {
    expect(outline(layoutFor(knobs).layout)).toBe(ORDER[knobs.grouping][knobs.working]);
  });

  it.each(COMBINATIONS)("gives rows their fields for %o", (knobs) => {
    const { layout, statuses } = layoutFor(knobs);
    const resolved = resolveView(knobs, NO_EXPERIMENTS, 272);
    const fieldsOf = (key: string): Fields => {
      const entry = findRow(layout, key)!;
      return {
        lines: entry.lines,
        ...rowFields({
          status: statuses[key]!,
          placement: entry.placement,
          lines: entry.lines,
          grouping: resolved.grouping,
          idleRows: resolved.idleRows,
        }),
      };
    };
    const expected = FIELDS[knobs.grouping][knobs.rowDetail];
    expect(fieldsOf("i")).toEqual(expected.idle);
    // A chat is a task like any other: same fields, only the name differs ("Chat").
    expect(fieldsOf("c")).toEqual(expected.idle);
    expect(fieldsOf("w")).toEqual(expected.working);
  });
});

describe("experiments and defaults", () => {
  it("override a knob while on and give it back when off", () => {
    const knobs: ViewKnobs = { ...DEFAULT_VIEW, rowDetail: "comfortable" };
    expect(resolveView(knobs, NO_EXPERIMENTS, 272)).toMatchObject({
      workingPlacement: "dock",
      idleRows: "two",
      approvalLines: 4,
    });
    expect(resolveView(knobs, { idleRows: "mark", approvalLines: 3 }, 272)).toMatchObject({
      workingPlacement: "dock",
      idleRows: "mark",
      approvalLines: 3,
    });
    expect(resolveView(knobs, NO_EXPERIMENTS, 340).approvalLines).toBe(3);
  });

  it("counts customised knobs and describes the combination", () => {
    expect(customizedKnobs(DEFAULT_VIEW)).toEqual([]);
    expect(customizedKnobs({ ...DEFAULT_VIEW, working: "list", rowDetail: "comfortable" })).toEqual(
      ["working", "rowDetail"],
    );
    expect(describeView(DEFAULT_VIEW)).toBe(
      "One inbox across projects; working tasks docked at the bottom; one line per idle task with its project.",
    );
  });
});
