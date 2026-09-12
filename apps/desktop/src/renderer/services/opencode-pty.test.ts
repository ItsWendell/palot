import type { OpenCodeClient } from "@opencode/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetOpenCodeClientForTest, setOpenCodeClientForTest } from "./opencode-client";
import { getPty, removePty, resizePty, snapshotPty } from "./opencode-pty";

afterEach(resetOpenCodeClientForTest);

describe("renderer OpenCode persistent PTY service", () => {
  it("uses the persistent PTY resource for restore, status, resize, and cleanup", async () => {
    const get = vi.fn().mockResolvedValue({
      id: "pty_persistent_1",
      title: "Terminal",
      status: "running",
    });
    const snapshot = vi.fn().mockResolvedValue({
      text: "restored output",
      checkpoint: btoa("\u001b[2Jrestored checkpoint"),
      info: { output: { tail: 42 }, size: { cols: 120, rows: 32 } },
    });
    const update = vi.fn().mockResolvedValue({});
    const remove = vi.fn().mockResolvedValue(undefined);
    setOpenCodeClientForTest({
      experimental: { persistentPty: { get, snapshot, update, remove } },
    } as unknown as OpenCodeClient);

    await expect(getPty({ directory: "/repo" }, "pty_persistent_1", "persistent")).resolves.toEqual(
      {
        id: "pty_persistent_1",
        title: "Terminal",
        status: "running",
        transport: "persistent",
      },
    );
    await expect(snapshotPty("pty_persistent_1")).resolves.toEqual({
      buffer: "\u001b[2Jrestored checkpoint",
      cursor: 42,
      cols: 120,
      rows: 32,
    });
    await resizePty({ directory: "/repo" }, "pty_persistent_1", "persistent", {
      cols: 100,
      rows: 24,
    });
    await removePty({ directory: "/repo" }, "pty_persistent_1", "persistent");

    expect(update).toHaveBeenCalledWith({
      ptyID: "pty_persistent_1",
      size: { cols: 100, rows: 24 },
    });
    expect(remove).toHaveBeenCalledWith({ ptyID: "pty_persistent_1" });
  });
});
