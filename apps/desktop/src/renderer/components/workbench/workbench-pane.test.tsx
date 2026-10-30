import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider, createStore } from "jotai";
import { afterEach, expect, it, vi } from "vitest";
import { workbenchStateAtom, useWorkbenchScope } from "../../atoms/workbench";
import { experimentalBrowserAtom } from "../../atoms/ui";
import {
  workbenchScopeKey,
  type WorkbenchTab,
  type ClosedWorkbenchTab,
} from "../../lib/workbench-tabs";
import { showErrorToast } from "../../lib/toast-error";
import { palot } from "../../services/palot";
import { WorkbenchPane } from "./workbench-pane";

const permissions = vi.hoisted(() => ({ requests: [] as { tabID: string }[], grants: [] }));

vi.mock("../../atoms/workspace", async () => ({ runtimeAtom: (await import("jotai")).atom(null) }));
vi.mock("../../hooks/use-browser-session", () => ({
  useBrowserSession: () => ({
    permissions,
    bindingID: "binding",
    state: {
      focusedTabID: "page-1",
      tabs: [
        { id: "page-1", title: "Example", url: "https://example.com" },
        { id: "page-2", title: "", url: "https://other.example" },
      ],
    },
  }),
}));
vi.mock("../../services/palot", () => ({
  palot: {
    browserCommand: vi.fn(),
    onBrowserShortcut: vi.fn(() => () => undefined),
    createPty: vi.fn(),
    connectPty: vi.fn(),
    removePty: vi.fn(),
  },
}));
vi.mock("../../lib/toast-error", () => ({ showErrorToast: vi.fn() }));
vi.mock("../../hooks/use-navigation", () => ({
  usePalotNavigation: () => ({
    openPullRequests: vi.fn(),
    openScheduled: vi.fn(),
    openUsage: vi.fn(),
    openWorktrees: vi.fn(),
  }),
}));
vi.mock("../../hooks/use-source-control", () => ({
  useSessionPullRequests: () => ({ data: [] }),
}));
vi.mock("../workbench-tabs/changes-tab", () => ({ ChangesTab: () => <div>Changes view</div> }));
vi.mock("../workbench-tabs/browser-tab", () => ({ BrowserTab: () => <div>Browser page</div> }));
vi.mock("../workbench-tabs/context-tab", () => ({ ContextTab: () => <div>Context view</div> }));
vi.mock("../workbench-tabs/file-tab", () => ({ FileTab: () => <div>File view</div> }));
vi.mock("../workbench-tabs/terminal-tab", () => ({ TerminalTab: () => <div>Terminal view</div> }));

const scope = { profileID: "profile", sessionID: "session" };
const location = { directory: "/repo" };
const pages: WorkbenchTab[] = [
  {
    id: "row-1",
    kind: "browser",
    pinned: false,
    resource: { ...scope, location, browserTabID: "page-1" },
  },
  {
    id: "row-2",
    kind: "browser",
    pinned: false,
    resource: { ...scope, location, browserTabID: "page-2" },
  },
];

afterEach(() => {
  permissions.requests = [];
  cleanup();
  vi.clearAllMocks();
  delete document.documentElement.dataset.platform;
});

it("flags a hidden page's permission request, then clears the flag when that page is visible", async () => {
  permissions.requests = [{ tabID: "page-2" }];
  vi.mocked(palot.browserCommand).mockResolvedValue(undefined);
  mount();
  const hidden = screen.getByRole("tab", {
    name: "https://other.example, microphone or camera permission needed",
  });
  fireEvent.click(hidden);
  await waitFor(() =>
    expect(screen.getByRole("tab", { name: "https://other.example" })).toBeTruthy(),
  );
  expect(screen.queryByRole("tab", { name: /permission needed/ })).toBeNull();
});

function ScopePane() {
  const context = useWorkbenchScope(scope);
  return <WorkbenchPane pane="right" scope={scope} context={context} location={location} />;
}

function mount(tabs = pages, recentlyClosed?: ClosedWorkbenchTab[]) {
  const store = createStore();
  store.set(experimentalBrowserAtom, true);
  const context = {
    right: { tabs, activeTabID: "row-1", requestedOpen: true },
    bottom: { tabs: [], activeTabID: null, requestedOpen: false },
    updatedAt: 1,
    ...(recentlyClosed ? { recentlyClosed } : {}),
  };
  store.set(workbenchStateAtom, { version: 1, scopes: { [workbenchScopeKey(scope)]: context } });
  render(
    <Provider store={store}>
      <ScopePane />
    </Provider>,
  );
  return store;
}

it("shows live page titles and focuses the chosen page", async () => {
  vi.mocked(palot.browserCommand).mockResolvedValue(undefined);
  mount();
  expect(screen.getByRole("tab", { name: "Example" })).toBeTruthy();
  expect(screen.getByRole("tab", { name: "https://other.example" })).toBeTruthy();
  fireEvent.click(screen.getByRole("tab", { name: "https://other.example" }));
  await waitFor(() =>
    expect(palot.browserCommand).toHaveBeenCalledWith("binding", {
      type: "tabs.focus",
      tabID: "page-2",
    }),
  );
});

it("keeps the strip a fluid tab list with focus-following hover and middle-click close", async () => {
  vi.mocked(palot.browserCommand).mockResolvedValue(undefined);
  mount();
  const list = screen.getByRole("tablist");
  expect(list.getAttribute("data-variant")).toBe("subtle");
  const tabs = screen.getAllByRole("tab");
  await waitFor(() => expect(tabs.every((tab) => tab.hasAttribute("data-fluid-item"))).toBe(true));

  // Keyboard focus moves the hover pill to the focused tab.
  expect(list.hasAttribute("data-fluid-hover-active-index")).toBe(false);
  fireEvent.focus(screen.getByRole("tab", { name: "https://other.example" }));
  await waitFor(() => expect(list.getAttribute("data-fluid-hover-active-index")).toBe("1"));

  const wrapper = screen.getByRole("tab", { name: "Example" }).parentElement;
  if (!wrapper) throw new Error("tab wrapper missing");
  fireEvent(wrapper, new MouseEvent("auxclick", { bubbles: true, button: 1 }));
  await waitFor(() =>
    expect(palot.browserCommand).toHaveBeenCalledWith("binding", {
      type: "tabs.close",
      tabID: "page-1",
    }),
  );
});

it("keeps browser rows on a failed close and reports the failure", async () => {
  vi.mocked(palot.browserCommand).mockRejectedValue(new Error("Connection lost"));
  const store = mount();
  fireEvent.click(screen.getByRole("button", { name: "Close Example" }));
  await waitFor(() =>
    expect(showErrorToast).toHaveBeenCalledWith("Could not control browser", expect.any(Error)),
  );
  expect(palot.browserCommand).toHaveBeenCalledWith("binding", {
    type: "tabs.close",
    tabID: "page-1",
  });
  expect(store.get(workbenchStateAtom).scopes[workbenchScopeKey(scope)]?.right.tabs).toHaveLength(
    2,
  );
});

it("opens a new browser page without creating a generic workbench tab", async () => {
  vi.mocked(palot.browserCommand).mockResolvedValue(undefined);
  const store = mount();
  fireEvent.click(screen.getByRole("button", { name: "Open workbench surface" }));
  fireEvent.click(await screen.findByRole("menuitem", { name: "Browser" }));
  expect(palot.browserCommand).toHaveBeenCalledWith(
    "binding",
    { type: "tabs.open", focus: true },
    "right",
  );
  expect(store.get(workbenchStateAtom).scopes[workbenchScopeKey(scope)]?.right.tabs).toHaveLength(
    2,
  );
});

it("places a page opened from the bottom menu in the bottom pane", async () => {
  vi.mocked(palot.browserCommand).mockResolvedValue("page-new");
  const store = createStore();
  store.set(experimentalBrowserAtom, true);
  const context = {
    right: { tabs: [], activeTabID: null, requestedOpen: false },
    bottom: { tabs: [], activeTabID: null, requestedOpen: true },
    updatedAt: 1,
  };
  store.set(workbenchStateAtom, { version: 1, scopes: { [workbenchScopeKey(scope)]: context } });
  render(
    <Provider store={store}>
      <WorkbenchPane pane="bottom" scope={scope} context={context} location={location} />
    </Provider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Open workbench surface" }));
  fireEvent.click(await screen.findByRole("menuitem", { name: "Browser" }));
  expect(palot.browserCommand).toHaveBeenCalledWith(
    "binding",
    { type: "tabs.open", focus: true },
    "bottom",
  );
  await waitFor(() =>
    expect(
      store.get(workbenchStateAtom).scopes[workbenchScopeKey(scope)]?.bottom.tabs,
    ).toMatchObject([{ kind: "browser", resource: { browserTabID: "page-new" } }]),
  );
  expect(store.get(workbenchStateAtom).scopes[workbenchScopeKey(scope)]?.right).toMatchObject({
    tabs: [],
    requestedOpen: false,
  });
});

it("closes browser victims through browser commands and ordinary victims through workbench commands", async () => {
  vi.mocked(palot.browserCommand).mockResolvedValue(undefined);
  const contextTab: WorkbenchTab = {
    id: "context",
    kind: "context",
    pinned: true,
    resource: { ...scope, location },
  };
  const store = mount([...pages, contextTab]);
  fireEvent.contextMenu(screen.getByRole("tab", { name: "Example" }));
  fireEvent.click(await screen.findByRole("menuitem", { name: "Close others" }));
  expect(palot.browserCommand).toHaveBeenCalledWith("binding", {
    type: "tabs.close",
    tabID: "page-2",
  });
  expect(palot.browserCommand).not.toHaveBeenCalledWith("binding", {
    type: "tabs.close",
    tabID: "page-1",
  });
  expect(store.get(workbenchStateAtom).scopes[workbenchScopeKey(scope)]?.right.tabs).toEqual(pages);
});

it("lists and reopens a closed tab from the menu in its original pane without creating resources", async () => {
  const terminal: WorkbenchTab = {
    id: "terminal",
    kind: "terminal",
    pinned: false,
    resource: {
      profileID: scope.profileID,
      location,
      ptyID: "still-running",
      sessionID: "child",
      transport: "persistent",
      readOnly: true,
    },
  };
  const store = mount([], [{ tab: terminal, pane: "bottom", index: 0, closedAt: 1 }]);
  fireEvent.click(screen.getByRole("button", { name: "Open workbench surface" }));
  const recent = await screen.findByRole("menuitem", { name: "Terminal Bottom" });
  expect(palot.createPty).not.toHaveBeenCalled();
  expect(palot.connectPty).not.toHaveBeenCalled();
  expect(
    screen.getByText(
      "Browser pages cannot be reopened. Terminals reconnect only if still available.",
    ),
  ).toBeTruthy();
  fireEvent.click(recent);
  expect(store.get(workbenchStateAtom).scopes[workbenchScopeKey(scope)]?.bottom).toMatchObject({
    requestedOpen: true,
    activeTabID: "terminal",
    tabs: [terminal],
  });
  expect(palot.createPty).not.toHaveBeenCalled();
  expect(palot.removePty).not.toHaveBeenCalled();
});

it("reopens the most recently closed tab using the workbench-focused shortcut", async () => {
  const tabs: WorkbenchTab[] = ["first", "last"].map((id) => ({
    id,
    kind: "file",
    pinned: false,
    resource: { profileID: scope.profileID, location, path: `${id}.ts` },
  }));
  const store = mount(tabs);
  fireEvent.click(screen.getByRole("button", { name: "Close first.ts" }));
  fireEvent.click(screen.getByRole("button", { name: "Close last.ts" }));
  expect(fireEvent.keyDown(window, { key: "t", ctrlKey: true, shiftKey: true })).toBe(true);
  expect(store.get(workbenchStateAtom).scopes[workbenchScopeKey(scope)]?.right.tabs).toEqual([]);
  expect(
    fireEvent.keyDown(screen.getByRole("region", { name: "Right workbench" }), {
      key: "T",
      ctrlKey: true,
      shiftKey: true,
    }),
  ).toBe(false);
  await screen.findByRole("tab", { name: "last.ts" });
  expect(store.get(workbenchStateAtom).scopes[workbenchScopeKey(scope)]?.right.tabs).toEqual([
    tabs[1],
  ]);
  fireEvent.click(screen.getByRole("button", { name: "Open workbench surface" }));
  fireEvent.click(await screen.findByRole("menuitem", { name: "Reopen closed tab" }));
  await screen.findByRole("tab", { name: "first.ts" });
  expect(store.get(workbenchStateAtom).scopes[workbenchScopeKey(scope)]?.recentlyClosed).toEqual(
    [],
  );
});

it("opens a New tab page from + and turns it into the chosen surface in place", async () => {
  const store = mount();
  fireEvent.click(screen.getByRole("button", { name: "New tab" }));
  const tab = await screen.findByRole("tab", { name: "New tab" });
  expect(tab.getAttribute("aria-selected")).toBe("true");
  const tools = await screen.findByRole("group", { name: "Tools" });
  fireEvent.click(within(tools).getByRole("button", { name: /Changes/ }));
  await screen.findByRole("tab", { name: /^Changes/ });
  const right = store.get(workbenchStateAtom).scopes[workbenchScopeKey(scope)]!.right;
  expect(right.tabs.map((candidate) => candidate.kind)).toEqual(["browser", "browser", "changes"]);
  expect(right.activeTabID).toBe(right.tabs[2]!.id);
  expect(screen.queryByRole("tab", { name: "New tab" })).toBeNull();
});

it("navigates a New tab by opening the address as a page in its place", async () => {
  vi.mocked(palot.browserCommand).mockResolvedValue("page-3");
  const store = mount();
  fireEvent.click(screen.getByRole("button", { name: "New tab" }));
  const address = await screen.findByRole("textbox", { name: "Browser address" });
  await userEvent.type(address, "https://example.org{Enter}");
  await waitFor(() =>
    expect(palot.browserCommand).toHaveBeenCalledWith(
      "binding",
      { type: "tabs.open", url: "https://example.org", focus: true },
      "right",
    ),
  );
  await waitFor(() =>
    expect(
      store.get(workbenchStateAtom).scopes[workbenchScopeKey(scope)]?.right.tabs.at(-1),
    ).toMatchObject({ kind: "browser", resource: { browserTabID: "page-3" } }),
  );
  expect(
    store
      .get(workbenchStateAtom)
      .scopes[workbenchScopeKey(scope)]?.right.tabs.some((tab) => tab.kind === "new-tab"),
  ).toBe(false);
});

it("shows the New tab page in an empty pane", async () => {
  mount([]);
  expect(await screen.findByRole("group", { name: "Tools" })).toBeTruthy();
  expect(screen.getByRole("textbox", { name: "Browser address" })).toBeTruthy();
});

it("closes the active tab with Ctrl+W instead of the window", () => {
  document.documentElement.dataset.platform = "linux";
  vi.mocked(palot.browserCommand).mockResolvedValue(undefined);
  mount();
  const tab = screen.getByRole("tab", { name: "Example" });
  tab.focus();
  // A canceled keydown never reaches the window menu's Close item.
  expect(fireEvent.keyDown(tab, { key: "w", code: "KeyW", ctrlKey: true })).toBe(false);
  expect(palot.browserCommand).toHaveBeenCalledWith("binding", {
    type: "tabs.close",
    tabID: "page-1",
  });
});

it("cycles workbench tabs with Ctrl+Tab instead of switching tasks", async () => {
  document.documentElement.dataset.platform = "linux";
  vi.mocked(palot.browserCommand).mockResolvedValue(undefined);
  const windowListener = vi.fn();
  window.addEventListener("keydown", windowListener);
  try {
    mount();
    const tab = screen.getByRole("tab", { name: "Example" });
    tab.focus();
    expect(fireEvent.keyDown(tab, { key: "Tab", code: "Tab", ctrlKey: true })).toBe(false);
    expect(windowListener).not.toHaveBeenCalled();
    const next = screen.getByRole("tab", { name: "https://other.example" });
    await waitFor(() => expect(next.getAttribute("aria-selected")).toBe("true"));
    await waitFor(() => expect(document.activeElement).toBe(next));
    expect(palot.browserCommand).toHaveBeenCalledWith("binding", {
      type: "tabs.focus",
      tabID: "page-2",
    });
  } finally {
    window.removeEventListener("keydown", windowListener);
  }
});

it("replays a browser page's Ctrl+W only in the pane that shows it", () => {
  document.documentElement.dataset.platform = "linux";
  vi.mocked(palot.browserCommand).mockResolvedValue(undefined);
  mount();
  const replay = vi.mocked(palot.onBrowserShortcut).mock.calls[0]![0];
  const close = {
    key: "w",
    code: "KeyW",
    control: true,
    meta: false,
    shift: false,
    alt: false,
    repeat: false,
  };
  replay({ ...close, tabID: "other-page" as never });
  expect(palot.browserCommand).not.toHaveBeenCalled();
  replay({ ...close, tabID: "page-1" as never });
  expect(palot.browserCommand).toHaveBeenCalledWith("binding", {
    type: "tabs.close",
    tabID: "page-1",
  });
});

it("leaves Ctrl+Tab to task switching when the pane has one tab", () => {
  document.documentElement.dataset.platform = "linux";
  const windowListener = vi.fn();
  window.addEventListener("keydown", windowListener);
  try {
    mount(pages.slice(0, 1));
    const tab = screen.getByRole("tab", { name: "Example" });
    expect(fireEvent.keyDown(tab, { key: "Tab", code: "Tab", ctrlKey: true })).toBe(true);
    expect(windowListener).toHaveBeenCalled();
  } finally {
    window.removeEventListener("keydown", windowListener);
  }
});
