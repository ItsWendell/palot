import { atom, createStore, useAtomValue } from "jotai";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import type { PalotSession } from "../../shared";
import { useSessionTranscript } from "../hooks/use-session-transcript";
import { createRendererQueryClient } from "../lib/query-client";
import { renderWithRouter, seedCatalog } from "../test-utils/render-with-router";
import { Thread } from "./thread";

vi.mock("../hooks/use-session-transcript", async (original) => ({
  ...(await original<typeof import("../hooks/use-session-transcript")>()),
  useSessionTranscript: vi.fn(),
}));

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  delete document.documentElement.dataset.reducedMotion;
});

const session: PalotSession = {
  id: "paging-session",
  parentID: null,
  projectID: "project",
  title: "Long conversation",
  agent: null,
  model: null,
  location: { directory: "/repo" },
  createdAt: 1,
  updatedAt: 1,
  archivedAt: null,
  cost: null,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
};

async function renderLoadedThread() {
  const state = atom<ReturnType<typeof useSessionTranscript>>({
    connectionID: "disconnected",
    messages: [
      {
        id: "loaded-prompt",
        type: "user",
        createdAt: 1,
        completedAt: null,
        text: "Existing conversation",
        agent: null,
        model: null,
        tokens: null,
        finish: null,
        content: [],
        data: {},
      },
    ],
    error: null,
    fetchNextPage: vi.fn(),
    hasNextPage: false,
    isFetchNextPageError: false,
    isFetchingNextPage: false,
    isHydrating: false,
    isPending: false,
  });
  vi.mocked(useSessionTranscript).mockImplementation(() => useAtomValue(state));
  const queryClient = createRendererQueryClient();
  seedCatalog(queryClient, { sessions: [session] });
  renderWithRouter(<Thread sessionID={session.id} />, createStore(), "/new", queryClient);
  const viewport = await screen.findByRole("region", { name: "Task transcript" });
  Object.defineProperties(viewport, {
    clientHeight: { configurable: true, value: 500 },
    scrollHeight: { configurable: true, value: 3_000 },
  });
  const scrollTo = vi.fn();
  viewport.scrollTo = scrollTo as typeof viewport.scrollTo;
  const input = screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Message Palot" });
  return { viewport, scrollTo, input };
}

it("pages the transcript from the composer without moving focus or the caret", async () => {
  const user = userEvent.setup();
  const { viewport, scrollTo, input } = await renderLoadedThread();
  await user.type(input, "keep this draft");
  input.setSelectionRange(4, 4);
  viewport.scrollTop = 2_500;
  document.documentElement.dataset.reducedMotion = "true";

  expect(fireEvent.keyDown(input, { key: "PageUp" })).toBe(false);
  expect(scrollTo).toHaveBeenCalledOnce();
  const [{ top, behavior }] = scrollTo.mock.calls[0]!;
  // Most of a page, measured above the composer that covers the transcript's bottom.
  expect(2_500 - top).toBeGreaterThan(500 * 0.6);
  expect(2_500 - top).toBeLessThan(500);
  expect(behavior).toBe("instant");
  expect(document.activeElement).toBe(input);
  expect([input.selectionStart, input.selectionEnd]).toEqual([4, 4]);
  expect(input.value).toBe("keep this draft");

  // Modified page keys keep their native meaning, such as extending the selection.
  expect(fireEvent.keyDown(input, { key: "PageDown", shiftKey: true })).toBe(true);
  expect(scrollTo).toHaveBeenCalledOnce();
});

it("adds up repeated page keys while a smooth page scroll is under way", async () => {
  const { viewport, scrollTo, input } = await renderLoadedThread();
  input.focus();
  viewport.scrollTop = 1_000;

  fireEvent.keyDown(input, { key: "PageDown" });
  fireEvent.keyDown(input, { key: "PageDown" });
  const [first, second] = scrollTo.mock.calls.map(([options]) => options);
  expect(first.behavior).toBe("smooth");
  expect(first.top).toBeGreaterThan(1_000);
  expect(second.top - first.top).toBeCloseTo(first.top - 1_000);
});

it("leaves page keys alone while a suggestion list is open", async () => {
  const user = userEvent.setup();
  const { scrollTo, input } = await renderLoadedThread();
  await user.type(input, "@");
  expect(input.getAttribute("aria-expanded")).toBe("true");

  expect(fireEvent.keyDown(input, { key: "PageUp" })).toBe(true);
  expect(scrollTo).not.toHaveBeenCalled();
});
