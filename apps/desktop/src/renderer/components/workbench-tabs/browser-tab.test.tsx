import type { Browser } from "@opencode/plugin-browser/rpc";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider, createStore } from "jotai";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PalotBrowserComment, PalotBrowserHost } from "../../../shared/browser-contract";
import { composerDirectBrowserSendAtomFamily } from "../../atoms/composer-state";
import { experimentalBrowserAtom } from "../../atoms/ui";
import { useWorkbenchScope } from "../../atoms/workbench";
import { BrowserSessionAttachment } from "../../hooks/use-browser-session";
import { composerScope } from "../../lib/composer-scope";
import type { WorkbenchScope } from "../../lib/workbench-tabs";
import { palot } from "../../services/palot";
import { BrowserTab } from "./browser-tab";

const scope: WorkbenchScope = { profileID: "local", sessionID: "session-one" };
const tabID = "page-one" as Browser.TabID;

function Harness() {
  const context = useWorkbenchScope(scope);
  return (
    <BrowserSessionAttachment
      scope={scope}
      connectionID="local-connection"
      location={{ directory: "/repo" }}
      context={context}
      active
    />
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
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete (window as { localStorage?: Storage }).localStorage;
});

async function renderPage() {
  type Listener = Parameters<typeof palot.onBrowserEvent>[0];
  const listeners = new Set<Listener>();
  vi.spyOn(palot, "onBrowserEvent").mockImplementation((listener) => {
    listeners.add(listener);
    return () => void listeners.delete(listener);
  });
  const notify = (event: Parameters<Listener>[0]) => {
    for (const listener of listeners) listener(event);
  };
  vi.spyOn(palot, "browserRegister").mockResolvedValue("binding-one");
  vi.spyOn(palot, "browserClose").mockResolvedValue(undefined);
  vi.spyOn(palot, "browserLayout").mockResolvedValue(undefined);
  const control = vi.spyOn(palot, "browserPageControl").mockResolvedValue(undefined as never);
  const store = createStore();
  store.set(experimentalBrowserAtom, true);
  render(
    <Provider store={store}>
      <Harness />
      <BrowserTab scope={scope} tabID={tabID} active />
    </Provider>,
  );
  await waitFor(() => expect(palot.browserRegister).toHaveBeenCalled());
  const host: PalotBrowserHost = { tabID, leaseID: "lease-one", partition: "persist:one" };
  await act(async () => {
    notify({ bindingID: "binding-one", type: "hosts", hosts: [host] });
    notify({
      bindingID: "binding-one",
      type: "state",
      state: {
        tabs: [
          {
            id: tabID,
            url: "https://example.com/",
            title: "Example",
            loading: false,
            canGoBack: false,
            canGoForward: false,
            generation: 1,
          },
        ],
        focusedTabID: tabID,
      },
    });
  });
  return { store, notify, control };
}

it("sends an element comment on its own with Mod+Enter, like a line comment", async () => {
  const { store, notify } = await renderPage();
  const send = vi.fn(async (_comment: PalotBrowserComment) => true);
  act(() =>
    store.set(
      composerDirectBrowserSendAtomFamily(composerScope("local", "session:session-one")),
      () => send,
    ),
  );
  await act(async () =>
    notify({
      bindingID: "binding-one",
      type: "inspect",
      tabID,
      active: false,
      selection: {
        tabID,
        url: "https://example.com/",
        generation: 1,
        element: { label: "Buy button", selector: "#buy" },
      },
    }),
  );
  const field = await screen.findByRole("textbox", { name: "Comment about selected element" });
  await userEvent.type(field, "Make this bigger");
  fireEvent.keyDown(field, { key: "Enter", ctrlKey: true });
  await waitFor(() => expect(send).toHaveBeenCalledOnce());
  expect(send.mock.calls[0]![0]).toMatchObject({
    comment: "Make this bigger",
    element: { selector: "#buy" },
  });
  await waitFor(() =>
    expect(screen.queryByRole("form", { name: "Browser element comment" })).toBeNull(),
  );
});

it("leaves Escape and Enter to an input method while it composes in Find in page", async () => {
  const { control } = await renderPage();
  await userEvent.click(screen.getByRole("button", { name: "Browser options" }));
  await userEvent.click(await screen.findByRole("menuitem", { name: /find/i }));
  const find = await screen.findByRole("textbox", { name: "Find in page" });
  fireEvent.keyDown(find, { key: "Escape", isComposing: true });
  fireEvent.keyDown(find, { key: "Enter", shiftKey: true, isComposing: true });
  expect(screen.getByRole("textbox", { name: "Find in page" })).toBe(find);
  const finds = () =>
    control.mock.calls.filter(([, , command]) => command.type.startsWith("find")).length;
  expect(finds()).toBe(0);
  fireEvent.keyDown(find, { key: "Escape" });
  expect(finds()).toBe(1);
  expect(screen.queryByRole("textbox", { name: "Find in page" })).toBeNull();
});
