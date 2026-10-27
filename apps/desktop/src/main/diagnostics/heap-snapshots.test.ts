// @vitest-environment node
import { ClientError, type OpenCodeClient } from "@opencode/client";
import type { BrowserWindow, WebContents } from "electron";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenCodeRuntimeStatus } from "../../shared/opencode-contract";
import { captureHeapSnapshots, heapSnapshots } from "./heap-snapshots";

const mocks = vi.hoisted(() => ({
  mkdir: vi.fn(),
  mkdtemp: vi.fn(),
  writeFile: vi.fn(),
  writeHeapSnapshot: vi.fn(),
  windows: vi.fn(),
  metrics: vi.fn(),
  runtimeStatus: vi.fn(),
  scopedConnection: vi.fn(),
  heapDump: vi.fn(),
  reveal: vi.fn(),
}));

vi.mock("electron", () => ({
  app: {
    getName: () => "Palot Test",
    getVersion: () => "0.19.0",
    isPackaged: false,
    getAppMetrics: mocks.metrics,
  },
  BrowserWindow: { getAllWindows: mocks.windows },
  shell: { showItemInFolder: mocks.reveal },
}));
vi.mock("node:fs/promises", () => ({
  mkdir: mocks.mkdir,
  mkdtemp: mocks.mkdtemp,
  writeFile: mocks.writeFile,
}));
vi.mock("node:v8", () => ({ writeHeapSnapshot: mocks.writeHeapSnapshot }));
vi.mock("../data-recovery", () => ({ palotDataLocations: () => ({ logs: "/palot/logs" }) }));
vi.mock("../ipc-security", () => ({
  windowRole: (window: { role?: string }) => window.role,
}));
vi.mock("../opencode-runtime", () => ({
  openCodeRuntime: {
    runtimeStatus: mocks.runtimeStatus,
    scopedConnection: mocks.scopedConnection,
  },
}));

const memory = { rss: 500, heapTotal: 400, heapUsed: 300, external: 200, arrayBuffers: 100 };
const metrics = [{ pid: 123, type: "Browser", memory: { workingSetSize: 456 } }];

function runtime(patch: Partial<OpenCodeRuntimeStatus> = {}): OpenCodeRuntimeStatus {
  return {
    connectionID: "focused-connection",
    profileID: "local-profile",
    connected: true,
    topology: "same-machine",
    ...patch,
  } as OpenCodeRuntimeStatus;
}

function windowFixture(id: number, role: string | undefined = "main", destroyed = false) {
  const snapshot = vi.fn(async (_file: string) => {});
  const window = {
    id,
    role,
    isDestroyed: () => destroyed,
    getTitle: () => `Palot ${id}`,
    webContents: {
      isDestroyed: () => destroyed,
      getOSProcessId: () => id + 100,
      takeHeapSnapshot: snapshot,
    },
  } as unknown as BrowserWindow;
  return { window, snapshot };
}

function manifest() {
  const contents = mocks.writeFile.mock.calls.at(-1)?.[1];
  if (typeof contents !== "string") throw new Error("No manifest was written");
  return JSON.parse(contents);
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.mkdir.mockResolvedValue(undefined);
  let count = 0;
  mocks.mkdtemp.mockImplementation(async (prefix: string) => `${prefix}${++count}`);
  mocks.writeFile.mockResolvedValue(undefined);
  mocks.writeHeapSnapshot.mockImplementation((file: string) => file);
  mocks.windows.mockReturnValue([]);
  mocks.metrics.mockReturnValue(metrics);
  mocks.runtimeStatus.mockReturnValue(runtime());
  mocks.heapDump.mockImplementation(async ({ directory }: { directory: string }) => ({
    path: path.join(directory, "server-321.heapsnapshot"),
    pid: 321,
    memory,
  }));
  mocks.scopedConnection.mockImplementation(() => ({
    withClient: (operation: (client: OpenCodeClient) => Promise<unknown>) =>
      operation({ debug: { heapDump: mocks.heapDump } } as unknown as OpenCodeClient),
  }));
});

describe("heap snapshot capture", () => {
  it("writes one private log folder, all Palot window snapshots, and a manifest last", async () => {
    const main = windowFixture(1);
    const voice = windowFixture(2, "voice-overlay");
    const external = windowFixture(3, "unregistered");
    // A BrowserWindow displaying arbitrary browser content has no registered Palot role.
    delete (external.window as unknown as { role?: string }).role;
    const closed = windowFixture(4, "main", true);
    mocks.windows.mockReturnValue([main.window, voice.window, external.window, closed.window]);

    const result = await captureHeapSnapshots();

    expect(result.complete).toBe(true);
    expect(result.directory).toMatch(/^\/palot\/logs\/diagnostics\/heap-\d{4}-/);
    expect(mocks.mkdir).toHaveBeenCalledExactlyOnceWith("/palot/logs/diagnostics", {
      recursive: true,
      mode: 0o700,
    });
    expect(main.snapshot).toHaveBeenCalledExactlyOnceWith(
      path.join(result.directory, "window-1-101.heapsnapshot"),
    );
    expect(voice.snapshot).toHaveBeenCalledExactlyOnceWith(
      path.join(result.directory, "window-2-102.heapsnapshot"),
    );
    expect(external.snapshot).not.toHaveBeenCalled();
    expect(closed.snapshot).not.toHaveBeenCalled();
    expect(mocks.heapDump).toHaveBeenCalledExactlyOnceWith({ directory: result.directory });
    expect(mocks.writeHeapSnapshot).toHaveBeenCalledExactlyOnceWith(
      path.join(result.directory, `main-${process.pid}.heapsnapshot`),
    );
    expect(mocks.writeFile).toHaveBeenCalledExactlyOnceWith(
      path.join(result.directory, "manifest.json"),
      expect.any(String),
      { encoding: "utf8", mode: 0o600 },
    );
    expect(mocks.writeFile.mock.invocationCallOrder[0]).toBeGreaterThan(
      mocks.writeHeapSnapshot.mock.invocationCallOrder[0]!,
    );
    expect(manifest()).toMatchObject({
      startedAt: expect.any(String),
      completedAt: expect.any(String),
      complete: true,
      application: { name: "Palot Test", version: "0.19.0" },
      connection: { connectionID: "focused-connection", topology: "same-machine" },
      before: { main: { rss: expect.any(Number) }, appMetrics: metrics },
      after: { main: { heapUsed: expect.any(Number) }, appMetrics: metrics },
      snapshots: [
        { process: "server", pid: 321, file: "server-321.heapsnapshot", memory },
        { process: "renderer", windowID: 1, pid: 101, title: "Palot 1", label: "main window 1" },
        { process: "renderer", windowID: 2, label: "voice-overlay window 2" },
        { process: "main", pid: process.pid, file: `main-${process.pid}.heapsnapshot` },
      ],
    });
  });

  it("captures server, windows, and main sequentially and refuses overlapping requests", async () => {
    const server = Promise.withResolvers<void>();
    const renderer = Promise.withResolvers<void>();
    mocks.heapDump.mockImplementationOnce(async ({ directory }: { directory: string }) => {
      await server.promise;
      return { path: path.join(directory, "server.heapsnapshot"), pid: 321, memory };
    });
    const first = windowFixture(1);
    const second = windowFixture(2);
    first.snapshot.mockImplementationOnce(() => renderer.promise);
    mocks.windows.mockReturnValue([first.window, second.window]);
    const capture = captureHeapSnapshots();
    await vi.waitFor(() => expect(mocks.heapDump).toHaveBeenCalledOnce());

    await expect(captureHeapSnapshots()).rejects.toThrow("already being captured");
    expect(mocks.mkdtemp).toHaveBeenCalledOnce();
    expect(first.snapshot).not.toHaveBeenCalled();
    server.resolve();
    await vi.waitFor(() => expect(first.snapshot).toHaveBeenCalledOnce());
    expect(second.snapshot).not.toHaveBeenCalled();
    expect(mocks.writeHeapSnapshot).not.toHaveBeenCalled();
    renderer.resolve();
    await capture;

    expect(second.snapshot).toHaveBeenCalledOnce();
    expect(second.snapshot.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.writeHeapSnapshot.mock.invocationCallOrder[0]!,
    );
    await expect(captureHeapSnapshots()).resolves.toMatchObject({ complete: true });
  });

  it("records a 404 as an old server while still capturing the desktop", async () => {
    mocks.heapDump.mockRejectedValueOnce(
      new ClientError("UnexpectedStatus", { cause: { status: 404 } }),
    );

    await expect(captureHeapSnapshots()).resolves.toMatchObject({ complete: false });

    expect(manifest().snapshots[0]).toMatchObject({
      process: "server",
      status: "unsupported",
      error: expect.stringContaining("Server too old"),
    });
    expect(mocks.writeHeapSnapshot).toHaveBeenCalledOnce();
  });

  it.each(["remote-machine", undefined] as const)(
    "skips server-local paths for topology %s",
    async (topology) => {
      mocks.runtimeStatus.mockReturnValue(runtime({ topology }));

      await expect(captureHeapSnapshots()).resolves.toMatchObject({ complete: true });

      expect(mocks.scopedConnection).not.toHaveBeenCalled();
      expect(mocks.heapDump).not.toHaveBeenCalled();
      expect(manifest().snapshots[0]).toMatchObject({ process: "server", status: "skipped" });
      expect(manifest().snapshots[0].reason).toMatch(/Remote server|topology is unknown/);
    },
  );

  it("does not start a disconnected server for diagnostics", async () => {
    mocks.runtimeStatus.mockReturnValue(runtime({ connected: false }));

    await captureHeapSnapshots();

    expect(mocks.scopedConnection).not.toHaveBeenCalled();
    expect(manifest().snapshots[0]).toMatchObject({
      status: "skipped",
      reason: "The OpenCode server is not connected.",
    });
  });

  it("keeps the original connection if focus changes while the folder is created", async () => {
    mocks.mkdir.mockImplementationOnce(async () => {
      mocks.runtimeStatus.mockReturnValue(runtime({ connectionID: "another-connection" }));
    });

    await captureHeapSnapshots();

    expect(mocks.scopedConnection).toHaveBeenCalledExactlyOnceWith("focused-connection");
    expect(manifest().connection.connectionID).toBe("focused-connection");
  });

  it("records failures without dropping other snapshots or the manifest", async () => {
    mocks.heapDump.mockRejectedValueOnce(new Error("Server unavailable"));
    const first = windowFixture(1);
    const second = windowFixture(2);
    first.snapshot.mockRejectedValueOnce(new Error("Window closed"));
    mocks.windows.mockReturnValue([first.window, second.window]);
    mocks.writeHeapSnapshot.mockImplementationOnce(() => {
      throw new Error("Not enough disk space");
    });

    await expect(captureHeapSnapshots()).resolves.toMatchObject({ complete: false });

    expect(manifest().snapshots).toMatchObject([
      { process: "server", status: "error", error: "Server unavailable" },
      { process: "renderer", status: "error", error: "Window closed" },
      { process: "renderer", status: "captured" },
      { process: "main", status: "error", error: "Not enough disk space" },
    ]);
  });

  it("releases the concurrency guard after a filesystem failure", async () => {
    mocks.writeFile.mockRejectedValueOnce(new Error("Disk full"));

    await expect(captureHeapSnapshots()).rejects.toThrow("Disk full");
    await expect(captureHeapSnapshots()).resolves.toMatchObject({ complete: true });
  });

  it("reveals only captures owned by the caller, independent of current server topology", async () => {
    const owner = {} as WebContents;
    const other = {} as WebContents;
    const first = await heapSnapshots(owner, { type: "capture" });
    await heapSnapshots(owner, { type: "capture" });
    mocks.runtimeStatus.mockReturnValue(runtime({ topology: "remote-machine" }));

    await expect(
      heapSnapshots(other, { type: "reveal", captureID: first.captureID }),
    ).rejects.toThrow("unavailable");
    await expect(
      heapSnapshots(owner, { type: "reveal", captureID: "/arbitrary/path" }),
    ).rejects.toThrow("unavailable");
    expect(mocks.reveal).not.toHaveBeenCalled();
    await heapSnapshots(owner, { type: "reveal", captureID: first.captureID });
    expect(mocks.reveal).toHaveBeenCalledExactlyOnceWith(first.directory);
  });

  it.each([null, {}, { type: "delete" }, { type: "reveal", captureID: 123 }])(
    "rejects invalid action %j without starting a capture",
    async (input) => {
      await expect(heapSnapshots({} as WebContents, input)).rejects.toThrow();
      expect(mocks.mkdtemp).not.toHaveBeenCalled();
      expect(mocks.reveal).not.toHaveBeenCalled();
    },
  );
});
