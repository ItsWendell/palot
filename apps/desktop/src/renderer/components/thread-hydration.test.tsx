import { atom, createStore, useAtomValue } from "jotai";
import { act, cleanup, screen } from "@testing-library/react";
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

afterEach(cleanup);

it("keeps the transcript and composer mounted while an older page hydrates", async () => {
  const session: PalotSession = {
    id: "history-session",
    parentID: null,
    projectID: "project",
    title: "Paginated history",
    agent: null,
    model: null,
    location: { directory: "/repo" },
    createdAt: 1,
    updatedAt: 1,
    archivedAt: null,
    cost: null,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  };
  const state = atom<ReturnType<typeof useSessionTranscript>>({
    connectionID: "disconnected",
    messages: [],
    error: null,
    fetchNextPage: vi.fn(),
    hasNextPage: true,
    isFetchNextPageError: false,
    isFetchingNextPage: false,
    isHydrating: false,
    isPending: true,
  });
  vi.mocked(useSessionTranscript).mockImplementation(() => useAtomValue(state));
  const store = createStore();
  const queryClient = createRendererQueryClient();
  seedCatalog(queryClient, { sessions: [session] });
  const { container } = renderWithRouter(
    <Thread sessionID={session.id} />,
    store,
    "/new",
    queryClient,
  );
  expect(screen.queryByRole("region", { name: "Task transcript" })).toBeNull();
  const pendingComposer = container.querySelector("[data-palot-composer-dock]");
  expect(pendingComposer).not.toBeNull();
  expect(pendingComposer?.hasAttribute("inert")).toBe(true);

  act(() =>
    store.set(state, (current) => ({
      ...current,
      isPending: false,
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
    })),
  );
  const viewport = await screen.findByRole("region", { name: "Task transcript" });
  const composer = container.querySelector("[data-palot-composer-dock]");
  expect(composer).toBe(pendingComposer);
  expect(composer?.hasAttribute("inert")).toBe(false);
  viewport.scrollTop = 120;

  act(() => store.set(state, (current) => ({ ...current, isHydrating: true })));
  expect(screen.getByRole("region", { name: "Task transcript" })).toBe(viewport);
  expect(container.querySelector("[data-palot-composer-dock]")).toBe(composer);
  expect(viewport.scrollTop).toBe(120);

  act(() => store.set(state, (current) => ({ ...current, isHydrating: false })));
  expect(screen.getByRole("region", { name: "Task transcript" })).toBe(viewport);
});
