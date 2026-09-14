import type { OpenCodeClient } from "@opencode/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  resetOpenCodeClientForTest,
  setOpenCodeClientForTest,
  setFocusedOpenCodeRuntime,
} from "./opencode-client";
import { getPty, removePty, resizePty, snapshotPty } from "./opencode-pty";
import { palot } from "./palot";
import type { OpenCodeRuntimeStatus, PalotApi } from "../../shared";

afterEach(() => {
  resetOpenCodeClientForTest();
  Reflect.deleteProperty(window, "palot");
});

describe("renderer OpenCode persistent PTY service", () => {
  it.each(["persistent", "legacy"] as const)(
    "keeps %s PTY reads, resize and removal on the explicit owner across focus changes",
    async (transport) => {
      const owner = {
        profileID: "owner-profile",
        connectionID: "owner",
        connected: true,
      } as OpenCodeRuntimeStatus;
      setFocusedOpenCodeRuntime(owner);
      const other = { ...owner, profileID: "other-profile", connectionID: "other" };
      setFocusedOpenCodeRuntime(other);
      let release!: () => void;
      const barrier = new Promise<void>((resolve) => {
        release = resolve;
      });
      const pty = { id: "same-pty", title: "Owner terminal", status: "running" };
      const request = vi.fn(async (input: { path: string; method: string }) => {
        if (input.method === "GET") await barrier;
        const data = input.path.endsWith("/snapshot")
          ? {
              checkpoint: "",
              text: "owner output",
              info: { output: { tail: 12 }, size: { cols: 80, rows: 24 } },
            }
          : input.path.split("?")[0] === "/api/pty"
            ? [pty]
            : pty;
        return {
          status: input.method === "DELETE" ? 204 : 200,
          statusText: "OK",
          headers: { "content-type": "application/json" },
          body:
            input.method === "DELETE"
              ? null
              : new TextEncoder().encode(JSON.stringify({ data })).buffer,
        };
      });
      Object.defineProperty(window, "palot", {
        configurable: true,
        value: {
          openCodeRequest: request,
          runtimeStatus: vi.fn().mockResolvedValue(other),
        } as unknown as PalotApi,
      });
      const pending = palot.getPty({ directory: "/repo" }, "same-pty", transport, "owner");
      await vi.waitFor(() => expect(request).toHaveBeenCalledOnce());
      setFocusedOpenCodeRuntime({ ...other, connectionID: "third" });
      release();
      expect((await pending).title).toBe("Owner terminal");
      if (transport === "persistent")
        expect((await palot.snapshotPty("same-pty", "owner"))?.buffer).toBe("owner output");
      await palot.resizePty(
        { directory: "/repo" },
        "same-pty",
        transport,
        { cols: 100, rows: 30 },
        "owner",
      );
      await palot.removePty({ directory: "/repo" }, "same-pty", transport, "owner");
      await palot.listPtys({ directory: "/repo" }, "owner");
      for (const [input] of request.mock.calls)
        expect(input).toMatchObject({ connectionID: "owner", profileID: "owner-profile" });
    },
  );
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
