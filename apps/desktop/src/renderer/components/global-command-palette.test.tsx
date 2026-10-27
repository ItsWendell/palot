import { createStore } from "jotai";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenCodeProfile, PalotMessage, PalotProject, PalotSession } from "../../shared";
import type { ConnectionOverview } from "../lib/connection-overview";
import {
  commandPaletteTabAtom,
  composerActionRequestAtom,
  globalCommandRequestAtom,
} from "../atoms/command-requests";
import { commandPaletteOpenAtom, navigationOpenAtom } from "../atoms/ui";
import { transcriptJumpTargetAtom, workbenchStateAtom } from "../atoms/workbench";
import { newTaskDestinationAtom, runtimeAtom } from "../atoms/workspace";
import { createWorkbenchState, workbenchScopeKey } from "../lib/workbench-tabs";
import { createRendererQueryClient } from "../lib/query-client";
import { sessionCatalogInfo, sessionInfoFromPalot } from "../lib/session-catalog-query";
import { openCodeReconciler } from "../lib/open-code-reconciler";
import { formatRelativeTime } from "../lib/view-models";
import { transcriptQueryKey } from "../hooks/use-session-transcript";
import { renderWithRouter, seedCatalog } from "../test-utils/render-with-router";

const mocks = vi.hoisted(() => ({
  listRootSessionInfo: vi.fn(),
  restartApp: vi.fn().mockResolvedValue(undefined),
  getSession: vi.fn(),
  findWorkspaceFiles: vi.fn(),
  exportSession: vi.fn(),
  compactSession: vi.fn(),
  loadRecentSessionMessages: vi.fn(),
  overview: {
    connections: [] as ConnectionOverview[],
    includedProfileIDs: [] as string[],
    visibleProfileIDs: null as string[] | null,
  },
}));

vi.mock("../hooks/use-connection-overview", () => ({
  useConnectionOverview: () => mocks.overview,
}));

vi.mock("../services/palot", () => ({
  palot: {
    restartApp: mocks.restartApp,
    getSession: mocks.getSession,
    findWorkspaceFiles: mocks.findWorkspaceFiles,
    exportSession: mocks.exportSession,
    compactSession: mocks.compactSession,
    isPreview: () => true,
  },
}));

vi.mock("../services/opencode-catalog", () => ({
  listRootSessionInfo: mocks.listRootSessionInfo,
}));

vi.mock("../services/opencode-message-search", () => ({
  loadRecentSessionMessages: mocks.loadRecentSessionMessages,
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

function connection(
  id: string,
  name: string,
  sessions: PalotSession[],
  connected = true,
): ConnectionOverview {
  const profile: OpenCodeProfile = {
    id,
    kind: "remote",
    name,
    urls: [`https://${id}.example`],
    credentialID: null,
    allowPlainHttp: false,
    lastSuccessfulUrl: null,
    lastConnectedAt: null,
  };
  return {
    profile,
    runtime: {
      connectionID: `${id}-connection`,
      profileID: id,
      contractVersion: "test",
      phase: connected ? "connected" : "stopped",
      connected,
      binaryPath: null,
      version: null,
      pid: null,
      managed: false,
      lastConnectedAt: 1,
      error: null,
      versionMismatch: null,
    },
    phase: connected ? "ready" : "idle",
    error: null,
    lastSyncedAt: 1,
    projects: [project],
    sessions,
    inbox: { pinned: [], inbox: [], snoozed: [], settled: [], nextSnoozeDeadline: null },
    hasMore: false,
    loadingMore: false,
    triageReady: true,
    attentionState: "ready",
  };
}

function message(id: string, type: "user" | "assistant", text: string): PalotMessage {
  return {
    id,
    type,
    createdAt: 1,
    completedAt: 1,
    text: null,
    agent: null,
    model: null,
    tokens: null,
    finish: null,
    content: [{ id: `${id}-part`, type: "text", text }],
    data: null,
  };
}

function hydrateTranscript(
  queryClient: ReturnType<typeof createRendererQueryClient>,
  connectionID: string,
  sessionID: string,
  messages: PalotMessage[] = [],
) {
  if (messages.length > 0) {
    openCodeReconciler(queryClient).setTranscriptSnapshot(
      connectionID,
      sessionID,
      messages,
      "rooted",
    );
  }
  queryClient.setQueryData(transcriptQueryKey(connectionID, sessionID), {
    pages: [{ data: [], cursor: { previous: null, next: null } }],
    pageParams: [null],
  });
}

function groupHeading(name: string) {
  return [
    ...screen
      .getByRole("listbox", { name: "Command results" })
      .querySelectorAll('[data-slot="command-group-heading"]'),
  ].find((heading) => heading.textContent?.startsWith(name));
}

/** Happy DOM reports AltGraph for any Alt press; Chromium only does for AltGr. */
function pressAltDigit(digit: number) {
  const event = new KeyboardEvent("keydown", {
    key: String(digit),
    code: `Digit${digit}`,
    altKey: true,
    bubbles: true,
    cancelable: true,
  });
  Object.defineProperty(event, "getModifierState", { value: () => false });
  window.dispatchEvent(event);
  return event;
}

describe("GlobalCommandPalette", () => {
  beforeEach(() => {
    mocks.overview = { connections: [], includedProfileIDs: [], visibleProfileIDs: null };
    mocks.listRootSessionInfo.mockReset();
    mocks.listRootSessionInfo.mockResolvedValue({ data: [], cursor: {} });
    mocks.getSession.mockReset();
    mocks.findWorkspaceFiles.mockReset();
    mocks.findWorkspaceFiles.mockResolvedValue([]);
    mocks.exportSession.mockReset();
    mocks.compactSession.mockReset();
    mocks.loadRecentSessionMessages.mockReset();
    mocks.loadRecentSessionMessages.mockResolvedValue([]);
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

  it.each([
    ["auto-settle", "Auto-settle idle tasks", "/settings/general"],
    ["microphone", "Microphone", "/settings/voice"],
    ["proxy", "Tailscale", "/settings/connections/web-access"],
  ])("finds the %s setting and opens its page", async (query, title, route) => {
    const { router } = setup("/new?projectID=project-1");
    fireEvent.keyDown(window, { key: "k", metaKey: true });
    await userEvent.type(
      await screen.findByRole("combobox", { name: "Search tasks and commands" }),
      query,
    );
    const option = await screen.findByRole("option", { name: new RegExp(`^${title}`) });
    await userEvent.click(option);
    await waitFor(() => expect(router.state.location.pathname).toBe(route));
    expect(router.state.location.search).toMatchObject({ projectID: "project-1" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("includes individual settings in the Settings tab but not the Commands tab", async () => {
    const { store } = setup();
    store.set(commandPaletteTabAtom, "settings");
    store.set(commandPaletteOpenAtom, true);
    await userEvent.type(
      await screen.findByRole("combobox", { name: "Search tasks and commands" }),
      "auto-settle",
    );
    expect(await screen.findByRole("option", { name: /^Auto-settle idle tasks/ })).toBeTruthy();
    await userEvent.click(screen.getByRole("tab", { name: "Commands" }));
    expect(screen.queryByRole("option", { name: /^Auto-settle idle tasks/ })).toBeNull();
  });

  it("navigates commands with the keyboard and closes from the root page", async () => {
    const { store } = setup();
    store.set(commandPaletteOpenAtom, true);

    const options = await screen.findAllByRole("option");
    expect(options[0]?.hasAttribute("data-highlighted")).toBe(true);
    const target = screen.getByRole("option", { name: /^Hide navigation/ });
    const steps = options.indexOf(target);
    expect(steps).toBeGreaterThan(0);
    for (let index = 0; index < steps; index += 1) await userEvent.keyboard("{ArrowDown}");
    await waitFor(() => expect(target.hasAttribute("data-highlighted")).toBe(true));
    await userEvent.keyboard("{Enter}");

    await waitFor(() => expect(store.get(navigationOpenAtom)).toBe(false));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

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

  it("uses the remembered destination for the new-task shortcut instead of the viewed project", async () => {
    const { store, router } = setup("/sessions/session-1");
    store.set(newTaskDestinationAtom, { profileID: "local-default", projectID: "another-project" });
    fireEvent.keyDown(window, { key: "n", metaKey: true });
    await waitFor(() => expect(router.state.location.pathname).toBe("/new"));
    expect(router.state.location.search).toMatchObject({
      profileID: "local-default",
      projectID: "another-project",
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keeps the explicit project chooser available in the command palette", async () => {
    const { store } = setup("/new", [
      project,
      { ...project, id: "project-2", canonical: "/other", name: "Other" },
    ]);
    store.set(commandPaletteOpenAtom, true);
    await screen.findByText("New task");
    await userEvent.click(screen.getByRole("option", { name: /^Choose project for a new task/ }));

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
  it("lists recent tasks first, then quick actions and every settings page", async () => {
    const { store } = setup();
    store.set(commandPaletteOpenAtom, true);

    const listbox = await screen.findByRole("listbox", { name: "Command results" });
    const headings = [...listbox.querySelectorAll('[data-slot="command-group-heading"]')].map(
      (heading) => heading.textContent,
    );
    expect(headings.slice(0, 3)).toEqual(["Recent tasksAlt+1–9", "Quick actions", "Settings"]);
    expect(screen.getAllByRole("option")[0]?.textContent).toContain("Global commander");
    expect(screen.getByRole("option", { name: /^Keyboard shortcuts/ })).toBeTruthy();
  });

  it("filters results by tab and switches tabs with arrows only at the caret edges", async () => {
    const { router, store } = setup();
    store.set(commandPaletteOpenAtom, true);
    const input = await screen.findByRole("combobox", { name: "Search tasks and commands" });
    const selectedTab = () =>
      within(screen.getByRole("tablist", { name: "Filter results" }))
        .getAllByRole("tab")
        .find((tab) => tab.getAttribute("aria-selected") === "true")?.textContent;
    expect(selectedTab()).toBe("All");

    // An empty field hands ← and → to the tabs.
    expect(fireEvent.keyDown(input, { key: "ArrowRight" })).toBe(false);
    await waitFor(() => expect(selectedTab()).toBe("Tasks"));
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual([
      expect.stringContaining("Global commander"),
    ]);

    await userEvent.click(screen.getByRole("tab", { name: "Settings" }));
    expect(selectedTab()).toBe("Settings");
    expect(document.activeElement).toBe(input);
    expect(screen.queryByRole("option", { name: /Global commander/ })).toBeNull();
    expect(screen.queryByRole("option", { name: /^New task/ })).toBeNull();

    await userEvent.type(input, "appearance");
    const caret = (position: number) =>
      (input as HTMLInputElement).setSelectionRange(position, position);
    // Mid-text arrows move the caret; a modified arrow keeps extending the selection.
    caret(3);
    expect(fireEvent.keyDown(input, { key: "ArrowRight" })).toBe(true);
    expect(fireEvent.keyDown(input, { key: "ArrowLeft" })).toBe(true);
    caret("appearance".length);
    expect(fireEvent.keyDown(input, { key: "ArrowRight", shiftKey: true })).toBe(true);
    expect(selectedTab()).toBe("Settings");

    // At the end, → wraps to All; at the start, ← comes back.
    expect(fireEvent.keyDown(input, { key: "ArrowRight" })).toBe(false);
    await waitFor(() => expect(selectedTab()).toBe("All"));
    caret(0);
    expect(fireEvent.keyDown(input, { key: "ArrowLeft" })).toBe(false);
    await waitFor(() => expect(selectedTab()).toBe("Settings"));

    const appearance = await screen.findByRole("option", { name: /^Appearance/ });
    await waitFor(() => expect(appearance.hasAttribute("data-highlighted")).toBe(true));
    await userEvent.keyboard("{Enter}");
    await waitFor(() => expect(router.state.location.pathname).toBe("/settings/appearance"));
  });

  it("names the Enter hint after the highlighted row and moves the fluid fill with the keyboard", async () => {
    const { store } = setup();
    store.set(commandPaletteOpenAtom, true);
    const listbox = await screen.findByRole("listbox", { name: "Command results" });
    const results = listbox.parentElement;
    expect(results).toBeTruthy();
    if (!results) return;
    const enterHint = () =>
      document.querySelector('[data-slot="command-palette-enter-hint"]')?.textContent;
    const options = screen.getAllByRole("option");

    await waitFor(() => expect(enterHint()).toContain("Open task"));
    expect(results.getAttribute("data-fluid-hover-active-index")).toBe("0");

    await userEvent.keyboard("{ArrowDown}");
    await waitFor(() => expect(options[1]?.hasAttribute("data-highlighted")).toBe(true));
    await waitFor(() => expect(results.getAttribute("data-fluid-hover-active-index")).toBe("1"));
    expect(options[1]?.hasAttribute("data-fluid-hover-active")).toBe(true);
    expect(listbox.querySelectorAll("[data-highlighted]")).toHaveLength(1);
    expect(enterHint()).toContain("Run command");

    await userEvent.type(screen.getByRole("combobox"), "appearance");
    await waitFor(() => expect(enterHint()).toContain("Open settings"));
    const highlighted = listbox.querySelector("[data-highlighted]");
    expect(highlighted?.textContent).toContain("Appearance");
    expect(highlighted?.hasAttribute("data-fluid-hover-active")).toBe(true);
  });

  it("opens a recent task with Alt and its position", async () => {
    const { router } = setup();

    const event = pressAltDigit(1);

    expect(event.defaultPrevented).toBe(true);
    await waitFor(() => expect(router.state.location.pathname).toBe("/sessions/session-1"));
    expect(pressAltDigit(2).defaultPrevented).toBe(false);
  });

  it("moves to the next recent task with Ctrl+Tab", async () => {
    const { router } = setup();

    fireEvent.keyDown(window, { key: "Tab", code: "Tab", ctrlKey: true });

    await waitFor(() => expect(router.state.location.pathname).toBe("/sessions/session-1"));
  });

  it("focuses the composer with the primary modifier and L", async () => {
    const composer = document.createElement("textarea");
    composer.dataset.palotComposerInput = "";
    document.body.append(composer);
    setup();

    expect(fireEvent.keyDown(window, { key: "l", ctrlKey: true })).toBe(false);

    await waitFor(() => expect(document.activeElement).toBe(composer));
    composer.remove();
  });

  it("searches every visible server and opens results on their own connection", async () => {
    mocks.overview = {
      connections: [
        connection("work", "Work", [
          session({ id: "work-recent", title: "Work recent", updatedAt: 5 }),
        ]),
        connection("home", "Home", [
          session({ id: "home-recent", title: "Home recent", updatedAt: 9 }),
        ]),
        connection("hidden", "Hidden", [session({ id: "hidden-task", title: "Hidden task" })]),
      ],
      includedProfileIDs: ["work", "home", "hidden"],
      visibleProfileIDs: ["work", "home"],
    };
    mocks.listRootSessionInfo.mockImplementation(
      async (_input: unknown, _signal: unknown, connectionID: string) => ({
        data:
          connectionID === "work-connection"
            ? [
                sessionInfoFromPalot(
                  session({ id: "work-deploy", title: "Deploy pipeline", updatedAt: 3 }),
                ),
              ]
            : [
                sessionInfoFromPalot(
                  session({ id: "home-deploy", title: "Deploy dotfiles", updatedAt: 8 }),
                ),
              ],
        cursor: {},
      }),
    );
    const { queryClient, router, store } = setup();
    store.set(commandPaletteOpenAtom, true);

    const recent = await screen.findAllByRole("option");
    expect(recent[0]?.textContent).toContain("Home recent");
    expect(recent[0]?.textContent).toContain("Home");
    expect(recent[1]?.textContent).toContain("Work recent");
    expect(screen.queryByText("Hidden task")).toBeNull();

    await userEvent.type(
      screen.getByRole("combobox", { name: "Search tasks and commands" }),
      "deploy",
    );

    const home = await screen.findByRole("option", { name: /Deploy dotfiles/ });
    const work = await screen.findByRole("option", { name: /Deploy pipeline/ });
    expect(home.compareDocumentPosition(work) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(work.textContent).toContain("Work");
    expect(mocks.listRootSessionInfo.mock.calls.map((call) => call[2]).toSorted()).toEqual([
      "home-connection",
      "work-connection",
    ]);

    await userEvent.click(work);

    await waitFor(() => expect(router.state.location.pathname).toBe("/sessions/work-deploy"));
    expect(router.state.location.search).toMatchObject({ profileID: "work" });
    expect(sessionCatalogInfo(queryClient, "work-connection").map((item) => item.id)).toContain(
      "work-deploy",
    );
    expect(sessionCatalogInfo(queryClient, "home-connection").map((item) => item.id)).not.toContain(
      "work-deploy",
    );
  });

  it("offers task actions only while a task is open and runs them for that task", async () => {
    const first = setup("/new");
    first.store.set(commandPaletteOpenAtom, true);
    const input = await screen.findByRole("combobox", { name: "Search tasks and commands" });
    await userEvent.type(input, "compact");
    expect(screen.queryByRole("option", { name: /^Compact task/ })).toBeNull();
    first.unmount();

    mocks.compactSession.mockResolvedValue(undefined);
    const { router, store } = setup("/sessions/session-1");
    await router.load();
    store.set(commandPaletteOpenAtom, true);
    await userEvent.type(
      await screen.findByRole("combobox", { name: "Search tasks and commands" }),
      "compact task",
    );
    await userEvent.click(await screen.findByRole("option", { name: /^Compact task/ }));
    await waitFor(() => expect(mocks.compactSession).toHaveBeenCalledWith("session-1"));
    // Closing animates; reopen only once the previous dialog has left, or typing can land in it.
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    store.set(commandPaletteOpenAtom, true);
    await userEvent.type(
      await screen.findByRole("combobox", { name: "Search tasks and commands" }),
      "undo last",
    );
    await userEvent.click(await screen.findByRole("option", { name: /^Undo last step/ }));
    await waitFor(() =>
      expect(store.get(composerActionRequestAtom)).toMatchObject({
        action: "undo",
        sessionID: "session-1",
      }),
    );
  });

  it("runs palette commands requested by slash commands", async () => {
    mocks.exportSession.mockResolvedValue(null);
    const { router, store } = setup("/sessions/session-1");
    await router.load();
    store.set(globalCommandRequestAtom, { commandID: "task.export", nonce: 1 });
    await waitFor(() =>
      expect(mocks.exportSession).toHaveBeenCalledWith("session-1", "Global commander", undefined),
    );
    expect(store.get(globalCommandRequestAtom)).toBeNull();

    // /open shows the palette on the Files tab.
    store.set(globalCommandRequestAtom, { commandID: "task.files.open", nonce: 2 });
    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect(store.get(commandPaletteTabAtom)).toBe("files");
  });

  it("searches the open task's files on the Files tab and opens one in the workbench", async () => {
    mocks.findWorkspaceFiles.mockImplementation(async ({ query }: { query: string }) =>
      [
        { path: "src/auth.ts", type: "file" },
        { path: "src/auth", type: "directory" },
        { path: "README.md", type: "file" },
      ].filter((entry) => entry.path.includes(query)),
    );
    const { router, store } = setup("/sessions/session-1");
    await router.load();
    store.set(runtimeAtom, {
      connectionID: "disconnected",
      profileID: "test-profile",
      contractVersion: "test",
      phase: "connected",
      connected: true,
      binaryPath: null,
      version: null,
      pid: null,
      managed: true,
      lastConnectedAt: 1,
      error: null,
      versionMismatch: null,
    });
    store.set(workbenchStateAtom, createWorkbenchState());
    store.set(commandPaletteOpenAtom, true);
    const input = await screen.findByRole("combobox", { name: "Search tasks and commands" });
    const selectedTab = () =>
      within(screen.getByRole("tablist", { name: "Filter results" }))
        .getAllByRole("tab")
        .find((tab) => tab.getAttribute("aria-selected") === "true")?.textContent;

    // ← and → cycle through Files, right after Tasks.
    fireEvent.keyDown(input, { key: "ArrowRight" });
    fireEvent.keyDown(input, { key: "ArrowRight" });
    await waitFor(() => expect(selectedTab()).toBe("Files"));
    await screen.findByRole("option", { name: /README\.md/ });
    expect(screen.queryByRole("option", { name: /Global commander/ })).toBeNull();

    await userEvent.type(input, "auth");
    await waitFor(() =>
      expect(mocks.findWorkspaceFiles).toHaveBeenLastCalledWith(
        { directory: "/repo", query: "auth", limit: 20 },
        expect.any(AbortSignal),
        "disconnected",
      ),
    );
    const auth = await screen.findByRole("option", { name: /auth\.ts/ });
    await waitFor(() => expect(screen.queryByRole("option", { name: /README/ })).toBeNull());
    expect(screen.getAllByRole("option")).toHaveLength(1);
    await waitFor(() => expect(auth.hasAttribute("data-highlighted")).toBe(true));
    expect(
      document.querySelector('[data-slot="command-palette-enter-hint"]')?.textContent,
    ).toContain("Open file");

    await userEvent.keyboard("{Enter}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const scope =
      store.get(workbenchStateAtom).scopes[
        workbenchScopeKey({ profileID: "test-profile", sessionID: "session-1" })
      ];
    expect(scope?.right.tabs).toMatchObject([
      { kind: "file", resource: { path: "src/auth.ts", location: { directory: "/repo" } } },
    ]);
  });

  it("adds matching files to a typed All search after tasks and commands", async () => {
    mocks.findWorkspaceFiles.mockResolvedValue([{ path: "docs/global.md", type: "file" }]);
    const { router, store } = setup("/sessions/session-1");
    await router.load();
    store.set(commandPaletteOpenAtom, true);
    const listbox = await screen.findByRole("listbox", { name: "Command results" });
    expect(mocks.findWorkspaceFiles).not.toHaveBeenCalled();

    await userEvent.type(screen.getByRole("combobox"), "global");
    await screen.findByRole("option", { name: /global\.md/ });
    const headings = [...listbox.querySelectorAll('[data-slot="command-group-heading"]')].map(
      (heading) => heading.textContent,
    );
    expect(headings.indexOf("Files")).toBeGreaterThan(headings.indexOf("Tasks"));
  });

  it("searches loaded transcripts without fetching and jumps to the matching turn", async () => {
    const { queryClient, router, store } = setup();
    hydrateTranscript(queryClient, "disconnected", "session-1", [
      message("user-1", "user", "How should we handle keys?"),
      message("assistant-1", "assistant", "Rotate the signing key every month."),
    ]);
    store.set(commandPaletteOpenAtom, true);

    await userEvent.type(
      await screen.findByRole("combobox", { name: "Search tasks and commands" }),
      "signing key",
    );
    const hit = await screen.findByRole("option", { name: /Rotate the signing key/ });
    expect(hit.querySelector("mark")?.textContent).toBe("signing key");
    expect(hit.textContent).toContain("Assistant · Global commander");
    expect(groupHeading("Messages")?.textContent).toBe("MessagesSearched 1 task loaded in Palot");
    // All only lists messages that matched; the bounded fetch is offered without running.
    expect(screen.getByRole("option", { name: /Search messages in 1 recent task/ })).toBeTruthy();
    expect(mocks.loadRecentSessionMessages).not.toHaveBeenCalled();

    await userEvent.click(hit);

    await waitFor(() => expect(router.state.location.pathname).toBe("/sessions/session-1"));
    expect(store.get(transcriptJumpTargetAtom)).toEqual({
      sessionID: "session-1",
      messageID: "user-1",
    });
  });

  it("fetches recent tasks on request, bounded per server, and reports coverage and failures", async () => {
    const workSessions = Array.from({ length: 35 }, (_, index) =>
      session({ id: `work-${index}`, title: `Work task ${index}`, updatedAt: 100 - index }),
    );
    mocks.overview = {
      connections: [
        connection("work", "Work", workSessions),
        connection("home", "Home", [
          session({ id: "home-1", title: "Home one", updatedAt: 60 }),
          session({ id: "home-2", title: "Home two", updatedAt: 59 }),
        ]),
        connection("away", "Away", [session({ id: "away-1", title: "Away one" })], false),
      ],
      includedProfileIDs: ["work", "home", "away"],
      visibleProfileIDs: null,
    };
    let active = 0;
    let peak = 0;
    mocks.loadRecentSessionMessages.mockImplementation(
      async (sessionID: string, connectionID: string | undefined) => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 1));
        active -= 1;
        if (connectionID === "home-connection") throw new Error("unreachable");
        return sessionID === "work-3"
          ? [
              message("w3-user", "user", "ship it"),
              message("w3-reply", "assistant", "Deploy notes are ready"),
            ]
          : [];
      },
    );
    const { queryClient, router, store } = setup();
    store.set(commandPaletteTabAtom, "tasks");
    store.set(commandPaletteOpenAtom, true);

    await userEvent.type(
      await screen.findByRole("combobox", { name: "Search tasks and commands" }),
      "deploy notes",
    );
    const searchRecent = await screen.findByRole("option", {
      name: /Search messages in 32 recent tasks/,
    });
    expect(mocks.loadRecentSessionMessages).not.toHaveBeenCalled();
    await userEvent.click(searchRecent);

    const hit = await screen.findByRole("option", { name: /Deploy notes are ready/ });
    await waitFor(() =>
      expect(groupHeading("Messages")?.textContent).toBe(
        "MessagesSearched 30 recent tasks · latest messages only",
      ),
    );
    const calls = mocks.loadRecentSessionMessages.mock.calls;
    expect(calls.filter((call) => call[1] === "work-connection")).toHaveLength(30);
    expect(calls.map((call) => call[0])).not.toContain("work-30");
    expect(calls.filter((call) => call[1] === "home-connection").length).toBeLessThanOrEqual(2);
    expect(calls.some((call) => call[1] === "away-connection")).toBe(false);
    expect(peak).toBeLessThanOrEqual(3);
    expect(screen.getByRole("option", { name: /Retry message search/ }).textContent).toContain(
      "Couldn't search Home: unreachable",
    );
    expect(hit.textContent).toContain("Assistant · Work task 3");
    expect(hit.textContent).toContain("Work");

    await userEvent.click(hit);

    await waitFor(() => expect(router.state.location.pathname).toBe("/sessions/work-3"));
    expect(router.state.location.search).toMatchObject({ profileID: "work" });
    // The jump waits for the task's own connection to hydrate its transcript.
    expect(store.get(transcriptJumpTargetAtom)).toBeNull();
    hydrateTranscript(queryClient, "work-connection", "work-3");
    expect(store.get(transcriptJumpTargetAtom)).toEqual({
      sessionID: "work-3",
      messageID: "w3-user",
    });
  });

  it("aborts message requests when the query changes and forgets them on close", async () => {
    const signals: AbortSignal[] = [];
    mocks.loadRecentSessionMessages.mockImplementation(
      (_sessionID: string, _connectionID: string | undefined, signal: AbortSignal) => {
        signals.push(signal);
        return new Promise(() => {});
      },
    );
    const { store } = setup();
    store.set(commandPaletteTabAtom, "tasks");
    store.set(commandPaletteOpenAtom, true);
    const input = await screen.findByRole("combobox", { name: "Search tasks and commands" });

    await userEvent.type(input, "rollout");
    await userEvent.click(
      await screen.findByRole("option", { name: /Search messages in 1 recent task/ }),
    );
    await waitFor(() => expect(signals).toHaveLength(1));
    expect(mocks.loadRecentSessionMessages).toHaveBeenCalledWith(
      "session-1",
      undefined,
      expect.any(AbortSignal),
    );
    expect((await screen.findByText(/Messages · Searching 0 of 1 task/)).textContent).toBeTruthy();

    await userEvent.type(input, " plan");
    await waitFor(() => expect(signals).toHaveLength(2));
    expect(signals[0]?.aborted).toBe(true);
    expect(signals[1]?.aborted).toBe(false);

    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(signals[1]?.aborted).toBe(true);

    store.set(commandPaletteTabAtom, "tasks");
    store.set(commandPaletteOpenAtom, true);
    await userEvent.type(
      await screen.findByRole("combobox", { name: "Search tasks and commands" }),
      "rollout",
    );
    expect(
      await screen.findByRole("option", { name: /Search messages in 1 recent task/ }),
    ).toBeTruthy();
    expect(signals).toHaveLength(2);
  });
});
