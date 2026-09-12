// @vitest-environment node
import type { OpenCodeClient } from "@opencode/client";
import { describe, expect, it, vi } from "vitest";
import {
  OpenCodeRuntimeLifecycle,
  type OpenCodeRuntimeLifecycleAdapter,
} from "./opencode-runtime-lifecycle";
import { SUPPORTED_OPENCODE_VERSION } from "./opencode-version";
import type { SshConnector } from "./ssh/interaction";

function fixture(version = SUPPORTED_OPENCODE_VERSION) {
  const adapter: OpenCodeRuntimeLifecycleAdapter = {
    discoverService: vi.fn(),
    ensureService: vi.fn(),
    stopService: vi.fn(),
    discoverBinary: vi
      .fn()
      .mockResolvedValue({ path: "/bundled/opencode2", version: SUPPORTED_OPENCODE_VERSION }),
    makeClient: vi.fn(
      () =>
        ({
          health: { get: vi.fn().mockResolvedValue({ healthy: true, version, pid: 42 }) },
          event: {
            subscribe: async function* ({ signal }: { signal: AbortSignal }) {
              await new Promise<void>((resolve) =>
                signal.addEventListener("abort", () => resolve(), { once: true }),
              );
              yield* [];
            },
          },
        }) as unknown as OpenCodeClient,
    ),
    wait: vi.fn().mockResolvedValue(undefined),
    now: Date.now,
  };
  const onReconnect = vi.fn(async (_client: OpenCodeClient) => {});
  const runtime = new OpenCodeRuntimeLifecycle({
    profile: { id: "ssh", kind: "ssh", name: "Office", ssh: { target: "office" } },
    adapter,
    allowVersionMismatch: true,
    onEvent: vi.fn(),
    onStatus: vi.fn(),
    onReconnect,
  });
  const close = vi.fn(async () => {});
  const endpoint = {
    url: "http://127.0.0.1:5678",
    auth: { type: "basic" as const, username: "opencode", password: "remote-secret" },
  };
  const connector = vi.fn<SshConnector>().mockResolvedValue({ endpoint, close });
  return { runtime, adapter, close, endpoint, connector, onReconnect };
}

describe("SSH lifecycle", () => {
  it("lets reconnect observers use the ready client without waiting on themselves", async () => {
    const { runtime, adapter, connector, onReconnect } = fixture();
    onReconnect.mockImplementation(async (client) => {
      expect(await runtime.client()).toBe(client);
    });
    await runtime.connect({}, connector);
    adapter.now = () => Date.now() + 60_000;
    runtime.recoverEventStream("resume");
    await vi.waitFor(() => expect(onReconnect).toHaveBeenCalledOnce());
    await runtime.stop();
  });

  it("fails requests during recovery and requires explicit retry after canceled reconnect", async () => {
    const { runtime, adapter, connector } = fixture();
    await runtime.connect({}, connector);
    connector.mockRejectedValueOnce(new Error("SSH connection canceled"));
    adapter.now = () => Date.now() + 60_000;
    runtime.recoverEventStream("resume");
    await expect(runtime.client()).rejects.toThrow("stale after resume");
    await vi.waitFor(() =>
      expect(runtime.status()).toMatchObject({ phase: "error", error: "SSH connection canceled" }),
    );
    await expect(runtime.client()).rejects.toThrow("canceled");
    await expect(runtime.client()).rejects.toThrow("canceled");
    expect(connector).toHaveBeenCalledTimes(2);
    await runtime.connect({}, connector);
    expect(runtime.status().connected).toBe(true);
    await runtime.stop();
  });

  it("shares awaited disposal and cannot reconnect a disposed lifecycle", async () => {
    const { runtime, connector, close } = fixture();
    await runtime.connect({}, connector);
    let finish!: () => void;
    close.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const first = runtime.stop();
    await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());
    const second = runtime.stop();
    expect(second).toBe(first);
    await expect(runtime.connect({}, connector)).rejects.toThrow("disposed");
    await expect(runtime.client()).rejects.toThrow("disposed");
    finish();
    await Promise.all([first, second]);
    expect(connector).toHaveBeenCalledOnce();
  });

  it("uses the tunneled endpoint without local service ownership or local capabilities", async () => {
    const { runtime, adapter, connector, endpoint, close } = fixture();
    const status = await runtime.connect({}, connector);
    expect(status).toMatchObject({
      connected: true,
      source: "network-server",
      topology: "remote-machine",
      managed: false,
      capabilities: { localPathActions: false, localFileAttachments: false },
    });
    expect(adapter.discoverService).not.toHaveBeenCalled();
    expect(adapter.ensureService).not.toHaveBeenCalled();
    expect(await runtime.requestConnection()).toMatchObject({
      endpoint,
      headers: { authorization: expect.stringMatching(/^Basic /) },
    });
    await runtime.stop();
    expect(close).toHaveBeenCalledOnce();
    expect(adapter.stopService).not.toHaveBeenCalled();
    expect(runtime.status().connected).toBe(false);
  });

  it("cleans up an incompatible remote tunnel even with the development mismatch override", async () => {
    const { runtime, connector, close, adapter } = fixture("0.0.0-beta-1");
    await expect(runtime.connect({ versionMismatch: "continue" }, connector)).rejects.toThrow(
      "not supported",
    );
    expect(close).toHaveBeenCalledOnce();
    expect(adapter.ensureService).not.toHaveBeenCalled();
    await runtime.stop();
    expect(close).toHaveBeenCalledOnce();
  });

  it("aborts pending SSH setup and waits for its cleanup before stopping", async () => {
    const { runtime } = fixture();
    let finish!: () => void;
    const cleaned = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const connector: SshConnector = async ({ signal }) => {
      await new Promise<void>((resolve) =>
        signal.addEventListener("abort", () => resolve(), { once: true }),
      );
      await cleaned;
      signal.throwIfAborted();
      throw new Error("Expected abort");
    };
    const connecting = runtime.connect({}, connector);
    const rejection = expect(connecting).rejects.toThrow("stopped");
    await vi.waitFor(() => expect(runtime.status().phase).toBe("discovering"));
    await new Promise((resolve) => setImmediate(resolve));
    let stopped = false;
    const stopping = runtime.stop().then(() => {
      stopped = true;
    });
    await new Promise((resolve) => setImmediate(resolve));
    expect(stopped).toBe(false);
    finish();
    await Promise.all([stopping, rejection]);
    expect(runtime.status().phase).toBe("stopped");
  });
});
