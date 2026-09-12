import { afterEach, describe, expect, it, vi } from "vitest";
import { palot } from "./palot";
import { openNewWorkbenchTerminal } from "./workbench-terminal";

afterEach(() => vi.restoreAllMocks());

describe("openNewWorkbenchTerminal", () => {
  it("removes the PTY when the workbench tab limit rejects it", async () => {
    vi.spyOn(palot, "createPty").mockResolvedValue({
      id: "pty-1",
      title: "Terminal",
      status: "running",
      transport: "persistent",
    });
    const remove = vi.spyOn(palot, "removePty").mockResolvedValue();

    await expect(
      openNewWorkbenchTerminal("session-1", { directory: "/repo" }, () => ({
        ok: false,
        reason: "tab-limit",
      })),
    ).rejects.toThrow("Close a workbench tab");

    expect(remove).toHaveBeenCalledWith({ directory: "/repo" }, "pty-1", "persistent");
  });
});
