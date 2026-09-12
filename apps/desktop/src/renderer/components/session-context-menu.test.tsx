import { Provider, createStore } from "jotai";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenCodeRuntimeStatus, PalotProject, PalotSession } from "../../shared";
import { palot } from "../services/palot";
import { createRendererQueryClient } from "../lib/query-client";
import { messagesAtom, runtimeAtom, selectedSessionIDAtom } from "../atoms/workspace";
import { setTranscriptSnapshot } from "../hooks/use-session-transcript";
import { mapMessage } from "../services/opencode-mappers";
import { cacheSessions } from "../lib/session-catalog-query";
import { openCodeReconciler } from "../lib/open-code-reconciler";

const mocks = vi.hoisted(() => ({
  forkSession: vi.fn(),
  openNewTask: vi.fn(),
  openScheduled: vi.fn(),
  openSession: vi.fn(),
  forkOwner: vi.fn(),
}));

vi.mock("../hooks/use-session-fork", () => ({
  useSessionFork: (owner: unknown) => {
    mocks.forkOwner(owner);
    return mocks.forkSession;
  },
}));

import { SessionContextMenu, SessionExportMenu } from "./session-context-menu";

vi.mock("../hooks/use-navigation", () => ({
  usePalotNavigation: () => ({
    openNewTask: mocks.openNewTask,
    openScheduled: mocks.openScheduled,
    openSession: mocks.openSession,
  }),
}));

const project: PalotProject = {
  id: "project-1",
  canonical: "/repo",
  name: "Palot",
  sandboxes: [],
  vcs: "git",
  updatedAt: 1,
};

const session: PalotSession = {
  id: "session-1",
  parentID: null,
  projectID: project.id,
  title: "Task",
  agent: null,
  model: null,
  location: { directory: project.canonical },
  createdAt: 1,
  updatedAt: 1,
  archivedAt: null,
  cost: null,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
};

const owner: OpenCodeRuntimeStatus = {
  connectionID: "background-connection",
  profileID: "background-profile",
  contractVersion: "test",
  phase: "connected",
  connected: true,
  binaryPath: null,
  version: "test",
  pid: null,
  managed: false,
  lastConnectedAt: 1,
  error: null,
  versionMismatch: null,
};

beforeEach(() => {
  Element.prototype.getAnimations = vi.fn(() => []);
  mocks.forkSession.mockReset();
  mocks.forkSession.mockResolvedValue(undefined);
  mocks.openNewTask.mockReset();
  mocks.openNewTask.mockResolvedValue(undefined);
  mocks.openSession.mockReset();
  mocks.openSession.mockResolvedValue(undefined);
  mocks.openScheduled.mockReset();
  mocks.forkOwner.mockReset();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("SessionContextMenu", () => {
  it.each(["header", "sidebar"] as const)(
    "opens the selected task in a new window from the %s",
    async (surface) => {
      const open = vi.spyOn(palot, "openSessionWindow").mockResolvedValue(undefined);
      const store = createStore();
      store.set(runtimeAtom, { connectionID: "native-owner" } as never);
      render(
        <QueryClientProvider client={createRendererQueryClient()}>
          <Provider store={store}>
            {surface === "header" ? (
              <SessionExportMenu session={session} />
            ) : (
              <SessionContextMenu session={session} trigger={<button type="button">Task</button>} />
            )}
          </Provider>
        </QueryClientProvider>,
      );
      if (surface === "header")
        fireEvent.click(screen.getByRole("button", { name: "Task actions" }));
      else fireEvent.contextMenu(screen.getByRole("button", { name: "Task" }));
      fireEvent.click(await screen.findByRole("menuitem", { name: "Open in new window" }));
      expect(open).toHaveBeenCalledWith(session.id, "native-owner");
    },
  );
  it.each([
    ["Previous user turn", "previousTurn"],
    ["Next user turn", "nextTurn"],
    ["Prompt timeline", "openTimeline"],
    ["Fork from prompt…", "forkFromPrompt"],
  ] as const)("runs %s from task actions", async (label, action) => {
    const historyActions = {
      loadingOlder: false,
      previousTurn: vi.fn(),
      nextTurn: vi.fn(),
      openTimeline: vi.fn(),
      forkFromPrompt: vi.fn(),
    };
    render(
      <QueryClientProvider client={createRendererQueryClient()}>
        <Provider store={createStore()}>
          <SessionExportMenu session={session} historyActions={historyActions} />
        </Provider>
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Task actions" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: label }));
    expect(historyActions[action]).toHaveBeenCalledOnce();
  });

  it("disables previous-turn navigation while loading older turns", async () => {
    const previousTurn = vi.fn();
    render(
      <QueryClientProvider client={createRendererQueryClient()}>
        <Provider store={createStore()}>
          <SessionExportMenu
            session={session}
            historyActions={{
              loadingOlder: true,
              previousTurn,
              nextTurn: vi.fn(),
              openTimeline: vi.fn(),
              forkFromPrompt: vi.fn(),
            }}
          />
        </Provider>
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Task actions" }));
    const previous = await screen.findByRole("menuitem", { name: "Previous user turn" });
    expect(previous.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(previous);
    expect(previousTurn).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    "creates and moves on the original connection with focus changed=%s",
    async (switchFocus) => {
      vi.spyOn(palot, "refreshProjectCopies").mockResolvedValue(undefined);
      vi.spyOn(palot, "listProjectDirectories").mockResolvedValue([
        { directory: project.canonical, strategy: null },
      ]);
      const copy = Promise.withResolvers<{ directory: string }>();
      const create = vi.spyOn(palot, "createProjectCopy").mockReturnValue(copy.promise);
      const move = vi.spyOn(palot, "moveSession").mockResolvedValue({
        ...session,
        location: { directory: "/worktrees/new-task" },
      });

      const store = createStore();
      store.set(runtimeAtom, {
        connectionID: "connection",
        profileID: "profile",
        contractVersion: "test",
        phase: "connected",
        connected: true,
        binaryPath: "/usr/local/bin/opencode2",
        version: "test",
        pid: 1,
        managed: true,
        lastConnectedAt: 1,
        error: null,
        versionMismatch: null,
      });
      render(
        <QueryClientProvider client={createRendererQueryClient()}>
          <Provider store={store}>
            <SessionContextMenu
              trigger={<button type="button">Task</button>}
              session={session}
              project={project}
            />
          </Provider>
        </QueryClientProvider>,
      );

      fireEvent.contextMenu(screen.getByRole("button", { name: "Task" }));
      const submenu = await screen.findByRole("menuitem", { name: "Move to worktree" });
      fireEvent.mouseEnter(submenu);
      fireEvent.click(submenu);
      fireEvent.click(await screen.findByRole("menuitem", { name: "New worktree" }));

      await waitFor(() =>
        expect(create).toHaveBeenCalledWith(project.id, project.canonical, undefined, "connection"),
      );
      if (switchFocus) {
        act(() =>
          store.set(runtimeAtom, {
            ...store.get(runtimeAtom)!,
            connectionID: "other",
            profileID: "other-profile",
          }),
        );
      }
      await act(async () => copy.resolve({ directory: "/worktrees/new-task" }));
      expect(move).toHaveBeenCalledWith(session.id, "/worktrees/new-task", "connection");
    },
  );

  it("keeps the main checkout above the worktree list", async () => {
    vi.spyOn(palot, "refreshProjectCopies").mockResolvedValue(undefined);
    vi.spyOn(palot, "listProjectDirectories").mockResolvedValue([
      { directory: project.canonical, strategy: null },
      { directory: "/worktrees/current", strategy: "worktree" },
      { directory: "/worktrees/another", strategy: "worktree" },
    ]);

    render(
      <QueryClientProvider client={createRendererQueryClient()}>
        <Provider store={createStore()}>
          <SessionContextMenu
            trigger={<button type="button">Task</button>}
            session={{ ...session, location: { directory: "/worktrees/current" } }}
            project={project}
          />
        </Provider>
      </QueryClientProvider>,
    );

    fireEvent.contextMenu(screen.getByRole("button", { name: "Task" }));
    const submenu = await screen.findByRole("menuitem", { name: "Move to worktree" });
    fireEvent.mouseEnter(submenu);
    fireEvent.click(submenu);

    const newWorktree = await screen.findByRole("menuitem", { name: "New worktree" });
    const mainCheckout = await screen.findByRole("menuitem", { name: "Main checkout" });
    const anotherWorktree = await screen.findByRole("menuitem", { name: "another" });

    expect(newWorktree.compareDocumentPosition(mainCheckout)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(mainCheckout.compareDocumentPosition(anotherWorktree)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it("forks the full task from every session context menu", async () => {
    render(
      <QueryClientProvider client={createRendererQueryClient()}>
        <Provider store={createStore()}>
          <SessionContextMenu
            trigger={<button type="button">Task</button>}
            session={session}
            project={project}
          />
        </Provider>
      </QueryClientProvider>,
    );

    fireEvent.contextMenu(screen.getByRole("button", { name: "Task" }));
    expect(screen.queryByRole("menuitem", { name: "Remove worktree" })).toBeNull();
    fireEvent.click(await screen.findByRole("menuitem", { name: "Fork" }));

    await waitFor(() => expect(mocks.forkSession).toHaveBeenCalledWith({ sessionID: session.id }));
  });

  it("copies the complete conversation as Markdown", async () => {
    const copy = vi.spyOn(palot, "copySessionMarkdown").mockResolvedValue(undefined);
    render(
      <QueryClientProvider client={createRendererQueryClient()}>
        <Provider store={createStore()}>
          <SessionContextMenu
            trigger={<button type="button">Task</button>}
            session={session}
            project={project}
          />
        </Provider>
      </QueryClientProvider>,
    );

    fireEvent.contextMenu(screen.getByRole("button", { name: "Task" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Copy conversation as Markdown" }));
    await waitFor(() => expect(copy).toHaveBeenCalledWith(session.id, undefined));
  });

  it("offers nested snooze choices", async () => {
    const onSnooze = vi.fn();
    vi.spyOn(Date, "now").mockReturnValue(1_000);
    render(
      <QueryClientProvider client={createRendererQueryClient()}>
        <Provider store={createStore()}>
          <SessionContextMenu
            trigger={<button type="button">Task</button>}
            session={session}
            project={project}
            onSnooze={onSnooze}
          />
        </Provider>
      </QueryClientProvider>,
    );

    fireEvent.contextMenu(screen.getByRole("button", { name: "Task" }));
    const submenu = await screen.findByRole("menuitem", { name: "Snooze" });
    fireEvent.mouseEnter(submenu);
    fireEvent.click(submenu);
    fireEvent.click(await screen.findByRole("menuitem", { name: /^In 1 hour/ }));

    expect(onSnooze).toHaveBeenCalledWith(3_601_000);
  });

  it("confirms permanent deletion and leaves the selected task", async () => {
    const remove = vi.spyOn(palot, "removeSession").mockResolvedValue(undefined);
    const store = createStore();
    store.set(selectedSessionIDAtom, session.id);
    store.set(runtimeAtom, {
      connectionID: "connection",
      profileID: "profile",
      contractVersion: "test",
      phase: "connected",
      connected: true,
      binaryPath: "/usr/local/bin/opencode2",
      version: "test",
      pid: 1,
      managed: true,
      lastConnectedAt: 1,
      error: null,
      versionMismatch: null,
    });
    render(
      <QueryClientProvider client={createRendererQueryClient()}>
        <Provider store={store}>
          <SessionContextMenu
            trigger={<button type="button">Task</button>}
            session={session}
            project={project}
          />
        </Provider>
      </QueryClientProvider>,
    );

    fireEvent.contextMenu(screen.getByRole("button", { name: "Task" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Delete task" }));
    fireEvent.click(await screen.findByRole("button", { name: "Delete task" }));

    await waitFor(() => expect(remove).toHaveBeenCalledWith(session.id, "connection"));
    expect(mocks.openNewTask).toHaveBeenCalledWith(session.projectID, "profile");
  });

  it.each([
    "Open in new window",
    "Fork",
    "Schedule follow-up",
    "Export task",
    "Copy conversation as Markdown",
    "Import task",
  ])("routes %s to its background owner after the active profile changes", async (label) => {
    const openWindow = vi.spyOn(palot, "openSessionWindow").mockResolvedValue(undefined);
    const exportTask = vi.spyOn(palot, "exportSession").mockResolvedValue(null);
    const copy = vi.spyOn(palot, "copySessionMarkdown").mockResolvedValue(undefined);
    const imported = { ...session, id: "imported" };
    const importTask = vi.spyOn(palot, "importSession").mockResolvedValue(imported);
    const transcript = vi.spyOn(palot, "loadTranscript");
    const directories = vi.spyOn(palot, "listProjectDirectories");
    const store = createStore();
    const client = createRendererQueryClient();
    store.set(runtimeAtom, { ...owner, connectionID: "active", profileID: "active-profile" });
    render(
      <QueryClientProvider client={client}>
        <Provider store={store}>
          <SessionContextMenu
            owner={owner}
            session={session}
            project={project}
            trigger={<button type="button">Task</button>}
          />
        </Provider>
      </QueryClientProvider>,
    );
    expect(transcript).not.toHaveBeenCalled();
    expect(directories).not.toHaveBeenCalled();
    fireEvent.contextMenu(screen.getByRole("button", { name: "Task" }));
    act(() =>
      store.set(runtimeAtom, { ...owner, connectionID: "changed", profileID: "changed-profile" }),
    );
    fireEvent.click(await screen.findByRole("menuitem", { name: label }));
    await waitFor(() => {
      if (label === "Open in new window")
        expect(openWindow).toHaveBeenCalledWith(session.id, owner.connectionID);
      if (label === "Fork") {
        expect(mocks.forkOwner).toHaveBeenLastCalledWith(owner);
        expect(mocks.forkSession).toHaveBeenCalledWith({ sessionID: session.id });
      }
      if (label === "Schedule follow-up")
        expect(mocks.openScheduled).toHaveBeenCalledWith({
          mode: "create",
          sessionID: session.id,
          profileID: owner.profileID,
        });
      if (label === "Export task")
        expect(exportTask).toHaveBeenCalledWith(session.id, session.title, owner.connectionID);
      if (label === "Copy conversation as Markdown")
        expect(copy).toHaveBeenCalledWith(session.id, owner.connectionID);
      if (label === "Import task") {
        expect(importTask).toHaveBeenCalledWith(session.location, owner.connectionID);
        expect(mocks.openSession).toHaveBeenCalledWith(imported.id, { profileID: owner.profileID });
        expect(
          openCodeReconciler(client)
            .sessions(owner.connectionID)
            .map((item) => item.id),
        ).toContain(imported.id);
        expect(openCodeReconciler(client).sessions("changed")).toHaveLength(0);
      }
    });
  });

  it("deletes only the background duplicate without leaving the active task", async () => {
    const remove = vi.spyOn(palot, "removeSession").mockResolvedValue(undefined);
    const client = createRendererQueryClient();
    const store = createStore();
    store.set(runtimeAtom, { ...owner, connectionID: "active", profileID: "active-profile" });
    store.set(selectedSessionIDAtom, session.id);
    cacheSessions(client, "active", [session]);
    cacheSessions(client, owner.connectionID, [session]);
    render(
      <QueryClientProvider client={client}>
        <Provider store={store}>
          <SessionContextMenu
            owner={owner}
            session={session}
            trigger={<button type="button">Task</button>}
          />
        </Provider>
      </QueryClientProvider>,
    );
    fireEvent.contextMenu(screen.getByRole("button", { name: "Task" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Delete task" }));
    fireEvent.click(await screen.findByRole("button", { name: "Delete task" }));
    await waitFor(() => expect(remove).toHaveBeenCalledWith(session.id, owner.connectionID));
    expect(openCodeReconciler(client).sessions(owner.connectionID)).toHaveLength(0);
    expect(
      openCodeReconciler(client)
        .sessions("active")
        .map((item) => item.id),
    ).toEqual([session.id]);
    expect(mocks.openNewTask).not.toHaveBeenCalled();
  });

  it("lazily loads background prompts without mixing duplicate active transcript or optimistic IDs", async () => {
    const client = createRendererQueryClient();
    const store = createStore();
    store.set(runtimeAtom, { ...owner, connectionID: "active", profileID: "active-profile" });
    const activePrompt = {
      id: "same-prompt",
      type: "user" as const,
      time: { created: 1 },
      text: "Active prompt",
    };
    const backgroundPrompt = { ...activePrompt, text: "Background prompt" };
    store.set(
      messagesAtom,
      new Map([[session.id, [{ ...mapMessage(activePrompt), optimistic: true }]]]),
    );
    setTranscriptSnapshot(
      client,
      "active",
      session.id,
      { data: [activePrompt], cursor: { previous: null, next: null } },
      "rooted",
    );
    const load = vi
      .spyOn(palot, "loadTranscript")
      .mockResolvedValue({ data: [backgroundPrompt], cursor: { previous: null, next: null } });
    render(
      <QueryClientProvider client={client}>
        <Provider store={store}>
          <SessionContextMenu
            owner={owner}
            session={session}
            trigger={<button type="button">Task</button>}
          />
        </Provider>
      </QueryClientProvider>,
    );
    expect(load).not.toHaveBeenCalled();
    fireEvent.contextMenu(screen.getByRole("button", { name: "Task" }));
    expect(load).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("menuitem", { name: "Fork from prompt…" }));
    const prompt = await screen.findByRole("button", { name: /^Background prompt/ });
    expect(screen.queryByRole("button", { name: /^Active prompt/ })).toBeNull();
    expect(load).toHaveBeenCalledWith(
      session,
      "rooted",
      expect.any(AbortSignal),
      owner.connectionID,
    );
    fireEvent.click(prompt);
    await waitFor(() =>
      expect(mocks.forkSession).toHaveBeenCalledWith({
        sessionID: session.id,
        beforeMessageID: "same-prompt",
        restore: expect.objectContaining({ text: "Background prompt" }),
      }),
    );
    expect(mocks.forkOwner).toHaveBeenLastCalledWith(owner);
  });

  it("lazily lists and creates worktrees on the background owner, including after focus changes", async () => {
    const list = vi
      .spyOn(palot, "listProjectDirectories")
      .mockResolvedValue([{ directory: "/worktrees/other", strategy: "worktree" }]);
    const createResult = Promise.withResolvers<{ directory: string }>();
    const create = vi.spyOn(palot, "createProjectCopy").mockReturnValue(createResult.promise);
    const move = vi
      .spyOn(palot, "moveSession")
      .mockResolvedValue({ ...session, location: { directory: "/worktrees/new" } });
    const store = createStore();
    const client = createRendererQueryClient();
    store.set(runtimeAtom, { ...owner, connectionID: "active", profileID: "active-profile" });
    render(
      <QueryClientProvider client={client}>
        <Provider store={store}>
          <SessionContextMenu
            owner={owner}
            session={session}
            project={project}
            trigger={<button type="button">Task</button>}
          />
        </Provider>
      </QueryClientProvider>,
    );
    expect(list).not.toHaveBeenCalled();
    fireEvent.contextMenu(screen.getByRole("button", { name: "Task" }));
    const submenu = await screen.findByRole("menuitem", { name: "Move to worktree" });
    fireEvent.mouseEnter(submenu);
    fireEvent.click(submenu);
    await screen.findByRole("menuitem", { name: "other" });
    expect(list).toHaveBeenCalledWith(
      project.id,
      project.canonical,
      expect.any(AbortSignal),
      owner.connectionID,
    );
    fireEvent.click(await screen.findByRole("menuitem", { name: "New worktree" }));
    await waitFor(() =>
      expect(create).toHaveBeenCalledWith(
        project.id,
        project.canonical,
        undefined,
        owner.connectionID,
      ),
    );
    act(() =>
      store.set(runtimeAtom, { ...owner, connectionID: "changed", profileID: "changed-profile" }),
    );
    await act(async () => createResult.resolve({ directory: "/worktrees/new" }));
    expect(move).toHaveBeenCalledWith(session.id, "/worktrees/new", owner.connectionID);
    expect(
      openCodeReconciler(client)
        .sessions(owner.connectionID)
        .map((item) => item.id),
    ).toEqual([session.id]);
    expect(openCodeReconciler(client).sessions("changed")).toHaveLength(0);
  });

  it.each([null, { ...owner, connected: false }, { ...owner, phase: "connecting" as const }])(
    "never falls back to the active connection for unavailable owner %j",
    async (unavailableOwner) => {
      const store = createStore();
      store.set(runtimeAtom, owner);
      const remove = vi.spyOn(palot, "removeSession");
      const copy = vi.spyOn(palot, "copySessionMarkdown");
      const transcript = vi.spyOn(palot, "loadTranscript");
      const directories = vi.spyOn(palot, "listProjectDirectories");
      render(
        <QueryClientProvider client={createRendererQueryClient()}>
          <Provider store={store}>
            <SessionContextMenu
              owner={unavailableOwner}
              session={session}
              project={project}
              trigger={<button type="button">Task</button>}
            />
          </Provider>
        </QueryClientProvider>,
      );
      fireEvent.contextMenu(screen.getByRole("button", { name: "Task" }));
      for (const label of [
        "Open in new window",
        "Fork",
        "Fork from prompt…",
        "Schedule follow-up",
        "Export task",
        "Import task",
        "Copy conversation as Markdown",
        "Move to worktree",
        "Delete task",
      ]) {
        const item = await screen.findByRole("menuitem", { name: label });
        expect(item.getAttribute("aria-disabled")).toBe("true");
        fireEvent.click(item);
      }
      expect(remove).not.toHaveBeenCalled();
      expect(copy).not.toHaveBeenCalled();
      expect(mocks.forkSession).not.toHaveBeenCalled();
      expect(mocks.openScheduled).not.toHaveBeenCalled();
      expect(transcript).not.toHaveBeenCalled();
      expect(directories).not.toHaveBeenCalled();
    },
  );

  it("honors the owner's native restrictions without disabling server-side moves", async () => {
    const remote = {
      ...owner,
      capabilities: {
        serverFilesystem: true,
        localPathActions: false,
        localFileAttachments: false,
        worktreeCreate: false,
        pty: "legacy",
        scheduledAutomations: false,
        manualAutomations: true,
        integrationCallback: "code",
        pairing: "import-only",
      },
    } as const;
    vi.spyOn(palot, "listProjectDirectories").mockResolvedValue([
      { directory: "/worktrees/other", strategy: "worktree" },
    ]);
    const create = vi.spyOn(palot, "createProjectCopy");
    const move = vi.spyOn(palot, "moveSession").mockResolvedValue(null);
    render(
      <QueryClientProvider client={createRendererQueryClient()}>
        <Provider store={createStore()}>
          <SessionContextMenu
            owner={remote}
            session={session}
            project={project}
            trigger={<button type="button">Task</button>}
          />
        </Provider>
      </QueryClientProvider>,
    );
    fireEvent.contextMenu(screen.getByRole("button", { name: "Task" }));
    const schedule = await screen.findByRole("menuitem", { name: "Schedule follow-up" });
    expect(schedule.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(schedule);
    expect(mocks.openScheduled).not.toHaveBeenCalled();
    const submenu = await screen.findByRole("menuitem", { name: "Move to worktree" });
    fireEvent.mouseEnter(submenu);
    fireEvent.click(submenu);
    const newWorktree = await screen.findByRole("menuitem", { name: "New worktree" });
    expect(newWorktree.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(newWorktree);
    expect(create).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("menuitem", { name: "other" }));
    await waitFor(() =>
      expect(move).toHaveBeenCalledWith(session.id, "/worktrees/other", owner.connectionID),
    );
  });
});
