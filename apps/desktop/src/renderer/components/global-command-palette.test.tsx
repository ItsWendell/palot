import { createStore } from "jotai";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PalotProject, PalotSession } from "../../shared";
import { commandPaletteOpenAtom, navigationOpenAtom } from "../atoms/ui";
import { createRendererQueryClient } from "../lib/query-client";
import { sessionCatalogInfo, sessionInfoFromPalot } from "../lib/session-catalog-query";
import { openCodeReconciler } from "../lib/open-code-reconciler";
import { formatRelativeTime } from "../lib/view-models";
import { renderWithRouter, seedCatalog } from "../test-utils/render-with-router";

const mocks = vi.hoisted(() => ({
  listRootSessionInfo: vi.fn(),
  restartApp: vi.fn().mockResolvedValue(undefined),
  getSession: vi.fn(),
}));

vi.mock("../services/palot", () => ({
  palot: {
    restartApp: mocks.restartApp,
    getSession: mocks.getSession,
    isPreview: () => true,
  },
}));

vi.mock("../services/opencode-catalog", () => ({
  listRootSessionInfo: mocks.listRootSessionInfo,
}));

import { GlobalCommandPalette } from "./global-command-palette";

const project: PalotProject = {
  id: "project-1",
  canonical: "/repo",
  name: "Palot",
  sandboxes: [],
  vcs: null,
  updatedAt: 1,
};

function session(input: Partial<PalotSession> & Pick<PalotSession, "id">): PalotSession {
  return {
    parentID: null,
    projectID: project.id,
    title: "Global commander",
    agent: null,
    model: null,
    location: { directory: project.canonical },
    createdAt: 1,
    updatedAt: 2,
    archivedAt: null,
    cost: null,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    ...input,
  };
}

function setup(initialEntry = "/new", projects: PalotProject[] = [project]) {
  const store = createStore();
  const queryClient = createRendererQueryClient();
  seedCatalog(queryClient, { projects, sessions: [session({ id: "session-1" })] });
  return {
    store,
    ...renderWithRouter(<GlobalCommandPalette />, store, initialEntry, queryClient),
  };
}

function markUnread(
  queryClient: ReturnType<typeof createRendererQueryClient>,
  value: PalotSession,
) {
  openCodeReconciler(queryClient).patchSession("disconnected", value.id, (session) => ({
    ...session,
    time: { created: value.createdAt, updated: value.updatedAt, idle: 10, viewed: 5 },
  }));
}

describe("GlobalCommandPalette", () => {
  beforeEach(() => {
    mocks.listRootSessionInfo.mockReset();
    mocks.listRootSessionInfo.mockResolvedValue({ data: [], cursor: {} });
    mocks.getSession.mockReset();
  });

  afterEach(() => cleanup());

  it("opens globally and navigates to settings", async () => {
    const { router } = setup();

    fireEvent.keyDown(window, { key: "k", metaKey: true });

    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect(screen.getByText("Global commander")).toBeTruthy();
    await userEvent.click(screen.getByRole("option", { name: /Settings/ }));

    await waitFor(() => expect(router.state.location.pathname).toBe("/settings/general"));
  });

  it("reopens the welcome guide from global search", async () => {
    const { router } = setup();

    fireEvent.keyDown(window, { key: "k", metaKey: true });
    await userEvent.type(
      await screen.findByRole("combobox", { name: "Search tasks and commands" }),
      "welcome guide",
    );
    await userEvent.click(await screen.findByRole("option", { name: /Open welcome guide/ }));

    await waitFor(() => expect(router.state.location.pathname).toBe("/welcome"));
  });

  it("navigates commands with the keyboard and closes from the root page", async () => {
    const { store } = setup();
    store.set(commandPaletteOpenAtom, true);

    const options = await screen.findAllByRole("option");
    expect(options[0]?.hasAttribute("data-highlighted")).toBe(true);
    await userEvent.keyboard("{ArrowDown}");
    await waitFor(() => expect(options[1]?.hasAttribute("data-highlighted")).toBe(true));
    await userEvent.keyboard("{Enter}");

    await waitFor(() => expect(store.get(navigationOpenAtom)).toBe(false));
    expect(screen.queryByRole("dialog")).toBeNull();

    store.set(commandPaletteOpenAtom, true);
    expect(await screen.findByRole("dialog")).toBeTruthy();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("keeps the task icon and puts unread beside its trailing time", async () => {
    const value = session({ id: "session-1" });
    const { queryClient, store } = setup();
    markUnread(queryClient, value);
    store.set(commandPaletteOpenAtom, true);

    const option = await screen.findByRole("option", { name: /Global commander/ });
    expect(option.querySelector("svg")).toBeTruthy();
    expect(within(option).getByLabelText("Unread task activity")).toBeTruthy();
    expect(option.textContent).toContain(formatRelativeTime(value.updatedAt));
  });

  it("shows running instead of unread without removing the trailing time", async () => {
    const value = session({ id: "session-1" });
    const { queryClient, store } = setup();
    markUnread(queryClient, value);
    openCodeReconciler(queryClient).replaceActivity("disconnected", {
      activeIDs: new Set([value.id]),
      execution: new Map(),
      statuses: new Map([[value.id, { type: "busy" as const }]]),
    });
    store.set(commandPaletteOpenAtom, true);

    const option = await screen.findByRole("option", { name: /Global commander/ });
    expect(within(option).getByLabelText("Running")).toBeTruthy();
    expect(within(option).queryByLabelText("Unread task activity")).toBeNull();
    expect(option.textContent).toContain(formatRelativeTime(value.updatedAt));
  });

  it("merges remote task search results into the ranked list", async () => {
    const remote = session({ id: "session-remote", title: "Archived command palette" });
    mocks.listRootSessionInfo.mockResolvedValue({
      data: [sessionInfoFromPalot(remote)],
      cursor: {},
    });
    const { queryClient, router, store } = setup();
    store.set(commandPaletteOpenAtom, true);

    const input = await screen.findByRole("combobox", { name: "Search tasks and commands" });
    await userEvent.type(input, "archived");

    expect(await screen.findByText("Archived command palette")).toBeTruthy();
    expect(mocks.listRootSessionInfo).toHaveBeenCalledWith(
      { limit: 50, search: "archived" },
      expect.any(AbortSignal),
    );

    await userEvent.click(screen.getByRole("option", { name: /Archived command palette/ }));

    await waitFor(() => expect(router.state.location.pathname).toBe(`/sessions/${remote.id}`));
    expect(sessionCatalogInfo(queryClient, "disconnected").map((item) => item.id)).toContain(
      remote.id,
    );
    expect(mocks.getSession).not.toHaveBeenCalled();
  });

  it("returns to the highest-ranked result when remote search reorders the list", async () => {
    const remote = session({ id: "session-remote", title: "Restart" });
    let resolveSearch!: (result: {
      data: ReturnType<typeof sessionInfoFromPalot>[];
      cursor: Record<string, never>;
    }) => void;
    mocks.listRootSessionInfo.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSearch = resolve;
        }),
    );
    const { router, store } = setup();
    store.set(commandPaletteOpenAtom, true);

    await userEvent.type(
      await screen.findByRole("combobox", { name: "Search tasks and commands" }),
      "restart",
    );
    const localResult = await screen.findByRole("option", { name: /Restart Palot/ });
    await waitFor(() => expect(localResult.hasAttribute("data-highlighted")).toBe(true));
    await waitFor(() => expect(mocks.listRootSessionInfo).toHaveBeenCalled());

    const viewport = screen.getByRole("listbox", { name: "Command results" }).parentElement;
    expect(viewport).toBeTruthy();
    if (!viewport) return;
    viewport.scrollTop = 120;
    resolveSearch({ data: [sessionInfoFromPalot(remote)], cursor: {} });

    const remoteResult = (await screen.findByText("Restart")).closest('[role="option"]');
    expect(remoteResult).toBeTruthy();
    if (!remoteResult) return;
    await waitFor(() => {
      expect(remoteResult.hasAttribute("data-highlighted")).toBe(true);
      expect(viewport.scrollTop).toBe(0);
    });

    await userEvent.keyboard("{Enter}");
    await waitFor(() => expect(router.state.location.pathname).toBe(`/sessions/${remote.id}`));
  });

  it("loads additional remote task pages through the query cursor", async () => {
    const first = session({ id: "session-first", title: "Archived first" });
    const second = session({ id: "session-second", title: "Archived second" });
    mocks.listRootSessionInfo
      .mockResolvedValueOnce({
        data: [sessionInfoFromPalot(first)],
        cursor: { next: "cursor-2" },
      })
      .mockResolvedValueOnce({ data: [sessionInfoFromPalot(second)], cursor: {} });
    const { store } = setup();
    store.set(commandPaletteOpenAtom, true);

    await userEvent.type(
      await screen.findByRole("combobox", { name: "Search tasks and commands" }),
      "archived",
    );
    const firstResult = (await screen.findByText("Archived first")).closest('[role="option"]');
    expect(firstResult).toBeTruthy();
    if (!firstResult) return;
    await waitFor(() => expect(firstResult.hasAttribute("data-highlighted")).toBe(true));
    const loadMore = screen.getByRole("option", { name: "Load more tasks" });
    for (let index = 1; index < screen.getAllByRole("option").length; index += 1) {
      await userEvent.keyboard("{ArrowDown}");
    }
    await waitFor(() =>
      expect(screen.getByRole("combobox").getAttribute("aria-activedescendant")).toBe(loadMore.id),
    );
    const viewport = screen.getByRole("listbox", { name: "Command results" }).parentElement;
    expect(viewport).toBeTruthy();
    if (!viewport) return;
    viewport.scrollTop = 120;
    await userEvent.keyboard("{Enter}");

    expect(await screen.findByText("Archived second")).toBeTruthy();
    expect(viewport.scrollTop).toBe(120);
    expect(mocks.listRootSessionInfo).toHaveBeenNthCalledWith(
      2,
      { limit: 50, search: "archived", cursor: "cursor-2" },
      expect.any(AbortSignal),
    );
  });

  it("opens the project picker for the new-task shortcut when there is no current project", async () => {
    const { store } = setup("/new", [
      project,
      { ...project, id: "project-2", canonical: "/other", name: "Other" },
    ]);
    store.set(commandPaletteOpenAtom, true);
    await screen.findByText("New task");
    store.set(commandPaletteOpenAtom, false);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    fireEvent.keyDown(window, { key: "n", metaKey: true });

    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect(screen.getByText("New task / Choose project")).toBeTruthy();
    expect(screen.getByRole("option", { name: /New task in Palot/ })).toBeTruthy();

    await userEvent.keyboard("{Escape}");

    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Search tasks and commands" })).toBeTruthy();
  });

  it("uses the same navigation toggle for the global shortcut", () => {
    const { store } = setup();
    expect(store.get(navigationOpenAtom)).toBe(true);

    fireEvent.keyDown(window, { key: "b", metaKey: true });

    expect(store.get(navigationOpenAtom)).toBe(false);
  });

  it("does not dispatch direct shortcuts through another open dialog", () => {
    const { store } = setup();
    const modal = document.createElement("div");
    modal.dataset.slot = "dialog-content";
    modal.dataset.open = "";
    document.body.append(modal);

    const handled = fireEvent.keyDown(window, { key: "b", metaKey: true });

    expect(handled).toBe(false);
    expect(store.get(navigationOpenAtom)).toBe(true);
    modal.remove();
  });

  it("focuses the composer after the palette finishes closing", async () => {
    const composer = document.createElement("textarea");
    composer.dataset.palotComposerInput = "";
    document.body.append(composer);
    setup();

    fireEvent.keyDown(window, { key: "k", metaKey: true });
    const input = await screen.findByRole("combobox", { name: "Search tasks and commands" });
    await userEvent.type(input, "focus composer");
    await userEvent.click(screen.getByRole("option", { name: /Focus composer/ }));

    await waitFor(() => expect(document.activeElement).toBe(composer));
    composer.remove();
  });

  it("consumes unavailable reserved shortcuts", () => {
    setup();

    expect(fireEvent.keyDown(window, { key: "i", metaKey: true, shiftKey: true })).toBe(false);
  });
});
