import { afterEach, describe, expect, it, vi } from "vitest";
import type { OpenCodeRuntimeStatus, PalotApi } from "../../shared";
import { palot } from "./palot";

afterEach(() => Reflect.deleteProperty(window, "palot"));

describe("connection-scoped native wrappers", () => {
  const operations = [
    {
      method: "createPty",
      run: () => palot.createPty("session", { directory: "/repo" }, "owner"),
      args: [{ sessionID: "session", location: { directory: "/repo" } }, "owner"],
    },
    {
      method: "connectPty",
      run: () =>
        palot.connectPty(
          { ptyID: "pty", location: { directory: "/repo" }, cursor: 0, transport: "legacy" },
          "owner",
        ),
      args: [
        { ptyID: "pty", location: { directory: "/repo" }, cursor: 0, transport: "legacy" },
        "owner",
      ],
    },
    {
      method: "openSessionWindow",
      run: () => palot.openSessionWindow("session", "owner"),
      args: ["session", "owner"],
    },
    { method: "pickDirectory", run: () => palot.pickDirectory("owner"), args: ["owner"] },
    { method: "pickFiles", run: () => palot.pickFiles("owner"), args: ["owner"] },
    {
      method: "revealFileInFinder",
      run: () => palot.revealFileInFinder("/repo/file", "owner"),
      args: ["/repo/file", "owner"],
    },
    {
      method: "externalOpenTargets",
      run: () => palot.externalOpenTargets("session", "owner"),
      args: ["session", "owner"],
    },
    {
      method: "externalOpen",
      run: () =>
        palot.externalOpen(
          { resource: { kind: "session-directory", sessionID: "session" } },
          "owner",
        ),
      args: [{ resource: { kind: "session-directory", sessionID: "session" } }, "owner"],
    },
    {
      method: "attachClipboardImages",
      run: () => palot.attachClipboardImages([], "owner"),
      args: [[], "owner"],
    },
    {
      method: "attachmentPreview",
      run: () => palot.attachmentPreview("grant", "owner"),
      args: ["grant", "owner"],
    },
  ];

  it.each(operations)(
    "preserves the caller's connection for $method instead of resolving current focus",
    async ({ method, run, args }) => {
      const invoke = vi.fn().mockResolvedValue(undefined);
      const runtimeStatus = vi.fn().mockResolvedValue({ connectionID: "other" });
      window.palot = { [method]: invoke, runtimeStatus } as unknown as PalotApi;
      await run();
      expect(invoke).toHaveBeenCalledExactlyOnceWith(...args);
      expect(runtimeStatus).not.toHaveBeenCalled();
    },
  );

  it("captures the fallback connection before awaiting the native operation", async () => {
    const status = Promise.withResolvers<OpenCodeRuntimeStatus>();
    const pickFiles = vi.fn().mockResolvedValue({ files: [], errors: [] });
    const runtimeStatus = vi
      .fn()
      .mockReturnValueOnce(status.promise)
      .mockResolvedValue({ connectionID: "later" });
    window.palot = { runtimeStatus, pickFiles } as unknown as PalotApi;
    const pending = palot.pickFiles();
    status.resolve({ connectionID: "original" } as OpenCodeRuntimeStatus);
    await pending;
    expect(runtimeStatus).toHaveBeenCalledOnce();
    expect(pickFiles).toHaveBeenCalledWith("original");
  });
});
