import { atom, type createStore } from "jotai";
import type { LocationRef } from "@opencode/client";
import { btwPrompt, findBtwTab, updateBtwTab } from "../lib/btw";
import { workbenchScopeKey, type WorkbenchScope } from "../lib/workbench-tabs";
import { openCodeClient } from "../services/opencode-client";
import { workbenchCommandAtom, workbenchStateAtom } from "./workbench";
import { runtimeAtom } from "./workspace";

type Store = ReturnType<typeof createStore>;
export const btwPendingAtom = atom<ReadonlySet<string>>(new Set<string>());
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
  const requests = new Map<
    string,
    { scope: WorkbenchScope; tabID: string; controller: AbortController }
  >();
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
  return {
    async generate(scope: WorkbenchScope, tabID: string, connectionID: string) {
      const key = btwRequestKey(scope, tabID);
      const tab = findBtwTab(store.get(workbenchStateAtom), scope, tabID);
      if (!tab || requests.has(key)) return;
      const controller = new AbortController();
      const request = { scope, tabID, controller };
      requests.set(key, request);
      publish();
      const update = (result: { answer?: string; error?: string }) => {
        if (controller.signal.aborted || requests.get(key) !== request) return;
        store.set(workbenchStateAtom, (state) =>
          updateBtwTab(state, scope, tabID, (current) => {
            const { answer: _answer, error: _error, ...resource } = current.resource;
            return { ...current, resource: { ...resource, ...result } };
          }),
        );
      };
      update({});
      try {
        const result = await openCodeClient(connectionID).session.generate(
          { sessionID: scope.sessionID, prompt: btwPrompt(tab.resource.question) },
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
        if (requests.get(key) === request) {
          requests.delete(key);
          publish();
        }
      }
    },
  };
}

export function askBtw(
  store: Store,
  owner: WorkbenchScope & { connectionID: string; location: LocationRef },
  value: string,
): void {
  const question = value.trim();
  if (!question) throw new Error("Enter a question after /btw.");
  assertOwnerConnection(store, owner, owner.connectionID);
  const result = store.set(workbenchCommandAtom, {
    type: "open",
    scope: owner,
    input: { kind: "btw", location: owner.location, questionID: crypto.randomUUID(), question },
    options: { pane: "right" },
  });
  if (!result?.ok) throw new Error("Close a workbench tab before asking another side question.");
  void manager(store).generate(owner, result.tabID, owner.connectionID);
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
