import { atom, createStore, useAtomValue } from "jotai";
import { cleanup, screen, waitFor } from "@testing-library/react";
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
});

const session: PalotSession = {
  id: "older-history-session",
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

it("keeps a reader at the bottom following it when Load earlier brings older history", async () => {
  const fetchNextPage = vi.fn(async () => ({ isError: false }));
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
    fetchNextPage: fetchNextPage as unknown as ReturnType<
      typeof useSessionTranscript
    >["fetchNextPage"],
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
  const user = userEvent.setup();
  const viewport = await screen.findByRole("region", { name: "Task transcript" });
  expect(viewport.dataset.bottomLocked).toBe("true");

  viewport.focus();
  await user.keyboard("{Control>}f{/Control}");
  await user.click(await screen.findByRole("button", { name: "Load earlier" }));
  await waitFor(() => expect(fetchNextPage).toHaveBeenCalledOnce());
  // The older page lands above, out of view; the reader still follows the live edge.
  expect(viewport.dataset.bottomLocked).toBe("true");
  expect(screen.queryByRole("button", { name: "Scroll to bottom" })).toBeNull();
});
