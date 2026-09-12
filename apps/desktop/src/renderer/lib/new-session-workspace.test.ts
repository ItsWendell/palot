import { describe, expect, it, vi } from "vitest";
import type { PalotProject, PalotSession } from "../../shared";
import { createSessionInWorkspace, type WorkspaceSelection } from "./new-session-workspace";

const project: PalotProject = {
  id: "project-1",
  canonical: "/Users/example/repo",
  name: "Repo",
  sandboxes: [],
  vcs: "git",
  updatedAt: 1,
};

function session(directory: string): PalotSession {
  return {
    id: "session-1",
    parentID: null,
    projectID: project.id,
    title: null,
    agent: null,
    model: null,
    location: { directory },
    createdAt: 1,
    updatedAt: 1,
    archivedAt: null,
    cost: null,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  };
}

async function create(selection: WorkspaceSelection) {
  const createCopy = vi.fn().mockResolvedValue({ directory: "/Users/example/generated-copy-2" });
  const createSession = vi.fn(async (directory: string) => session(directory));
  const result = await createSessionInWorkspace({
    project,
    selection,
    createCopy,
    createSession,
  });
  return { result, createCopy, createSession };
}

describe("createSessionInWorkspace", () => {
  it("creates a session directly in the current checkout", async () => {
    const selection = { type: "current", directory: project.canonical } as const;
    const result = await create(selection);

    expect(result.createCopy).not.toHaveBeenCalled();
    expect(result.createSession).toHaveBeenCalledWith(selection.directory);
    expect(result.result?.location.directory).toBe(selection.directory);
  });

  it("uses the exact directory returned by OpenCode for a new worktree", async () => {
    const result = await create({ type: "create" });

    expect(result.createCopy).toHaveBeenCalledWith(project.id, project.canonical, undefined);
    expect(result.createSession).toHaveBeenCalledWith("/Users/example/generated-copy-2");
    expect(result.result?.location.directory).toBe("/Users/example/generated-copy-2");
  });

  it("creates a worktree from the selected branch", async () => {
    const result = await create({ type: "create", branch: "release" });

    expect(result.createCopy).toHaveBeenCalledWith(project.id, project.canonical, "release");
  });

  it("preserves a created worktree when session creation fails", async () => {
    const createCopy = vi.fn().mockResolvedValue({ directory: "/Users/example/generated-copy" });
    const createSession = vi.fn().mockRejectedValue(new Error("Session failed"));

    await expect(
      createSessionInWorkspace({
        project,
        selection: { type: "create" },
        createCopy,
        createSession,
      }),
    ).rejects.toThrow("Session failed");
  });

  it("reports when session creation returns no session", async () => {
    const createCopy = vi.fn().mockResolvedValue({ directory: "/Users/example/generated-copy" });
    const createSession = vi.fn().mockResolvedValue(null);

    await expect(
      createSessionInWorkspace({
        project,
        selection: { type: "create" },
        createCopy,
        createSession,
      }),
    ).rejects.toThrow("Could not create this task.");
  });
});
