import type { PalotProject, PalotSession } from "../../../shared";
import { createStore } from "jotai";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runtimeAtom } from "../../atoms/workspace";
import { createRendererQueryClient } from "../../lib/query-client";
import { palot } from "../../services/palot";
import * as opencodeVcs from "../../services/opencode-vcs";
import { renderWithRouter, seedCatalog } from "../../test-utils/render-with-router";
import { WorktreesPage } from "./worktrees-page";

const project: PalotProject = {
  id: "project-1",
  canonical: "/repo",
  name: "Palot",
  sandboxes: [],
  vcs: "git",
  updatedAt: 1,
};

const attachedSession: PalotSession = {
  id: "session-1",
  parentID: null,
  projectID: project.id,
  title: "Attached task",
  agent: null,
  model: null,
  location: { directory: "/worktrees/attached" },
  createdAt: 1,
  updatedAt: 1,
  archivedAt: null,
  cost: null,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("WorktreesPage", () => {
  it("discloses only tasks attached to that project's worktree and links archived tasks too", async () => {
    vi.spyOn(palot, "refreshProjectCopies").mockResolvedValue(undefined);
    vi.spyOn(palot, "listProjectDirectories").mockResolvedValue([
      { directory: project.canonical, strategy: null },
      { directory: "/worktrees/attached", strategy: "git" },
      { directory: "/worktrees/other", strategy: "git" },
    ]);
    const archived = {
      ...attachedSession,
      id: "archived",
      title: "Archived investigation",
      archivedAt: 2,
    };
    const queryClient = createRendererQueryClient();
    const store = createConnectedStore();
    seedCatalog(
      queryClient,
      {
        projects: [project],
        sessions: [
          attachedSession,
          archived,
          {
            ...attachedSession,
            id: "other-worktree",
            title: "Other worktree task",
            location: { directory: "/worktrees/other" },
          },
          {
            ...attachedSession,
            id: "other-project",
            title: "Other project task",
            projectID: "other-project",
          },
        ],
      },
      "connection",
    );
    const { router } = renderWithRouter(
      <div style={{ width: 360 }}>
        <WorktreesPage />
      </div>,
      store,
      "/worktrees?projectID=project-1",
      queryClient,
    );

    const disclosure = await screen.findByRole("button", { name: "Tasks in attached" });
    expect(disclosure.getAttribute("aria-expanded")).toBe("false");
    expect(disclosure.textContent).toContain("2 tasks");
    expect(screen.queryByRole("link", { name: "Attached task" })).toBeNull();
    await userEvent.click(disclosure);
    const list = screen.getByRole("list", { name: "Tasks in attached" });
    expect(within(list).getAllByRole("link")).toHaveLength(2);
    expect(within(list).getByRole("link", { name: "Attached task" }).getAttribute("href")).toBe(
      "/sessions/session-1",
    );
    const archivedLink = within(list).getByRole("link", {
      name: "Archived investigation Archived",
    });
    expect(screen.queryByRole("link", { name: "Other worktree task" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Other project task" })).toBeNull();
    await userEvent.click(archivedLink);
    await waitFor(() => expect(router.state.location.pathname).toBe("/sessions/archived"));
  });

  it("lists project worktrees, protects attached tasks, and removes a clean worktree", async () => {
    vi.spyOn(palot, "refreshProjectCopies").mockResolvedValue(undefined);
    vi.spyOn(palot, "listProjectDirectories").mockResolvedValue([
      { directory: project.canonical, strategy: null },
      { directory: "/worktrees/clean", strategy: "git" },
      { directory: "/worktrees/attached", strategy: "git" },
    ]);
    const remove = vi.spyOn(palot, "removeProjectCopy").mockResolvedValue(undefined);
    const status = vi.spyOn(opencodeVcs, "getOpenCodeVcsStatus").mockResolvedValue([]);

    const store = createConnectedStore();
    const queryClient = createRendererQueryClient();
    seedCatalog(queryClient, { projects: [project], sessions: [attachedSession] }, "connection");
    renderWithRouter(<WorktreesPage />, store, "/worktrees?projectID=project-1", queryClient);

    expect(await screen.findByText("Main checkout")).toBeTruthy();
    expect(screen.getByText("clean")).toBeTruthy();
    expect(screen.getByText("attached")).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Remove attached" }) as HTMLButtonElement).disabled,
    ).toBe(true);

    await userEvent.click(screen.getByRole("button", { name: "Remove clean" }));
    await waitFor(() => expect(status).toHaveBeenCalledWith({ directory: "/worktrees/clean" }));
    await userEvent.click(screen.getByRole("button", { name: "Remove worktree" }));

    await waitFor(() =>
      expect(remove).toHaveBeenCalledWith(project.id, project.canonical, "/worktrees/clean", false),
    );
  });
});

function createConnectedStore() {
  const store = createStore();
  store.set(runtimeAtom, {
    connectionID: "connection",
    profileID: "profile",
    contractVersion: "test",
    phase: "connected",
    connected: true,
    binaryPath: null,
    version: "test",
    pid: 1,
    managed: true,
    lastConnectedAt: 1,
    error: null,
    versionMismatch: null,
  });
  return store;
}
