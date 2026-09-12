import type { LocationRef } from "@opencode/client";
import {
  MAX_WORKBENCH_SCOPES,
  MAX_WORKBENCH_TABS,
  createWorkbenchState,
  type WorkbenchContextState,
  type WorkbenchPaneState,
  type WorkbenchState,
  type WorkbenchTab,
  workbenchTabResourceKey,
} from "./workbench-tabs";

export function parseWorkbenchState(value: unknown): WorkbenchState {
  if (!record(value) || value.version !== 1 || !record(value.scopes)) return createWorkbenchState();
  const scopes = Object.entries(value.scopes)
    .map(([key, context]) => [key, parseContext(context)] as const)
    .filter((entry): entry is readonly [string, WorkbenchContextState] => entry[1] !== null)
    .toSorted(([, left], [, right]) => right.updatedAt - left.updatedAt)
    .slice(0, MAX_WORKBENCH_SCOPES);
  return { version: 1, scopes: Object.fromEntries(scopes) };
}

export function isWorkbenchState(value: unknown): value is WorkbenchState {
  if (!record(value) || value.version !== 1 || !record(value.scopes)) return false;
  return JSON.stringify(parseWorkbenchState(value)) === JSON.stringify(value);
}

function parseContext(value: unknown): WorkbenchContextState | null {
  if (!record(value)) return null;
  const right = parsePane(value.right);
  const bottom = parsePane(value.bottom);
  if (!right || !bottom || !number(value.updatedAt)) return null;
  const seenIDs = new Set<string>();
  const seenResources = new Set<string>();
  const unique = (pane: WorkbenchPaneState) => {
    const activeResource = pane.tabs.find((tab) => tab.id === pane.activeTabID);
    const activeResourceKey = activeResource ? workbenchTabResourceKey(activeResource) : null;
    return repairPane({
      ...pane,
      tabs: pane.tabs.filter((tab) => {
        const resource = workbenchTabResourceKey(tab);
        if (resource === activeResourceKey && tab.id !== pane.activeTabID) return false;
        if (seenIDs.has(tab.id) || seenResources.has(resource)) return false;
        seenIDs.add(tab.id);
        seenResources.add(resource);
        return true;
      }),
    });
  };
  const parsedRight = unique(right);
  const parsedBottom = unique(bottom);
  return {
    right: parsedRight,
    bottom: repairPane({
      ...parsedBottom,
      tabs: parsedBottom.tabs.slice(0, Math.max(0, MAX_WORKBENCH_TABS - parsedRight.tabs.length)),
    }),
    updatedAt: value.updatedAt,
  };
}

function parsePane(value: unknown): WorkbenchPaneState | null {
  if (!record(value) || !Array.isArray(value.tabs) || typeof value.requestedOpen !== "boolean") {
    return null;
  }
  return repairPane({
    tabs: value.tabs.map(parseTab).filter((tab): tab is WorkbenchTab => tab !== null),
    activeTabID:
      value.activeTabID === null || identifier(value.activeTabID) ? value.activeTabID : null,
    requestedOpen: value.requestedOpen,
  });
}

function repairPane(pane: WorkbenchPaneState): WorkbenchPaneState {
  return {
    tabs: pane.tabs,
    activeTabID: pane.tabs.some((tab) => tab.id === pane.activeTabID)
      ? pane.activeTabID
      : (pane.tabs[0]?.id ?? null),
    requestedOpen: pane.tabs.length > 0 && pane.requestedOpen,
  };
}

function parseTab(value: unknown): WorkbenchTab | null {
  if (
    !record(value) ||
    !identifier(value.id) ||
    typeof value.pinned !== "boolean" ||
    !record(value.resource) ||
    !identifier(value.resource.profileID)
  ) {
    return null;
  }
  const location = parseLocation(value.resource.location);
  const sourceSessionID = optionalIdentifier(value.resource.sourceSessionID);
  if (!location || sourceSessionID === false) return null;
  if (value.kind === "context" && identifier(value.resource.sessionID)) {
    return {
      id: value.id,
      kind: value.kind,
      pinned: value.pinned,
      resource: {
        profileID: value.resource.profileID,
        location,
        sessionID: value.resource.sessionID,
      },
    };
  }
  if (value.kind === "changes") {
    const mode = value.resource.mode === "branch" ? "branch" : "working";
    return {
      id: value.id,
      kind: value.kind,
      pinned: value.pinned,
      resource: {
        profileID: value.resource.profileID,
        location,
        mode,
        ...(sourceSessionID ? { sourceSessionID } : {}),
      },
    };
  }
  if (
    value.kind === "file-diff" &&
    path(value.resource.path) &&
    (value.resource.mode === "working" || value.resource.mode === "branch")
  ) {
    return {
      id: value.id,
      kind: value.kind,
      pinned: value.pinned,
      resource: {
        profileID: value.resource.profileID,
        location,
        path: value.resource.path,
        mode: value.resource.mode,
        ...(sourceSessionID ? { sourceSessionID } : {}),
      },
    };
  }
  if (value.kind === "file" && path(value.resource.path)) {
    const line = optionalLine(value.resource.line);
    if (line === false) return null;
    return {
      id: value.id,
      kind: value.kind,
      pinned: value.pinned,
      resource: {
        profileID: value.resource.profileID,
        location,
        path: value.resource.path,
        ...(line ? { line } : {}),
      },
    };
  }
  if (value.kind === "terminal" && identifier(value.resource.ptyID)) {
    const sessionID = optionalIdentifier(value.resource.sessionID);
    if (sessionID === false) return null;
    return {
      id: value.id,
      kind: value.kind,
      pinned: value.pinned,
      resource: {
        profileID: value.resource.profileID,
        location,
        ptyID: value.resource.ptyID,
        ...(sessionID ? { sessionID } : {}),
        transport: value.resource.transport === "persistent" ? "persistent" : "legacy",
        ...(typeof value.resource.readOnly === "boolean"
          ? { readOnly: value.resource.readOnly }
          : {}),
      },
    };
  }
  if (
    value.kind === "command" &&
    identifier(value.resource.shellID) &&
    typeof value.resource.command === "string"
  ) {
    const sessionID = optionalIdentifier(value.resource.sessionID);
    if (sessionID === false) return null;
    return {
      id: value.id,
      kind: value.kind,
      pinned: value.pinned,
      resource: {
        profileID: value.resource.profileID,
        location,
        shellID: value.resource.shellID,
        command: value.resource.command,
        ...(sessionID ? { sessionID } : {}),
      },
    };
  }
  return null;
}

function parseLocation(value: unknown): LocationRef | null {
  if (!record(value) || !path(value.directory)) return null;
  const workspaceID = optionalIdentifier(value.workspaceID);
  if (workspaceID === false) return null;
  return { directory: value.directory, ...(workspaceID ? { workspaceID } : {}) };
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function identifier(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 512;
}

function optionalIdentifier(value: unknown): string | undefined | false {
  return value === undefined ? undefined : identifier(value) ? value : false;
}

function path(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 16_384;
}

function number(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function optionalLine(value: unknown): number | undefined | false {
  return value === undefined
    ? undefined
    : typeof value === "number" && Number.isSafeInteger(value) && value > 0
      ? value
      : false;
}
