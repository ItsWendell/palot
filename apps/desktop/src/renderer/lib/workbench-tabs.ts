import type { LocationRef } from "@opencode/client";
import type { PalotPtyTransport } from "../../shared";
import { locationKey } from "./opencode-query";

export type WorkbenchPaneID = "right" | "bottom";
export type WorkbenchReviewMode = "working" | "branch";

type TabBase = { id: string; pinned: boolean };

export type WorkbenchTab =
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
      kind: "file";
      resource: {
        profileID: string;
        location: LocationRef;
        path: string;
        line?: number;
      };
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
  updatedAt: number;
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
  if (tab.kind === "context") {
    return `context\u0000${tab.resource.profileID}\u0000${tab.resource.sessionID}`;
  }
  if (tab.kind === "changes") return `changes\u0000${location}`;
  if (tab.kind === "terminal") return `terminal\u0000${location}\u0000${tab.resource.ptyID}`;
  if (tab.kind === "command") return `command\u0000${location}\u0000${tab.resource.shellID}`;
  if (tab.kind === "file") return `file\u0000${location}\u0000${tab.resource.path}`;
  return `file-diff\u0000${location}\u0000${tab.resource.mode}\u0000${tab.resource.path}`;
}

export function workbenchTabTitle(tab: WorkbenchTab): string {
  if (tab.kind === "context") return "Context";
  if (tab.kind === "changes") return "Changes";
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
  const context = state.scopes[key] ?? emptyContext(now);
  const candidate = tabFromInput(scope, input, createID());
  const resourceKey = workbenchTabResourceKey(candidate);
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
  if (context.right.tabs.length + context.bottom.tabs.length >= MAX_WORKBENCH_TABS) {
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
  const next = mutateContext(context, mutation);
  return next === context ? state : withScope(state, key, next, now);
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
        .slice(0, MAX_WORKBENCH_SCOPES),
    ),
  };
}

function defaultTabID(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `workbench-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
