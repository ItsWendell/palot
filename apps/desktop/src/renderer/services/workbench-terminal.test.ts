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

    expect(remove).toHaveBeenCalledWith({ directory: "/repo" }, "pty-1", "persistent", undefined);
  });

  it("rolls a delayed PTY creation back on its original server after focus changes", async () => {
    let resolve!: (value: Awaited<ReturnType<typeof palot.createPty>>) => void;
    const create = vi.spyOn(palot, "createPty").mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const remove = vi.spyOn(palot, "removePty").mockResolvedValue();
    let focused = "owner";
    const openTab = vi.fn(() =>
      focused === "owner" ? undefined : ({ ok: false, reason: "tab-limit" } as const),
    );
    const pending = openNewWorkbenchTerminal(
      "session",
      { directory: "/repo" },
      openTab,
      { pane: "bottom" },
      focused,
    );
    const rejection = expect(pending).rejects.toThrow("Close a workbench tab");
    focused = "other";
    resolve({ id: "same-pty", title: "Terminal", status: "running", transport: "persistent" });
    await rejection;
    expect(create).toHaveBeenCalledWith("session", { directory: "/repo" }, "owner");
    expect(remove).toHaveBeenCalledWith({ directory: "/repo" }, "same-pty", "persistent", "owner");
  });
});
