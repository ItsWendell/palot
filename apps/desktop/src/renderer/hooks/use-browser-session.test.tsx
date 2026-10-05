import type { Browser } from "@opencode/plugin-browser/rpc";
import type { PalotBrowserHost } from "../../shared/browser-contract";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { Provider, createStore } from "jotai";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { experimentalBrowserAtom } from "../atoms/ui";
import { useWorkbenchScope, workbenchStateAtom } from "../atoms/workbench";
import { persistedStorageKey } from "../atoms/persisted";
import {
  createWorkbenchState,
  mutateWorkbench,
  openWorkbenchTab,
  workbenchScopeKey,
  type WorkbenchScope,
} from "../lib/workbench-tabs";
import { palot } from "../services/palot";
import { BrowserSessionAttachment, useBrowserSession } from "./use-browser-session";
import { BrowserTab } from "../components/workbench-tabs/browser-tab";

const location = { directory: "/repo" };
const scope: WorkbenchScope = { profileID: "ssh-one", sessionID: "session-one" };

function mockBrowserEvents() {
  type Listener = Parameters<typeof palot.onBrowserEvent>[0];
  const listeners = new Set<Listener>();
  vi.spyOn(palot, "onBrowserEvent").mockImplementation((listener) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  });
  return (event: Parameters<Listener>[0]) => {
    for (const listener of listeners) listener(event);
  };
}

function expectGuestVisibility(guest: HTMLElement, visible: boolean) {
  expect(guest.dataset.browserVisible).toBe(String(visible));
  expect(guest.style.visibility).toBe(visible ? "visible" : "hidden");
  expect(guest.style.pointerEvents).toBe(visible ? "auto" : "none");
}

function Harness({ owner, active = true }: { owner: WorkbenchScope; active?: boolean }) {
  const context = useWorkbenchScope(owner);
  const browser = useBrowserSession(owner);
  return (
    <>
      <BrowserSessionAttachment
        scope={owner}
        connectionID="remote-connection"
        location={location}
        context={context}
        active={active}
      />
      <output data-testid="browser">{browser?.state.tabs.length ?? 0}</output>
      <output data-testid="popup-tabs">{browser?.popupTabIDs.join(",") ?? ""}</output>
    </>
  );
}

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
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete (window as { localStorage?: Storage }).localStorage;
});

it("keeps the experimental browser off by default and persists explicit opt-in", () => {
  const store = createStore();
  expect(store.get(experimentalBrowserAtom)).toBe(false);
  store.set(experimentalBrowserAtom, true);
  expect(
    JSON.parse(window.localStorage.getItem(persistedStorageKey("experimental.browser")) ?? "null"),
  ).toEqual({ version: 1, value: true });
});

it("registers the exact session connection, scopes events, and detaches on disable", async () => {
  const store = createStore();
  store.set(experimentalBrowserAtom, true);
  const register = vi.spyOn(palot, "browserRegister").mockResolvedValue("binding-one");
  const close = vi.spyOn(palot, "browserClose").mockResolvedValue(undefined);
  const notify = mockBrowserEvents();
  const mounted = render(
    <Provider store={store}>
      <Harness owner={scope} />
    </Provider>,
  );
  await waitFor(() =>
    expect(register).toHaveBeenCalledWith({ ...scope, connectionID: "remote-connection" }),
  );
  const state = {
    tabs: [
      {
        id: "tab-one" as Browser.TabID,
        url: "https://example.org",
        title: "Example",
        loading: false,
        canGoBack: false,
        canGoForward: false,
        generation: 0,
      },
    ],
    focusedTabID: "tab-one" as Browser.TabID,
  } satisfies Browser.State;
  await act(async () => {
    notify({ bindingID: "other-session", type: "state", state });
  });
  expect(mounted.getByTestId("browser").textContent).toBe("0");
  await act(async () => {
    notify({ bindingID: "binding-one", type: "state", state });
  });
  expect(mounted.getByTestId("browser").textContent).toBe("1");
  expect(
    store.get(workbenchStateAtom).scopes[workbenchScopeKey(scope)]?.right.tabs[0],
  ).toMatchObject({
    kind: "browser",
    resource: { sessionID: scope.sessionID, profileID: scope.profileID, browserTabID: "tab-one" },
  });
  await act(async () => notify({ bindingID: "binding-one", type: "preview", path: "index.html" }));
  expect(
    store.get(workbenchStateAtom).scopes[workbenchScopeKey(scope)]?.right.tabs[1],
  ).toMatchObject({
    kind: "file",
    resource: { profileID: scope.profileID, path: "index.html", location },
  });
  await act(async () => store.set(experimentalBrowserAtom, false));
  await waitFor(() => expect(close).toHaveBeenCalledWith("binding-one"));
  expect(store.get(workbenchStateAtom).scopes[workbenchScopeKey(scope)]?.right.tabs).toMatchObject([
    { kind: "file" },
  ]);
});

it("restores the focused page when an attachment registered behind settings becomes active", async () => {
  const store = createStore();
  store.set(experimentalBrowserAtom, true);
  let resolve!: (id: string) => void;
  vi.spyOn(palot, "browserRegister").mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  vi.spyOn(palot, "browserClose").mockResolvedValue(undefined);
  const notify = mockBrowserEvents();
  const focused = "restored-page" as Browser.TabID;
  const state: Browser.State = {
    tabs: [
      {
        id: focused,
        url: "https://example.org",
        title: "Saved page",
        loading: false,
        canGoBack: false,
        canGoForward: false,
        generation: 1,
      },
    ],
    focusedTabID: focused,
  };
  const mounted = render(
    <Provider store={store}>
      <Harness owner={scope} active={false} />
    </Provider>,
  );
  await waitFor(() => expect(palot.browserRegister).toHaveBeenCalled());
  await act(async () => {
    notify({ bindingID: "binding-one", type: "state", state });
    resolve("binding-one");
  });
  const key = workbenchScopeKey(scope);
  expect(store.get(workbenchStateAtom).scopes[key]?.right.requestedOpen).toBe(false);
  mounted.rerender(
    <Provider store={store}>
      <Harness owner={scope} active />
    </Provider>,
  );
  await waitFor(() =>
    expect(store.get(workbenchStateAtom).scopes[key]?.right.requestedOpen).toBe(true),
  );
  expect(store.get(workbenchStateAtom).scopes[key]?.right.tabs).toMatchObject([
    { kind: "browser", resource: { browserTabID: focused } },
  ]);
});

it("places a locally opened page in the requested pane without reopening a collapsed right pane", async () => {
  const store = createStore();
  store.set(experimentalBrowserAtom, true);
  const withFile = openWorkbenchTab(
    createWorkbenchState(),
    scope,
    { kind: "file", location, path: "README.md" },
    { pane: "right" },
  ).state;
  store.set(
    workbenchStateAtom,
    mutateWorkbench(withFile, scope, { type: "toggle-pane", pane: "right" }),
  );
  vi.spyOn(palot, "browserRegister").mockResolvedValue("binding-one");
  vi.spyOn(palot, "browserClose").mockResolvedValue(undefined);
  const notify = mockBrowserEvents();
  render(
    <Provider store={store}>
      <Harness owner={scope} />
    </Provider>,
  );
  await waitFor(() => expect(palot.browserRegister).toHaveBeenCalled());
  const local = "local-page" as Browser.TabID;
  const agent = "agent-page" as Browser.TabID;
  const tab = (id: Browser.TabID): Browser.Tab => ({
    id,
    url: "about:blank",
    title: "",
    loading: false,
    canGoBack: false,
    canGoForward: false,
    generation: 1,
  });
  await act(async () => {
    notify({ bindingID: "binding-one", type: "placement", tabID: local, pane: "bottom" });
    notify({
      bindingID: "binding-one",
      type: "state",
      state: { tabs: [tab(local), tab(agent)], focusedTabID: local },
    });
  });
  const context = store.get(workbenchStateAtom).scopes[workbenchScopeKey(scope)]!;
  expect(context.right).toMatchObject({
    requestedOpen: false,
    tabs: [{ kind: "file" }, { kind: "browser", resource: { browserTabID: agent } }],
  });
  expect(context.bottom).toMatchObject({
    requestedOpen: true,
    tabs: [{ kind: "browser", resource: { browserTabID: local } }],
  });
});

it("closes a late registration after leaving the session", async () => {
  const store = createStore();
  store.set(experimentalBrowserAtom, true);
  let resolve!: (id: string) => void;
  vi.spyOn(palot, "browserRegister").mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const close = vi.spyOn(palot, "browserClose").mockResolvedValue(undefined);
  mockBrowserEvents();
  const mounted = render(
    <Provider store={store}>
      <Harness owner={scope} />
    </Provider>,
  );
  mounted.unmount();
  await act(async () => resolve("late-binding"));
  expect(close).toHaveBeenCalledWith("late-binding");
});

it("buffers webview hosts before registration and keeps hidden guest nodes mounted across focus and workbench changes", async () => {
  const store = createStore();
  store.set(experimentalBrowserAtom, true);
  let resolve!: (id: string) => void;
  vi.spyOn(palot, "browserRegister").mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  vi.spyOn(palot, "browserClose").mockResolvedValue(undefined);
  const layout = vi.spyOn(palot, "browserLayout").mockResolvedValue(undefined);
  const notify = mockBrowserEvents();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  const bounds = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    x: 10,
    y: 20,
    width: 400,
    height: 300,
  } as DOMRect);
  const hosts = [
    { tabID: "page-one" as Browser.TabID, leaseID: "lease-one", partition: "persist:one" },
    { tabID: "page-two" as Browser.TabID, leaseID: "lease-two", partition: "persist:two" },
  ] satisfies [PalotBrowserHost, PalotBrowserHost];
  const state: Browser.State = {
    tabs: hosts.map((host) => ({
      id: host.tabID,
      url: "about:blank",
      title: "Page",
      loading: false,
      canGoBack: false,
      canGoForward: false,
      generation: 0,
    })),
    focusedTabID: hosts[0].tabID,
  };
  const mounted = render(
    <Provider store={store}>
      <Harness owner={scope} />
    </Provider>,
  );
  await waitFor(() => expect(palot.browserRegister).toHaveBeenCalled());
  await act(async () => {
    notify({ bindingID: "stale", type: "hosts", hosts });
    notify({ bindingID: "binding-one", type: "hosts", hosts });
    resolve("binding-one");
  });
  const guests = mounted.container.querySelectorAll("webview");
  expect(guests).toHaveLength(2);
  const first = guests[0]! as HTMLElement;
  const second = guests[1]! as HTMLElement;
  expect(first.getAttribute("partition")).toBe("persist:one");
  expect(first.getAttribute("src")).toBe("about:blank");
  expect(first.hasAttribute("preload")).toBe(false);
  expect(first.hasAttribute("webpreferences")).toBe(false);
  expect(first.hasAttribute("allowpopups")).toBe(true);
  expectGuestVisibility(first, false);
  expectGuestVisibility(second, false);
  await act(async () => notify({ bindingID: "binding-one", type: "state", state }));
  expect(mounted.container.querySelectorAll("webview")).toHaveLength(2);
  await act(async () =>
    notify({ bindingID: "binding-one", type: "state", state, error: "Recoverable page error" }),
  );
  expect(mounted.container.querySelectorAll("webview")[0]).toBe(first);
  expect(mounted.container.querySelectorAll("webview")[1]).toBe(second);
  mounted.rerender(
    <Provider store={store}>
      <Harness owner={scope} />
      <BrowserTab scope={scope} tabID={hosts[0].tabID} active />
    </Provider>,
  );
  await waitFor(() => expectGuestVisibility(first, true));
  expectGuestVisibility(second, false);
  await act(async () =>
    notify({ bindingID: "binding-one", type: "inspect", tabID: hosts[0].tabID, active: true }),
  );
  expect(
    mounted.getByRole("button", { name: "Cancel element picker" }).getAttribute("aria-pressed"),
  ).toBe("true");
  const assertInventoryKeepsActiveGuest = async (nextState: Browser.State) => {
    const previousCalls = layout.mock.calls.length;
    await act(async () => notify({ bindingID: "binding-one", type: "state", state: nextState }));
    expect(
      layout.mock.calls
        .slice(previousCalls)
        .some(([input]) => input.tabID === hosts[0].tabID && !input.visible),
    ).toBe(false);
    expect(mounted.container.querySelectorAll("webview")[0]).toBe(first);
    expectGuestVisibility(first, true);
  };
  const renamedState = {
    ...state,
    tabs: state.tabs.map((tab) => ({ ...tab, title: "Renamed page" })),
  };
  await assertInventoryKeepsActiveGuest(renamedState);
  await assertInventoryKeepsActiveGuest({
    ...renamedState,
    tabs: [
      ...renamedState.tabs,
      {
        ...renamedState.tabs[1]!,
        id: "background-page" as Browser.TabID,
        title: "Background page",
      },
    ],
  });
  expect(mounted.getByTestId("browser").textContent).toBe("3");
  await act(async () => notify({ bindingID: "binding-one", type: "focus", tabID: hosts[1].tabID }));
  mounted.rerender(
    <Provider store={store}>
      <Harness owner={scope} />
      <BrowserTab scope={scope} tabID={hosts[0].tabID} active={false} />
      <BrowserTab scope={scope} tabID={hosts[1].tabID} active />
    </Provider>,
  );
  await waitFor(() => expectGuestVisibility(second, true));
  await act(async () => notify({ bindingID: "stale", type: "hosts", hosts: [] }));
  expect(mounted.container.querySelectorAll("webview")).toHaveLength(2);
  expectGuestVisibility(first, false);
  expect(first.style.width).toBe("400px");
  expect(mounted.container.querySelectorAll("webview")[0]).toBe(first);
  const beforeDeactivate = layout.mock.calls.length;
  mounted.rerender(
    <Provider store={store}>
      <Harness owner={scope} />
      <BrowserTab scope={scope} tabID={hosts[1].tabID} active={false} />
    </Provider>,
  );
  await waitFor(() => expectGuestVisibility(second, false));
  expect(
    layout.mock.calls
      .slice(beforeDeactivate)
      .some(([input]) => input.tabID === hosts[1].tabID && !input.visible),
  ).toBe(true);
  expect(mounted.container.querySelectorAll("webview")[1]).toBe(second);
  expect(second.style.width).toBe("400px");
  bounds.mockReturnValue({ x: 0, y: 0, width: 0, height: 0 } as DOMRect);
  const layoutCalls = layout.mock.calls.length;
  fireEvent(window, new Event("resize"));
  await waitFor(() => expect(layout.mock.calls.length).toBeGreaterThan(layoutCalls));
  expect(second.style.width).toBe("400px");
  expect(layout).toHaveBeenCalledWith(
    expect.objectContaining({
      bindingID: "binding-one",
      tabID: hosts[1].tabID,
      visible: false,
    }),
  );
  const beforeUnmount = layout.mock.calls.length;
  mounted.rerender(
    <Provider store={store}>
      <Harness owner={scope} />
    </Provider>,
  );
  expect(mounted.container.querySelectorAll("webview")[1]).toBe(second);
  expect(
    layout.mock.calls
      .slice(beforeUnmount)
      .some(([input]) => input.tabID === hosts[1].tabID && !input.visible),
  ).toBe(true);
  bounds.mockRestore();
  await act(async () => notify({ bindingID: "binding-one", type: "hosts", hosts: [hosts[1]] }));
  expect(mounted.container.querySelectorAll("webview")).toHaveLength(1);
  expect(mounted.container.querySelector("webview")).toBe(second);
  await act(async () => notify({ bindingID: "binding-one", type: "state", state: null }));
  expect(mounted.container.querySelector("webview")).toBeNull();
});

it("keeps buffered hosts when an early nonnull state reports a recoverable error", async () => {
  const store = createStore();
  store.set(experimentalBrowserAtom, true);
  let resolve!: (id: string) => void;
  vi.spyOn(palot, "browserRegister").mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  vi.spyOn(palot, "browserClose").mockResolvedValue(undefined);
  const notify = mockBrowserEvents();
  const host: PalotBrowserHost = {
    tabID: "early-page" as Browser.TabID,
    leaseID: "early-lease",
    partition: "persist:early",
  };
  const state: Browser.State = {
    tabs: [],
    focusedTabID: null,
  };
  const mounted = render(
    <Provider store={store}>
      <Harness owner={scope} />
    </Provider>,
  );
  await waitFor(() => expect(palot.browserRegister).toHaveBeenCalled());
  await act(async () => {
    notify({ bindingID: "binding-one", type: "hosts", hosts: [host] });
    notify({ bindingID: "binding-one", type: "state", state, error: "Recoverable page error" });
    resolve("binding-one");
  });
  const guest = mounted.container.querySelector("webview");
  expect(guest?.getAttribute("partition")).toBe("persist:early");
  await act(async () => notify({ bindingID: "binding-one", type: "state", state }));
  expect(mounted.container.querySelector("webview")).toBe(guest);
  await act(async () => notify({ bindingID: "binding-one", type: "state", state: null }));
  expect(mounted.container.querySelector("webview")).toBeNull();
});

it("applies buffered popup state and clears popup metadata on later states and detach", async () => {
  const store = createStore();
  store.set(experimentalBrowserAtom, true);
  let resolve!: (id: string) => void;
  vi.spyOn(palot, "browserRegister").mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  vi.spyOn(palot, "browserClose").mockResolvedValue(undefined);
  const notify = mockBrowserEvents();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  const popup = "popup-one" as Browser.TabID;
  const state: Browser.State = {
    tabs: [
      {
        id: popup,
        url: "https://example.org",
        title: "Popup",
        loading: false,
        canGoBack: false,
        canGoForward: false,
        generation: 0,
      },
    ],
    focusedTabID: popup,
  };
  const mounted = render(
    <Provider store={store}>
      <Harness owner={scope} />
      <BrowserTab scope={scope} tabID={popup} active />
    </Provider>,
  );
  await waitFor(() => expect(palot.browserRegister).toHaveBeenCalled());
  await act(async () => {
    notify({ bindingID: "binding-one", type: "state", state, popupTabIDs: [popup] });
    resolve("binding-one");
  });
  expect(mounted.getByTestId("popup-tabs").textContent).toBe(popup);
  expect(mounted.getByText("Open in a separate browser window")).toBeTruthy();
  await act(async () => notify({ bindingID: "binding-one", type: "state", state }));
  expect(mounted.getByTestId("popup-tabs").textContent).toBe("");
  expect(mounted.queryByText("Open in a separate browser window")).toBeNull();
  await act(async () =>
    notify({ bindingID: "binding-one", type: "state", state, popupTabIDs: [popup] }),
  );
  expect(mounted.getByTestId("popup-tabs").textContent).toBe(popup);
  await act(async () => notify({ bindingID: "binding-one", type: "state", state: null }));
  expect(mounted.getByTestId("popup-tabs").textContent).toBe("");
  expect(mounted.queryByText("Open in a separate browser window")).toBeNull();
});

it("shows a popup placeholder while retaining embedded guests and normal tab commands", async () => {
  const store = createStore();
  store.set(experimentalBrowserAtom, true);
  vi.spyOn(palot, "browserRegister").mockResolvedValue("binding-one");
  vi.spyOn(palot, "browserClose").mockResolvedValue(undefined);
  const layout = vi.spyOn(palot, "browserLayout").mockResolvedValue(undefined);
  const command = vi.spyOn(palot, "browserCommand").mockResolvedValue(undefined);
  const notify = mockBrowserEvents();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    x: 10,
    y: 20,
    width: 400,
    height: 300,
  } as DOMRect);
  const embedded = "embedded" as Browser.TabID;
  const popup = "popup" as Browser.TabID;
  const host: PalotBrowserHost = {
    tabID: embedded,
    leaseID: "embedded-lease",
    partition: "persist:embedded",
  };
  const state: Browser.State = {
    tabs: [embedded, popup].map((id) => ({
      id,
      url: "https://example.org",
      title: id,
      loading: false,
      canGoBack: false,
      canGoForward: false,
      generation: 0,
    })),
    focusedTabID: embedded,
  };
  const mounted = render(
    <Provider store={store}>
      <Harness owner={scope} />
      <BrowserTab scope={scope} tabID={embedded} active />
    </Provider>,
  );
  await waitFor(() => expect(palot.browserRegister).toHaveBeenCalled());
  await act(async () => {
    notify({ bindingID: "binding-one", type: "hosts", hosts: [host] });
    notify({ bindingID: "binding-one", type: "state", state, popupTabIDs: [popup] });
  });
  const guest = mounted.container.querySelector("webview") as HTMLElement;
  expect(guest).toBeTruthy();
  await waitFor(() => expectGuestVisibility(guest, true));
  await act(async () =>
    notify({
      bindingID: "binding-one",
      type: "state",
      state: { ...state, focusedTabID: popup },
      popupTabIDs: [popup],
    }),
  );
  mounted.rerender(
    <Provider store={store}>
      <Harness owner={scope} />
      <BrowserTab scope={scope} tabID={popup} active />
    </Provider>,
  );
  expect(mounted.getByText("Open in a separate browser window")).toBeTruthy();
  expect(mounted.container.querySelectorAll("webview")).toHaveLength(1);
  expect(mounted.container.querySelector("webview")).toBe(guest);
  await waitFor(() => expectGuestVisibility(guest, false));
  await waitFor(() =>
    expect(layout).toHaveBeenLastCalledWith(
      expect.objectContaining({ bindingID: "binding-one", tabID: popup, visible: true }),
    ),
  );
  fireEvent.click(mounted.getByRole("button", { name: "Focus popup window" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("binding-one", { type: "tabs.focus", tabID: popup }),
  );
  fireEvent.click(mounted.getByRole("button", { name: "Reload page" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("binding-one", { type: "reload", tabID: popup }),
  );
  mounted.rerender(
    <Provider store={store}>
      <Harness owner={scope} />
      <BrowserTab scope={scope} tabID={popup} active={false} />
    </Provider>,
  );
  await waitFor(() =>
    expect(layout).toHaveBeenLastCalledWith(
      expect.objectContaining({ bindingID: "binding-one", tabID: popup, visible: false }),
    ),
  );
  await act(async () =>
    notify({
      bindingID: "binding-one",
      type: "hosts",
      hosts: [host, { ...host, tabID: popup, leaseID: "popup-lease" }],
    }),
  );
  await act(async () =>
    notify({ bindingID: "binding-one", type: "state", state: { ...state, focusedTabID: popup } }),
  );
  expect(mounted.queryByText("Open in a separate browser window")).toBeNull();
  expect(mounted.container.querySelector("webview")).toBe(guest);
  expect(mounted.container.querySelectorAll("webview")).toHaveLength(2);
  mounted.rerender(
    <Provider store={store}>
      <Harness owner={scope} />
      <BrowserTab scope={scope} tabID={popup} active />
    </Provider>,
  );
  await waitFor(() =>
    expectGuestVisibility(mounted.container.querySelectorAll("webview")[1] as HTMLElement, true),
  );
});

it("treats pending empty webview hosts as webview mode, without native overlay suppression", async () => {
  const store = createStore();
  store.set(experimentalBrowserAtom, true);
  vi.spyOn(palot, "browserRegister").mockResolvedValue("binding-one");
  vi.spyOn(palot, "browserClose").mockResolvedValue(undefined);
  const layout = vi.spyOn(palot, "browserLayout").mockResolvedValue(undefined);
  const notify = mockBrowserEvents();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    x: 10,
    y: 20,
    width: 400,
    height: 300,
  } as DOMRect);
  const mounted = render(
    <Provider store={store}>
      <Harness owner={scope} />
      <BrowserTab scope={scope} tabID={"page" as Browser.TabID} active />
    </Provider>,
  );
  await waitFor(() => expect(palot.browserRegister).toHaveBeenCalled());
  await act(async () => {
    notify({ bindingID: "binding-one", type: "hosts", hosts: [] });
    notify({
      bindingID: "binding-one",
      type: "state",
      state: {
        tabs: [
          {
            id: "page" as Browser.TabID,
            url: "about:blank",
            title: "Page",
            loading: false,
            canGoBack: false,
            canGoForward: false,
            generation: 0,
          },
        ],
        focusedTabID: "page" as Browser.TabID,
      },
    });
  });
  const overlay = document.createElement("div");
  overlay.dataset.slot = "dialog-overlay";
  document.body.append(overlay);
  fireEvent(window, new Event("resize"));
  await waitFor(() =>
    expect(layout).toHaveBeenLastCalledWith(
      expect.objectContaining({ bindingID: "binding-one", tabID: "page", visible: true }),
    ),
  );
  expect(mounted.container.querySelector("webview")).toBeNull();
  overlay.remove();
});

it("keeps pages behind overlays and hides them when their workbench tab becomes inactive", async () => {
  const store = createStore();
  store.set(experimentalBrowserAtom, true);
  vi.spyOn(palot, "browserRegister")
    .mockResolvedValueOnce("binding-one")
    .mockResolvedValueOnce("binding-two");
  vi.spyOn(palot, "browserClose").mockResolvedValue(undefined);
  const layout = vi.spyOn(palot, "browserLayout").mockResolvedValue(undefined);
  const command = vi.spyOn(palot, "browserCommand").mockResolvedValue(undefined);
  const notify = mockBrowserEvents();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    x: 10,
    y: 20,
    width: 400,
    height: 300,
  } as DOMRect);
  const state: Browser.State = {
    tabs: [
      {
        id: "page" as Browser.TabID,
        url: "https://example.org",
        title: "Example",
        loading: false,
        canGoBack: false,
        canGoForward: false,
        generation: 0,
      },
    ],
    focusedTabID: "page" as Browser.TabID,
  };
  const mounted = render(
    <Provider store={store}>
      <Harness owner={scope} />
      <BrowserTab scope={scope} tabID={"page" as Browser.TabID} active />
    </Provider>,
  );
  await waitFor(() => expect(palot.browserRegister).toHaveBeenCalled());
  await act(async () => notify({ bindingID: "binding-one", type: "state", state }));
  await waitFor(() =>
    expect(layout).toHaveBeenCalledWith(
      expect.objectContaining({ bindingID: "binding-one", tabID: "page", visible: true }),
    ),
  );
  const overlay = document.createElement("div");
  overlay.dataset.slot = "dialog-overlay";
  document.body.append(overlay);
  await waitFor(() =>
    expect(layout).toHaveBeenLastCalledWith(
      expect.objectContaining({ bindingID: "binding-one", tabID: "page", visible: true }),
    ),
  );
  overlay.remove();
  await waitFor(() =>
    expect(layout).toHaveBeenLastCalledWith(
      expect.objectContaining({ bindingID: "binding-one", tabID: "page", visible: true }),
    ),
  );
  fireEvent.change(mounted.getByRole("textbox", { name: "Browser address" }), {
    target: { value: "https://example.com" },
  });
  fireEvent.submit(mounted.getByRole("textbox", { name: "Browser address" }).closest("form")!);
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("binding-one", {
      type: "navigate",
      tabID: "page",
      url: "https://example.com",
    }),
  );
  mounted.rerender(
    <Provider store={store}>
      <Harness owner={scope} />
      <BrowserTab scope={scope} tabID={"page" as Browser.TabID} active={false} />
    </Provider>,
  );
  await waitFor(() =>
    expect(layout).toHaveBeenLastCalledWith(
      expect.objectContaining({ bindingID: "binding-one", tabID: "page", visible: false }),
    ),
  );
  await act(async () =>
    notify({
      bindingID: "binding-one",
      type: "state",
      state: null,
      error: "browser.pane.suspended",
    }),
  );
  expect(
    (mounted.getByRole("textbox", { name: "Browser address" }) as HTMLInputElement).disabled,
  ).toBe(true);
  await act(async () => notify({ bindingID: "binding-one", type: "state", state }));
  expect(
    (mounted.getByRole("textbox", { name: "Browser address" }) as HTMLInputElement).disabled,
  ).toBe(true);
  fireEvent.click(mounted.getByRole("button", { name: "Reconnect browser" }));
  await waitFor(() => expect(palot.browserRegister).toHaveBeenCalledTimes(2));
  await act(async () => notify({ bindingID: "binding-two", type: "state", state }));
  expect(mounted.queryByRole("button", { name: "Reconnect browser" })).toBeNull();
});
