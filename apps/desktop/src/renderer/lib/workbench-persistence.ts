import type { LocationRef } from "@opencode/client";
import {
  MAX_WORKBENCH_SCOPES,
  MAX_WORKBENCH_TABS,
  createWorkbenchState,
  hasBtwTabs,
  type BtwFollowUp,
  type BtwQuote,
  type WorkbenchContextState,
  type WorkbenchPaneState,
  type WorkbenchState,
  type WorkbenchTab,
  workbenchTabResourceKey,
  workbenchScopeKey,
} from "./workbench-tabs";

export function parseWorkbenchState(value: unknown): WorkbenchState {
  if (!record(value) || value.version !== 1 || !record(value.scopes)) return createWorkbenchState();
  const scopes = Object.entries(value.scopes)
    .map(([key, context]) => [key, parseContext(context, key)] as const)
    .filter((entry): entry is readonly [string, WorkbenchContextState] => entry[1] !== null)
    .toSorted(([, left], [, right]) => right.updatedAt - left.updatedAt)
    .filter(([, context], index) => index < MAX_WORKBENCH_SCOPES || hasBtwTabs(context));
  return { version: 1, scopes: Object.fromEntries(scopes) };
}

export function isWorkbenchState(value: unknown): value is WorkbenchState {
  if (!record(value) || value.version !== 1 || !record(value.scopes)) return false;
  return JSON.stringify(parseWorkbenchState(value)) === JSON.stringify(value);
}

function parseContext(value: unknown, key: string): WorkbenchContextState | null {
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
        if (tab.kind === "btw" && workbenchScopeKey(tab.resource) !== key) return false;
        const resource = workbenchTabResourceKey(tab);
        if (resource === activeResourceKey && tab.id !== pane.activeTabID) return false;
        if (seenIDs.has(tab.id) || seenResources.has(resource)) return false;
        seenIDs.add(tab.id);
        seenResources.add(resource);
        return true;
      }),
    });
  };
  // Browser pages are the published browser inventory projected into this strip,
  // not user-opened workbench resources. Never truncate their saved placements.
  let otherTabs = 0;
  const limit = (pane: WorkbenchPaneState) =>
    repairPane({
      ...pane,
      tabs: pane.tabs.filter((tab) => tab.kind === "browser" || otherTabs++ < MAX_WORKBENCH_TABS),
    });
  const parsedRight = limit(unique(right));
  const parsedBottom = limit(unique(bottom));
  return {
    right: parsedRight,
    bottom: parsedBottom,
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
  // Reply previews are transient; don't restore arbitrary agent documents across reloads.
  if (value.kind === "html-preview") return null;
  if (value.kind === "btw") {
    const quote = parseBtwQuote(value.resource.quote);
    const followUps = parseBtwFollowUps(value.resource.followUps);
    if (
      !identifier(value.resource.sessionID) ||
      !identifier(value.resource.questionID) ||
      typeof value.resource.question !== "string" ||
      quote === false ||
      followUps === false ||
      // A selection's tab may wait for its first question; any other tab needs one.
      (!value.resource.question.trim() && (!quote || followUps)) ||
      (value.resource.answer !== undefined && typeof value.resource.answer !== "string") ||
      (value.resource.error !== undefined && typeof value.resource.error !== "string")
    )
      return null;
    return {
      id: value.id,
      kind: "btw",
      pinned: value.pinned,
      resource: {
        profileID: value.resource.profileID,
        sessionID: value.resource.sessionID,
        location,
        questionID: value.resource.questionID,
        question: value.resource.question,
        ...(value.resource.answer !== undefined ? { answer: value.resource.answer } : {}),
        ...(value.resource.error !== undefined ? { error: value.resource.error } : {}),
        ...(quote ? { quote } : {}),
        ...(followUps ? { followUps } : {}),
      },
    };
  }
  if (value.kind === "browser" && identifier(value.resource.sessionID)) {
    if (value.resource.browserTabID !== undefined && !identifier(value.resource.browserTabID))
      return null;
    return {
      id: value.id,
      kind: "browser",
      pinned: value.pinned,
      resource: {
        profileID: value.resource.profileID,
        sessionID: value.resource.sessionID,
        location,
        ...(value.resource.browserTabID ? { browserTabID: value.resource.browserTabID } : {}),
      },
    };
  }
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
  if (value.kind === "workspace-files") {
    return {
      id: value.id,
      kind: value.kind,
      pinned: value.pinned,
      resource: { profileID: value.resource.profileID, location },
    };
  }
  if (
    value.kind === "turn-diff" &&
    identifier(value.resource.sessionID) &&
    identifier(value.resource.userMessageID)
  ) {
    return {
      id: value.id,
      kind: value.kind,
      pinned: value.pinned,
      resource: {
        profileID: value.resource.profileID,
        location,
        sessionID: value.resource.sessionID,
        userMessageID: value.resource.userMessageID,
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
    // Older tabs have no range; an unusable end line only drops the range.
    const endLine = optionalLine(value.resource.endLine);
    return {
      id: value.id,
      kind: value.kind,
      pinned: value.pinned,
      resource: {
        profileID: value.resource.profileID,
        location,
        path: value.resource.path,
        ...(line ? { line } : {}),
        ...(line && endLine && endLine > line ? { endLine } : {}),
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

function parseBtwQuote(value: unknown): BtwQuote | undefined | false {
  if (value === undefined) return undefined;
  if (
    !record(value) ||
    typeof value.text !== "string" ||
    !value.text.trim() ||
    !identifier(value.messageID) ||
    (value.truncated !== undefined && typeof value.truncated !== "boolean")
  )
    return false;
  const turnMessageID = optionalIdentifier(value.turnMessageID);
  if (turnMessageID === false) return false;
  return {
    text: value.text,
    ...(value.truncated ? { truncated: true } : {}),
    messageID: value.messageID,
    ...(turnMessageID ? { turnMessageID } : {}),
  };
}

function parseBtwFollowUps(value: unknown): BtwFollowUp[] | undefined | false {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length === 0) return false;
  const followUps: BtwFollowUp[] = [];
  for (const entry of value) {
    if (
      !record(entry) ||
      !identifier(entry.id) ||
      typeof entry.question !== "string" ||
      !entry.question.trim() ||
      (entry.answer !== undefined && typeof entry.answer !== "string") ||
      (entry.error !== undefined && typeof entry.error !== "string")
    )
      return false;
    followUps.push({
      id: entry.id,
      question: entry.question,
      ...(entry.answer !== undefined ? { answer: entry.answer } : {}),
      ...(entry.error !== undefined ? { error: entry.error } : {}),
    });
  }
  return followUps;
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
