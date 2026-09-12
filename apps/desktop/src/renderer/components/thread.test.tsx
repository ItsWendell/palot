import { createStore } from "jotai";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PalotSession } from "../../shared";
import { palot } from "../services/palot";
import { renderWithRouter } from "../test-utils/render-with-router";
import { SessionThreadHeader } from "./thread";

const session: PalotSession = {
  id: "session-1",
  parentID: null,
  projectID: "project-1",
  title: "A long task title that should leave the task actions reachable in a narrow header",
  agent: null,
  model: null,
  location: { directory: "/worktrees/investigation" },
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

describe("SessionThreadHeader", () => {
  it("exports and copies the current task through its keyboard-accessible overflow", async () => {
    Element.prototype.getAnimations = vi.fn(() => []);
    const exportSession = vi.spyOn(palot, "exportSession").mockResolvedValue(null);
    const copy = vi.spyOn(palot, "copySessionMarkdown").mockResolvedValue(undefined);
    renderWithRouter(
      <div style={{ width: 360 }}>
        <SessionThreadHeader session={session} />
      </div>,
      createStore(),
    );
    const actions = screen.getByRole("button", { name: "Task actions" });
    actions.focus();
    await userEvent.keyboard("{Enter}");
    await userEvent.click(await screen.findByRole("menuitem", { name: "Export task" }));
    await waitFor(() =>
      expect(exportSession).toHaveBeenCalledWith(session.id, session.title, undefined),
    );
    await userEvent.click(actions);
    await userEvent.click(
      await screen.findByRole("menuitem", { name: "Copy conversation as Markdown" }),
    );
    await waitFor(() => expect(copy).toHaveBeenCalledWith(session.id, undefined));
  });
});
