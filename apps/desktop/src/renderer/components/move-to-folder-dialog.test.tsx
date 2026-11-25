import { createStore } from "jotai";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenCodeRuntimeStatus, PalotSession } from "../../shared";
import { runtimeAtom } from "../atoms/workspace";
import { createRendererQueryClient } from "../lib/query-client";
import { palot } from "../services/palot";
import { getOpenCodeVcsStatus } from "../services/opencode-vcs";
import { renderWithRouter, seedCatalog } from "../test-utils/render-with-router";
import { MoveToFolderDialog } from "./move-to-folder-dialog";

vi.mock("../services/opencode-vcs", () => ({ getOpenCodeVcsStatus: vi.fn() }));

const owner = {
  connectionID: "origin",
  profileID: "origin-profile",
  connected: true,
  phase: "connected",
} as OpenCodeRuntimeStatus;
const session: PalotSession = {
  id: "task",
  parentID: null,
  projectID: "project-1",
  title: "Fix login",
  agent: null,
  model: null,
  location: { directory: "/repo-worktree" },
  createdAt: 1,
  updatedAt: 1,
  archivedAt: null,
  cost: null,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
};

beforeEach(() => {
  Element.prototype.getAnimations = vi.fn(() => []);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function setup(changes: string[]) {
  vi.mocked(getOpenCodeVcsStatus).mockResolvedValue(
    changes.map((file) => ({ file }) as Awaited<ReturnType<typeof getOpenCodeVcsStatus>>[number]),
  );
  const store = createStore();
  store.set(runtimeAtom, owner);
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
          vcs: "git",
          updatedAt: 1,
        },
        {
          id: "project-2",
          canonical: "/site",
          name: "Site",
          sandboxes: [],
          vcs: "git",
          updatedAt: 1,
        },
      ],
      sessions: [session],
    },
    owner.connectionID,
  );
  const onClose = vi.fn();
  renderWithRouter(
    <MoveToFolderDialog session={session} owner={owner} onClose={onClose} />,
    store,
    "/new",
    queryClient,
  );
  return { onClose };
}

describe("MoveToFolderDialog", () => {
  it("warns that uncommitted changes stay behind, then moves on confirmation", async () => {
    const move = vi
      .spyOn(palot, "moveSession")
      .mockResolvedValue({ ...session, projectID: "project-2", location: { directory: "/site" } });
    const { onClose } = setup(["src/login.ts", "README.md"]);
    await userEvent.click(await screen.findByRole("option", { name: /Site/ }));
    expect(await screen.findByText(/2 uncommitted changes stay in repo-worktree/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Move anyway" }));
    await waitFor(() => expect(move).toHaveBeenCalledWith("task", "/site", "origin"));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });

  it("moves a clean task without a warning and keeps errors in the dialog", async () => {
    vi.spyOn(palot, "moveSession").mockRejectedValue(new Error("Directory is unavailable"));
    const { onClose } = setup([]);
    await userEvent.click(await screen.findByRole("option", { name: /Palot/ }));
    const button = await screen.findByRole<HTMLButtonElement>("button", { name: "Move task" });
    await waitFor(() => expect(button.disabled).toBe(false));
    expect(screen.queryByText(/uncommitted/)).toBeNull();
    await userEvent.click(button);
    expect((await screen.findByRole("alert")).textContent).toContain("Directory is unavailable");
    expect(onClose).not.toHaveBeenCalled();
  });
});
