import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider, createStore } from "jotai";
import { Files, Gauge, GitCompareArrows } from "lucide-react";
import { afterEach, expect, it, vi } from "vitest";
import {
  formatShortcut,
  resetShortcutBinding,
  setShortcutBinding,
} from "../../lib/keyboard-shortcuts";
import { NewTabPage, type NewTabTool } from "./new-tab-page";

afterEach(() => {
  cleanup();
  resetShortcutBinding("task.changes.toggle");
});

function tools(): NewTabTool[] {
  return [
    {
      id: "changes",
      label: "Changes",
      icon: GitCompareArrows,
      shortcut: "task.changes.toggle",
      onSelect: vi.fn(),
    },
    { id: "files", label: "Files", icon: Files, onSelect: vi.fn() },
    { id: "side-chat", label: "Side chat", icon: Gauge, onSelect: vi.fn() },
    { id: "context", label: "Context", icon: Gauge, onSelect: vi.fn() },
  ];
}

function mount(props: Partial<Parameters<typeof NewTabPage>[0]> = {}) {
  const navigate = vi.fn();
  const items = props.tools ?? tools();
  render(
    <Provider store={createStore()}>
      <NewTabPage browser={{ enabled: true, navigate }} tools={items} {...props} />
    </Provider>,
  );
  return { navigate, items };
}

it("starts as an empty browser tab: a focused address field, tools, and no empty suggestions", () => {
  mount({ autoFocus: true });
  const address = screen.getByRole("textbox", { name: "Browser address" });
  expect(address).toBe(document.activeElement);
  expect(address.getAttribute("placeholder")).toBe("Search or enter a URL");
  expect(screen.getByRole("button", { name: "Browser back" }).hasAttribute("disabled")).toBe(true);
  const grid = screen.getByRole("group", { name: "Tools" });
  expect(
    within(grid)
      .getAllByRole("button")
      .map((tile) => tile.textContent),
  ).toEqual([expect.stringContaining("Changes"), "Files", "Side chat", "Context"]);
  expect(screen.queryByRole("heading", { name: "Suggested" })).toBeNull();
});

it("navigates the tab when an address is entered", async () => {
  const { navigate } = mount();
  await userEvent.type(
    screen.getByRole("textbox", { name: "Browser address" }),
    "example.com{Enter}",
  );
  expect(navigate).toHaveBeenCalledExactlyOnceWith(
    expect.stringMatching(/^https?:\/\/example\.com/),
  );
});

it("shows each tool's effective shortcut and follows rebinding", () => {
  setShortcutBinding("task.changes.toggle", ["Mod", "Shift", "G"]);
  mount();
  const changes = screen.getByRole("button", { name: /Changes/ });
  expect(changes.textContent).toContain(formatShortcut(["Mod", "Shift", "G"]));
  expect(screen.getByRole("button", { name: "Files" }).querySelector("kbd")).toBeNull();
});

it("chooses a tool by click and moves between tiles with the arrow keys", async () => {
  const { items } = mount();
  fireEvent.click(screen.getByRole("button", { name: "Files" }));
  expect(items[1]!.onSelect).toHaveBeenCalledOnce();

  const changes = screen.getByRole("button", { name: /Changes/ });
  changes.focus();
  await userEvent.keyboard("{ArrowRight}");
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Files" }));
  await userEvent.keyboard("{End}");
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Context" }));
  await userEvent.keyboard("{Home}");
  expect(document.activeElement).toBe(changes);
  await userEvent.keyboard("{Enter}");
  expect(items[0]!.onSelect).toHaveBeenCalledOnce();
});

it("asks a side question from the Side chat tool", async () => {
  const ask = vi
    .fn()
    .mockRejectedValueOnce(new Error("Connect first"))
    .mockResolvedValue(undefined);
  mount({ onAskSideQuestion: ask });
  const tile = screen.getByRole("button", { name: "Side chat" });
  fireEvent.click(tile);
  expect(tile.getAttribute("aria-expanded")).toBe("true");
  const field = screen.getByRole("textbox", { name: "Ask a side question" });
  await userEvent.type(field, "why is CI slow?{Enter}");
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Connect first");
  await userEvent.click(screen.getByRole("button", { name: "Ask" }));
  expect(ask).toHaveBeenLastCalledWith("why is CI slow?");
  field.focus();
  await userEvent.keyboard("{Escape}");
  expect(screen.queryByRole("textbox", { name: "Ask a side question" })).toBeNull();
});

it("reveals more tools on demand", () => {
  const usage = vi.fn();
  mount({ moreTools: [{ id: "usage", label: "Usage", icon: Gauge, onSelect: usage }] });
  expect(screen.queryByRole("button", { name: "Usage" })).toBeNull();
  const more = screen.getByRole("button", { name: "More tools…" });
  fireEvent.click(more);
  expect(more.getAttribute("aria-expanded")).toBe("true");
  fireEvent.click(screen.getByRole("button", { name: "Usage" }));
  expect(usage).toHaveBeenCalledOnce();
});

it("suggests recent sites and opens them in this tab", () => {
  const clear = vi.fn();
  const { navigate } = mount({
    suggestions: [
      { url: "https://docs.example.com/", title: "Docs", visits: 3, lastVisitedAt: 1 },
      { url: "http://localhost:3000/", title: "", visits: 1, lastVisitedAt: 1 },
    ],
    onClearSuggestions: clear,
  });
  const grid = screen.getByRole("group", { name: "Suggested sites" });
  fireEvent.click(within(grid).getByRole("button", { name: "localhost:3000" }));
  expect(navigate).toHaveBeenCalledWith("http://localhost:3000/");
  fireEvent.click(screen.getByRole("button", { name: "Clear" }));
  expect(clear).toHaveBeenCalledOnce();
});

it("keeps tools usable when the browser is off", () => {
  render(
    <Provider store={createStore()}>
      <NewTabPage browser={{ enabled: false, navigate: vi.fn() }} tools={tools()} />
    </Provider>,
  );
  expect(screen.getByRole("textbox", { name: "Browser address" }).hasAttribute("disabled")).toBe(
    true,
  );
  expect(screen.getByRole("button", { name: "Files" }).hasAttribute("disabled")).toBe(false);
});
