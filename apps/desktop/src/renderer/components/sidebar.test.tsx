import { Provider, createStore } from "jotai";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { FormInfo, PermissionRequest } from "@opencode/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenCodeRuntimeStatus, PalotSession } from "../../shared";
import { attentionTargetAtom } from "../atoms/attention";
import { attentionSeenIDsAtom, sidebarSectionsAtom } from "../atoms/attention";
import { sessionTriageSnapshotAtom } from "../atoms/inbox";
import { runtimeAtom, selectedSessionIDAtom } from "../atoms/workspace";
import { ProjectSidebarContent } from "./sidebar";
import { SidebarProvider } from "./ui/sidebar";
import { renderWithRouter, seedCatalog } from "../test-utils/render-with-router";
import { createRendererQueryClient } from "../lib/query-client";
import { openCodeReconciler } from "../lib/open-code-reconciler";
import { setSessionRequestSnapshot } from "../lib/session-request-query";
import { palot } from "../services/palot";

let showAttentionNotification: ReturnType<typeof vi.fn>;
let dispatchSessionTriage: ReturnType<typeof vi.fn>;
const overview = vi.hoisted(() => ({
  connections: [] as {
    profile: { id: string; name: string; kind: string };
    runtime: OpenCodeRuntimeStatus;
  }[],
  includedProfileIDs: [] as string[],
}));
vi.mock("../hooks/use-connection-overview", () => ({ useConnectionOverview: () => overview }));

const session: PalotSession = {
  id: "session-1",
  parentID: null,
  projectID: "project-1",
  title: "Release verification",
  agent: null,
  model: null,
  location: { directory: "/repo" },
  createdAt: 1,
  updatedAt: 2,
  archivedAt: null,
  cost: null,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
};

function permission(id: string, sessionID = session.id, action = "shell"): PermissionRequest {
  return { id, sessionID, action, resources: [] };
}

function form(id: string, sessionID = session.id): FormInfo {
  return {
    id,
    sessionID,
    title: "Deployment details",
    fields: [{ key: "details", type: "string", title: "Details" }],
  };
}

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
  showAttentionNotification = vi.fn();
  dispatchSessionTriage = vi.fn().mockResolvedValue({
    profileID: "local-default",
    bootstrapThrough: null,
    sessions: [],
  });
  Object.defineProperty(window, "palot", {
    configurable: true,
    value: {
      dispatchSessionTriage,
      runtimeStatus: vi.fn(),
      showAttentionNotification,
    },
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  Reflect.deleteProperty(window, "palot");
});

describe("ProjectSidebarContent attention", () => {
  it.each(["folder", "remote", "import"] as const)(
    "keeps %s creation and navigation on its original owner after focus changes",
    async (action) => {
      const store = createStore();
      const queryClient = createRendererQueryClient();
      store.set(runtimeAtom, {
        connectionID: "origin",
        profileID: "origin-profile",
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
        capabilities: {
          serverFilesystem: true,
          localPathActions: action !== "remote",
          localFileAttachments: true,
          worktreeCreate: true,
          pty: "persistent",
          scheduledAutomations: false,
          manualAutomations: true,
          integrationCallback: "unknown",
          pairing: "none",
        },
      });
      overview.connections = [
        {
          profile: {
            id: "origin-profile",
            name: "Original",
            kind: action === "remote" ? "remote" : "local",
          },
          runtime: store.get(runtimeAtom)!,
        },
      ];
      overview.includedProfileIDs = ["origin-profile"];
      const directory = Promise.withResolvers<string | null>();
      const created = Promise.withResolvers<PalotSession | null>();
      vi.spyOn(palot, "pickDirectory").mockReturnValue(directory.promise);
      const create = vi.spyOn(palot, "createSession").mockReturnValue(created.promise);
      const importTask = vi.spyOn(palot, "importSession").mockReturnValue(created.promise);
      const { router } = renderWithRouter(
        <SidebarProvider>
          <ProjectSidebarContent onNewSession={vi.fn()} />
        </SidebarProvider>,
        store,
        "/new",
        queryClient,
      );
      const navigate = vi.spyOn(router, "navigate").mockResolvedValue(undefined);

      if (action === "import") {
        fireEvent.click(await screen.findByRole("button", { name: "Import task" }));
        expect(importTask).toHaveBeenCalledWith(undefined, "origin");
      } else {
        fireEvent.click(screen.getByRole("button", { name: "Add project folder" }));
        if (action === "remote") {
          fireEvent.change(screen.getByLabelText("Folder path"), {
            target: { value: "/repo" },
          });
          fireEvent.click(screen.getByRole("button", { name: "Add project" }));
        } else fireEvent.click(screen.getByRole("button", { name: "Choose local folder…" }));
      }
      act(() =>
        store.set(runtimeAtom, {
          ...store.get(runtimeAtom)!,
          connectionID: "other",
          profileID: "other-profile",
        }),
      );
      if (action === "folder") {
        await act(async () => directory.resolve("/repo"));
        fireEvent.click(screen.getByRole("button", { name: "Add project" }));
      }
      if (action !== "import") expect(create).toHaveBeenCalledWith("/repo", undefined, "origin");
      await act(async () => created.resolve(session));

      expect(navigate).toHaveBeenCalledWith(
        expect.objectContaining({
          params: { sessionID: session.id },
          search: { profileID: "origin-profile" },
        }),
      );
      expect(openCodeReconciler(queryClient).session("origin", session.id)?.id).toBe(session.id);
      expect(openCodeReconciler(queryClient).session("other", session.id)).toBeNull();
    },
  );

  it("constrains the projects panel so its task list can scroll", () => {
    const store = createStore();
    const queryClient = createRendererQueryClient();
    seedCatalog(queryClient, {
      projects: [
        {
          id: "project-1",
          name: "Palot",
          canonical: "/repo",
          sandboxes: [],
          vcs: null,
          updatedAt: 1,
        },
      ],
      sessions: [session],
    });

    renderWithRouter(
      <Provider store={store}>
        <SidebarProvider>
          <ProjectSidebarContent onNewSession={vi.fn()} />
        </SidebarProvider>
      </Provider>,
      store,
      "/new",
      queryClient,
    );

    const root = screen
      .getByRole("button", { name: "Projects" })
      .closest('[data-slot="collapsible"]');
    const panel = root?.querySelector('[data-slot="collapsible-content"]');
    expect(root?.classList.contains("flex-col")).toBe(true);
    expect(root?.classList.contains("overflow-hidden")).toBe(true);
    expect(panel?.classList.contains("flex-col")).toBe(true);
    expect(panel?.classList.contains("overflow-hidden")).toBe(true);
  });

  it("preloads hovered sessions without selecting them", async () => {
    const store = createStore();
    const second = { ...session, id: "session-2", title: "Second session", updatedAt: 3 };
    const queryClient = createRendererQueryClient();
    seedCatalog(queryClient, { sessions: [session, second] });
    markUnread(queryClient, second);
    store.set(selectedSessionIDAtom, session.id);
    const { router } = renderWithRouter(
      <Provider store={store}>
        <SidebarProvider>
          <ProjectSidebarContent onNewSession={vi.fn()} />
        </SidebarProvider>
      </Provider>,
      store,
      `/sessions/${session.id}`,
      queryClient,
    );

    await userEvent.hover(screen.getByRole("button", { name: /Second session/ }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/sessions/${session.id}`));
    expect(store.get(selectedSessionIDAtom)).toBe(session.id);
    expect(openCodeReconciler(queryClient).session("disconnected", second.id)?.time.viewed).toBe(5);
  });

  it("offers Settle from session context menus", async () => {
    const store = createStore();
    store.set(runtimeAtom, {
      connectionID: "disconnected",
      profileID: "local-default",
      contractVersion: "0.0.0-beta-19425",
      phase: "idle",
      connected: false,
      binaryPath: null,
      version: null,
      pid: null,
      managed: false,
      lastConnectedAt: null,
      error: null,
      versionMismatch: null,
    });
    const queryClient = createRendererQueryClient();
    seedCatalog(queryClient, { sessions: [session] });

    renderWithRouter(
      <Provider store={store}>
        <SidebarProvider>
          <ProjectSidebarContent onNewSession={vi.fn()} />
        </SidebarProvider>
      </Provider>,
      store,
      "/new",
      queryClient,
    );

    fireEvent.contextMenu(screen.getAllByRole("button", { name: /Release verification/ })[0]!);

    fireEvent.click(await screen.findByRole("menuitem", { name: "Settle" }));

    await waitFor(() =>
      expect(dispatchSessionTriage).toHaveBeenCalledWith({
        type: "settle",
        profileID: "local-default",
        sessionID: session.id,
        at: expect.any(Number),
        through: { updatedAt: session.updatedAt, sessionID: session.id },
      }),
    );
  });

  it("snoozes sessions from a nested context menu", async () => {
    const store = createStore();
    store.set(runtimeAtom, {
      connectionID: "disconnected",
      profileID: "local-default",
      contractVersion: "0.0.0-beta-19425",
      phase: "idle",
      connected: false,
      binaryPath: null,
      version: null,
      pid: null,
      managed: false,
      lastConnectedAt: null,
      error: null,
      versionMismatch: null,
    });
    store.set(sessionTriageSnapshotAtom, {
      profileID: "local-default",
      bootstrapThrough: null,
      sessions: [],
    });
    const queryClient = createRendererQueryClient();
    seedCatalog(queryClient, { sessions: [session] });
    vi.spyOn(Date, "now").mockReturnValue(1_000);

    renderWithRouter(
      <Provider store={store}>
        <SidebarProvider>
          <ProjectSidebarContent onNewSession={vi.fn()} />
        </SidebarProvider>
      </Provider>,
      store,
      "/new",
      queryClient,
    );

    fireEvent.contextMenu(screen.getAllByRole("button", { name: /Release verification/ })[0]!);
    const submenu = await screen.findByRole("menuitem", { name: "Snooze" });
    fireEvent.mouseEnter(submenu);
    fireEvent.click(submenu);
    fireEvent.click(await screen.findByRole("menuitem", { name: /^In 1 hour/ }));

    await waitFor(() =>
      expect(dispatchSessionTriage).toHaveBeenCalledWith({
        type: "snooze",
        profileID: "local-default",
        sessionID: session.id,
        at: 1_000,
        until: 3_601_000,
        through: { updatedAt: session.updatedAt, sessionID: session.id },
      }),
    );
  });

  it("uses one reserved state slot for idle unread activity", () => {
    const store = createStore();
    const queryClient = createRendererQueryClient();
    seedCatalog(queryClient, { sessions: [session] });
    markUnread(queryClient, session);

    renderWithRouter(
      <Provider store={store}>
        <SidebarProvider>
          <ProjectSidebarContent onNewSession={vi.fn()} />
        </SidebarProvider>
      </Provider>,
      store,
      "/new",
      queryClient,
    );

    expect(screen.getAllByLabelText("Unread task activity")).toHaveLength(1);
    expect(
      document.querySelectorAll(`time[datetime="${new Date(10).toISOString()}"]`),
    ).toHaveLength(1);
  });

  it("does not show unread activity for the selected session", async () => {
    const store = createStore();
    const queryClient = createRendererQueryClient();
    seedCatalog(queryClient, { sessions: [session] });
    markUnread(queryClient, session);

    const { router } = renderWithRouter(
      <Provider store={store}>
        <SidebarProvider>
          <ProjectSidebarContent onNewSession={vi.fn()} />
        </SidebarProvider>
      </Provider>,
      store,
      "/new",
      queryClient,
    );
    const navigate = vi.spyOn(router, "navigate").mockImplementation(() => new Promise(() => {}));

    await userEvent.click(screen.getAllByRole("button", { name: /Release verification/ })[0]!);

    await waitFor(() => expect(screen.queryByLabelText("Unread task activity")).toBeNull());
    navigate.mockRestore();
  });

  it("shows running instead of unread while keeping the recent timestamp", () => {
    const store = createStore();
    const queryClient = createRendererQueryClient();
    seedCatalog(queryClient, { sessions: [session] });
    markUnread(queryClient, session);
    openCodeReconciler(queryClient).replaceActivity("disconnected", {
      activeIDs: new Set([session.id]),
      execution: new Map([
        [session.id, { status: "running" as const, startedAt: 1, completedAt: null }],
      ]),
      statuses: new Map(),
    });

    renderWithRouter(
      <Provider store={store}>
        <SidebarProvider>
          <ProjectSidebarContent onNewSession={vi.fn()} />
        </SidebarProvider>
      </Provider>,
      store,
      "/new",
      queryClient,
    );

    expect(screen.getAllByLabelText("Task is running")).toHaveLength(1);
    expect(screen.queryByLabelText("Unread task activity")).toBeNull();
    expect(
      document.querySelectorAll(`time[datetime="${new Date(session.updatedAt).toISOString()}"]`),
    ).toHaveLength(1);
  });

  it("shows the clicked session as active before navigation commits", async () => {
    const store = createStore();
    const second = { ...session, id: "session-2", title: "Second session", updatedAt: 3 };
    const queryClient = createRendererQueryClient();
    seedCatalog(queryClient, { sessions: [session, second] });
    const { router } = renderWithRouter(
      <Provider store={store}>
        <SidebarProvider>
          <ProjectSidebarContent onNewSession={vi.fn()} />
        </SidebarProvider>
      </Provider>,
      store,
      `/sessions/${session.id}`,
      queryClient,
    );
    const navigate = vi.spyOn(router, "navigate").mockImplementation(() => new Promise(() => {}));

    await userEvent.click(screen.getByRole("button", { name: /Second session/ }));

    expect(screen.getByRole("button", { name: /Second session/ }).hasAttribute("data-active")).toBe(
      true,
    );
    expect(router.state.location.pathname).toBe(`/sessions/${session.id}`);
    navigate.mockRestore();
  });

  it("drops an optimistic selection when navigation moves from another origin", async () => {
    const store = createStore();
    const second = { ...session, id: "session-2", title: "Second session", updatedAt: 3 };
    const third = { ...session, id: "session-3", title: "Third session", updatedAt: 4 };
    const queryClient = createRendererQueryClient();
    seedCatalog(queryClient, { sessions: [session, second, third] });
    const { router } = renderWithRouter(
      <Provider store={store}>
        <SidebarProvider>
          <ProjectSidebarContent onNewSession={vi.fn()} />
        </SidebarProvider>
      </Provider>,
      store,
      `/sessions/${session.id}`,
      queryClient,
    );
    const navigate = vi.spyOn(router, "navigate").mockImplementation(() => new Promise(() => {}));

    await userEvent.click(screen.getByRole("button", { name: /Second session/ }));
    navigate.mockRestore();
    await router.navigate({
      to: "/sessions/$sessionID",
      params: { sessionID: third.id },
    });

    expect(screen.getByRole("button", { name: /Second session/ }).hasAttribute("data-active")).toBe(
      false,
    );
    expect(screen.getByRole("button", { name: /Third session/ }).hasAttribute("data-active")).toBe(
      true,
    );
  });

  it("renders pending attention and deep-links to its session", async () => {
    const store = createStore();
    const queryClient = createRendererQueryClient();
    seedCatalog(queryClient, {
      projects: [
        {
          id: "project-1",
          name: "Palot",
          canonical: "/repo",
          sandboxes: [],
          vcs: null,
          updatedAt: 1,
        },
      ],
      sessions: [session],
    });
    setSessionRequestSnapshot(queryClient, "disconnected", session.id, {
      permissions: [permission("permission-1", session.id, "Run command")],
      forms: [],
      inbox: [],
      errors: [],
    });
    const { router } = renderWithRouter(
      <Provider store={store}>
        <SidebarProvider>
          <ProjectSidebarContent onNewSession={vi.fn()} />
        </SidebarProvider>
      </Provider>,
      store,
      "/new",
      queryClient,
    );

    expect(screen.getByText("Needs attention")).toBeTruthy();
    await userEvent.click(document.querySelector<HTMLElement>("[data-palot-attention-row]")!);

    expect(router.state.location.pathname).toBe(`/sessions/${session.id}`);
    expect(store.get(attentionTargetAtom)).toEqual({
      sessionID: session.id,
      requestID: "permission-1",
      type: "permission",
    });
  });

  it("renders one row for multiple blockers in the same session", () => {
    const store = createStore();
    const queryClient = createRendererQueryClient();
    seedCatalog(queryClient, { sessions: [session] });
    setSessionRequestSnapshot(queryClient, "disconnected", session.id, {
      permissions: [permission("permission-1")],
      forms: [form("form-1")],
      inbox: [],
      errors: [],
    });

    renderWithRouter(
      <Provider store={store}>
        <SidebarProvider>
          <ProjectSidebarContent onNewSession={vi.fn()} />
        </SidebarProvider>
      </Provider>,
      store,
      "/new",
      queryClient,
    );

    expect(document.querySelectorAll("[data-palot-attention-row]")).toHaveLength(1);
    expect(screen.getByText("2 requests · form + permission")).toBeTruthy();
  });

  it("marks only the focused blocker seen when selecting a grouped row", async () => {
    const store = createStore();
    const queryClient = createRendererQueryClient();
    seedCatalog(queryClient, { sessions: [session] });
    setSessionRequestSnapshot(queryClient, "disconnected", session.id, {
      permissions: [permission("permission-1")],
      forms: [form("form-1")],
      inbox: [],
      errors: [],
    });

    renderWithRouter(
      <Provider store={store}>
        <SidebarProvider>
          <ProjectSidebarContent onNewSession={vi.fn()} />
        </SidebarProvider>
      </Provider>,
      store,
      "/new",
      queryClient,
    );
    await userEvent.click(document.querySelector<HTMLElement>("[data-palot-attention-row]")!);

    expect(store.get(attentionSeenIDsAtom)).toEqual([`${session.id}:form:form-1`]);
  });

  it("opens the child session that owns a descendant blocker", async () => {
    const store = createStore();
    const child = { ...session, id: "child-1", parentID: session.id, title: "Explore" };
    const queryClient = createRendererQueryClient();
    seedCatalog(queryClient, { sessions: [session, child] });
    setSessionRequestSnapshot(queryClient, "disconnected", child.id, {
      permissions: [permission("permission-child", child.id)],
      forms: [],
      inbox: [],
      errors: [],
    });

    const { router } = renderWithRouter(
      <Provider store={store}>
        <SidebarProvider>
          <ProjectSidebarContent onNewSession={vi.fn()} />
        </SidebarProvider>
      </Provider>,
      store,
      "/new",
      queryClient,
    );
    expect(document.querySelector("[data-palot-attention-row]")?.textContent).toContain(
      session.title,
    );
    expect(document.querySelector("[data-palot-attention-row]")?.textContent).toContain(
      "Subagent permission",
    );
    await userEvent.click(document.querySelector<HTMLElement>("[data-palot-attention-row]")!);

    expect(router.state.location.pathname).toBe(`/sessions/${child.id}`);
  });

  it("notifies for a new blocker in an existing attention session", async () => {
    const store = createStore();
    const queryClient = createRendererQueryClient();
    seedCatalog(queryClient, { sessions: [session] });
    setSessionRequestSnapshot(queryClient, "disconnected", session.id, {
      permissions: [permission("permission-1")],
      forms: [],
      inbox: [],
      errors: [],
    });
    vi.spyOn(document, "hasFocus").mockReturnValue(false);

    renderWithRouter(
      <Provider store={store}>
        <SidebarProvider>
          <ProjectSidebarContent onNewSession={vi.fn()} />
        </SidebarProvider>
      </Provider>,
      store,
      "/new",
      queryClient,
    );

    setSessionRequestSnapshot(queryClient, "disconnected", session.id, {
      permissions: [permission("permission-1")],
      forms: [form("form-1")],
      inbox: [],
      errors: [],
    });

    await waitFor(() =>
      expect(showAttentionNotification).toHaveBeenCalledWith({
        sessionID: session.id,
        requestID: "form-1",
        type: "form",
      }),
    );
  });

  it("preserves a persisted collapsed attention section on mount", () => {
    const store = createStore();
    store.set(sidebarSectionsAtom, { attention: false, recents: true, projects: true });
    const queryClient = createRendererQueryClient();
    seedCatalog(queryClient, { sessions: [session] });
    setSessionRequestSnapshot(queryClient, "disconnected", session.id, {
      permissions: [permission("permission-1", session.id, "Run command")],
      forms: [],
      inbox: [],
      errors: [],
    });

    renderWithRouter(
      <Provider store={store}>
        <SidebarProvider>
          <ProjectSidebarContent onNewSession={vi.fn()} />
        </SidebarProvider>
      </Provider>,
      store,
      "/new",
      queryClient,
    );

    expect(store.get(sidebarSectionsAtom).attention).toBe(false);
    expect(document.querySelector("[data-palot-attention-row]")).toBeNull();
  });
});
