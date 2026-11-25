/**
 * What the task list remembers: the three View knobs, ordering, show snoozed and settled,
 * filters, and which sections and groups are open. Stored in the Inbox's existing atoms
 * (`ui.inbox-view-preferences`, `ui.inbox-filters`, `ui.inbox-shelves`) as added optional
 * fields, so values the old sidebars wrote stay readable and theirs keep working.
 */

import { useAtom } from "jotai";
import { useCallback, useMemo } from "react";
import {
  inboxFiltersAtom,
  inboxShelvesAtom,
  inboxViewPreferencesAtom,
  type InboxFilters,
  type InboxShelves,
  type InboxStateFilter,
  type InboxViewPreferences,
} from "@/atoms/ui";
import { CHATS_PROJECT_FILTER } from "@/lib/session-inbox";
import {
  CHATS,
  NO_FILTERS,
  type Filters,
  type Ordering,
  type ShelfID,
  type StateFilter,
} from "@/lib/task-list/model/sections";
import { DEFAULT_VIEW, type ViewKnobs } from "@/lib/task-list/model/view";

export interface TaskListPreferences {
  view: ViewKnobs;
  ordering: Ordering;
  showSnoozed: boolean;
  showSettled: boolean;
  filters: Filters;
  /** Pinned and Working open; Snoozed and Settled closed until asked for. */
  shelves: Readonly<Record<ShelfID, boolean>>;
  /** Keys of collapsed project and server groups. */
  collapsed: readonly string[];
}

export const DEFAULT_SHELVES: Readonly<Record<ShelfID, boolean>> = {
  pinned: true,
  working: true,
  snoozed: false,
  settled: false,
};

export const DEFAULT_TASK_LIST_PREFERENCES: TaskListPreferences = {
  view: DEFAULT_VIEW,
  ordering: "activity",
  showSnoozed: true,
  showSettled: true,
  filters: NO_FILTERS,
  shelves: DEFAULT_SHELVES,
  collapsed: [],
};

const TO_LIST_STATE: Record<InboxStateFilter, StateFilter> = {
  attention: "needs-you",
  running: "working",
  failed: "failed",
  unread: "unseen",
};
const TO_INBOX_STATE: Record<StateFilter, InboxStateFilter> = {
  "needs-you": "attention",
  working: "running",
  failed: "failed",
  unseen: "unread",
};

type StoredShelves = InboxShelves;

/** Reads the three stored values as the list's preferences. Pure, for tests and the hook. */
export function readTaskListPreferences(
  view: InboxViewPreferences,
  filters: InboxFilters,
  shelves: StoredShelves,
): TaskListPreferences {
  return {
    view: {
      grouping: view.grouping ?? DEFAULT_VIEW.grouping,
      working: storedWorking(view),
      rowDetail: view.rowDetail ?? DEFAULT_VIEW.rowDetail,
    },
    ordering: view.taskOrdering ?? "activity",
    showSnoozed: view.showSnoozed,
    showSettled: view.showSettled,
    filters: {
      project: filters.projectID === CHATS_PROJECT_FILTER ? CHATS : filters.projectID,
      states: filters.states.map((state) => TO_LIST_STATE[state]),
      server: filters.serverID ?? null,
    },
    shelves: {
      pinned: shelves.pinned,
      working: shelves.working ?? DEFAULT_SHELVES.working,
      snoozed: shelves.snoozed,
      settled: shelves.settled,
    },
    collapsed: shelves.collapsedGroups ?? [],
  };
}

/**
 * Working's placement. Builds before the dock wrote `working: "after-inbox"` whenever anything
 * changed, so only a deliberate other choice there survives; the rest get today's default.
 */
function storedWorking(view: InboxViewPreferences): ViewKnobs["working"] {
  if (view.workingPlacement) return view.workingPlacement;
  if (view.working === "under-needs-you" || view.working === "list") return view.working;
  return DEFAULT_VIEW.working;
}

/** Writes the list's preferences back over the stored values, keeping the old sidebars' fields. */
export function writeTaskListPreferences(
  next: TaskListPreferences,
  current: { view: InboxViewPreferences; filters: InboxFilters; shelves: StoredShelves },
): { view: InboxViewPreferences; filters: InboxFilters; shelves: StoredShelves } {
  return {
    view: {
      ...current.view,
      grouping: next.view.grouping,
      workingPlacement: next.view.working,
      rowDetail: next.view.rowDetail,
      taskOrdering: next.ordering,
      showSnoozed: next.showSnoozed,
      showSettled: next.showSettled,
    },
    filters: {
      ...current.filters,
      projectID: next.filters.project === CHATS ? CHATS_PROJECT_FILTER : next.filters.project,
      states: next.filters.states.map((state) => TO_INBOX_STATE[state]),
      serverID: next.filters.server,
    },
    shelves: {
      ...current.shelves,
      pinned: next.shelves.pinned,
      working: next.shelves.working,
      snoozed: next.shelves.snoozed,
      settled: next.shelves.settled,
      collapsedGroups: [...next.collapsed],
    },
  };
}

/** The persisted preferences and their setter, for `<TaskList preferences onPreferencesChange>`. */
export function usePersistedTaskListPreferences(): [
  TaskListPreferences,
  (next: TaskListPreferences) => void,
] {
  const [view, setView] = useAtom(inboxViewPreferencesAtom);
  const [filters, setFilters] = useAtom(inboxFiltersAtom);
  const [shelves, setShelves] = useAtom(inboxShelvesAtom);
  const preferences = useMemo(
    () => readTaskListPreferences(view, filters, shelves),
    [view, filters, shelves],
  );
  const update = useCallback(
    (next: TaskListPreferences) => {
      const written = writeTaskListPreferences(next, { view, filters, shelves });
      // Only what changed, so the old sidebars' subscribers stay still.
      if (!sameJSON(written.view, view)) setView(written.view);
      if (!sameJSON(written.filters, filters)) setFilters(written.filters);
      if (!sameJSON(written.shelves, shelves)) setShelves(written.shelves);
    },
    [view, filters, shelves, setView, setFilters, setShelves],
  );
  return [preferences, update];
}

function sameJSON(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
