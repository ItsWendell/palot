import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Provider, createStore } from "jotai";
import { afterEach, expect, it, vi } from "vitest";
import { workbenchStateAtom } from "../../atoms/workbench";
import { experimentalBrowserAtom } from "../../atoms/ui";
import { workbenchScopeKey, type WorkbenchTab } from "../../lib/workbench-tabs";
import { showErrorToast } from "../../lib/toast-error";
import { palot } from "../../services/palot";
import { WorkbenchPane } from "./workbench-pane";

vi.mock("../../atoms/workspace", async () => ({ runtimeAtom: (await import("jotai")).atom(null) }));
vi.mock("../../hooks/use-browser-session", () => ({
  useBrowserSession: () => ({
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
vi.mock("../../services/palot", () => ({ palot: { browserCommand: vi.fn() } }));
vi.mock("../../lib/toast-error", () => ({ showErrorToast: vi.fn() }));
vi.mock("../workbench-tabs/browser-tab", () => ({ BrowserTab: () => <div>Browser page</div> }));

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
  cleanup();
  vi.clearAllMocks();
});

function mount(tabs = pages) {
  const store = createStore();
  store.set(experimentalBrowserAtom, true);
  const context = {
    right: { tabs, activeTabID: "row-1", requestedOpen: true },
    bottom: { tabs: [], activeTabID: null, requestedOpen: false },
    updatedAt: 1,
  };
  store.set(workbenchStateAtom, { version: 1, scopes: { [workbenchScopeKey(scope)]: context } });
  render(
    <Provider store={store}>
      <WorkbenchPane pane="right" scope={scope} context={context} location={location} />
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
