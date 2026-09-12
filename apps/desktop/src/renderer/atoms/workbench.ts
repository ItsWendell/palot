import { atom, useAtomValue, useStore } from "jotai";
import { selectAtom } from "jotai/utils";
import { useMemo } from "react";
import { loadPersistedValue, savePersistedValue } from "./persisted";
import { isWorkbenchState, parseWorkbenchState } from "../lib/workbench-persistence";
import {
  EMPTY_WORKBENCH_CONTEXT,
  createWorkbenchState,
  mutateWorkbench,
  openWorkbenchTab,
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
    validate: isWorkbenchState,
    migrate: (value) => parseWorkbenchState(value),
  }),
);
let timer: number | undefined;
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

type WorkbenchCommand =
  | {
      type: "open";
      scope: WorkbenchScope;
      input: OpenWorkbenchTabInput;
      options?: OpenWorkbenchTabOptions;
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
    const next = mutateWorkbench(current, command.scope, command.mutation);
    if (next !== current) set(workbenchStateAtom, next);
    return undefined;
  },
);

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
      activateTab: (pane: WorkbenchPaneID, tabID: string) =>
        mutate({ type: "activate", pane, tabID }),
      closeTab: (pane: WorkbenchPaneID, tabID: string) => mutate({ type: "close", pane, tabID }),
      closeOtherTabs: (pane: WorkbenchPaneID, tabID: string) =>
        mutate({ type: "close-others", pane, tabID }),
      closeTabsToEnd: (pane: WorkbenchPaneID, tabID: string) =>
        mutate({ type: "close-to-end", pane, tabID }),
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
  if (timer !== undefined) window.clearTimeout(timer);
  timer = undefined;
  if (!pending) return;
  savePersistedValue(PERSISTENCE_KEY, pending);
  pending = undefined;
}

function scheduleSave(state: WorkbenchState): void {
  if (typeof window === "undefined") return;
  pending = state;
  if (timer !== undefined) window.clearTimeout(timer);
  timer = window.setTimeout(flushWorkbenchPersistence, 150);
}
