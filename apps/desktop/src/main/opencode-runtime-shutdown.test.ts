// @vitest-environment node

import type { OpenCodeClient, OpenCodeEvent } from "@opencode/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PalotEventBatch } from "../shared/opencode-contract";
import type { SshConnector } from "./ssh/interaction";
import type { WebContents } from "electron";
import { PtyTransport } from "./opencode-pty";

const { send } = vi.hoisted(() => ({ send: vi.fn() }));

vi.mock("electron", () => ({
  app: { isPackaged: false },
  safeStorage: {},
  BrowserWindow: {
    getAllWindows: () => [{ isDestroyed: () => false, webContents: { send } }],
  },
}));

vi.mock("electron-store", () => ({
  default: class MemoryStore {
    private readonly values: Record<string, unknown>;
    constructor({ defaults }: { defaults: Record<string, unknown> }) {
      this.values = structuredClone(defaults);
    }
    get(key: string) {
      return this.values[key];
    }
    set(key: string, value: unknown) {
      this.values[key] = value;
    }
  },
}));

vi.mock("./opencode-observability", () => ({
  openCodeLog: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
  observedOpenCodeFetch: (fetch: typeof globalThis.fetch) => fetch,
}));

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

let runtime: typeof import("./opencode-runtime").openCodeRuntime;
const releaseCleanup: Array<() => void> = [];

beforeEach(async () => {
  vi.resetModules();
  send.mockClear();
  vi.stubEnv("PALOT_CONNECTION_PROFILE_ID", "");
  const { openCodeRuntimeLifecycleAdapter: adapter } = await import("./opencode-runtime-lifecycle");
  const { SUPPORTED_OPENCODE_VERSION: version } = await import("./opencode-version");
  const client = {
    health: { get: vi.fn().mockResolvedValue({ healthy: true, version, pid: 42 }) },
    event: {
      subscribe: async function* ({ signal }: { signal: AbortSignal }) {
        yield { id: "same-event", type: "server.connected", data: {} } as OpenCodeEvent;
        yield { id: "same-event", type: "server.connected", data: {} } as OpenCodeEvent;
        if (!signal.aborted)
          await new Promise<void>((resolve) =>
            signal.addEventListener("abort", () => resolve(), { once: true }),
          );
        yield* [];
      },
    },
  } as unknown as OpenCodeClient;
  vi.spyOn(adapter, "makeClient").mockReturnValue(client);
  vi.spyOn(adapter, "discoverBinary").mockResolvedValue({ path: "/bundled/opencode2", version });
  vi.spyOn(adapter, "discoverService").mockRejectedValue(new Error("Unexpected local discovery"));
  vi.spyOn(adapter, "ensureService").mockRejectedValue(new Error("Unexpected local startup"));
  runtime = (await import("./opencode-runtime")).openCodeRuntime;
});

afterEach(async () => {
  for (const release of releaseCleanup.splice(0)) release();
  await runtime.shutdown();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

function addSshProfile(target: string) {
  return runtime.createProfile({ kind: "ssh", name: target, ssh: { target } }).profiles.at(-1)!;
}

function tunnel(close = vi.fn(async () => {})) {
  return { endpoint: { url: "http://127.0.0.1:4567" }, close };
}

describe("OpenCode runtime SSH shutdown ownership", () => {
  it("keeps terminal streams across focus switches and closes only their disposed owner", async () => {
    const first = addSshProfile("terminal-first");
    const second = addSshProfile("terminal-second");
    const firstStatus = await runtime.switchProfile(first.id, async () => tunnel());
    const secondStatus = await runtime.connectProfile(second.id, async () => tunnel());
    const sockets = [0, 1].map(() => Object.assign(new EventTarget(), { close: vi.fn() }));
    let socketIndex = 0;
    const transport = new PtyTransport(
      async () => ({ url: "ws://localhost/terminal", expiresAt: Date.now() + 10_000 }),
      () => sockets[socketIndex++] as unknown as WebSocket,
    );
    const sender = {
      id: 1,
      once: vi.fn(),
      isDestroyed: () => false,
      send: vi.fn(),
    } as unknown as WebContents;
    for (const status of [firstStatus, secondStatus]) {
      const scoped = runtime.scopedConnection(status.connectionID);
      const id = await transport.connect(
        sender,
        {
          ptyID: "terminal",
          location: { directory: "/repo" },
          cursor: 0,
          transport: "legacy",
        },
        {
          ...scoped,
          withClient: (operation) => scoped.withClient((client) => operation(client, true)),
          requestConnection: () => runtime.requestConnection({ connectionID: status.connectionID }),
        },
      );
      transport.start(sender, id);
    }
    await runtime.switchProfile(second.id);
    await runtime.switchProfile(first.id);
    for (const socket of sockets) expect(socket.close).not.toHaveBeenCalled();
    await runtime.disconnectProfile(second.id);
    expect(sockets[0]!.close).not.toHaveBeenCalled();
    expect(sockets[1]!.close).toHaveBeenCalledOnce();
    await runtime.shutdown();
    expect(sockets[0]!.close).toHaveBeenCalledOnce();
  });

  it("publishes background event owners and status changes without changing focus", async () => {
    const profile = addSshProfile("observed-background");
    const event = vi.fn();
    const status = vi.fn();
    const offEvent = runtime.onScopedEvent(event);
    const offStatus = runtime.onRuntimeStatus(status);
    const connection = await runtime.connectProfile(profile.id, async () => tunnel());
    await vi.waitFor(() =>
      expect(event).toHaveBeenCalledWith(
        expect.objectContaining({ type: "server.connected" }),
        expect.objectContaining({ profileID: profile.id, connectionID: connection.connectionID }),
      ),
    );
    expect(runtime.runtimeStatus().profileID).toBe("local-default");
    await runtime.disconnectProfile(profile.id);
    expect(status).toHaveBeenCalledWith(
      expect.objectContaining({
        profileID: profile.id,
        connectionID: connection.connectionID,
        phase: "stopped",
      }),
    );
    offEvent();
    offStatus();
    event.mockClear();
    status.mockClear();
    await runtime.connectProfile(profile.id, async () => tunnel());
    expect(event).not.toHaveBeenCalled();
    expect(status).not.toHaveBeenCalled();
  });

  it("disconnects only a known nonfocused lifecycle and immediately notifies disposal", async () => {
    const profile = addSshProfile("background");
    const closeReady = deferred();
    const connection = tunnel(vi.fn(() => closeReady.promise));
    releaseCleanup.push(closeReady.resolve);
    const status = await runtime.connectProfile(profile.id, async () => connection);
    const disposed = vi.fn();
    runtime.onConnectionDisposed(disposed);
    const pending = runtime.disconnectProfile(profile.id);
    expect(disposed).toHaveBeenCalledWith(status.connectionID);
    expect(runtime.listRuntimes().map((item) => item.profileID)).toEqual(["local-default"]);
    await expect(runtime.requestConnection({ connectionID: status.connectionID })).rejects.toThrow(
      "stale",
    );
    await expect(runtime.disconnectProfile("unknown")).rejects.toThrow();
    closeReady.resolve();
    await pending;
    expect(connection.close).toHaveBeenCalledOnce();
    await vi.waitFor(() => {
      const events = send.mock.calls.flatMap(([, batch]) => (batch as PalotEventBatch).events);
      expect(events).toContainEqual(
        expect.objectContaining({
          type: "palot.runtime.status",
          data: expect.objectContaining({
            connectionID: status.connectionID,
            phase: "stopped",
            connected: false,
          }),
        }),
      );
    });
    await runtime.disconnectProfile(profile.id);
    expect(disposed).toHaveBeenCalledOnce();
    expect(runtime.profileSnapshot().profiles.some((item) => item.id === profile.id)).toBe(true);
  });

  it("disables the focused connection without switching profiles and can enable it again", async () => {
    const profile = addSshProfile("focused");
    const connection = tunnel();
    const connected = await runtime.switchProfile(profile.id, async () => connection);
    await runtime.disconnectProfile(profile.id);
    expect(connection.close).toHaveBeenCalledOnce();
    expect(runtime.profileSnapshot().activeProfileID).toBe(profile.id);
    expect(runtime.runtimeStatus()).toMatchObject({
      profileID: profile.id,
      connected: false,
      phase: "stopped",
    });
    await expect(runtime.requestConnection()).rejects.toThrow("disposed");
    const enabled = await runtime.connectProfile(profile.id, async () => tunnel());
    expect(enabled.connected).toBe(true);
    expect(enabled.connectionID).not.toBe(connected.connectionID);
    expect(runtime.runtimeStatus()).toEqual(enabled);
  });

  it("disposes cached attention indexes when their lifecycle is disconnected", async () => {
    const { openCodeAttentionIndex, destroyOpenCodeAttentionIndex } =
      await import("./attention-index");
    const profile = addSshProfile("attention");
    const status = await runtime.connectProfile(profile.id, async () => tunnel());
    const index = openCodeAttentionIndex(status.connectionID);
    const dispose = vi.spyOn(index, "dispose");
    await runtime.disconnectProfile(profile.id);
    expect(dispose).toHaveBeenCalledOnce();
    expect(() => openCodeAttentionIndex(status.connectionID)).toThrow("stale");
    destroyOpenCodeAttentionIndex();
    expect(dispose).toHaveBeenCalledOnce();
  });
  it("coalesces concurrent connection attempts for one retained profile without changing focus", async () => {
    const profile = addSshProfile("shared");
    const ready = deferred();
    const connector = vi.fn<SshConnector>(async () => {
      await ready.promise;
      return tunnel();
    });
    const first = runtime.connectProfile(profile.id, connector);
    const second = runtime.connectProfile(profile.id, connector);
    ready.resolve();
    const [a, b] = await Promise.all([first, second]);
    expect(a.connectionID).toBe(b.connectionID);
    expect(connector).toHaveBeenCalledOnce();
    expect(runtime.listRuntimes().filter((status) => status.profileID === profile.id)).toHaveLength(
      1,
    );
    expect(runtime.runtimeStatus().profileID).toBe("local-default");
  });
  it.each(["test", "switch"] as const)(
    "aborts and awaits cleanup for a pending SSH %s",
    async (operation) => {
      const entered = deferred();
      const closing = deferred();
      const finishClose = deferred();
      releaseCleanup.push(finishClose.resolve);
      const connection = tunnel(
        vi.fn(async () => {
          closing.resolve();
          await finishClose.promise;
        }),
      );
      let signal!: AbortSignal;
      const connector: SshConnector = async (input) => {
        signal = input.signal;
        entered.resolve();
        await new Promise<void>((resolve) =>
          signal.addEventListener("abort", () => resolve(), { once: true }),
        );
        // Exercise acquisition finishing concurrently with disposal, not just an abort rejection.
        return connection;
      };
      const pending =
        operation === "test"
          ? runtime.testProfile({ kind: "ssh", name: "Test", ssh: { target: "test" } }, connector)
          : runtime.switchProfile(addSshProfile("candidate").id, connector);
      const rejected = expect(pending).rejects.toThrow(/stopped|disposed/);
      await entered.promise;
      let shutdownFinished = false;
      const shutdown = runtime.shutdown().then(() => {
        shutdownFinished = true;
      });
      await closing.promise;
      expect(signal.aborted).toBe(true);
      expect(shutdownFinished).toBe(false);
      finishClose.resolve();
      await Promise.all([shutdown, rejected]);
      expect(connection.close).toHaveBeenCalledOnce();
      expect(runtime.runtimeStatus()).toMatchObject({
        profileID: "local-default",
        connected: false,
        phase: "stopped",
      });
    },
  );

  it("rejects new work while shutdown is awaiting owned tunnel cleanup", async () => {
    const closing = deferred();
    const finishClose = deferred();
    releaseCleanup.push(finishClose.resolve);
    const connector = vi.fn<SshConnector>().mockResolvedValue(
      tunnel(
        vi.fn(async () => {
          closing.resolve();
          await finishClose.promise;
        }),
      ),
    );
    const profile = addSshProfile("active");
    await runtime.switchProfile(profile.id, connector);
    const shutdown = runtime.shutdown();
    await closing.promise;
    await expect(runtime.connect({}, connector)).rejects.toThrow("shutting down");
    await expect(runtime.withClient(async () => "unexpected")).rejects.toThrow("shutting down");
    await expect(runtime.requestConnection()).rejects.toThrow("shutting down");
    await expect(runtime.switchProfile("local-default")).rejects.toThrow("shutting down");
    await expect(
      runtime.testProfile({ kind: "ssh", name: "Test", ssh: { target: "test" } }, connector),
    ).rejects.toThrow("shutting down");
    expect(connector).toHaveBeenCalledOnce();
    finishClose.resolve();
    await shutdown;
    await expect(runtime.connect({}, connector)).rejects.toThrow("shutting down");
  });

  it("does not focus a candidate when shutdown begins during focus observers", async () => {
    const closing = deferred();
    const finishClose = deferred();
    releaseCleanup.push(finishClose.resolve);
    const previous = addSshProfile("previous");
    const candidate = addSshProfile("candidate");
    await runtime.switchProfile(previous.id, async () => tunnel());
    runtime.onBeforeSwitch(async () => {
      closing.resolve();
      await finishClose.promise;
    });
    const candidateConnection = tunnel();
    const pending = runtime.switchProfile(candidate.id, async () => candidateConnection);
    const rejected = expect(pending).rejects.toThrow("shutting down");
    await closing.promise;
    const shutdown = runtime.shutdown();
    finishClose.resolve();
    await Promise.all([shutdown, rejected]);
    expect(candidateConnection.close).toHaveBeenCalledOnce();
    expect(runtime.runtimeStatus()).toMatchObject({
      profileID: previous.id,
      connected: false,
      phase: "stopped",
    });
  });

  it("retains connected profiles across focus and deduplicates events per connection", async () => {
    const first = addSshProfile("first");
    const second = addSshProfile("second");
    const a = tunnel();
    const b = tunnel();
    const focusedObserver = vi.fn();
    runtime.onEvent(focusedObserver);
    const statusA = await runtime.connectProfile(first.id, async () => a);
    const statusB = await runtime.connectProfile(second.id, async () => b);
    expect(runtime.runtimeStatus().profileID).toBe("local-default");
    const connector = vi.fn<SshConnector>();
    expect((await runtime.switchProfile(first.id, connector)).connectionID).toBe(
      statusA.connectionID,
    );
    expect((await runtime.switchProfile(second.id, connector)).connectionID).toBe(
      statusB.connectionID,
    );
    expect((await runtime.switchProfile(first.id, connector)).connectionID).toBe(
      statusA.connectionID,
    );
    expect(connector).not.toHaveBeenCalled();
    expect(a.close).not.toHaveBeenCalled();
    expect(b.close).not.toHaveBeenCalled();
    expect(focusedObserver).not.toHaveBeenCalled();
    await vi.waitFor(() => {
      const batches = send.mock.calls.map(([, batch]) => batch as PalotEventBatch);
      const events = batches.flatMap((batch) =>
        batch.events.filter((event) => event.id === "same-event").map(() => batch.connectionID),
      );
      expect(events.sort()).toEqual([statusA.connectionID, statusB.connectionID].sort());
    });
  });

  it("routes exact background requests and rejects stale or mismatched generations", async () => {
    const first = addSshProfile("first");
    const second = addSshProfile("second");
    const statusA = await runtime.connectProfile(first.id, async () => ({
      ...tunnel(),
      endpoint: { url: "http://127.0.0.1:1111" },
    }));
    const statusB = await runtime.switchProfile(second.id, async () => ({
      ...tunnel(),
      endpoint: { url: "http://127.0.0.1:2222" },
    }));
    expect(
      (await runtime.requestConnection({ profileID: first.id, connectionID: statusA.connectionID }))
        .endpoint.url,
    ).toContain(":1111");
    expect(
      (await runtime.requestConnection({ connectionID: statusB.connectionID })).endpoint.url,
    ).toContain(":2222");
    await expect(
      runtime.requestConnection({ profileID: first.id, connectionID: statusB.connectionID }),
    ).rejects.toThrow("stale");
    await expect(runtime.requestConnection({ profileID: "unknown" })).rejects.toThrow();
    await expect(runtime.requestConnection({ profileID: "local-default" })).rejects.toThrow(
      "not connected",
    );
    const scoped = runtime.scopedConnection(statusA.connectionID);
    runtime.updateProfile({ ...first, kind: "ssh", ssh: { target: "edited" } });
    await expect(runtime.requestConnection({ connectionID: statusA.connectionID })).rejects.toThrow(
      "stale",
    );
    expect(() => scoped.runtimeStatus()).toThrow("stale");
    expect(runtime.listRuntimes().some((status) => status.profileID === first.id)).toBe(false);
    const replacement = await runtime.connectProfile(first.id, async () => tunnel());
    expect(replacement.connectionID).not.toBe(statusA.connectionID);
    runtime.deleteProfile(first.id);
    await expect(
      runtime.requestConnection({ connectionID: replacement.connectionID }),
    ).rejects.toThrow("stale");
  });

  it("does not retain or publish test lifecycles", async () => {
    const connection = tunnel();
    await runtime.testProfile(
      { kind: "ssh", name: "Probe", ssh: { target: "probe" } },
      async () => connection,
    );
    expect(connection.close).toHaveBeenCalledOnce();
    expect(runtime.listRuntimes().map((status) => status.profileID)).toEqual(["local-default"]);
    await runtime.shutdown();
    const events = send.mock.calls.flatMap(([, batch]) => (batch as PalotEventBatch).events);
    expect(events.some((event) => event.id === "same-event")).toBe(false);
    expect(events).not.toContainEqual(
      expect.objectContaining({ data: expect.objectContaining({ profileID: "profile-test" }) }),
    );
  });
});
