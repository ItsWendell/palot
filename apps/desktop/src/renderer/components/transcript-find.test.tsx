import { atom, createStore, useAtomValue } from "jotai";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { PalotMessage, PalotSession } from "../../shared";
import { useSessionTranscript } from "../hooks/use-session-transcript";
import { createRendererQueryClient } from "../lib/query-client";
import { renderWithRouter, seedCatalog } from "../test-utils/render-with-router";
import { Thread } from "./thread";
import { openTranscriptFindAtom } from "./transcript-find";

vi.mock("../hooks/use-session-transcript", async (original) => ({
  ...(await original<typeof import("../hooks/use-session-transcript")>()),
  useSessionTranscript: vi.fn(),
}));

afterEach(cleanup);

const session: PalotSession = {
  id: "find-session",
  parentID: null,
  projectID: "project",
  title: "Find session",
  agent: null,
  model: null,
  location: { directory: "/repo" },
  createdAt: 1,
  updatedAt: 1,
  archivedAt: null,
  cost: null,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
};

function message(id: string, type: string, text: string, createdAt: number): PalotMessage {
  return {
    id,
    type,
    createdAt,
    completedAt: createdAt + 1,
    text,
    agent: null,
    model: null,
    tokens: null,
    finish: type === "assistant" ? "stop" : null,
    content: [{ id: `${id}-text`, type: "text", text }],
    data: {},
  };
}

async function renderThread(hasNextPage: boolean) {
  const fetchNextPage = vi.fn(async () => ({ isError: false }));
  const state = atom<ReturnType<typeof useSessionTranscript>>({
    connectionID: "disconnected",
    messages: [
      message("u1", "user", "Rename the widget", 1),
      message("a1", "assistant", "Renamed the Widget and its widget tests.", 3),
      message("u2", "user", "Now document it", 5),
    ],
    error: null,
    fetchNextPage,
    hasNextPage,
    isFetchNextPageError: false,
    isFetchingNextPage: false,
    isHydrating: false,
    isPending: false,
  } as unknown as ReturnType<typeof useSessionTranscript>);
  vi.mocked(useSessionTranscript).mockImplementation(() => useAtomValue(state));
  const store = createStore();
  const queryClient = createRendererQueryClient();
  seedCatalog(queryClient, { sessions: [session] });
  renderWithRouter(<Thread sessionID={session.id} />, store, "/new", queryClient);
  const viewport = await screen.findByRole("region", { name: "Task transcript" });
  return { store, viewport, fetchNextPage };
}

it("finds loaded text with Mod+F, steps through matches, and restores focus on Escape", async () => {
  const { viewport } = await renderThread(false);
  viewport.focus();

  fireEvent.keyDown(viewport, { key: "f", code: "KeyF", ctrlKey: true });
  const input = await screen.findByRole("textbox", { name: "Find in task" });
  await act(() => new Promise((resolve) => requestAnimationFrame(resolve)));
  expect(document.activeElement).toBe(input);

  fireEvent.change(input, { target: { value: "WIDGET" } });
  const status = await screen.findByText("1 of 3", { selector: '[role="status"]' });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(status.textContent).toBe("2 of 3");
  fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
  fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
  expect(status.textContent).toBe("3 of 3");

  fireEvent.change(input, { target: { value: "missing" } });
  expect(await screen.findByText("No results", { selector: '[role="status"]' })).toBeTruthy();
  expect(screen.queryByText("Searching loaded messages")).toBeNull();

  fireEvent.keyDown(input, { key: "Escape" });
  expect(screen.queryByRole("search", { name: "Find in task" })).toBeNull();
  expect(document.activeElement).toBe(viewport);
});

it("opens from the exported atom and offers to load earlier history", async () => {
  const { store, fetchNextPage } = await renderThread(true);
  act(() => store.set(openTranscriptFindAtom));
  expect(await screen.findByRole("search", { name: "Find in task" })).toBeTruthy();
  expect(screen.getByText("Searching loaded messages")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Load earlier" }));
  // Loading earlier history first records a scroll anchor over two frames.
  await waitFor(() => expect(fetchNextPage).toHaveBeenCalledOnce());
});

it("leaves Mod+F to surfaces with their own find", async () => {
  await renderThread(false);
  const terminal = document.createElement("div");
  terminal.setAttribute("data-workbench-terminal", "");
  terminal.tabIndex = 0;
  document.body.append(terminal);
  fireEvent.keyDown(terminal, { key: "f", code: "KeyF", ctrlKey: true });
  expect(screen.queryByRole("search", { name: "Find in task" })).toBeNull();
  terminal.remove();
});

// happy-dom reports every Alt press as AltGraph, which shortcuts deliberately ignore.
function altShortcut(init: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  Object.defineProperty(event, "getModifierState", {
    value: (key: string) => (key === "AltGraph" ? false : key === "Alt" && event.altKey),
  });
  return event;
}

it("claims the user-turn shortcuts only inside the task view", async () => {
  const { viewport } = await renderThread(false);
  const next = { key: "]", code: "BracketRight", ctrlKey: true, altKey: true };
  expect(fireEvent(viewport, altShortcut(next))).toBe(false);
  // Plain Mod+] stays with workspace back/forward navigation.
  expect(fireEvent.keyDown(viewport, { ...next, altKey: false })).toBe(true);
  const pane = document.createElement("section");
  pane.setAttribute("data-workbench-pane", "right");
  pane.tabIndex = 0;
  document.body.append(pane);
  expect(fireEvent(pane, altShortcut({ ...next, key: "[", code: "BracketLeft" }))).toBe(true);
  pane.remove();
});
