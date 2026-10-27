import type { OpenCodeClient } from "@opencode/client";
import { Provider, createStore } from "jotai";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenCodeRuntimeStatus, PalotSession } from "../../shared";
import { sessionTriageSnapshotAtom } from "../atoms/inbox";
import { inboxFiltersAtom, inboxViewPreferencesAtom } from "../atoms/ui";
import { runtimeAtom } from "../atoms/workspace";
import { createRendererQueryClient } from "../lib/query-client";
import { openCodeReconciler } from "../lib/open-code-reconciler";
import { openCodeKeys } from "../lib/opencode-query";
import { projectSessionInbox } from "../lib/session-inbox";
import { resetOpenCodeClientForTest, setOpenCodeClientForTest } from "../services/opencode-client";
import { palot } from "../services/palot";
import { renderWithRouter, seedCatalog } from "../test-utils/render-with-router";
import { InboxCompactRowSurface, InboxSidebarContent } from "./inbox-sidebar";
import { installSourceControl, pullRequestLink } from "./pull-requests/test-fixtures";
import { SidebarProvider } from "./ui/sidebar";
import { toast } from "./ui/toast";

const navigation = vi.hoisted(() => ({
  openSession: vi.fn(),
  preloadSession: vi.fn(),
}));
const overview = vi.hoisted(() => ({
  connections: [] as {
    profile: { id: string; name: string; kind: string };
    runtime: OpenCodeRuntimeStatus;
  }[],
  includedProfileIDs: [] as string[],
}));
vi.mock("../hooks/use-connection-overview", () => ({ useConnectionOverview: () => overview }));

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
  overview.connections = [];
  overview.includedProfileIDs = [];
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
  it("labels compact chat rows without pull request badges", () => {
    const chat = {
      ...session("chat", "Quick question", 20),
      location: { directory: "/home/user/.palot/chats/2026-10-27-question-abc" },
    };
    const item = projectSessionInbox({
      sessions: [chat],
      projects: [],
      requests: new Map(),
      activeIDs: new Set(),
      runningSinceBySession: new Map(),
      triage: null,
      now: 50,
    }).inbox[0]!;
    renderWithRouter(
      <InboxCompactRowSurface
        item={{ ...item, section: "settled" }}
        selected={false}
        buttonProps={{}}
        pullRequest={<span>Pull request badge</span>}
      />,
      createStore(),
    );
    expect(screen.getByRole("button", { name: /Quick question.*Chat/ })).toBeTruthy();
    expect(screen.queryByText("Pull request badge")).toBeNull();
  });

  it("keeps chats in Inbox, offers Chats filtering, and hides their PR badges", async () => {
    const store = createStore();
    const queryClient = createRendererQueryClient();
    store.set(runtimeAtom, {
      connectionID: "disconnected",
      profileID: "profile",
      connected: false,
    } as OpenCodeRuntimeStatus);
    const chat = {
      ...session("chat", "Quick question", 20),
      projectID: "chat-project",
      location: { directory: "/home/user/.palot/chats/2026-10-27-question-abc" },
    };
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
          id: "chat-project",
          canonical: chat.location.directory,
          name: "Backing chat folder",
          sandboxes: [],
          vcs: null,
          updatedAt: 1,
        },
      ],
      sessions: [chat, session("task", "Project work", 10)],
    });
    installSourceControl({
      listPullRequestLinks: vi.fn(async () => ({
        ok: true as const,
        value: [pullRequestLink("chat", 4)],
      })),
    });
    renderWithRouter(
      <SidebarProvider>
        <InboxSidebarContent />
      </SidebarProvider>,
      store,
      "/new",
      queryClient,
    );
    const card = screen
      .getByRole("button", { name: /^Open Quick question, Chat,/ })
      .closest<HTMLElement>("[data-inbox-card]")!;
    expect(within(card).getByText("Chat")).toBeTruthy();
    await waitFor(() => expect(card.querySelector("[data-pull-request-badge]")).toBeNull());
    fireEvent.contextMenu(screen.getByRole("button", { name: /^Open Quick question,/ }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Move to project…" }));
    expect(await screen.findByRole("dialog", { name: "Move to project" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    fireEvent.click(screen.getByRole("button", { name: "Filter tasks" }));
    const submenu = await screen.findByRole("menuitem", { name: "Project" });
    fireEvent.mouseEnter(submenu);
    fireEvent.click(submenu);
    fireEvent.click(await screen.findByRole("option", { name: "Chats" }));
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(store.get(inboxFiltersAtom).projectID).toBe("@chats"));
    expect(screen.getByRole("button", { name: /^Open Quick question,/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Open Project work,/ })).toBeNull();
    act(() => store.set(inboxFiltersAtom, { projectID: "project-1", states: [] }));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /^Open Quick question,/ })).toBeNull(),
    );
    expect(screen.getByRole("button", { name: /^Open Project work,/ })).toBeTruthy();
  });

  it("keeps folder creation on the original connection while a native picker is open", async () => {
    const store = createStore();
    const runtime: OpenCodeRuntimeStatus = {
      connectionID: "connection-original",
      profileID: "profile-original",
      contractVersion: "test",
      phase: "connected",
      connected: true,
      binaryPath: null,
      version: null,
      pid: null,
      managed: false,
      lastConnectedAt: null,
      error: null,
      versionMismatch: null,
    };
    store.set(runtimeAtom, runtime);
    overview.connections = [
      { profile: { id: runtime.profileID, name: "Original", kind: "local" }, runtime },
    ];
    overview.includedProfileIDs = [runtime.profileID];
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
    fireEvent.click(screen.getByRole("button", { name: "Choose local folder…" }));
    expect(pick).toHaveBeenCalledWith("connection-original");
    store.set(runtimeAtom, {
      ...runtime,
      connectionID: "connection-other",
      profileID: "profile-other",
    });
    finishPick("/original/folder");
    await waitFor(() =>
      expect((screen.getByLabelText("Folder path") as HTMLInputElement).value).toBe(
        "/original/folder",
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Add project" }));
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

  it("badges linked tasks from one pull request links query for the whole list", async () => {
    const store = createStore();
    const queryClient = createRendererQueryClient();
    store.set(runtimeAtom, {
      connectionID: "disconnected",
      profileID: "profile",
      connected: false,
    } as OpenCodeRuntimeStatus);
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
      sessions: [
        session("open", "Open task", 30),
        session("merged", "Merged task", 20),
        session("plain", "Plain task", 10),
      ],
    });
    const { api } = installSourceControl({
      listPullRequestLinks: vi.fn(async () => ({
        ok: true as const,
        value: [
          pullRequestLink("open", 4, {
            watch: { startedAt: 1, commentWakes: 0, readFailures: 0, lastWakeAt: null },
            pullRequest: { checks: "pending" },
          }),
          pullRequestLink("merged", 9, { pullRequest: { state: "merged" } }),
        ],
      })),
    });
    renderWithRouter(
      <SidebarProvider>
        <InboxSidebarContent />
      </SidebarProvider>,
      store,
      "/new",
      queryClient,
    );
    expect(
      await screen.findByRole("img", { name: "Pull request #4, open, checks running, watching" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("img", { name: "Pull request #9, merged, checks passing" }),
    ).toBeTruthy();
    const plain = screen
      .getByRole("button", { name: /^Open Plain task,/ })
      .closest("[data-inbox-card]");
    expect(plain?.querySelector("[data-pull-request-badge]")).toBeNull();
    expect(api.listPullRequestLinks).toHaveBeenCalledTimes(1);
    expect(api.listPullRequestLinks).toHaveBeenCalledWith({ profileID: "profile" });

    fireEvent.click(screen.getByRole("img", { name: /Pull request #4/ }));
    await waitFor(() => expect(navigation.openSession).toHaveBeenCalledWith("open"));
  });

  it("holds the task order while the pointer is over the list", async () => {
    const store = createStore();
    const queryClient = createRendererQueryClient();
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
      sessions: [session("older", "Older task", 10), session("newer", "Newer task", 20)],
    });
    store.set(sessionTriageSnapshotAtom, {
      profileID: "local-default",
      bootstrapThrough: null,
      sessions: [],
    });
    const { container } = renderWithRouter(
      <Provider store={store}>
        <SidebarProvider>
          <InboxSidebarContent />
        </SidebarProvider>
      </Provider>,
      store,
      "/new",
      queryClient,
    );
    const order = () =>
      screen
        .getAllByRole("button", { name: /^Open .* task,/ })
        .map((button) => button.getAttribute("aria-label")?.split(",")[0]);
    expect(order()).toEqual(["Open Newer task", "Open Older task"]);

    const list = container.querySelector<HTMLElement>('[data-sidebar="content"]')!;
    fireEvent.pointerEnter(list);
    openCodeReconciler(queryClient).patchSession("disconnected", "older", (current) => ({
      ...current,
      title: "Finished task",
      time: { ...current.time, updated: 50, idle: 50 },
    }));
    await waitFor(() => expect(order()).toEqual(["Open Newer task", "Open Finished task"]));

    fireEvent.pointerLeave(list);
    await waitFor(() => expect(order()).toEqual(["Open Finished task", "Open Newer task"]));
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
  it.each([
    { shelf: "Snoozed", title: "Snoozed task", action: "Wake task", type: "wake", undo: "snooze" },
    {
      shelf: "Settled",
      title: "Settled task",
      action: "Unsettle task",
      type: "inbox",
      undo: "settle",
    },
  ] as const)(
    "reaches the $shelf shelf's $action by keyboard and offers Undo",
    async ({ shelf, title, action, type, undo }) => {
      const addToast = vi.spyOn(toast, "add");
      const store = createStore();
      const dispatchSessionTriage = vi.fn(async () => store.get(sessionTriageSnapshotAtom)!);
      Object.assign(window.palot, { dispatchSessionTriage });
      store.set(runtimeAtom, {
        connectionID: "disconnected",
        profileID: "local-default",
        contractVersion: "test",
        phase: "connected",
        connected: true,
        binaryPath: null,
        version: null,
        pid: null,
        managed: false,
        lastConnectedAt: 1,
        error: null,
        versionMismatch: null,
      });
      const queryClient = createRendererQueryClient();
      const snoozedUntil = Date.now() + 60_000;
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
        sessions: [session("snoozed", "Snoozed task", 10), session("settled", "Settled task", 10)],
      });
      store.set(sessionTriageSnapshotAtom, {
        profileID: "local-default",
        bootstrapThrough: { updatedAt: 100, sessionID: "z" },
        sessions: [
          {
            sessionID: "snoozed",
            disposition: "inbox",
            settledThrough: null,
            pinnedAt: null,
            snoozedUntil,
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
      fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${shelf} 1$`) }));
      const row = screen
        .getByRole("button", { name: new RegExp(title) })
        .closest<HTMLElement>("[data-inbox-compact-row]")!;
      act(() =>
        within(row)
          .getByRole("button", { name: new RegExp(title) })
          .focus(),
      );
      await userEvent.tab();
      expect(document.activeElement).toBe(within(row).getByRole("button", { name: action }));
      await userEvent.keyboard("{Enter}");
      const id = title === "Snoozed task" ? "snoozed" : "settled";
      await waitFor(() =>
        expect(dispatchSessionTriage).toHaveBeenCalledWith(
          expect.objectContaining({ type, sessionID: id }),
        ),
      );
      await waitFor(() => expect(addToast).toHaveBeenCalled());
      const onClick = addToast.mock.calls.at(-1)![0].actionProps!.onClick as () => void;
      act(() => onClick());
      await waitFor(() =>
        expect(dispatchSessionTriage).toHaveBeenLastCalledWith(
          expect.objectContaining({
            type: undo,
            sessionID: id,
            ...(undo === "snooze" ? { until: snoozedUntil } : {}),
          }),
        ),
      );
    },
  );
});
