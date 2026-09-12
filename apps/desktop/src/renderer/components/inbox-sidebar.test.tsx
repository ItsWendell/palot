import type { OpenCodeClient } from "@opencode/client";
import { Provider, createStore } from "jotai";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenCodeRuntimeStatus, PalotSession } from "../../shared";
import { sessionTriageSnapshotAtom } from "../atoms/inbox";
import { inboxFiltersAtom, inboxViewPreferencesAtom } from "../atoms/ui";
import { runtimeAtom } from "../atoms/workspace";
import { createRendererQueryClient } from "../lib/query-client";
import { openCodeReconciler } from "../lib/open-code-reconciler";
import { openCodeKeys } from "../lib/opencode-query";
import { resetOpenCodeClientForTest, setOpenCodeClientForTest } from "../services/opencode-client";
import { palot } from "../services/palot";
import { renderWithRouter, seedCatalog } from "../test-utils/render-with-router";
import { InboxSidebarContent } from "./inbox-sidebar";
import { SidebarProvider } from "./ui/sidebar";

const navigation = vi.hoisted(() => ({
  openSession: vi.fn(),
  preloadSession: vi.fn(),
}));

vi.mock("../hooks/use-navigation", () => ({
  usePalotNavigation: () => navigation,
}));

const session = (id: string, title: string, updatedAt: number): PalotSession => ({
  id,
  parentID: null,
  projectID: "project-1",
  title,
  agent: null,
  model: null,
  location: { directory: `/repo/${id}` },
  createdAt: updatedAt,
  updatedAt,
  archivedAt: null,
  cost: null,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
});

function markUnread(
  queryClient: ReturnType<typeof createRendererQueryClient>,
  value: PalotSession,
  connectionID = "disconnected",
) {
  openCodeReconciler(queryClient).patchSession(connectionID, value.id, (session) => ({
    ...session,
    time: { created: value.createdAt, updated: value.updatedAt, idle: 10, viewed: 5 },
  }));
}

beforeEach(() => {
  window.localStorage.clear();
  Element.prototype.getAnimations = vi.fn(() => []);
  Object.defineProperty(window, "palot", {
    configurable: true,
    value: {
      runtimeStatus: vi.fn(),
      onOpenTargetRequested: vi.fn(() => () => undefined),
      onOpenCodeEvents: vi.fn(() => () => undefined),
      openCodeRequest: vi.fn().mockRejectedValue(new Error("VCS unavailable in this test")),
      showAttentionNotification: vi.fn(),
    },
  });
  navigation.openSession.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  resetOpenCodeClientForTest();
  Reflect.deleteProperty(window, "palot");
});

describe("InboxSidebarContent", () => {
  it("keeps folder creation on the original connection while a native picker is open", async () => {
    const store = createStore();
    const runtime: OpenCodeRuntimeStatus = {
      connectionID: "connection-original",
      profileID: "profile-original",
      contractVersion: "test",
      phase: "stopped",
      connected: false,
      binaryPath: null,
      version: null,
      pid: null,
      managed: false,
      lastConnectedAt: null,
      error: null,
      versionMismatch: null,
    };
    store.set(runtimeAtom, runtime);
    let finishPick: (directory: string) => void = () => undefined;
    const pick = vi.spyOn(palot, "pickDirectory").mockImplementation(
      () =>
        new Promise((resolve) => {
          finishPick = resolve;
        }),
    );
    const created = session("created", "Created task", 10);
    const create = vi.spyOn(palot, "createSession").mockResolvedValue(created);
    renderWithRouter(
      <SidebarProvider>
        <InboxSidebarContent />
      </SidebarProvider>,
      store,
    );
    fireEvent.click(screen.getByRole("button", { name: "Add project folder" }));
    expect(pick).toHaveBeenCalledWith("connection-original");
    store.set(runtimeAtom, {
      ...runtime,
      connectionID: "connection-other",
      profileID: "profile-other",
    });
    finishPick("/original/folder");
    await waitFor(() =>
      expect(create).toHaveBeenCalledWith("/original/folder", undefined, "connection-original"),
    );
    await waitFor(() =>
      expect(navigation.openSession).toHaveBeenCalledWith("created", {
        profileID: "profile-original",
      }),
    );
  });

  it("clears an optimistic selection when navigation finishes without changing routes", async () => {
    let finishNavigation: (() => void) | undefined;
    navigation.openSession.mockReturnValue(
      new Promise<void>((resolve) => {
        finishNavigation = resolve;
      }),
    );
    const store = createStore();
    const queryClient = createRendererQueryClient();
    const item = session("inbox", "Inbox task", 120);
    seedCatalog(queryClient, {
      projects: [
        {
          id: "project-1",
          canonical: "/repo",
          name: "Palot",
          sandboxes: [],
          vcs: null,
          updatedAt: 1,
        },
      ],
      sessions: [item],
    });
    store.set(sessionTriageSnapshotAtom, {
      profileID: "local-default",
      bootstrapThrough: null,
      sessions: [],
    });

    renderWithRouter(
      <Provider store={store}>
        <SidebarProvider>
          <InboxSidebarContent />
        </SidebarProvider>
      </Provider>,
      store,
      "/new",
      queryClient,
    );

    const button = screen.getByRole("button", { name: /^Open Inbox task,/ });
    fireEvent.click(button);
    await vi.waitFor(() => expect(navigation.openSession).toHaveBeenCalledWith("inbox"));
    expect(button.closest("[data-inbox-card]")?.getAttribute("data-selected")).toBe("true");

    finishNavigation?.();
    await vi.waitFor(() =>
      expect(button.closest("[data-inbox-card]")?.getAttribute("data-selected")).toBeNull(),
    );
  });

  it("does not show unread activity for the selected session", async () => {
    navigation.openSession.mockImplementation(() => new Promise(() => {}));
    const store = createStore();
    const queryClient = createRendererQueryClient();
    const item = session("inbox", "Inbox task", 120);
    seedCatalog(queryClient, {
      projects: [
        {
          id: "project-1",
          canonical: "/repo",
          name: "Palot",
          sandboxes: [],
          vcs: null,
          updatedAt: 1,
        },
      ],
      sessions: [item],
    });
    markUnread(queryClient, item);

    renderWithRouter(
      <Provider store={store}>
        <SidebarProvider>
          <InboxSidebarContent />
        </SidebarProvider>
      </Provider>,
      store,
      "/new",
      queryClient,
    );

    const button = screen.getByRole("button", { name: /^Open Inbox task,/ });
    const card = button.closest("[data-inbox-card]");
    expect(card).toBeTruthy();
    fireEvent.click(button);
    await vi.waitFor(() =>
      expect(within(card as HTMLElement).queryByLabelText("Unread task activity")).toBeNull(),
    );
  });

  it("renders collapsible active sections and compact shelves", async () => {
    const store = createStore();
    const queryClient = createRendererQueryClient();
    const pinned = session("pinned", "Pinned task", 10);
    const running = session("inbox", "Inbox task", 120);
    seedCatalog(queryClient, {
      projects: [
        {
          id: "project-1",
          canonical: "/repo",
          name: "Palot",
          sandboxes: [],
          vcs: null,
          updatedAt: 1,
        },
        {
          id: "project-2",
          canonical: "/other",
          name: "Other",
          sandboxes: [],
          vcs: null,
          updatedAt: 1,
        },
      ],
      sessions: [
        pinned,
        running,
        session("snoozed", "Snoozed task", 10),
        session("settled", "Settled task", 10),
      ],
    });
    markUnread(queryClient, pinned);
    markUnread(queryClient, running);
    openCodeReconciler(queryClient).replaceActivity("disconnected", {
      activeIDs: new Set(["inbox"]),
      execution: new Map([
        [
          "inbox",
          {
            status: "running" as const,
            startedAt: Date.now() - 5_000,
            completedAt: null,
          },
        ],
      ]),
      statuses: new Map(),
    });
    store.set(sessionTriageSnapshotAtom, {
      profileID: "local-default",
      bootstrapThrough: { updatedAt: 100, sessionID: "z" },
      sessions: [
        {
          sessionID: "pinned",
          disposition: "inbox",
          settledThrough: null,
          pinnedAt: 110,
          snoozedUntil: null,
          snoozedThrough: null,
          updatedAt: 110,
        },
        {
          sessionID: "snoozed",
          disposition: "inbox",
          settledThrough: null,
          pinnedAt: null,
          snoozedUntil: Date.now() + 60_000,
          snoozedThrough: { updatedAt: 10, sessionID: "snoozed" },
          updatedAt: 100,
        },
        {
          sessionID: "settled",
          disposition: "settled",
          settledThrough: { updatedAt: 100, sessionID: "settled" },
          pinnedAt: null,
          snoozedUntil: null,
          snoozedThrough: null,
          updatedAt: 100,
        },
      ],
    });

    renderWithRouter(
      <Provider store={store}>
        <SidebarProvider>
          <InboxSidebarContent />
        </SidebarProvider>
      </Provider>,
      store,
      "/new",
      queryClient,
    );

    expect(screen.getByRole("button", { name: /^Open Pinned task,/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Open Inbox task,/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Unpin task" })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Settle task" })).toHaveLength(1);
    expect(screen.getByTitle(/Working for/)).toBeTruthy();
    expect(screen.getByText(/^New · /)).toBeTruthy();
    const pinnedCard = screen
      .getByRole("button", { name: /^Open Pinned task,/ })
      .closest<HTMLElement>("[data-inbox-card]")!;
    const runningCard = screen
      .getByRole("button", { name: /^Open Inbox task,/ })
      .closest<HTMLElement>("[data-inbox-card]")!;
    expect(within(pinnedCard).getByLabelText("Unread task activity")).toBeTruthy();
    expect(within(pinnedCard).getByText("Palot")).toBeTruthy();
    expect(within(pinnedCard).getByText("pinned").closest("[data-inbox-location]")).not.toBeNull();
    expect(
      within(pinnedCard).getByText("Pinned task").parentElement?.querySelector("[aria-label]"),
    ).toBeNull();
    expect(within(runningCard).queryByLabelText("Unread task activity")).toBeNull();
    expect(within(runningCard).getByTitle(/Working for/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add project folder" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Inbox view settings" }));
    expect(await screen.findByText("Ordering")).toBeTruthy();
    expect(screen.getByRole("combobox").textContent).toContain("Newest");
    expect(screen.getByRole("switch", { name: "Unread first" })).toBeTruthy();
    expect(screen.getByRole("switch", { name: "Show snoozed" })).toBeTruthy();
    expect(screen.getByRole("switch", { name: "Show settled" })).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    store.set(inboxViewPreferencesAtom, {
      ordering: "newest",
      unreadFirst: false,
      showSnoozed: true,
      showSettled: false,
    });
    await waitFor(() => expect(screen.queryByRole("button", { name: /Settled/ })).toBeNull());
    store.set(inboxViewPreferencesAtom, {
      ordering: "newest",
      unreadFirst: false,
      showSnoozed: true,
      showSettled: true,
    });
    fireEvent.click(screen.getByRole("button", { name: "Filter tasks" }));
    expect(await screen.findByText("Add filter…")).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Project" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "State" })).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    store.set(inboxFiltersAtom, { projectID: null, states: ["running"] });
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /^Open Pinned task,/ })).toBeNull(),
    );
    expect(screen.getByRole("button", { name: /^Open Inbox task,/ })).toBeTruthy();
    store.set(inboxFiltersAtom, { projectID: null, states: [] });
    fireEvent.click(screen.getByRole("button", { name: "Inbox options" }));
    expect(
      await screen.findByRole("menuitem", { name: /tasks loaded|Load older tasks/i }),
    ).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Expand all sections" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Collapse all sections" })).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: /^Pinned 1$/ }));
    expect(screen.queryByRole("button", { name: /^Open Pinned task,/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^Inbox 1$/ }));
    expect(screen.queryByRole("button", { name: /^Open Inbox task,/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Snoozed/ }).textContent).toContain("1");
    expect(screen.getByRole("button", { name: /Settled/ }).textContent).toContain("1");
    expect(screen.queryByText("Snoozed task")).toBeNull();
    expect(screen.queryByText("Settled task")).toBeNull();
  });

  it("shows the worktree name when the checkout has a detached HEAD", async () => {
    const getVcs = vi.fn().mockResolvedValue({
      data: { branch: { current: null, default: "main" } },
    });
    setOpenCodeClientForTest({
      vcs: {
        get: getVcs,
      },
    } as unknown as OpenCodeClient);
    const store = createStore();
    store.set(runtimeAtom, {
      connectionID: "connection-1",
      profileID: "local-default",
      contractVersion: "0.0.0-beta-19425",
      phase: "connected",
      connected: true,
      binaryPath: null,
      version: "0.0.0-beta-19425",
      pid: 1,
      managed: false,
      lastConnectedAt: 1,
      error: null,
      versionMismatch: null,
    });
    const queryClient = createRendererQueryClient();
    seedCatalog(
      queryClient,
      {
        projects: [
          {
            id: "project-1",
            canonical: "/repo",
            name: "Palot",
            sandboxes: [],
            vcs: null,
            updatedAt: 1,
          },
        ],
        sessions: [
          {
            ...session("worktree", "Worktree task", 120),
            location: { directory: "/data/opencode/worktree/projec/quiet-river" },
          },
        ],
      },
      "connection-1",
    );
    store.set(sessionTriageSnapshotAtom, {
      profileID: "local-default",
      bootstrapThrough: null,
      sessions: [],
    });

    renderWithRouter(
      <Provider store={store}>
        <SidebarProvider>
          <InboxSidebarContent />
        </SidebarProvider>
      </Provider>,
      store,
      "/new",
      queryClient,
    );

    await waitFor(() => expect(getVcs).toHaveBeenCalledOnce());
    await waitFor(() =>
      expect(
        queryClient.getQueryData(
          openCodeKeys.vcsLocation("connection-1", {
            directory: "/data/opencode/worktree/projec/quiet-river",
          }),
        ),
      ).toEqual({ currentBranch: null, defaultBranch: "main" }),
    );
    const label = await screen.findByTitle("/data/opencode/worktree/projec/quiet-river");
    expect(label.textContent).toBe("quiet-river");
    expect(screen.queryByText("Detached HEAD")).toBeNull();
  });

  it("offers shared context-menu actions for compact shelves", async () => {
    const store = createStore();
    const queryClient = createRendererQueryClient();
    const snoozed = session("snoozed", "Snoozed task", 10);
    const settled = session("settled", "Settled task", 10);
    seedCatalog(queryClient, {
      projects: [
        {
          id: "project-1",
          canonical: "/repo",
          name: "Palot",
          sandboxes: [],
          vcs: null,
          updatedAt: 1,
        },
      ],
      sessions: [snoozed, settled],
    });
    markUnread(queryClient, snoozed);
    markUnread(queryClient, settled);
    store.set(sessionTriageSnapshotAtom, {
      profileID: "local-default",
      bootstrapThrough: { updatedAt: 100, sessionID: "z" },
      sessions: [
        {
          sessionID: "snoozed",
          disposition: "inbox",
          settledThrough: null,
          pinnedAt: null,
          snoozedUntil: Date.now() + 60_000,
          snoozedThrough: { updatedAt: 10, sessionID: "snoozed" },
          updatedAt: 100,
        },
      ],
    });

    renderWithRouter(
      <Provider store={store}>
        <SidebarProvider>
          <InboxSidebarContent />
        </SidebarProvider>
      </Provider>,
      store,
      "/new",
      queryClient,
    );

    fireEvent.click(screen.getByRole("button", { name: /^Snoozed 1$/ }));
    fireEvent.contextMenu(screen.getByRole("button", { name: /Snoozed task/ }));

    expect(await screen.findByRole("menuitem", { name: "Pin" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Wake" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Move to worktree" })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: "Settle" })).toBeNull();
    fireEvent.keyDown(document, { key: "Escape" });

    fireEvent.click(screen.getByRole("button", { name: /^Settled 1$/ }));
    expect(
      within(
        screen
          .getByRole("button", { name: /Settled task/ })
          .closest<HTMLElement>("[data-inbox-compact-row]")!,
      ).getByLabelText("Unread task activity"),
    ).toBeTruthy();
    fireEvent.contextMenu(screen.getByRole("button", { name: /Settled task/ }));

    expect(await screen.findByRole("menuitem", { name: "Pin" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Unsettle" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Move to worktree" })).toBeTruthy();
  });
});
