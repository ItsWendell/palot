import { createStore } from "jotai";
import { act, cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenCodeRuntimeStatus, PalotSession } from "../../shared";
import { runtimeAtom } from "../atoms/workspace";
import { createRendererQueryClient } from "../lib/query-client";
import { openCodeReconciler } from "../lib/open-code-reconciler";
import { palot } from "../services/palot";
import { renderWithRouter, seedCatalog } from "../test-utils/render-with-router";
import { MoveToProjectDialog } from "./move-to-project-dialog";
import { SessionThreadHeader } from "./thread";

const owner = {
  connectionID: "origin",
  profileID: "origin-profile",
  connected: true,
  phase: "connected",
} as OpenCodeRuntimeStatus;
const session: PalotSession = {
  id: "chat",
  parentID: null,
  projectID: "chat-project",
  title: "Question",
  agent: null,
  model: null,
  location: { directory: "/home/user/.palot/chats/2026-10-27-question-abc" },
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

function setup() {
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
          sandboxes: ["/repo-worktree"],
          vcs: "git",
          updatedAt: 1,
        },
        {
          id: "chat-project",
          canonical: session.location.directory,
          name: "Backing chat folder",
          sandboxes: [],
          vcs: null,
          updatedAt: 1,
        },
      ],
      sessions: [session],
    },
    owner.connectionID,
  );
  const onClose = vi.fn();
  renderWithRouter(
    <MoveToProjectDialog session={session} onClose={onClose} />,
    store,
    "/new",
    queryClient,
  );
  return { store, queryClient, onClose };
}

describe("MoveToProjectDialog", () => {
  it.each([false, true])(
    "offers moving from the chat header, disabled while working: %s",
    async (running) => {
      const store = createStore();
      store.set(runtimeAtom, {
        ...owner,
        capabilities: { localPathActions: true },
      } as OpenCodeRuntimeStatus);
      const queryClient = createRendererQueryClient();
      seedCatalog(queryClient, { sessions: [session] }, owner.connectionID);
      if (running) {
        openCodeReconciler(queryClient).replaceActivity(owner.connectionID, {
          activeIDs: new Set([session.id]),
          execution: new Map([
            [session.id, { status: "running", startedAt: 1, completedAt: null }],
          ]),
          statuses: new Map(),
        });
      }
      renderWithRouter(<SessionThreadHeader session={session} />, store, "/new", queryClient);
      expect(screen.getByRole("button", { name: "Chat" })).toBeTruthy();
      expect(screen.queryByRole("button", { name: /^Pull request/ })).toBeNull();
      expect(screen.queryByRole("button", { name: /^Open checkout/ })).toBeNull();
      const move = screen.getByRole<HTMLButtonElement>("button", { name: "Move to project…" });
      expect(move.disabled).toBe(running);
      if (!running) {
        await userEvent.click(move);
        expect(await screen.findByRole("dialog", { name: "Move to project" })).toBeTruthy();
      }
    },
  );

  it.each([
    { label: "Palot", directory: "/repo" },
    { label: "Palot · repo-worktree", directory: "/repo-worktree" },
  ])(
    "moves to $label on the original server and caches the normal task",
    async ({ label, directory }) => {
      const moved = { ...session, projectID: "project-1", location: { directory } };
      const move = vi.spyOn(palot, "moveSession").mockResolvedValue(moved);
      const { store, queryClient, onClose } = setup();
      await userEvent.click(screen.getByRole("combobox", { name: "Destination project" }));
      expect(screen.queryByRole("option", { name: "Backing chat folder" })).toBeNull();
      await userEvent.click(await screen.findByRole("option", { name: label }));
      act(() =>
        store.set(runtimeAtom, { ...owner, connectionID: "other", profileID: "other-profile" }),
      );
      await userEvent.click(screen.getByRole("button", { name: "Move to project" }));
      await waitFor(() => expect(move).toHaveBeenCalledWith(session.id, directory, "origin"));
      await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
      expect(
        openCodeReconciler(queryClient).session("origin", session.id)?.location.directory,
      ).toBe(directory);
      expect(openCodeReconciler(queryClient).session("other", session.id)).toBeNull();
    },
  );

  it("keeps the dialog open with an error when moving fails", async () => {
    vi.spyOn(palot, "moveSession").mockRejectedValue(new Error("Destination unavailable"));
    const { onClose } = setup();
    await userEvent.click(screen.getByRole("combobox", { name: "Destination project" }));
    await userEvent.click(await screen.findByRole("option", { name: "Palot" }));
    await userEvent.click(screen.getByRole("button", { name: "Move to project" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Destination unavailable");
    expect(onClose).not.toHaveBeenCalled();
  });
});
