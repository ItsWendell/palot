import { describe, expect, it } from "vitest";
import { locationKey, openCodeKeys } from "./opencode-query";

describe("OpenCode query keys", () => {
  it("isolates resources by connection", () => {
    expect(openCodeKeys.search("connection-a", "release")).not.toEqual(
      openCodeKeys.search("connection-b", "release"),
    );
  });

  it("includes workspace identity in location keys", () => {
    expect(locationKey({ directory: "/repo" })).not.toBe(
      locationKey({ directory: "/repo", workspaceID: "worktree" }),
    );
    expect(openCodeKeys.vcsLocation("connection", { directory: "/repo" })).not.toEqual(
      openCodeKeys.vcsLocation("connection", {
        directory: "/repo",
        workspaceID: "worktree",
      }),
    );
  });

  it("scopes settings snapshots by connection, location, and project", () => {
    const input = { projectID: "project-1", directory: "/repo", workspaceID: "worktree" };
    expect(openCodeKeys.settingsSnapshot("connection-a", input)).not.toEqual(
      openCodeKeys.settingsSnapshot("connection-b", input),
    );
    expect(openCodeKeys.settingsSnapshot("connection-a", input)).not.toEqual(
      openCodeKeys.settingsSnapshot("connection-a", { ...input, projectID: "project-2" }),
    );
  });
});
