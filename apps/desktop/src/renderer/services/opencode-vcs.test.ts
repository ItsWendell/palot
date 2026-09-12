import type { OpenCodeClient } from "@opencode/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetOpenCodeClientForTest, setOpenCodeClientForTest } from "./opencode-client";
import { getOpenCodeVcsInfo, listOpenCodeVcsBranches } from "./opencode-vcs";

afterEach(resetOpenCodeClientForTest);

describe("renderer OpenCode VCS service", () => {
  it("rejects an unknown explicit VCS owner rather than falling back to focus", async () => {
    await expect(
      getOpenCodeVcsInfo({ directory: "/repo" }, undefined, "unknown-owner"),
    ).rejects.toThrow("Unknown OpenCode connection: unknown-owner");
  });

  it("lists branches for the selected checkout", async () => {
    const branches = vi.fn().mockResolvedValue({
      data: ["main", "release"],
      location: {
        directory: "/repo",
        project: { id: "project-1", directory: "/repo", canonical: "/repo" },
      },
    });
    setOpenCodeClientForTest({ vcs: { branches } } as unknown as OpenCodeClient);

    await expect(listOpenCodeVcsBranches({ directory: "/repo" }, "release")).resolves.toEqual([
      "main",
      "release",
    ]);
    expect(branches).toHaveBeenCalledWith(
      { location: { directory: "/repo" }, search: "release", limit: 100 },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });
});
