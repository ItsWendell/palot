import type { QueryClient } from "@tanstack/react-query";
import type { createStore } from "jotai";
import { attentionTargetAtom } from "../atoms/attention";
import {
  attentionSyncStateAtom,
  sessionCatalogReadyAtom,
  sessionTriageSnapshotAtom,
} from "../atoms/inbox";
import { disabledProfileIDsAtom } from "../atoms/connections";
import {
  inspectorOpenSessionIDsAtom,
  newTaskProjectIDAtom,
  runtimeAtom,
  selectedSessionIDAtom,
} from "../atoms/workspace";
import { setFocusedOpenCodeRuntime } from "../services/opencode-client";
import { palot } from "../services/palot";
import { openCodeReconciler } from "./open-code-reconciler";
import type { OpenCodeRuntimeStatus } from "../../shared";
import { connectionOverview } from "./connection-overview";

type Store = ReturnType<typeof createStore>;
const queues = new WeakMap<Store, Promise<unknown>>();
// IPC switches are not cancellable. Until a successful result is committed, the
// main process may no longer match the renderer (including after a rejected IPC).
const pendingFocusSync = new WeakSet<Store>();
const selections = new WeakMap<
  Store,
  Map<string, { sessionID: string | null; projectID: string | null; inspectors: string[] }>
>();

/** Serialize focus changes, but never route a request through a mutable active-server lookup. */
export function focusConnection(
  queryClient: QueryClient,
  store: Store,
  profileID: string,
  signal?: AbortSignal,
) {
  const run = async () => {
    signal?.throwIfAborted();
    const previous = store.get(runtimeAtom);
    if (previous?.profileID === profileID && !pendingFocusSync.has(store)) {
      const runtime = store.get(disabledProfileIDsAtom).includes(profileID)
        ? { ...previous, connected: false, phase: "stopped" as const }
        : previous;
      setFocusedOpenCodeRuntime(runtime);
      store.set(runtimeAtom, runtime);
      return runtime;
    }
    let runtime: OpenCodeRuntimeStatus;
    let switched = false;
    pendingFocusSync.add(store);
    try {
      if (store.get(disabledProfileIDsAtom).includes(profileID)) {
        const cached = connectionOverview(queryClient)
          .getSnapshot()
          .find((entry) => entry.profile.id === profileID)?.runtime;
        const retained = cached ?? (await palot.runtimeStatus());
        if (retained.profileID !== profileID)
          throw new Error("This server is disabled. Enable it to load its tasks.");
        runtime = { ...retained, connected: false, phase: "stopped" };
      } else {
        runtime = await palot.switchOpenCodeProfile(profileID);
        switched = true;
      }
    } catch (error) {
      const cached = connectionOverview(queryClient)
        .getSnapshot()
        .find((entry) => entry.profile.id === profileID);
      if (!cached?.runtime || cached.sessions.length === 0) throw error;
      runtime = {
        ...cached.runtime,
        connected: false,
        phase: "error",
        error: error instanceof Error ? error.message : "Connection unavailable",
      };
    }
    signal?.throwIfAborted();
    let saved = selections.get(store);
    if (!saved) {
      saved = new Map();
      selections.set(store, saved);
    }
    if (previous)
      saved.set(previous.profileID, {
        sessionID: store.get(selectedSessionIDAtom),
        projectID: store.get(newTaskProjectIDAtom),
        inspectors: store.get(inspectorOpenSessionIDsAtom),
      });
    const next = saved.get(profileID);
    setFocusedOpenCodeRuntime(runtime);
    openCodeReconciler(queryClient).setFocusedConnection(runtime.connectionID);
    store.set(runtimeAtom, runtime);
    if (switched) pendingFocusSync.delete(store);
    store.set(selectedSessionIDAtom, next?.sessionID ?? null);
    store.set(newTaskProjectIDAtom, next?.projectID ?? null);
    store.set(inspectorOpenSessionIDsAtom, next?.inspectors ?? []);
    store.set(attentionTargetAtom, null);
    store.set(sessionCatalogReadyAtom, false);
    store.set(attentionSyncStateAtom, "syncing");
    store.set(sessionTriageSnapshotAtom, null);
    void connectionOverview(queryClient)
      .refreshRegistry()
      .catch(() => undefined);
    return runtime;
  };
  const promise = (queues.get(store) ?? Promise.resolve()).catch(() => undefined).then(run);
  queues.set(store, promise);
  return promise;
}
