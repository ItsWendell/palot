import type { LocationRef } from "@opencode/client";
import type { PalotPtyTransport } from "../../shared";
import { locationKey } from "./opencode-query";

export type WorkbenchPaneID = "right" | "bottom";
export type WorkbenchReviewMode = "working" | "branch";

type TabBase = { id: string; pinned: boolean };

export type WorkbenchTab =
  | (TabBase & {
      kind: "btw";
      resource: {
        profileID: string;
        sessionID: string;
        location: LocationRef;
        questionID: string;
        question: string;
        answer?: string;
        error?: string;
      };
    })
  | (TabBase & {
      kind: "browser";
      resource: {
        profileID: string;
        sessionID: string;
        location: LocationRef;
        /** Absent only in a saved workbench from before browser pages became tabs. */
        browserTabID?: string;
      };
    })
  | (TabBase & {
      /** An empty browser tab: the New tab page. Local only; it is not restored after reload. */
      kind: "new-tab";
      resource: {
        profileID: string;
        sessionID: string;
        location: LocationRef;
        pageID: string;
      };
    })
  | (TabBase & {
      kind: "command";
      resource: {
        profileID: string;
        location: LocationRef;
        shellID: string;
        sessionID?: string;
        command: string;
      };
    })
  | (TabBase & {
      kind: "context";
      resource: {
        profileID: string;
        location: LocationRef;
        sessionID: string;
      };
    })
  | (TabBase & {
      kind: "changes";
      resource: {
        profileID: string;
        location: LocationRef;
        mode: WorkbenchReviewMode;
        sourceSessionID?: string;
      };
    })
  | (TabBase & {
      kind: "file-diff";
      resource: {
        profileID: string;
        location: LocationRef;
        path: string;
        mode: WorkbenchReviewMode;
        sourceSessionID?: string;
      };
    })
  | (TabBase & {
      kind: "turn-diff";
      resource: {
        profileID: string;
        location: LocationRef;
        sessionID: string;
        userMessageID: string;
      };
    })
  | (TabBase & {
      kind: "file";
      resource: {
        profileID: string;
        location: LocationRef;
        path: string;
        line?: number;
      };
    })
  | (TabBase & {
      kind: "workspace-files";
      resource: { profileID: string; location: LocationRef };
    })
  | (TabBase & {
      kind: "terminal";
      resource: {
        profileID: string;
        location: LocationRef;
        ptyID: string;
        sessionID?: string;
        transport: PalotPtyTransport;
        readOnly?: boolean;
      };
    });

export type OpenWorkbenchTabInput =
  | { kind: "btw"; location: LocationRef; questionID: string; question: string }
  | { kind: "browser"; location: LocationRef; browserTabID: string }
  | { kind: "new-tab"; location: LocationRef }
  | { kind: "command"; location: LocationRef; shellID: string; sessionID?: string; command: string }
  | { kind: "context"; location: LocationRef }
  | {
      kind: "changes";
      location: LocationRef;
      mode: WorkbenchReviewMode;
      sourceSessionID?: string;
    }
  | {
      kind: "file-diff";
      location: LocationRef;
      path: string;
      mode: WorkbenchReviewMode;
      sourceSessionID?: string;
    }
  | { kind: "file"; location: LocationRef; path: string; line?: number }
  | { kind: "workspace-files"; location: LocationRef }
  | { kind: "turn-diff"; location: LocationRef; userMessageID: string }
  | {
      kind: "terminal";
      location: LocationRef;
      ptyID: string;
      sessionID?: string;
      transport: PalotPtyTransport;
      readOnly?: boolean;
    };

export interface WorkbenchScope {
  profileID: string;
  sessionID: string;
}

export interface WorkbenchPaneState {
  tabs: WorkbenchTab[];
  activeTabID: string | null;
  requestedOpen: boolean;
}

export interface WorkbenchContextState {
  right: WorkbenchPaneState;
  bottom: WorkbenchPaneState;
  recentlyClosed?: ClosedWorkbenchTab[];
  updatedAt: number;
}

export interface ClosedWorkbenchTab {
  tab: WorkbenchTab;
  pane: WorkbenchPaneID;
  index: number;
  closedAt: number;
}

export interface WorkbenchState {
  version: 1;
  scopes: Record<string, WorkbenchContextState>;
}

export interface OpenWorkbenchTabOptions {
  pane?: WorkbenchPaneID;
  activate?: boolean;
  moveExisting?: boolean;
}

export type OpenWorkbenchTabResult =
  | { ok: true; tabID: string; pane: WorkbenchPaneID; created: boolean; moved: boolean }
  | { ok: false; reason: "tab-limit" };

export const MAX_WORKBENCH_SCOPES = 20;
export const MAX_WORKBENCH_TABS = 24;
export const MAX_CLOSED_WORKBENCH_TABS = 12;
export const EMPTY_WORKBENCH_CONTEXT: WorkbenchContextState = {
  right: { tabs: [], activeTabID: null, requestedOpen: false },
  bottom: { tabs: [], activeTabID: null, requestedOpen: false },
  updatedAt: 0,
};

export function createWorkbenchState(): WorkbenchState {
  return { version: 1, scopes: {} };
}

export function workbenchScopeKey(scope: WorkbenchScope): string {
  return `${scope.profileID}\u0000${scope.sessionID}`;
}

export function workbenchTabResourceKey(tab: WorkbenchTab): string {
  const location = `${tab.resource.profileID}\u0000${locationKey(tab.resource.location)}`;
  if (tab.kind === "btw")
    return `btw\u0000${tab.resource.profileID}\u0000${tab.resource.sessionID}\u0000${tab.resource.questionID}`;
  if (tab.kind === "context") {
    return `context\u0000${tab.resource.profileID}\u0000${tab.resource.sessionID}`;
  }
  if (tab.kind === "browser")
    return `browser\u0000${tab.resource.profileID}\u0000${tab.resource.sessionID}\u0000${tab.resource.browserTabID ?? ""}`;
  if (tab.kind === "new-tab")
    return `new-tab\u0000${tab.resource.profileID}\u0000${tab.resource.sessionID}\u0000${tab.resource.pageID}`;
  if (tab.kind === "changes") return `changes\u0000${location}`;
  if (tab.kind === "workspace-files") return `workspace-files\u0000${location}`;
  if (tab.kind === "turn-diff")
    return `turn-diff\u0000${location}\u0000${tab.resource.sessionID}\u0000${tab.resource.userMessageID}`;
  if (tab.kind === "terminal") return `terminal\u0000${location}\u0000${tab.resource.ptyID}`;
  if (tab.kind === "command") return `command\u0000${location}\u0000${tab.resource.shellID}`;
  if (tab.kind === "file") return `file\u0000${location}\u0000${tab.resource.path}`;
  return `file-diff\u0000${location}\u0000${tab.resource.mode}\u0000${tab.resource.path}`;
}

export function workbenchTabTitle(tab: WorkbenchTab): string {
  if (tab.kind === "btw") return `BTW: ${tab.resource.question}`;
  if (tab.kind === "browser") return "Browser";
  if (tab.kind === "new-tab") return "New tab";
  if (tab.kind === "context") return "Context";
  if (tab.kind === "changes") return "Changes";
  if (tab.kind === "workspace-files") return "Files";
  if (tab.kind === "turn-diff") return "Turn changes";
  if (tab.kind === "terminal") return "Terminal";
  if (tab.kind === "command") return tab.resource.command || "Command output";
  if (tab.kind === "file") return tab.resource.path.split("/").at(-1) || tab.resource.path;
  return tab.resource.path.split("/").at(-1) || tab.resource.path;
}

export function workbenchDefaultPane(kind: WorkbenchTab["kind"]): WorkbenchPaneID {
  return kind === "terminal" || kind === "command" ? "bottom" : "right";
}

export function openWorkbenchTab(
  state: WorkbenchState,
  scope: WorkbenchScope,
  input: OpenWorkbenchTabInput,
  options: OpenWorkbenchTabOptions = {},
  now = Date.now(),
  createID: () => string = defaultTabID,
): { state: WorkbenchState; result: OpenWorkbenchTabResult } {
  const key = workbenchScopeKey(scope);
  const previous = state.scopes[key] ?? emptyContext(now);
  const candidate = tabFromInput(scope, input, createID());
  const resourceKey = workbenchTabResourceKey(candidate);
  const context = forgetClosedResource(previous, resourceKey);
  const existing = findTab(context, (tab) => workbenchTabResourceKey(tab) === resourceKey);
  if (existing) {
    const targeted = updateTabTarget(context, existing.pane, existing.tab, candidate);
    const targetPane = options.pane ?? existing.pane;
    const moved = Boolean(options.moveExisting && targetPane !== existing.pane);
    const next = moved
      ? moveTab(targeted, existing.pane, targetPane, existing.tab.id)
      : options.activate === false
        ? targeted
        : activateTab(targeted, existing.pane, existing.tab.id);
    return {
      state: withScope(state, key, next, now),
      result: {
        ok: true,
        tabID: existing.tab.id,
        pane: moved ? targetPane : existing.pane,
        created: false,
        moved,
      },
    };
  }
  if (
    [...context.right.tabs, ...context.bottom.tabs].filter((tab) => tab.kind !== "browser")
      .length >= MAX_WORKBENCH_TABS
  ) {
    return { state, result: { ok: false, reason: "tab-limit" } };
  }
  const pane = options.pane ?? workbenchDefaultPane(input.kind);
  const currentPane = context[pane];
  const next = {
    ...context,
    [pane]: {
      ...currentPane,
      tabs: [...currentPane.tabs, candidate],
      activeTabID: options.activate === false ? currentPane.activeTabID : candidate.id,
      requestedOpen: true,
    },
  };
  return {
    state: withScope(state, key, next, now),
    result: { ok: true, tabID: candidate.id, pane, created: true, moved: false },
  };
}

/**
 * Turns one tab (a New tab page) into another surface in its place. When that surface is
 * already open, the existing tab is focused where it is and the replaced tab closes.
 */
export function replaceWorkbenchTab(
  state: WorkbenchState,
  scope: WorkbenchScope,
  pane: WorkbenchPaneID,
  tabID: string,
  input: OpenWorkbenchTabInput,
  options: Pick<OpenWorkbenchTabOptions, "moveExisting"> = {},
  now = Date.now(),
  createID: () => string = defaultTabID,
): { state: WorkbenchState; result: OpenWorkbenchTabResult } {
  const key = workbenchScopeKey(scope);
  const context = state.scopes[key];
  const index = context?.[pane].tabs.findIndex((tab) => tab.id === tabID) ?? -1;
  if (!context || index < 0)
    return openWorkbenchTab(state, scope, input, { ...options, pane }, now, createID);
  const without = withScope(
    state,
    key,
    {
      ...context,
      [pane]: { ...context[pane], tabs: context[pane].tabs.filter((tab) => tab.id !== tabID) },
    },
    now,
  );
  const opened = openWorkbenchTab(without, scope, input, { ...options, pane }, now, createID);
  if (!opened.result.ok) return { state, result: opened.result };
  const result = opened.result;
  let next = opened.state.scopes[key]!;
  if (result.pane === pane) {
    const tabs = [...next[pane].tabs];
    const [tab] = tabs.splice(
      tabs.findIndex((candidate) => candidate.id === result.tabID),
      1,
    );
    tabs.splice(Math.min(index, tabs.length), 0, tab!);
    next = { ...next, [pane]: { tabs, activeTabID: result.tabID, requestedOpen: true } };
  } else if (next[pane].activeTabID === tabID) {
    const tabs = next[pane].tabs;
    next = {
      ...next,
      [pane]: {
        tabs,
        activeTabID: tabs[index]?.id ?? tabs[index - 1]?.id ?? null,
        requestedOpen: tabs.length > 0 && next[pane].requestedOpen,
      },
    };
  }
  return { state: withScope(opened.state, key, next, now), result };
}

/** Browser inventory is authoritative; the workbench only retains page placement and selection. */
export function reconcileBrowserPages(
  state: WorkbenchState,
  scope: WorkbenchScope,
  location: LocationRef,
  pageIDs: readonly string[],
  focusedPageID?: string | null,
  preferredPanes: ReadonlyMap<string, WorkbenchPaneID> = new Map(),
  now = Date.now(),
  createID: () => string = defaultTabID,
): WorkbenchState {
  const key = workbenchScopeKey(scope);
  const context = state.scopes[key] ?? emptyContext(now);
  const wanted = new Set(pageIDs);
  const retained = new Set<string>();
  const legacy = [...context.right.tabs, ...context.bottom.tabs].find(
    (tab) => tab.kind === "browser" && !tab.resource.browserTabID,
  );
  const legacyPageID = pageIDs.find(
    (id) =>
      ![...context.right.tabs, ...context.bottom.tabs].some(
        (tab) => tab.kind === "browser" && tab.resource.browserTabID === id,
      ),
  );
  let changed = false;
  const repair = (pane: WorkbenchPaneState): WorkbenchPaneState => {
    const tabs = pane.tabs.flatMap((tab): WorkbenchTab[] => {
      if (tab.kind !== "browser") return [tab];
      const pageID = tab.resource.browserTabID ?? (tab === legacy ? legacyPageID : undefined);
      if (!pageID || !wanted.has(pageID) || retained.has(pageID)) {
        changed = true;
        return [];
      }
      retained.add(pageID);
      if (tab.resource.browserTabID) return [tab];
      changed = true;
      return [{ ...tab, pinned: false, resource: { ...tab.resource, browserTabID: pageID } }];
    });
    if (tabs.length === pane.tabs.length && pane.tabs.every((tab, i) => tabs[i] === tab))
      return pane;
    const previousActiveIndex = pane.tabs.findIndex((tab) => tab.id === pane.activeTabID);
    const activeTabID = tabs.some((tab) => tab.id === pane.activeTabID)
      ? pane.activeTabID
      : (tabs[Math.min(previousActiveIndex < 0 ? 0 : previousActiveIndex, tabs.length - 1)]?.id ??
        null);
    return {
      ...pane,
      tabs,
      activeTabID,
      requestedOpen: tabs.length > 0 && pane.requestedOpen,
    };
  };
  let right = repair(context.right);
  let bottom = repair(context.bottom);
  const newRightTabs: WorkbenchTab[] = [];
  const newBottomTabs: WorkbenchTab[] = [];
  for (const id of pageIDs) {
    if (retained.has(id)) continue;
    retained.add(id);
    changed = true;
    const tab = tabFromInput(scope, { kind: "browser", location, browserTabID: id }, createID());
    if (preferredPanes.get(id) === "bottom") newBottomTabs.push(tab);
    else newRightTabs.push(tab);
  }
  if (newRightTabs.length)
    right = {
      ...right,
      tabs: [...right.tabs, ...newRightTabs],
      activeTabID: right.activeTabID ?? newRightTabs[0]!.id,
    };
  if (newBottomTabs.length)
    bottom = {
      ...bottom,
      tabs: [...bottom.tabs, ...newBottomTabs],
      activeTabID: bottom.activeTabID ?? newBottomTabs[0]!.id,
    };
  if (focusedPageID) {
    const rightTab = right.tabs.find(
      (tab) => tab.kind === "browser" && tab.resource.browserTabID === focusedPageID,
    );
    const bottomTab = rightTab
      ? undefined
      : bottom.tabs.find(
          (tab) => tab.kind === "browser" && tab.resource.browserTabID === focusedPageID,
        );
    if (rightTab && (right.activeTabID !== rightTab.id || !right.requestedOpen)) {
      changed = true;
      right = { ...right, activeTabID: rightTab.id, requestedOpen: true };
    } else if (bottomTab && (bottom.activeTabID !== bottomTab.id || !bottom.requestedOpen)) {
      changed = true;
      bottom = { ...bottom, activeTabID: bottomTab.id, requestedOpen: true };
    }
  }
  return changed ? withScope(state, key, { ...context, right, bottom }, now) : state;
}

export type WorkbenchMutation =
  | { type: "activate"; pane: WorkbenchPaneID; tabID: string }
  | { type: "close"; pane: WorkbenchPaneID; tabID: string }
  | { type: "close-others"; pane: WorkbenchPaneID; tabID: string }
  | { type: "close-to-end"; pane: WorkbenchPaneID; tabID: string }
  | { type: "move"; from: WorkbenchPaneID; to: WorkbenchPaneID; tabID: string }
  | { type: "reorder"; pane: WorkbenchPaneID; tabID: string; index: number }
  | { type: "pin"; pane: WorkbenchPaneID; tabID: string; pinned: boolean }
  | { type: "toggle-pane"; pane: WorkbenchPaneID };

export function mutateWorkbench(
  state: WorkbenchState,
  scope: WorkbenchScope,
  mutation: WorkbenchMutation,
  now = Date.now(),
): WorkbenchState {
  const key = workbenchScopeKey(scope);
  const context = state.scopes[key] ?? (mutation.type === "toggle-pane" ? emptyContext(now) : null);
  if (!context) return state;
  let next = mutateContext(context, mutation);
  if (
    mutation.type === "close" ||
    mutation.type === "close-others" ||
    mutation.type === "close-to-end"
  ) {
    const retained = new Set(next[mutation.pane].tabs.map((tab) => tab.id));
    let removedBefore = 0;
    const closed = context[mutation.pane].tabs
      .flatMap((tab, index) => {
        if (retained.has(tab.id)) return [];
        // Record left-to-right removal positions so newest-first reopen reverses the removals.
        const restoreIndex = index - removedBefore;
        removedBefore += 1;
        return canRestoreWorkbenchTab(tab, scope)
          ? [{ tab, pane: mutation.pane, index: restoreIndex, closedAt: now }]
          : [];
      })
      .toReversed();
    if (closed.length) {
      const resources = new Set(closed.map(({ tab }) => workbenchTabResourceKey(tab)));
      next = {
        ...next,
        recentlyClosed: [
          ...closed,
          ...(next.recentlyClosed ?? []).filter(
            (entry) => !resources.has(workbenchTabResourceKey(entry.tab)),
          ),
        ].slice(0, MAX_CLOSED_WORKBENCH_TABS),
      };
    }
  }
  return next === context ? state : withScope(state, key, next, now);
}

/** Browser pages are deleted on close. Restoring their saved ID cannot restore the page. */
export function canRestoreWorkbenchTab(tab: WorkbenchTab, scope: WorkbenchScope): boolean {
  if (
    tab.kind === "browser" ||
    tab.kind === "new-tab" ||
    tab.resource.profileID !== scope.profileID
  )
    return false;
  if (tab.kind === "btw" || tab.kind === "context" || tab.kind === "turn-diff")
    return tab.resource.sessionID === scope.sessionID;
  return true;
}

export function reopenWorkbenchTab(
  state: WorkbenchState,
  scope: WorkbenchScope,
  tabID?: string,
  now = Date.now(),
): {
  state: WorkbenchState;
  result: OpenWorkbenchTabResult | { ok: false; reason: "no-history" };
} {
  const key = workbenchScopeKey(scope);
  const context = state.scopes[key];
  const entry = context?.recentlyClosed?.find(
    (entry) => (!tabID || entry.tab.id === tabID) && canRestoreWorkbenchTab(entry.tab, scope),
  );
  if (!context || !entry) return { state, result: { ok: false, reason: "no-history" } };
  const resourceKey = workbenchTabResourceKey(entry.tab);
  const existing = findTab(context, (tab) => workbenchTabResourceKey(tab) === resourceKey);
  if (existing) {
    return {
      state: withScope(
        state,
        key,
        activateTab(forgetClosedResource(context, resourceKey), existing.pane, existing.tab.id),
        now,
      ),
      result: {
        ok: true,
        tabID: existing.tab.id,
        pane: existing.pane,
        created: false,
        moved: false,
      },
    };
  }
  if (
    [...context.right.tabs, ...context.bottom.tabs].filter((tab) => tab.kind !== "browser")
      .length >= MAX_WORKBENCH_TABS
  )
    return { state, result: { ok: false, reason: "tab-limit" } };
  const tabs = [...context[entry.pane].tabs];
  const tab = findTab(context, (tab) => tab.id === entry.tab.id)
    ? { ...entry.tab, id: defaultTabID() }
    : entry.tab;
  tabs.splice(Math.min(entry.index, tabs.length), 0, tab);
  return {
    state: withScope(
      state,
      key,
      {
        ...forgetClosedResource(context, resourceKey),
        [entry.pane]: { tabs, activeTabID: tab.id, requestedOpen: true },
      },
      now,
    ),
    result: { ok: true, tabID: tab.id, pane: entry.pane, created: true, moved: false },
  };
}

function forgetClosedResource(
  context: WorkbenchContextState,
  resourceKey: string,
): WorkbenchContextState {
  if (!context.recentlyClosed?.some((entry) => workbenchTabResourceKey(entry.tab) === resourceKey))
    return context;
  return {
    ...context,
    recentlyClosed: context.recentlyClosed.filter(
      (entry) => workbenchTabResourceKey(entry.tab) !== resourceKey,
    ),
  };
}

function mutateContext(
  context: WorkbenchContextState,
  mutation: WorkbenchMutation,
): WorkbenchContextState {
  if (mutation.type === "activate") {
    return context[mutation.pane].tabs.some((tab) => tab.id === mutation.tabID)
      ? activateTab(context, mutation.pane, mutation.tabID)
      : context;
  }
  if (mutation.type === "move") {
    if (mutation.from === mutation.to) return context;
    return moveTab(context, mutation.from, mutation.to, mutation.tabID);
  }
  if (mutation.type === "toggle-pane") {
    return {
      ...context,
      [mutation.pane]: {
        ...context[mutation.pane],
        requestedOpen: !context[mutation.pane].requestedOpen,
      },
    };
  }
  const pane = context[mutation.pane];
  const index = pane.tabs.findIndex((tab) => tab.id === mutation.tabID);
  if (index < 0) return context;
  if (mutation.type === "close") {
    const nextPane = removeTab(pane, mutation.tabID);
    return {
      ...context,
      [mutation.pane]:
        nextPane.tabs.length === 0 ? { ...nextPane, requestedOpen: false } : nextPane,
    };
  }
  if (mutation.type === "close-others") {
    const tab = pane.tabs[index]!;
    return {
      ...context,
      [mutation.pane]: { tabs: [tab], activeTabID: tab.id, requestedOpen: true },
    };
  }
  if (mutation.type === "close-to-end") {
    const tabs = pane.tabs.slice(0, index + 1);
    if (tabs.length === pane.tabs.length) return context;
    return {
      ...context,
      [mutation.pane]: {
        ...pane,
        tabs,
        activeTabID: tabs.some((tab) => tab.id === pane.activeTabID)
          ? pane.activeTabID
          : mutation.tabID,
      },
    };
  }
  if (mutation.type === "pin") {
    return {
      ...context,
      [mutation.pane]: {
        ...pane,
        tabs: pane.tabs.map((tab) =>
          tab.id === mutation.tabID ? { ...tab, pinned: mutation.pinned } : tab,
        ),
      },
    };
  }
  const tabs = [...pane.tabs];
  const [tab] = tabs.splice(index, 1);
  tabs.splice(Math.max(0, Math.min(mutation.index, tabs.length)), 0, tab!);
  return { ...context, [mutation.pane]: { ...pane, tabs } };
}

function tabFromInput(
  scope: WorkbenchScope,
  input: OpenWorkbenchTabInput,
  id: string,
): WorkbenchTab {
  if (input.kind === "btw") {
    return {
      id,
      kind: "btw",
      pinned: false,
      resource: {
        profileID: scope.profileID,
        sessionID: scope.sessionID,
        location: input.location,
        questionID: input.questionID,
        question: input.question,
      },
    };
  }
  if (input.kind === "browser") {
    return {
      id,
      kind: "browser",
      pinned: false,
      resource: {
        profileID: scope.profileID,
        sessionID: scope.sessionID,
        location: input.location,
        browserTabID: input.browserTabID,
      },
    };
  }
  if (input.kind === "new-tab") {
    return {
      id,
      kind: "new-tab",
      pinned: false,
      resource: {
        profileID: scope.profileID,
        sessionID: scope.sessionID,
        location: input.location,
        pageID: id,
      },
    };
  }
  if (input.kind === "command") {
    return {
      id,
      kind: input.kind,
      pinned: false,
      resource: {
        profileID: scope.profileID,
        location: input.location,
        shellID: input.shellID,
        sessionID: input.sessionID ?? scope.sessionID,
        command: input.command,
      },
    };
  }
  if (input.kind === "context") {
    return {
      id,
      kind: input.kind,
      pinned: true,
      resource: {
        profileID: scope.profileID,
        location: input.location,
        sessionID: scope.sessionID,
      },
    };
  }
  if (input.kind === "terminal") {
    return {
      id,
      kind: input.kind,
      pinned: false,
      resource: {
        profileID: scope.profileID,
        location: input.location,
        ptyID: input.ptyID,
        sessionID: input.sessionID ?? scope.sessionID,
        transport: input.transport,
        ...(input.readOnly === undefined ? {} : { readOnly: input.readOnly }),
      },
    };
  }
  if (input.kind === "changes") {
    return {
      id,
      kind: input.kind,
      pinned: true,
      resource: {
        profileID: scope.profileID,
        location: input.location,
        mode: input.mode,
        ...(input.sourceSessionID ? { sourceSessionID: input.sourceSessionID } : {}),
      },
    };
  }
  if (input.kind === "workspace-files") {
    return {
      id,
      kind: input.kind,
      pinned: true,
      resource: { profileID: scope.profileID, location: input.location },
    };
  }
  if (input.kind === "turn-diff") {
    return {
      id,
      kind: input.kind,
      pinned: false,
      resource: {
        profileID: scope.profileID,
        location: input.location,
        sessionID: scope.sessionID,
        userMessageID: input.userMessageID,
      },
    };
  }
  if (input.kind === "file") {
    return {
      id,
      kind: input.kind,
      pinned: false,
      resource: {
        profileID: scope.profileID,
        location: input.location,
        path: input.path,
        ...(input.line ? { line: input.line } : {}),
      },
    };
  }
  return {
    id,
    kind: input.kind,
    pinned: false,
    resource: {
      profileID: scope.profileID,
      location: input.location,
      path: input.path,
      mode: input.mode,
      ...(input.sourceSessionID ? { sourceSessionID: input.sourceSessionID } : {}),
    },
  };
}

function updateTabTarget(
  context: WorkbenchContextState,
  pane: WorkbenchPaneID,
  existing: WorkbenchTab,
  candidate: WorkbenchTab,
): WorkbenchContextState {
  if (existing.kind === "changes" && candidate.kind === "changes") {
    if (
      existing.resource.mode === candidate.resource.mode &&
      existing.resource.sourceSessionID === candidate.resource.sourceSessionID
    ) {
      return context;
    }
    return {
      ...context,
      [pane]: {
        ...context[pane],
        tabs: context[pane].tabs.map((tab) =>
          tab.id === existing.id ? { ...existing, resource: candidate.resource } : tab,
        ),
      },
    };
  }
  if (existing.kind !== "file" || candidate.kind !== "file") return context;
  if (existing.resource.line === candidate.resource.line) return context;
  return {
    ...context,
    [pane]: {
      ...context[pane],
      tabs: context[pane].tabs.map((tab) =>
        tab.id === existing.id
          ? {
              ...existing,
              resource: {
                profileID: existing.resource.profileID,
                location: existing.resource.location,
                path: existing.resource.path,
                ...(candidate.resource.line ? { line: candidate.resource.line } : {}),
              },
            }
          : tab,
      ),
    },
  };
}

function emptyContext(now: number): WorkbenchContextState {
  return {
    right: { tabs: [], activeTabID: null, requestedOpen: false },
    bottom: { tabs: [], activeTabID: null, requestedOpen: false },
    updatedAt: now,
  };
}

function findTab(
  context: WorkbenchContextState,
  predicate: (tab: WorkbenchTab) => boolean,
): { pane: WorkbenchPaneID; tab: WorkbenchTab } | null {
  for (const pane of ["right", "bottom"] as const) {
    const tab = context[pane].tabs.find(predicate);
    if (tab) return { pane, tab };
  }
  return null;
}

function activateTab(
  context: WorkbenchContextState,
  pane: WorkbenchPaneID,
  tabID: string,
): WorkbenchContextState {
  return {
    ...context,
    [pane]: { ...context[pane], activeTabID: tabID, requestedOpen: true },
  };
}

function moveTab(
  context: WorkbenchContextState,
  from: WorkbenchPaneID,
  to: WorkbenchPaneID,
  tabID: string,
): WorkbenchContextState {
  const tab = context[from].tabs.find((candidate) => candidate.id === tabID);
  if (!tab) return context;
  return {
    ...context,
    [from]: removeTab(context[from], tabID),
    [to]: {
      ...context[to],
      tabs: [...context[to].tabs, tab],
      activeTabID: tabID,
      requestedOpen: true,
    },
  };
}

function removeTab(pane: WorkbenchPaneState, tabID: string): WorkbenchPaneState {
  const index = pane.tabs.findIndex((tab) => tab.id === tabID);
  if (index < 0) return pane;
  const tabs = pane.tabs.filter((tab) => tab.id !== tabID);
  return {
    tabs,
    activeTabID:
      pane.activeTabID === tabID
        ? (tabs[index]?.id ?? tabs[index - 1]?.id ?? null)
        : pane.activeTabID,
    requestedOpen: pane.requestedOpen,
  };
}

function withScope(
  state: WorkbenchState,
  key: string,
  context: WorkbenchContextState,
  now: number,
): WorkbenchState {
  const scopes = { ...state.scopes, [key]: { ...context, updatedAt: now } };
  return {
    version: 1,
    scopes: Object.fromEntries(
      Object.entries(scopes)
        .toSorted(([, left], [, right]) => right.updatedAt - left.updatedAt)
        .filter(([, context], index) => index < MAX_WORKBENCH_SCOPES || hasBtwTabs(context)),
    ),
  };
}

/** Side answers are retained until their tabs close, even when other scopes age out. */
export function hasBtwTabs(context: WorkbenchContextState): boolean {
  return [...context.right.tabs, ...context.bottom.tabs].some((tab) => tab.kind === "btw");
}

function defaultTabID(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `workbench-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
