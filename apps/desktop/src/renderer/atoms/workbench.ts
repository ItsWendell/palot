import { atom, useAtomValue, useStore } from "jotai";
import { selectAtom } from "jotai/utils";
import { useMemo } from "react";
import { loadPersistedValue, persistedAtom, savePersistedValue } from "./persisted";
import { isBrowserRecentSites, type BrowserRecentSites } from "../lib/browser-recent-sites";
import {
  isWorkbenchRecoveryState,
  parseWorkbenchRecoveryState,
} from "../lib/workbench-recovery-persistence";
import {
  EMPTY_WORKBENCH_CONTEXT,
  createWorkbenchState,
  mutateWorkbench,
  openWorkbenchTab,
  reopenWorkbenchTab,
  replaceWorkbenchTab,
  workbenchScopeKey,
  type OpenWorkbenchTabInput,
  type OpenWorkbenchTabOptions,
  type OpenWorkbenchTabResult,
  type WorkbenchMutation,
  type WorkbenchPaneID,
  type WorkbenchScope,
  type WorkbenchState,
} from "../lib/workbench-tabs";

const PERSISTENCE_KEY = "workspace.workbench";
const valueAtom = atom(
  loadPersistedValue({
    key: PERSISTENCE_KEY,
    initialValue: createWorkbenchState(),
    validate: isWorkbenchRecoveryState,
    migrate: (value) => parseWorkbenchRecoveryState(value),
  }),
);
let timer: ReturnType<typeof setTimeout> | undefined;
let pending: WorkbenchState | undefined;

export const workbenchStateAtom = atom(
  (get) => get(valueAtom),
  (get, set, update: WorkbenchState | ((state: WorkbenchState) => WorkbenchState)) => {
    const next = typeof update === "function" ? update(get(valueAtom)) : update;
    set(valueAtom, next);
    scheduleSave(next);
  },
);

export const contextMessageTargetAtom = atom<{
  sessionID: string;
  messageID: string;
} | null>(null);

/** Asks the task's transcript to scroll to a user message's turn or a compaction row. */
export const transcriptJumpTargetAtom = atom<{
  sessionID: string;
  messageID: string;
} | null>(null);

/** Sites opened in the task browser, per connection profile, for New tab suggestions. */
export const browserRecentSitesAtom = persistedAtom<BrowserRecentSites>({
  key: "browser.recent-sites",
  initialValue: {},
  validate: isBrowserRecentSites,
});

type WorkbenchCommand =
  | {
      type: "open";
      scope: WorkbenchScope;
      input: OpenWorkbenchTabInput;
      options?: OpenWorkbenchTabOptions;
    }
  | {
      type: "replace";
      scope: WorkbenchScope;
      pane: WorkbenchPaneID;
      tabID: string;
      input: OpenWorkbenchTabInput;
      options?: Pick<OpenWorkbenchTabOptions, "moveExisting">;
    }
  | { type: "mutate"; scope: WorkbenchScope; mutation: WorkbenchMutation };

export const workbenchCommandAtom = atom(
  null,
  (get, set, command: WorkbenchCommand): OpenWorkbenchTabResult | undefined => {
    const current = get(workbenchStateAtom);
    if (command.type === "open") {
      const next = openWorkbenchTab(current, command.scope, command.input, command.options);
      set(workbenchStateAtom, next.state);
      return next.result;
    }
    if (command.type === "replace") {
      const next = replaceWorkbenchTab(
        current,
        command.scope,
        command.pane,
        command.tabID,
        command.input,
        command.options,
      );
      if (next.state !== current) set(workbenchStateAtom, next.state);
      return next.result;
    }
    const next = mutateWorkbench(current, command.scope, command.mutation);
    if (next !== current) set(workbenchStateAtom, next);
    return undefined;
  },
);

export const workbenchReopenAtom = atom(null, (get, set, scope: WorkbenchScope, tabID?: string) => {
  const current = get(workbenchStateAtom);
  const next = reopenWorkbenchTab(current, scope, tabID);
  if (next.state !== current) set(workbenchStateAtom, next.state);
  return next.result;
});

export function useWorkbenchScope(scope: WorkbenchScope | null) {
  const key = scope ? workbenchScopeKey(scope) : null;
  const selected = useMemo(
    () =>
      selectAtom(workbenchStateAtom, (state) =>
        key ? (state.scopes[key] ?? EMPTY_WORKBENCH_CONTEXT) : EMPTY_WORKBENCH_CONTEXT,
      ),
    [key],
  );
  return useAtomValue(selected);
}

export function useWorkbenchCommands(scope: WorkbenchScope | null) {
  const store = useStore();
  const profileID = scope?.profileID;
  const sessionID = scope?.sessionID;
  return useMemo(() => {
    const currentScope = profileID && sessionID ? { profileID, sessionID } : null;
    const mutate = (mutation: WorkbenchMutation) => {
      if (currentScope) {
        store.set(workbenchCommandAtom, { type: "mutate", scope: currentScope, mutation });
      }
    };
    return {
      openTab: (input: OpenWorkbenchTabInput, options?: OpenWorkbenchTabOptions) =>
        currentScope
          ? store.set(workbenchCommandAtom, {
              type: "open",
              scope: currentScope,
              input,
              options,
            })
          : ({ ok: false, reason: "tab-limit" } as const),
      /** Turns a tab (a New tab page) into another surface, or focuses that surface. */
      replaceTab: (
        pane: WorkbenchPaneID,
        tabID: string,
        input: OpenWorkbenchTabInput,
        options?: Pick<OpenWorkbenchTabOptions, "moveExisting">,
      ) =>
        currentScope
          ? store.set(workbenchCommandAtom, {
              type: "replace",
              scope: currentScope,
              pane,
              tabID,
              input,
              options,
            })
          : ({ ok: false, reason: "tab-limit" } as const),
      activateTab: (pane: WorkbenchPaneID, tabID: string) =>
        mutate({ type: "activate", pane, tabID }),
      closeTab: (pane: WorkbenchPaneID, tabID: string) => mutate({ type: "close", pane, tabID }),
      closeOtherTabs: (pane: WorkbenchPaneID, tabID: string) =>
        mutate({ type: "close-others", pane, tabID }),
      closeTabsToEnd: (pane: WorkbenchPaneID, tabID: string) =>
        mutate({ type: "close-to-end", pane, tabID }),
      reopenTab: (tabID?: string) =>
        currentScope
          ? store.set(workbenchReopenAtom, currentScope, tabID)
          : ({ ok: false, reason: "no-history" } as const),
      moveTab: (from: WorkbenchPaneID, to: WorkbenchPaneID, tabID: string) =>
        mutate({ type: "move", from, to, tabID }),
      reorderTab: (pane: WorkbenchPaneID, tabID: string, index: number) =>
        mutate({ type: "reorder", pane, tabID, index }),
      setTabPinned: (pane: WorkbenchPaneID, tabID: string, pinned: boolean) =>
        mutate({ type: "pin", pane, tabID, pinned }),
      togglePane: (pane: WorkbenchPaneID) => mutate({ type: "toggle-pane", pane }),
    };
  }, [profileID, sessionID, store]);
}

export function flushWorkbenchPersistence(): void {
  if (timer !== undefined) clearTimeout(timer);
  timer = undefined;
  // A debounced save can fire after its window is gone (a torn-down test environment);
  // there is nothing left to persist to then.
  if (!pending || typeof window === "undefined") return;
  savePersistedValue(PERSISTENCE_KEY, pending);
  pending = undefined;
}

function scheduleSave(state: WorkbenchState): void {
  if (typeof window === "undefined") return;
  window.addEventListener("pagehide", flushWorkbenchPersistence);
  window.addEventListener("beforeunload", flushWorkbenchPersistence);
  pending = state;
  if (timer !== undefined) clearTimeout(timer);
  timer = setTimeout(flushWorkbenchPersistence, 150);
}
