// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

import { ExternalOpenService, editorUrlScheme, localFilePath } from "./service";

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

describe("local file paths for external apps", () => {
  it("rejects relative paths and paths that read as options", () => {
    expect(() => localFilePath("src/main.ts")).toThrow("must be absolute");
    expect(() => localFilePath("-a")).toThrow("must be absolute");
    expect(() => localFilePath("--args")).toThrow("must be absolute");
  });

  it("normalises absolute paths", () => {
    expect(localFilePath("/work/project/../project/./src/main.ts")).toBe(
      "/work/project/src/main.ts",
    );
  });

  it("percent-encodes path segments in editor links and keeps the position outside", () => {
    const file = "/work/my project/#1 100%.ts";
    expect(editorUrlScheme("vscode", file, 4, 2)).toBe(
      "vscode://file/work/my%20project/%231%20100%25.ts:4:2",
    );
    expect(editorUrlScheme("zed", file, 4)).toBe("zed://file/work/my%20project/%231%20100%25.ts:4");
    expect(editorUrlScheme("sublime-text", file, 4, 2)).toBe(
      "subl://open?url=file:///work/my%20project/%231%20100%25.ts&line=4&column=2",
    );
  });
});

describe("ExternalOpenService file launches", () => {
  const platform = Object.getOwnPropertyDescriptor(process, "platform")!;

  beforeEach(() => {
    Object.defineProperty(process, "platform", { ...platform, value: "darwin" });
    mocks.preferences.clear();
    mocks.execFile.mockReset();
    mocks.access.mockReset();
    mocks.runtimeStatus.mockReturnValue(localStatus);
    mocks.access.mockImplementation(async (candidate: string) => {
      if (candidate === "/Applications/Cursor.app") return;
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

  afterEach(() => {
    Object.defineProperty(process, "platform", platform);
  });

  function openCalls(): string[][] {
    return mocks.execFile.mock.calls
      .filter(([command]) => command === "/usr/bin/open")
      .map(([, args]) => args as string[]);
  }

  it("passes the absolute file path to open", async () => {
    await new ExternalOpenService().open({
      resource: { kind: "file", path: "/work/-notes.md" },
    });
    expect(openCalls()).toEqual([["-a", "/Applications/Cursor.app", "/work/-notes.md"]]);
  });

  it("passes an encoded editor link to open", async () => {
    await new ExternalOpenService().open({
      resource: { kind: "file", path: "/work/a b.ts", line: 3 },
    });
    expect(openCalls()).toEqual([["cursor://file/work/a%20b.ts:3"]]);
  });

  it("refuses a path that open would read as an option", async () => {
    await expect(
      new ExternalOpenService().open({ resource: { kind: "file", path: "-a" } }),
    ).rejects.toThrow("must be absolute");
    expect(openCalls()).toEqual([]);
  });
});
