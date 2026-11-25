import { describe, expect, it } from "vitest";
import type { InboxViewPreferences } from "@/atoms/ui";
import { CHATS } from "@/lib/task-list/model/sections";
import {
  DEFAULT_TASK_LIST_PREFERENCES,
  readTaskListPreferences,
  writeTaskListPreferences,
} from "./preferences";

const OLD_VIEW = {
  ordering: "oldest",
  unreadFirst: true,
  showSnoozed: false,
  showSettled: true,
} as const;
const OLD_FILTERS = { projectID: "@chats", states: ["attention" as const, "unread" as const] };
const OLD_SHELVES = { pinned: false, inbox: true, snoozed: true, settled: false };

describe("task list preferences", () => {
  it("reads values the old sidebars stored, with defaults for what they never had", () => {
    expect(readTaskListPreferences(OLD_VIEW, OLD_FILTERS, OLD_SHELVES)).toEqual({
      ...DEFAULT_TASK_LIST_PREFERENCES,
      showSnoozed: false,
      filters: { project: CHATS, states: ["needs-you", "unseen"], server: null },
      // A Pinned section the old sidebar had collapsed stays collapsed.
      shelves: { pinned: false, working: true, snoozed: true, settled: false },
    });
  });

  it("writes its own fields back and keeps the old sidebars' fields", () => {
    const next = {
      ...DEFAULT_TASK_LIST_PREFERENCES,
      view: { grouping: "server", working: "list", rowDetail: "comfortable" },
      ordering: "created",
      filters: { project: "palot", states: ["working"], server: "devbox" },
      shelves: { pinned: false, working: false, snoozed: true, settled: true },
      collapsed: ["group:project:palot"],
    } as const;
    const written = writeTaskListPreferences(next, {
      view: OLD_VIEW,
      filters: OLD_FILTERS,
      shelves: OLD_SHELVES,
    });
    expect(written.view).toMatchObject({
      ordering: "oldest",
      unreadFirst: true,
      grouping: "server",
    });
    expect(written.filters).toEqual({
      projectID: "palot",
      states: ["running"],
      serverID: "devbox",
    });
    expect(written.shelves).toMatchObject({ pinned: false, inbox: true, working: false });
    expect(readTaskListPreferences(written.view, written.filters, written.shelves)).toEqual(next);
  });

  it("moves the old explicit After the inbox to the dock, keeping deliberate choices", () => {
    const working = (view: Partial<InboxViewPreferences>) =>
      readTaskListPreferences({ ...OLD_VIEW, ...view }, OLD_FILTERS, OLD_SHELVES).view.working;
    expect(working({ working: "after-inbox" })).toBe("dock");
    expect(working({ working: "under-needs-you" })).toBe("under-needs-you");
    expect(working({ working: "list" })).toBe("list");

    // Choosing After the inbox now sticks.
    const written = writeTaskListPreferences(
      {
        ...DEFAULT_TASK_LIST_PREFERENCES,
        view: { ...DEFAULT_TASK_LIST_PREFERENCES.view, working: "after-inbox" },
      },
      { view: { ...OLD_VIEW, working: "after-inbox" }, filters: OLD_FILTERS, shelves: OLD_SHELVES },
    );
    expect(working(written.view)).toBe("after-inbox");
  });
});
