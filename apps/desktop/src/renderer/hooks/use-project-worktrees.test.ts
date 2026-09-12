import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { palot } from "../services/palot";
import { projectWorktreesQueryOptions } from "./use-project-worktrees";

afterEach(() => vi.restoreAllMocks());

describe("project worktree discovery", () => {
  it("lists directly on load and invalidation without a redundant refresh", async () => {
    const refresh = vi.spyOn(palot, "refreshProjectCopies").mockResolvedValue(undefined);
    const list = vi
      .spyOn(palot, "listProjectDirectories")
      .mockResolvedValueOnce([{ directory: "/repo", strategy: null }])
      .mockResolvedValueOnce([
        { directory: "/repo", strategy: null },
        { directory: "/copies/new", strategy: "git" },
      ]);
    const client = new QueryClient();
    const options = projectWorktreesQueryOptions("connection-1", {
      id: "project-1",
      canonical: "/repo",
    });

    try {
      await expect(client.fetchQuery(options)).resolves.toEqual([
        { directory: "/repo", strategy: null },
      ]);
      await client.invalidateQueries({ queryKey: options.queryKey });
      await expect(client.fetchQuery(options)).resolves.toContainEqual({
        directory: "/copies/new",
        strategy: "git",
      });
      expect(list).toHaveBeenCalledTimes(2);
      expect(list).toHaveBeenCalledWith(
        "project-1",
        "/repo",
        expect.any(AbortSignal),
        "connection-1",
      );
      expect(refresh).not.toHaveBeenCalled();
    } finally {
      client.clear();
    }
  });
});
