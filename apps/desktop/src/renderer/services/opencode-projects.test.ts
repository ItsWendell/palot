import { afterEach, describe, expect, it, vi } from "vitest";
import type { OpenCodeClient } from "@opencode/client";
import { resetOpenCodeClientForTest, setOpenCodeClientForTest } from "./opencode-client";
import { projectUpdatePatch, updateProjectDetails } from "./opencode-projects";

afterEach(resetOpenCodeClientForTest);
describe("project updates", () => {
  it("omits untouched fields and sends explicit empty strings to clear overrides", () => {
    expect(projectUpdatePatch("p", { name: "", override: "", start: "" })).toEqual({
      projectID: "p",
      name: "",
      icon: { override: "" },
      commands: { start: "" },
    });
    expect(projectUpdatePatch("p", { color: "blue" })).toEqual({
      projectID: "p",
      icon: { color: "blue" },
    });
    expect(projectUpdatePatch("p", {})).toEqual({ projectID: "p" });
  });
  it("rejects empty, relative, and multiline canonical paths before sending", async () => {
    const update = vi.fn();
    setOpenCodeClientForTest({ project: { update } } as unknown as OpenCodeClient);
    for (const canonical of ["", "../repo", "~/repo", "/repo\nother"]) {
      await expect(updateProjectDetails("p", { canonical })).rejects.toThrow("absolute path");
    }
    expect(update).not.toHaveBeenCalled();
    expect(projectUpdatePatch("p", { canonical: "C:\\repo" }).canonical).toBe("C:\\repo");
  });
  it("uses the official update API and preserves its errors", async () => {
    const update = vi.fn().mockRejectedValue(new Error("Permission denied"));
    setOpenCodeClientForTest({ project: { update } } as unknown as OpenCodeClient);
    await expect(updateProjectDetails("p", { name: "New" })).rejects.toThrow("Permission denied");
    expect(update).toHaveBeenCalledWith(
      { projectID: "p", name: "New" },
      { signal: expect.any(AbortSignal) },
    );
  });
});
