import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { Provider, createStore } from "jotai";
import { afterEach, expect, it, vi } from "vitest";
import type {
  AutomationChangedEvent,
  AutomationSnapshot,
  OpenCodeRuntimeStatus,
} from "../../shared";
import { runtimeAtom } from "../atoms/workspace";
import { automationSnapshotsAtom } from "../atoms/automations";
import { palot } from "../services/palot";
import { useAutomations } from "./use-automations";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("isolates a delayed old-profile snapshot and ignores unrelated change events", async () => {
  const store = createStore();
  store.set(runtimeAtom, runtime("a"));
  let resolveA!: (value: AutomationSnapshot) => void;
  const load = vi.spyOn(palot, "loadAutomations").mockImplementation(async (profileID) =>
    profileID === "a"
      ? new Promise((resolve) => {
          resolveA = resolve;
        })
      : snapshot(profileID),
  );
  const listeners = new Set<(event: AutomationChangedEvent) => void>();
  vi.spyOn(palot, "onAutomationChanged").mockImplementation((listener) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  });
  const runtimeStatus = vi.spyOn(palot, "runtimeStatus");
  const hook = renderHook(() => useAutomations(), {
    wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
  });
  await act(async () => {
    store.set(runtimeAtom, runtime("b"));
  });
  await waitFor(() => expect(hook.result.current.snapshot?.profileID).toBe("b"));
  await act(async () => {
    resolveA(snapshot("a"));
  });
  expect(hook.result.current.snapshot?.profileID).toBe("b");
  expect(store.get(automationSnapshotsAtom).a?.profileID).toBe("a");
  expect(store.get(runtimeAtom)?.profileID).toBe("b");
  act(() => {
    for (const listener of listeners) listener({ profileID: "a" });
  });
  expect(load).toHaveBeenCalledTimes(2);
  expect(runtimeStatus).not.toHaveBeenCalled();
});

it("keeps an in-flight mutation on its original profile after selection changes", async () => {
  const store = createStore();
  store.set(runtimeAtom, runtime("a"));
  let resolve!: (value: AutomationSnapshot) => void;
  const dispatch = vi.spyOn(palot, "dispatchAutomation").mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const hook = renderHook(() => useAutomations(false), {
    wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
  });
  let pending!: Promise<AutomationSnapshot>;
  act(() => {
    pending = hook.result.current.dispatch({ type: "mark-all-read" });
    store.set(runtimeAtom, runtime("b"));
  });
  await act(async () => {
    resolve(snapshot("a"));
    await pending;
  });
  expect(dispatch).toHaveBeenCalledWith({ type: "mark-all-read", profileID: "a" });
  expect(hook.result.current.snapshot).toBeNull();
  expect(store.get(automationSnapshotsAtom).a).toEqual(snapshot("a"));
});

function snapshot(profileID: string): AutomationSnapshot {
  return { profileID, automations: [], runs: [] };
}
function runtime(profileID: string): OpenCodeRuntimeStatus {
  return { profileID, connectionID: profileID, connected: true } as OpenCodeRuntimeStatus;
}
