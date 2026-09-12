// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  execFile: vi.fn(),
  access: vi.fn(),
  stat: vi.fn(),
  runtimeStatus: vi.fn(),
  withClient: vi.fn(),
  preferences: new Map<string, unknown>(),
}));

vi.mock("node:child_process", () => ({
  execFile: mocks.execFile,
}));
vi.mock("node:fs/promises", () => ({
  access: mocks.access,
  mkdir: vi.fn(),
  readFile: vi.fn(),
  stat: mocks.stat,
}));
vi.mock("electron", () => ({
  app: {
    getFileIcon: vi.fn(async () => ({ isEmpty: () => true, toDataURL: () => "" })),
    getPath: vi.fn(() => "/tmp"),
    on: vi.fn(),
  },
  shell: {
    showItemInFolder: vi.fn(),
  },
}));
vi.mock("electron-store", () => ({
  default: class {
    get(key: string) {
      return mocks.preferences.get(key);
    }
    set(key: string, value: unknown) {
      mocks.preferences.set(key, value);
    }
  },
}));
vi.mock("../opencode-runtime", () => ({
  openCodeRuntime: {
    runtimeStatus: mocks.runtimeStatus,
    withClient: mocks.withClient,
  },
}));

import { ExternalOpenService } from "./service";

const localStatus = {
  connected: true,
  connectionID: "local-1",
  capabilities: { localPathActions: true },
};

describe.skipIf(process.platform !== "darwin")("ExternalOpenService", () => {
  beforeEach(() => {
    mocks.preferences.clear();
    mocks.execFile.mockReset();
    mocks.access.mockReset();
    mocks.stat.mockReset();
    mocks.runtimeStatus.mockReset();
    mocks.withClient.mockReset();
    mocks.runtimeStatus.mockReturnValue(localStatus);
    mocks.withClient.mockImplementation(async (operation) =>
      operation({
        session: {
          get: vi.fn(async () => ({ location: { directory: "/workspace/checkout" } })),
        },
      }),
    );
    mocks.stat.mockResolvedValue({ isDirectory: () => true });
    mocks.access.mockImplementation(async (candidate: string) => {
      if (candidate === "/Applications/Cursor.app") return;
      if (candidate === "/System/Library/CoreServices/Finder.app") return;
      throw new Error("missing");
    });
    mocks.execFile.mockImplementation(
      (
        _command: string,
        _args: string[],
        _options: unknown,
        callback: (...args: unknown[]) => void,
      ) => callback(null, "", ""),
    );
  });

  it("opens the deterministic editor fallback and remembers it", async () => {
    const service = new ExternalOpenService();

    await expect(
      service.open({ resource: { kind: "session-directory", sessionID: "session-1" } }),
    ).resolves.toEqual({ openedTargetID: "cursor" });
    expect(mocks.execFile).toHaveBeenCalledWith(
      "/usr/bin/open",
      ["-a", "/Applications/Cursor.app", "/workspace/checkout"],
      expect.objectContaining({ timeout: 10_000 }),
      expect.any(Function),
    );
    expect(mocks.preferences.get("preferredEditorID")).toBe("cursor");
  });

  it("keeps Finder from replacing the preferred editor", async () => {
    const service = new ExternalOpenService();
    mocks.preferences.set("preferredEditorID", "cursor");

    await service.open({
      resource: { kind: "session-directory", sessionID: "session-1" },
      targetID: "finder",
    });

    expect(mocks.preferences.get("preferredEditorID")).toBe("cursor");
    expect(mocks.execFile).toHaveBeenCalledWith(
      "/usr/bin/open",
      ["-R", "/workspace/checkout"],
      expect.objectContaining({ timeout: 10_000 }),
      expect.any(Function),
    );
  });

  it("rejects remote runtimes before resolving a session", async () => {
    mocks.runtimeStatus.mockReturnValue({
      connected: true,
      connectionID: "remote-1",
      capabilities: { localPathActions: false },
    });
    const service = new ExternalOpenService();

    await expect(service.getTargets("session-1")).rejects.toThrow("unavailable");
    expect(mocks.withClient).not.toHaveBeenCalled();
  });

  it("rejects a profile switch before launching", async () => {
    mocks.withClient.mockImplementation(async (operation) => {
      const session = await operation({
        session: {
          get: vi.fn(async () => ({ location: { directory: "/workspace/checkout" } })),
        },
      });
      mocks.runtimeStatus.mockReturnValue({ ...localStatus, connectionID: "local-2" });
      return session;
    });
    const service = new ExternalOpenService();

    await expect(
      service.open({ resource: { kind: "session-directory", sessionID: "session-1" } }),
    ).rejects.toThrow("changed");
    expect(mocks.execFile).not.toHaveBeenCalledWith(
      "/usr/bin/open",
      expect.arrayContaining(["/workspace/checkout"]),
      expect.anything(),
      expect.anything(),
    );
  });
});
