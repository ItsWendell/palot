import { createStore } from "jotai";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FileEditSession } from "../components/workbench-tabs/file-save";
import { createWorkbenchState, workbenchScopeKey } from "../lib/workbench-tabs";
import { flushWorkbenchPersistence, workbenchCommandAtom, workbenchStateAtom } from "./workbench";
import { workbenchFileEditsAtom } from "./workbench-file-edits";

const scope = { profileID: "profile", sessionID: "task" };
const confirm = vi.fn(() => false);
beforeEach(() => {
  Object.defineProperty(window, "confirm", { configurable: true, value: confirm });
  confirm.mockReset().mockReturnValue(false);
});
function setup() {
  const store = createStore();
  store.set(workbenchStateAtom, createWorkbenchState());
  const opened = store.set(workbenchCommandAtom, {
    type: "open",
    scope,
    input: { kind: "file", location: { directory: "/repo" }, path: "a.ts" },
  });
  if (!opened?.ok) throw new Error("Expected a file tab");
  const draft = new FileEditSession();
  draft.receive(new TextEncoder().encode("original"), "original");
  draft.change("mine");
  store.set(workbenchFileEditsAtom, new Map([[opened.tabID, draft]]));
  return { store, tabID: opened.tabID, draft };
}

afterEach(() => {
  flushWorkbenchPersistence();
  vi.restoreAllMocks();
});

it("keeps a dirty tab and its draft when discard is cancelled, then closes after confirmation", () => {
  const { store, tabID, draft } = setup();
  const close = () =>
    store.set(workbenchCommandAtom, {
      type: "mutate",
      scope,
      mutation: { type: "close", pane: "right", tabID },
    });
  close();
  expect(confirm).toHaveBeenCalledOnce();
  expect(store.get(workbenchStateAtom).scopes[workbenchScopeKey(scope)]?.right.tabs).toHaveLength(
    1,
  );
  expect(store.get(workbenchFileEditsAtom).get(tabID)).toBe(draft);
  confirm.mockReturnValue(true);
  close();
  expect(store.get(workbenchStateAtom).scopes[workbenchScopeKey(scope)]?.right.tabs).toHaveLength(
    0,
  );
  expect(store.get(workbenchFileEditsAtom).has(tabID)).toBe(false);
});

it("guards replacing a dirty file and reports cancellation instead of a successful replacement", () => {
  const { store, tabID } = setup();
  expect(
    store.set(workbenchCommandAtom, {
      type: "replace",
      scope,
      pane: "right",
      tabID,
      input: { kind: "workspace-files", location: { directory: "/repo" } },
    }),
  ).toEqual({ ok: false, reason: "cancelled" });
  expect(store.get(workbenchStateAtom).scopes[workbenchScopeKey(scope)]?.right.tabs[0]?.id).toBe(
    tabID,
  );
});

it("retains the draft without asking when moving its tab to another pane", () => {
  const { store, tabID, draft } = setup();
  store.set(workbenchCommandAtom, {
    type: "mutate",
    scope,
    mutation: { type: "move", from: "right", to: "bottom", tabID },
  });
  expect(confirm).not.toHaveBeenCalled();
  expect(store.get(workbenchFileEditsAtom).get(tabID)).toBe(draft);
  expect(store.get(workbenchStateAtom).scopes[workbenchScopeKey(scope)]?.bottom.tabs[0]?.id).toBe(
    tabID,
  );
});

it.each(["close-others", "close-to-end"] as const)("protects dirty files from %s", (type) => {
  const { store, tabID } = setup();
  const opened = store.set(workbenchCommandAtom, {
    type: "open",
    scope,
    input: { kind: "workspace-files", location: { directory: "/repo" } },
  });
  if (!opened?.ok) throw new Error("Expected Files tab");
  store.set(workbenchCommandAtom, {
    type: "mutate",
    scope,
    mutation: { type: "reorder", pane: "right", tabID: opened.tabID, index: 0 },
  });
  store.set(workbenchCommandAtom, {
    type: "mutate",
    scope,
    mutation: { type, pane: "right", tabID: opened.tabID },
  });
  expect(
    store
      .get(workbenchStateAtom)
      .scopes[workbenchScopeKey(scope)]?.right.tabs.some((tab) => tab.id === tabID),
  ).toBe(true);
});
