import type { Browser } from "@opencode/plugin-browser/rpc";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { afterEach, expect, it, vi } from "vitest";
import { experimentalBrowserAtom } from "../atoms/ui";
import { workbenchStateAtom } from "../atoms/workbench";
import { browserViewportsAtom } from "./browser-webview-hosts";
import { workbenchScopeKey } from "../lib/workbench-tabs";
import { palot } from "../services/palot";
import { BrowserSessionManager } from "./browser-session-manager";

const catalog = vi.hoisted(() => ({
  sessions: [
    { id: "A", location: { directory: "/repo" } },
    { id: "B", location: { directory: "/repo" } },
  ],
}));
vi.mock("../hooks/use-session-catalog", () => ({
  useSessionCatalogSelector: (select: (sessions: typeof catalog.sessions) => unknown) =>
    select(catalog.sessions),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("retains each session guest across settings and switches, hides inactive guests, and releases them on disable or connection change", async () => {
  const store = createStore();
  store.set(experimentalBrowserAtom, true);
  const register = vi
    .spyOn(palot, "browserRegister")
    .mockImplementation(async ({ sessionID, connectionID }) => `${connectionID}-${sessionID}`);
  const close = vi.spyOn(palot, "browserClose").mockResolvedValue(undefined);
  const listeners = new Set<Parameters<typeof palot.onBrowserEvent>[0]>();
  vi.spyOn(palot, "onBrowserEvent").mockImplementation((listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  });
  const emit = (event: Parameters<Parameters<typeof palot.onBrowserEvent>[0]>[0]) => {
    for (const listener of listeners) listener(event);
  };
  const view = (connectionID: string, sessionID: string | null) => (
    <Provider store={store}>
      <BrowserSessionManager
        key={connectionID}
        connectionID={connectionID}
        profileID="profile"
        sessionID={sessionID}
      />
    </Provider>
  );
  const mounted = render(view("one", "A"));
  await waitFor(() =>
    expect(register).toHaveBeenCalledWith({
      connectionID: "one",
      profileID: "profile",
      sessionID: "A",
    }),
  );
  await act(async () => {
    emit({
      type: "hosts",
      bindingID: "one-A",
      hosts: [{ tabID: "tab-A" as Browser.TabID, leaseID: "lease-A", partition: "persist:A" }],
    });
    emit({
      type: "state",
      bindingID: "one-A",
      state: {
        tabs: [
          {
            id: "tab-A" as Browser.TabID,
            url: "about:blank",
            title: "A",
            loading: false,
            canGoBack: false,
            canGoForward: false,
            generation: 0,
          },
        ],
        focusedTabID: "tab-A" as Browser.TabID,
      },
    });
    emit({ bindingID: "one-A", type: "focus", tabID: "tab-A" as Browser.TabID });
  });
  const hostA = mounted.container.querySelector('webview[partition="persist:A"]');
  expect(hostA).not.toBeNull();
  const scopeA = workbenchScopeKey({ profileID: "profile", sessionID: "A" });
  const activeTabID = store.get(workbenchStateAtom).scopes[scopeA]?.right.activeTabID;
  expect(activeTabID).toBeTruthy();

  await act(async () => {
    store.set(browserViewportsAtom, {
      [scopeA]: { bindingID: "one-A", tabID: "tab-A" as Browser.TabID, visible: true },
    });
  });
  // A stale viewport cannot make an inactive session visible after a route switch.
  // The tab normally clears this on unmount; the manager also owns the inactive guard.
  mounted.rerender(view("one", null));
  expect(store.get(browserViewportsAtom)[scopeA]?.visible).toBe(false);
  mounted.rerender(view("one", "B"));
  await waitFor(() =>
    expect(register).toHaveBeenCalledWith({
      connectionID: "one",
      profileID: "profile",
      sessionID: "B",
    }),
  );
  await act(async () => {
    emit({ bindingID: "one-A", type: "focus", tabID: "tab-A" as Browser.TabID });
    emit({ bindingID: "one-A", type: "preview", path: "index.html" });
  });
  expect(store.get(workbenchStateAtom).scopes[scopeA]?.right.activeTabID).toBe(activeTabID);
  mounted.rerender(view("one", "A"));
  expect(mounted.container.querySelector('webview[partition="persist:A"]')).toBe(hostA);
  expect(register).toHaveBeenCalledTimes(2);
  expect(close).not.toHaveBeenCalled();

  await act(async () => store.set(experimentalBrowserAtom, false));
  await waitFor(() => expect(close).toHaveBeenCalledWith("one-A"));
  expect(close).toHaveBeenCalledWith("one-B");
  expect(store.get(workbenchStateAtom).scopes[scopeA]?.right.tabs.map((tab) => tab.kind)).toEqual([
    "file",
  ]);
  expect(mounted.container.querySelectorAll("webview")).toHaveLength(0);

  await act(async () => store.set(experimentalBrowserAtom, true));
  await waitFor(() => expect(register).toHaveBeenCalledTimes(3));
  mounted.rerender(view("two", "A"));
  await waitFor(() => expect(close).toHaveBeenCalledWith("one-A"));
  await waitFor(() =>
    expect(register).toHaveBeenCalledWith({
      connectionID: "two",
      profileID: "profile",
      sessionID: "A",
    }),
  );
  mounted.unmount();
  await waitFor(() => expect(close).toHaveBeenCalledWith("two-A"));
});
