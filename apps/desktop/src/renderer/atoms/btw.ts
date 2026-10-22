import { atom, type createStore } from "jotai";
import type { LocationRef } from "@opencode/client";
import {
  btwOpenExchange,
  btwPromptFor,
  findBtwTab,
  updateBtwExchange,
  updateBtwTab,
  withBtwQuestion,
} from "../lib/btw";
import { workbenchScopeKey, type BtwQuote, type WorkbenchScope } from "../lib/workbench-tabs";
import { openCodeClient } from "../services/opencode-client";
import { workbenchCommandAtom, workbenchStateAtom } from "./workbench";
import { runtimeAtom } from "./workspace";

type Store = ReturnType<typeof createStore>;
type BtwRequest = {
  scope: WorkbenchScope;
  tabID: string;
  exchangeID: string;
  controller: AbortController;
};
type BtwOwner = WorkbenchScope & { connectionID: string; location: LocationRef };
export const btwPendingAtom = atom<ReadonlySet<string>>(new Set<string>());
/** A side chat whose question field should take focus once it renders. */
export const btwFocusRequestAtom = atom<string | null>(null);
export const btwRequestKey = (scope: WorkbenchScope, tabID: string) =>
  `${workbenchScopeKey(scope)}\u0000${tabID}`;

/** A window/store owns requests, not a mounted composer or the currently selected session. */
const managers = new WeakMap<Store, ReturnType<typeof createManager>>();
function manager(store: Store) {
  let value = managers.get(store);
  if (!value) {
    value = createManager(store);
    managers.set(store, value);
  }
  return value;
}

function createManager(store: Store) {
  const requests = new Map<string, BtwRequest>();
  const publish = () => store.set(btwPendingAtom, new Set(requests.keys()));
  // Covers every close path, including close-others, rather than relying on UI unmounts.
  store.sub(workbenchStateAtom, () => {
    for (const [key, request] of requests) {
      if (findBtwTab(store.get(workbenchStateAtom), request.scope, request.tabID)) continue;
      requests.delete(key);
      request.controller.abort();
      publish();
    }
  });
  const finish = (key: string, request: BtwRequest) => {
    if (requests.get(key) !== request) return;
    requests.delete(key);
    publish();
  };
  const write = (request: BtwRequest, result: { answer?: string; error?: string }) =>
    store.set(workbenchStateAtom, (state) =>
      updateBtwTab(state, request.scope, request.tabID, (current) => ({
        ...current,
        resource: updateBtwExchange(current.resource, request.exchangeID, result),
      })),
    );
  return {
    async generate(scope: WorkbenchScope, tabID: string, connectionID: string) {
      const key = btwRequestKey(scope, tabID);
      const tab = findBtwTab(store.get(workbenchStateAtom), scope, tabID);
      if (!tab || requests.has(key)) return;
      const exchange = btwOpenExchange(tab.resource);
      if (!exchange) return;
      const controller = new AbortController();
      const request: BtwRequest = { scope, tabID, exchangeID: exchange.id, controller };
      requests.set(key, request);
      publish();
      const update = (result: { answer?: string; error?: string }) => {
        if (controller.signal.aborted || requests.get(key) !== request) return;
        write(request, result);
      };
      update({});
      try {
        const result = await openCodeClient(connectionID).session.generate(
          { sessionID: scope.sessionID, prompt: btwPromptFor(tab.resource, exchange.id) },
          { signal: controller.signal },
        );
        const answer = result.text.trim();
        if (!answer) throw new Error("No answer was returned. Try again.");
        update({ answer });
      } catch (error) {
        update({
          error: error instanceof Error ? error.message : "Could not answer this question.",
        });
      } finally {
        finish(key, request);
      }
    },
    cancel(scope: WorkbenchScope, tabID: string) {
      const key = btwRequestKey(scope, tabID);
      const request = requests.get(key);
      if (!request) return;
      finish(key, request);
      request.controller.abort();
      write(request, { error: "Stopped before an answer arrived." });
    },
    isPending(scope: WorkbenchScope, tabID: string) {
      return requests.has(btwRequestKey(scope, tabID));
    },
  };
}

export function askBtw(store: Store, owner: BtwOwner, value: string): void {
  const question = value.trim();
  if (!question) throw new Error("Enter a question after /btw.");
  assertOwnerConnection(store, owner, owner.connectionID);
  const result = store.set(workbenchCommandAtom, {
    type: "open",
    scope: owner,
    input: { kind: "btw", location: owner.location, questionID: crypto.randomUUID(), question },
    options: { pane: "right" },
  });
  if (!result?.ok) throw new Error(TAB_LIMIT_MESSAGE);
  void manager(store).generate(owner, result.tabID, owner.connectionID);
}

const TAB_LIMIT_MESSAGE = "Close a workbench tab before asking another side question.";

/**
 * Opens a side chat about text selected in a response. Nothing is generated until
 * the user writes the question in the tab, which receives focus.
 */
export function askAboutSelection(store: Store, owner: BtwOwner, quote: BtwQuote): string {
  if (!quote.text.trim()) throw new Error("Select some text in a response first.");
  assertOwnerConnection(store, owner, owner.connectionID);
  const result = store.set(workbenchCommandAtom, {
    type: "open",
    scope: owner,
    input: {
      kind: "btw",
      location: owner.location,
      questionID: crypto.randomUUID(),
      question: "",
      quote,
    },
    options: { pane: "right" },
  });
  if (!result?.ok) throw new Error(TAB_LIMIT_MESSAGE);
  store.set(btwFocusRequestAtom, result.tabID);
  return result.tabID;
}

/** Asks the side chat's next question (its first, a follow-up, or a replacement). */
export function submitBtwQuestion(
  store: Store,
  scope: WorkbenchScope,
  tabID: string,
  connectionID: string,
  value: string,
): void {
  const question = value.trim();
  if (!question) throw new Error("Enter a question.");
  assertOwnerConnection(store, scope, connectionID);
  const requests = manager(store);
  if (requests.isPending(scope, tabID)) throw new Error("Wait for the current answer first.");
  const tab = findBtwTab(store.get(workbenchStateAtom), scope, tabID);
  if (!tab) throw new Error("This side question was closed.");
  const resource = withBtwQuestion(tab.resource, question, crypto.randomUUID());
  store.set(workbenchStateAtom, (state) =>
    updateBtwTab(state, scope, tabID, (current) => ({ ...current, resource })),
  );
  void requests.generate(scope, tabID, connectionID);
}

/** Stops a pending side answer; the question stays and can be retried. */
export function cancelBtw(store: Store, scope: WorkbenchScope, tabID: string): void {
  manager(store).cancel(scope, tabID);
}

export function retryBtw(
  store: Store,
  scope: WorkbenchScope,
  tabID: string,
  connectionID: string,
): void {
  assertOwnerConnection(store, scope, connectionID);
  void manager(store).generate(scope, tabID, connectionID);
}

function assertOwnerConnection(store: Store, scope: WorkbenchScope, connectionID: string) {
  const runtime = store.get(runtimeAtom);
  if (
    !runtime?.connected ||
    runtime.profileID !== scope.profileID ||
    runtime.connectionID !== connectionID
  )
    throw new Error("Connect to this task’s server to ask a side question.");
}
