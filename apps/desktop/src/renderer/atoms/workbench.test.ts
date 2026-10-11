import { createStore } from "jotai";
import { afterEach, beforeEach, expect, it } from "vitest";
import { loadPersistedValue, persistedStorageKey } from "./persisted";
import {
  workbenchCommandAtom,
  workbenchReopenAtom,
  workbenchStateAtom,
  flushWorkbenchPersistence,
} from "./workbench";
import { createWorkbenchState, workbenchScopeKey } from "../lib/workbench-tabs";
import {
  isWorkbenchRecoveryState,
  parseWorkbenchRecoveryState,
} from "../lib/workbench-recovery-persistence";

beforeEach(() => {
  const entries = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => entries.get(key) ?? null,
      setItem: (key: string, value: string) => entries.set(key, value),
      removeItem: (key: string) => entries.delete(key),
    },
  });
});

afterEach(() => {
  flushWorkbenchPersistence();
  window.localStorage.removeItem(persistedStorageKey("workspace.workbench"));
});

it("persists closed descriptors without reopening resources, then reopens on command in the owning scope", () => {
  const scope = { profileID: "profile", sessionID: "task" };
  const store = createStore();
  store.set(workbenchStateAtom, createWorkbenchState());
  const opened = store.set(workbenchCommandAtom, {
    type: "open",
    scope,
    input: {
      kind: "terminal",
      location: { directory: "/repo" },
      ptyID: "live-pty",
      transport: "persistent",
      sessionID: "child-task",
      readOnly: true,
    },
    options: { pane: "right" },
  });
  if (!opened?.ok) throw new Error("Expected a tab");
  store.set(workbenchCommandAtom, {
    type: "mutate",
    scope,
    mutation: { type: "close", pane: "right", tabID: opened.tabID },
  });
  flushWorkbenchPersistence();
  const saved = loadPersistedValue({
    key: "workspace.workbench",
    initialValue: createWorkbenchState(),
    validate: isWorkbenchRecoveryState,
    migrate: parseWorkbenchRecoveryState,
  });
  const key = workbenchScopeKey(scope);
  expect(saved.scopes[key]?.right.tabs).toEqual([]);
  expect(saved.scopes[key]?.recentlyClosed).toMatchObject([
    { tab: { resource: { ptyID: "live-pty", sessionID: "child-task", readOnly: true } } },
  ]);
  store.set(workbenchStateAtom, saved);
  expect(store.set(workbenchReopenAtom, { ...scope, profileID: "another-server" })).toEqual({
    ok: false,
    reason: "no-history",
  });
  expect(store.set(workbenchReopenAtom, scope)).toMatchObject({
    ok: true,
    pane: "right",
    tabID: opened.tabID,
  });
  expect(store.get(workbenchStateAtom).scopes[key]?.right.tabs).toMatchObject([
    { resource: { ptyID: "live-pty", sessionID: "child-task", readOnly: true } },
  ]);
  expect(store.get(workbenchStateAtom).scopes[key]?.recentlyClosed).toEqual([]);
});
