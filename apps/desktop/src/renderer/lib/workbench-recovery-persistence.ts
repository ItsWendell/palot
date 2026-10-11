import { parseWorkbenchState } from "./workbench-persistence";
import {
  MAX_CLOSED_WORKBENCH_TABS,
  canRestoreWorkbenchTab,
  workbenchTabResourceKey,
  type ClosedWorkbenchTab,
  type WorkbenchState,
} from "./workbench-tabs";

/** Extend the existing storage contract without duplicating its tab/resource validation. */
export function parseWorkbenchRecoveryState(value: unknown): WorkbenchState {
  const state = parseWorkbenchState(value);
  if (!record(value) || !record(value.scopes)) return state;
  for (const [key, context] of Object.entries(state.scopes)) {
    const saved = value.scopes[key];
    if (!record(saved) || !Array.isArray(saved.recentlyClosed)) continue;
    const [profileID, sessionID] = key.split("\u0000");
    if (!profileID || !sessionID) continue;
    const seen = new Set<string>();
    const history: ClosedWorkbenchTab[] = [];
    for (const entry of saved.recentlyClosed) {
      if (
        !record(entry) ||
        (entry.pane !== "right" && entry.pane !== "bottom") ||
        typeof entry.index !== "number" ||
        !Number.isSafeInteger(entry.index) ||
        entry.index < 0 ||
        typeof entry.closedAt !== "number" ||
        !Number.isFinite(entry.closedAt) ||
        entry.closedAt < 0
      )
        continue;
      const parsed = parseWorkbenchState({
        version: 1,
        scopes: {
          [key]: {
            updatedAt: 0,
            right: { tabs: [entry.tab], activeTabID: null, requestedOpen: false },
            bottom: { tabs: [], activeTabID: null, requestedOpen: false },
          },
        },
      });
      const tab = parsed.scopes[key]?.right.tabs[0];
      if (!tab || !canRestoreWorkbenchTab(tab, { profileID, sessionID })) continue;
      const resourceKey = workbenchTabResourceKey(tab);
      if (seen.has(resourceKey)) continue;
      seen.add(resourceKey);
      history.push({ tab, pane: entry.pane, index: entry.index, closedAt: entry.closedAt });
      if (history.length === MAX_CLOSED_WORKBENCH_TABS) break;
    }
    context.recentlyClosed = history;
  }
  return state;
}

export function isWorkbenchRecoveryState(value: unknown): value is WorkbenchState {
  return (
    record(value) &&
    value.version === 1 &&
    record(value.scopes) &&
    JSON.stringify(parseWorkbenchRecoveryState(value)) === JSON.stringify(value)
  );
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
