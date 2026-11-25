import { atom, createStore, useAtomValue } from "jotai";
import { cleanup, fireEvent, screen } from "@testing-library/react";
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
});

const session: PalotSession = {
  id: "wheel-session",
  parentID: null,
  projectID: "project",
  title: "Wide tables",
  agent: null,
  model: null,
  location: { directory: "/repo" },
  createdAt: 1,
  updatedAt: 1,
  archivedAt: null,
  cost: null,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
};

async function renderFollowingThread() {
  const state = atom<ReturnType<typeof useSessionTranscript>>({
    connectionID: "disconnected",
    messages: [
      {
        id: "loaded-prompt",
        type: "user",
        createdAt: 1,
        completedAt: null,
        text: "Show the comparison table",
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
    hasNextPage: true,
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
  viewport.scrollTop = 2_500;
  return viewport;
}

it("keeps following the bottom through a sideways swipe with vertical noise", async () => {
  const viewport = await renderFollowingThread();
  expect(viewport.dataset.bottomLocked).toBe("true");

  // Shift-wheel is covered by transcriptWheelIsSideways: Happy DOM drops WheelEvent.shiftKey.
  fireEvent.wheel(viewport, { deltaX: 80, deltaY: -12 });
  // The browser reports the scroll the gesture caused (none, here) after the wheel event.
  fireEvent.scroll(viewport);
  expect(viewport.dataset.bottomLocked).toBe("true");
});

it("still leaves the live edge for a mostly vertical gesture", async () => {
  const viewport = await renderFollowingThread();
  fireEvent.wheel(viewport, { deltaX: 6, deltaY: -40 });
  viewport.scrollTop = 2_460;
  fireEvent.scroll(viewport);
  expect(viewport.dataset.bottomLocked).toBe("false");
});
