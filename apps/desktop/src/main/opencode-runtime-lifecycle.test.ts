// @vitest-environment node

import type { OpenCodeClient, OpenCodeEvent } from "@opencode/client";
import type { Endpoint } from "@opencode/client/service";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenCodeRuntimeStatus, OpenCodeVersionMismatch } from "../shared/opencode-contract";
import { SUPPORTED_OPENCODE_VERSION } from "./opencode-version";
import {
  OpenCodeRuntimeLifecycle,
  discoverBundledOpenCodeBinary,
  openCodeRuntimeLifecycleAdapter,
  type OpenCodeRuntimeLifecycleAdapter,
} from "./opencode-runtime-lifecycle";
import * as runtimeRelease from "./opencode-runtime-release";

describe("explicit Palot bundled runtime selection", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it.each(["/trusted/external/opencode", "/missing/opencode"])(
    "does not let OPENCODE_BIN=%s override the verified bundle",
    async (override) => {
      vi.stubEnv("OPENCODE_BIN", override);
      vi.stubGlobal("process", { ...process, resourcesPath: "/palot/resources" });
      const binary = { path: "/palot/resources/opencode/opencode2", version: "2.0.2" };
      const verify = vi
        .spyOn(runtimeRelease, "verifyBundledOpenCodeBinary")
        .mockResolvedValue(binary);
      await expect(discoverBundledOpenCodeBinary()).resolves.toEqual(binary);
      expect(verify).toHaveBeenCalledExactlyOnceWith({ directory: "/palot/resources/opencode" });
    },
  );

  it("fails closed with recovery guidance instead of discovering an external executable", async () => {
    vi.stubEnv("OPENCODE_BIN", "/trusted/external/opencode");
    vi.stubGlobal("process", { ...process, resourcesPath: "/palot/resources" });
    vi.spyOn(runtimeRelease, "verifyBundledOpenCodeBinary").mockRejectedValue(
      new Error("bad hash"),
    );
    await expect(discoverBundledOpenCodeBinary()).rejects.toThrow(
      "bad hash. Prepare a Palot runtime in connection settings",
    );
  });
});

const discoveredEndpoint = { url: "http://127.0.0.1:4096" } as Endpoint;
const managedEndpoint = { url: "http://127.0.0.1:4097" } as Endpoint;

function client(version: string, pid = 42): OpenCodeClient {
  return {
    health: { get: vi.fn().mockResolvedValue({ healthy: true, version, pid }) },
    event: {
      subscribe: async function* ({ signal }: { signal?: AbortSignal }) {
        await new Promise<void>((resolve) => signal?.addEventListener("abort", () => resolve()));
        yield* [];
      },
    },
  } as unknown as OpenCodeClient;
}

function lifecycle(input: {
  discoveredVersion: string;
  managedVersion?: string;
  allowed?: boolean;
  accepted?: (mismatch: OpenCodeVersionMismatch) => void;
}) {
  const discoveredClient = client(input.discoveredVersion);
  const managedClient = client(input.managedVersion ?? SUPPORTED_OPENCODE_VERSION, 84);
  const ensureService = vi.fn().mockImplementation(async ({ onStart }) => {
    onStart();
    return managedEndpoint;
  });
  const adapter: OpenCodeRuntimeLifecycleAdapter = {
    discoverService: vi.fn().mockResolvedValue(discoveredEndpoint),
    ensureService,
    stopService: vi.fn().mockResolvedValue(undefined),
    makeClient: (endpoint) =>
      endpoint.url === discoveredEndpoint.url ? discoveredClient : managedClient,
    discoverBinary: vi.fn().mockResolvedValue({
      path: "/usr/local/bin/opencode2",
      version: input.managedVersion ?? SUPPORTED_OPENCODE_VERSION,
    }),
    wait: vi.fn().mockResolvedValue(undefined),
    now: () => 100,
  };
  return {
    runtime: new OpenCodeRuntimeLifecycle({
      adapter,
      allowVersionMismatch: true,
      isVersionMismatchAllowed: () => input.allowed ?? false,
      onVersionMismatchAccepted: input.accepted,
      onEvent: vi.fn(),
      onReconnect: vi.fn().mockResolvedValue(undefined),
      onStatus: vi.fn(),
    }),
    ensureService,
  };
}

describe("OpenCodeRuntimeLifecycle version mismatch", () => {
  it.each(["2.0.0", "2.0.1", "2.1.0"])(
    "connects stable %s without override or service replacement",
    async (version) => {
      const { runtime, ensureService } = lifecycle({ discoveredVersion: version });
      await expect(runtime.connect()).resolves.toMatchObject({
        connected: true,
        version,
        versionMismatch: null,
      });
      expect(ensureService).not.toHaveBeenCalled();
      await runtime.stop();
    },
  );
  it("refuses beta mismatches when the caller disables compatibility mode", async () => {
    const discoveredClient = client("0.0.0-beta-17794");
    const runtime = new OpenCodeRuntimeLifecycle({
      adapter: {
        discoverService: vi.fn().mockResolvedValue(discoveredEndpoint),
        ensureService: vi.fn(),
        stopService: vi.fn().mockResolvedValue(undefined),
        makeClient: () => discoveredClient,
        discoverBinary: vi.fn(),
        wait: vi.fn(),
        now: () => 100,
      },
      onEvent: vi.fn(),
      onReconnect: vi.fn(),
      onStatus: vi.fn(),
    });

    await expect(runtime.connect({ versionMismatch: "continue" })).rejects.toThrow("not supported");
    expect(runtime.status().versionMismatch?.canContinue).toBe(false);
  });

  it("reuses the reviewed beta with the stable client without starting or replacing it", async () => {
    const { runtime, ensureService } = lifecycle({ discoveredVersion: "0.0.0-beta-19507" });
    await expect(runtime.connect()).resolves.toMatchObject({
      connected: true,
      version: "0.0.0-beta-19507",
      contractVersion: SUPPORTED_OPENCODE_VERSION,
      versionMismatch: null,
    });
    expect(ensureService).not.toHaveBeenCalled();
    await runtime.stop();
  });

  it("stops before replacing a healthy mismatched beta service", async () => {
    const { runtime, ensureService } = lifecycle({ discoveredVersion: "0.0.0-beta-17794" });

    await expect(runtime.connect()).rejects.toThrow("does not match");

    expect(ensureService).not.toHaveBeenCalled();
    expect(runtime.status()).toMatchObject({
      phase: "error",
      connected: false,
      version: "0.0.0-beta-17794",
      versionMismatch: {
        detectedVersion: "0.0.0-beta-17794",
        expectedVersion: SUPPORTED_OPENCODE_VERSION,
        canContinue: true,
      },
    });
  });

  it("continues on explicit approval and records the exact mismatch", async () => {
    const accepted = vi.fn();
    const { runtime, ensureService } = lifecycle({
      discoveredVersion: "0.0.0-beta-17794",
      accepted,
    });

    await expect(
      runtime.connect({ versionMismatch: "continue", approvedVersion: "0.0.0-beta-17794" }),
    ).resolves.toMatchObject({
      connected: true,
      version: "0.0.0-beta-17794",
      versionMismatch: { detectedVersion: "0.0.0-beta-17794" },
    });

    expect(ensureService).not.toHaveBeenCalled();
    expect(accepted).toHaveBeenCalledOnce();
    runtime.stop();
  });

  it("does not extend explicit beta consent to a replacement discovered after the dialog opened", async () => {
    const accepted = vi.fn();
    const { runtime } = lifecycle({ discoveredVersion: "0.0.0-beta-19599", accepted });
    await expect(
      runtime.connect({ versionMismatch: "continue", approvedVersion: "0.0.0-beta-19598" }),
    ).rejects.toThrow("does not match");
    expect(accepted).not.toHaveBeenCalled();
    expect(runtime.status().versionMismatch?.detectedVersion).toBe("0.0.0-beta-19599");
    await runtime.stop();
  });

  it("rechecks the approved version against the final health response", async () => {
    const accepted = vi.fn();
    const changingClient = client("0.0.0-beta-19598");
    vi.mocked(changingClient.health.get)
      .mockResolvedValueOnce({ healthy: true, version: "0.0.0-beta-19598", pid: 42 } as never)
      .mockResolvedValueOnce({ healthy: true, version: "0.0.0-beta-19599", pid: 43 } as never);
    const runtime = new OpenCodeRuntimeLifecycle({
      allowVersionMismatch: true,
      onVersionMismatchAccepted: accepted,
      adapter: {
        discoverService: vi.fn().mockResolvedValue(discoveredEndpoint),
        ensureService: vi.fn(),
        stopService: vi.fn(),
        discoverBinary: vi.fn(),
        makeClient: () => changingClient,
        wait: vi.fn(),
        now: () => 100,
      },
      onEvent: vi.fn(),
      onReconnect: vi.fn(),
      onStatus: vi.fn(),
    });
    await expect(
      runtime.connect({ versionMismatch: "continue", approvedVersion: "0.0.0-beta-19598" }),
    ).rejects.toThrow("does not match");
    expect(accepted).not.toHaveBeenCalledWith(
      expect.objectContaining({ detectedVersion: "0.0.0-beta-19599" }),
    );
    expect(runtime.status().connected).toBe(false);
    await runtime.stop();
  });

  it("reuses a mismatch that was previously approved", async () => {
    const accepted = vi.fn();
    const { runtime, ensureService } = lifecycle({
      discoveredVersion: "0.0.0-beta-17794",
      allowed: true,
      accepted,
    });

    await expect(runtime.connect()).resolves.toMatchObject({
      connected: true,
      version: "0.0.0-beta-17794",
    });

    expect(ensureService).not.toHaveBeenCalled();
    expect(accepted).not.toHaveBeenCalled();
    runtime.stop();
  });

  it("starts the supported binary only after explicit replacement", async () => {
    const { runtime, ensureService } = lifecycle({ discoveredVersion: "0.0.0-beta-17794" });

    await expect(runtime.connect({ versionMismatch: "replace" })).resolves.toMatchObject({
      connected: true,
      version: SUPPORTED_OPENCODE_VERSION,
      managed: true,
      versionMismatch: null,
    });

    expect(ensureService).toHaveBeenCalledOnce();
    runtime.stop();
  });

  it("connects the explicitly selected beta after replacement using its existing consent", async () => {
    const { runtime, ensureService } = lifecycle({
      discoveredVersion: "0.0.0-beta-17794",
      managedVersion: "0.0.0-beta-19599",
      allowed: true,
    });
    await expect(runtime.connect({ versionMismatch: "replace" })).resolves.toMatchObject({
      connected: true,
      version: "0.0.0-beta-19599",
      managed: true,
    });
    expect(ensureService).toHaveBeenCalledWith(
      expect.objectContaining({ version: "0.0.0-beta-19599" }),
    );
    await runtime.stop();
  });
});

describe("OpenCodeRuntimeLifecycle remote profiles", () => {
  it("connects directly without discovering or starting a local service", async () => {
    const discoverService = vi.fn();
    const ensureService = vi.fn();
    const makeClient = vi.fn(() => client(SUPPORTED_OPENCODE_VERSION));
    const runtime = new OpenCodeRuntimeLifecycle({
      profile: {
        id: "remote",
        kind: "remote",
        name: "Office",
        urls: ["http://office:4096"],
        credentialID: null,
        allowPlainHttp: true,
        lastSuccessfulUrl: null,
        lastConnectedAt: null,
      },
      headers: { authorization: "Bearer secret" },
      adapter: {
        discoverService,
        ensureService,
        stopService: vi.fn().mockResolvedValue(undefined),
        makeClient,
        discoverBinary: vi.fn(),
        wait: vi.fn().mockResolvedValue(undefined),
        now: () => 100,
      },
      onEvent: vi.fn(),
      onReconnect: vi.fn(),
      onStatus: vi.fn(),
    });

    await expect(runtime.connect()).resolves.toMatchObject({
      connected: true,
      profileID: "remote",
      source: "network-server",
      topology: "remote-machine",
    });

    expect(discoverService).not.toHaveBeenCalled();
    expect(ensureService).not.toHaveBeenCalled();
    expect(makeClient).toHaveBeenCalledWith(
      { url: "http://office:4096" },
      { authorization: "Bearer secret" },
      true,
    );
    runtime.stop();
  });
});

describe("OpenCodeRuntimeLifecycle local service controls", () => {
  it("leaves the working service connected when the selected runtime fails verification", async () => {
    const stopService = vi.fn();
    const ensureService = vi.fn();
    const discoverLocalBinary = vi.fn().mockRejectedValue(new Error("Runtime checksum mismatch"));
    const runtime = new OpenCodeRuntimeLifecycle({
      discoverLocalBinary,
      adapter: {
        discoverService: vi.fn().mockResolvedValue(discoveredEndpoint),
        ensureService,
        stopService,
        makeClient: () => client(SUPPORTED_OPENCODE_VERSION),
        discoverBinary: vi.fn(),
        wait: vi.fn(),
        now: () => 100,
      },
      onEvent: vi.fn(),
      onReconnect: vi.fn(),
      onStatus: vi.fn(),
    });
    await runtime.connect();
    expect(discoverLocalBinary).not.toHaveBeenCalled();
    await expect(runtime.restartLocalService()).rejects.toThrow("checksum mismatch");
    expect(stopService).not.toHaveBeenCalled();
    expect(ensureService).not.toHaveBeenCalled();
    expect(runtime.status().connected).toBe(true);
    await runtime.stop();
  });

  it("uses the verified local selection for confirmed startup, not the SSH authentication binary", async () => {
    const discoverBinary = vi.fn();
    const discoverLocalBinary = vi.fn().mockResolvedValue({
      path: "/private/runtime-cache/opencode2",
      version: "0.0.0-beta-19507",
    });
    const ensureService = vi.fn().mockResolvedValue(managedEndpoint);
    const runtime = new OpenCodeRuntimeLifecycle({
      discoverLocalBinary,
      adapter: {
        discoverService: vi.fn().mockResolvedValue(undefined),
        ensureService,
        stopService: vi.fn(),
        makeClient: () => client("0.0.0-beta-19507"),
        discoverBinary,
        wait: vi.fn(),
        now: () => 100,
      },
      onEvent: vi.fn(),
      onReconnect: vi.fn(),
      onStatus: vi.fn(),
    });
    await expect(runtime.connect()).rejects.toThrow("No reachable local");
    expect(discoverLocalBinary).not.toHaveBeenCalled();
    await runtime.connect({ startLocalService: true });
    expect(discoverBinary).not.toHaveBeenCalled();
    expect(discoverLocalBinary).toHaveBeenCalledOnce();
    expect(ensureService).toHaveBeenCalledWith(
      expect.objectContaining({
        command: ["/private/runtime-cache/opencode2", "serve", "--service", "--port=4096"],
        version: expect.any(Function),
      }),
    );
    await runtime.stop();
  });
  it("restarts the registered service and reconnects through the supported binary", async () => {
    const stopService = vi.fn().mockResolvedValue(undefined);
    const discoverService = vi
      .fn()
      .mockResolvedValueOnce(discoveredEndpoint)
      .mockResolvedValueOnce(undefined);
    const ensureService = vi.fn().mockImplementation(async ({ onStart }) => {
      onStart();
      return managedEndpoint;
    });
    const runtime = new OpenCodeRuntimeLifecycle({
      adapter: {
        discoverService,
        ensureService,
        stopService,
        makeClient: (endpoint) =>
          client(SUPPORTED_OPENCODE_VERSION, endpoint.url === managedEndpoint.url ? 84 : 42),
        discoverBinary: vi.fn().mockResolvedValue({
          path: "/usr/local/bin/opencode2",
          version: SUPPORTED_OPENCODE_VERSION,
        }),
        wait: vi.fn().mockResolvedValue(undefined),
        now: () => 100,
      },
      onEvent: vi.fn(),
      onReconnect: vi.fn(),
      onStatus: vi.fn(),
    });

    await runtime.connect();
    await expect(runtime.restartLocalService()).resolves.toMatchObject({
      connected: true,
      pid: 84,
      managed: true,
    });

    expect(stopService).toHaveBeenCalledOnce();
    expect(stopService).toHaveBeenCalledWith({ pty: "handoff" });
    expect(ensureService).toHaveBeenCalledOnce();
    runtime.stop();
  });

  it("reports restart failures as runtime errors", async () => {
    const runtime = new OpenCodeRuntimeLifecycle({
      adapter: {
        discoverService: vi.fn().mockResolvedValue(discoveredEndpoint),
        ensureService: vi.fn(),
        stopService: vi.fn().mockRejectedValue(new Error("service stop failed")),
        makeClient: () => client(SUPPORTED_OPENCODE_VERSION, 42),
        discoverBinary: vi.fn().mockResolvedValue({
          path: "/usr/local/bin/opencode2",
          version: SUPPORTED_OPENCODE_VERSION,
        }),
        wait: vi.fn().mockResolvedValue(undefined),
        now: () => 100,
      },
      onEvent: vi.fn(),
      onReconnect: vi.fn(),
      onStatus: vi.fn(),
    });

    await runtime.connect();
    await expect(runtime.restartLocalService()).rejects.toThrow("service stop failed");
    expect(runtime.status()).toMatchObject({
      phase: "error",
      connected: false,
      error: "service stop failed",
    });
    runtime.stop();
  });
});

describe("OpenCodeRuntimeLifecycle local startup failures", () => {
  afterEach(() => vi.unstubAllEnvs());

  it.each([
    [undefined, "4096"],
    ["  ", "4096"],
    [" 41234 ", "41234"],
  ])("starts the managed service on a stable port with override %s", async (override, port) => {
    vi.stubEnv("PALOT_OPENCODE_SERVICE_PORT", override);
    const ensureService = vi.fn().mockResolvedValue(managedEndpoint);
    const runtime = localRuntime({
      ensureService,
    });

    await runtime.connect({ startLocalService: true });

    expect(ensureService).toHaveBeenCalledWith(
      expect.objectContaining({
        command: ["/usr/local/bin/opencode2", "serve", "--service", `--port=${port}`],
      }),
    );
    runtime.stop();
  });

  it("requires a new confirmed start after setup resolves a missing runtime", async () => {
    const ensureService = vi.fn().mockResolvedValue(managedEndpoint);
    const discoverBinary = vi.fn().mockResolvedValue(null);
    const runtime = localRuntime({
      discoverBinary,
      ensureService,
    });

    await expect(runtime.connect({ startLocalService: true })).rejects.toThrow(
      "A supported OpenCode 2 binary was not found",
    );
    expect(ensureService).not.toHaveBeenCalled();
    expect(runtime.status()).toMatchObject({
      phase: "error",
      connected: false,
      canStartLocalService: true,
      error: expect.stringContaining("download an official runtime in connection settings"),
    });
    discoverBinary.mockResolvedValue({
      path: "/prepared/opencode2",
      version: SUPPORTED_OPENCODE_VERSION,
    });
    expect(ensureService).not.toHaveBeenCalled();
    await runtime.connect({ startLocalService: true });
    expect(ensureService).toHaveBeenCalledOnce();
    expect(runtime.status().connected).toBe(true);
    runtime.stop();
  });

  it.each([
    "Timed out waiting for the background service to start",
    "Failed to start server: address already in use",
  ])("surfaces official service startup failure: %s", async (message) => {
    const runtime = localRuntime({
      ensureService: vi.fn().mockRejectedValue(new Error(message)),
    });

    await expect(runtime.connect({ startLocalService: true })).rejects.toThrow(message);
    expect(runtime.status()).toMatchObject({ phase: "error", connected: false, error: message });
  });
});

describe("OpenCodeRuntimeLifecycle discovery-only connection", () => {
  it("does not start a missing service from connect or client", async () => {
    const discoverBinary = vi.fn();
    const ensureService = vi.fn();
    const stopService = vi.fn();
    const runtime = localRuntime({ discoverBinary, ensureService, stopService });
    await expect(runtime.connect()).rejects.toThrow(
      "No reachable local OpenCode service was found",
    );
    await expect(runtime.client()).rejects.toThrow("start OpenCode explicitly");
    expect(runtime.status()).toMatchObject({ canStartLocalService: true, connected: false });
    expect(discoverBinary).not.toHaveBeenCalled();
    expect(ensureService).not.toHaveBeenCalled();
    expect(stopService).not.toHaveBeenCalled();
    await runtime.stop();
  });

  it("rediscovers and reuses a service on explicit start", async () => {
    const discoverService = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValue(discoveredEndpoint);
    const ensureService = vi.fn();
    const discoverBinary = vi.fn();
    const runtime = localRuntime({ discoverService, ensureService, discoverBinary });
    await expect(runtime.connect()).rejects.toThrow("No reachable");
    await expect(runtime.connect({ startLocalService: true })).resolves.toMatchObject({
      connected: true,
      canStartLocalService: false,
    });
    expect(discoverService).toHaveBeenCalledTimes(2);
    expect(ensureService).not.toHaveBeenCalled();
    expect(discoverBinary).not.toHaveBeenCalled();
    await runtime.stop();
  });

  it("does not turn discovery errors into automatic startup", async () => {
    const ensureService = vi.fn();
    const discoverBinary = vi.fn();
    const runtime = localRuntime({
      discoverService: vi.fn().mockRejectedValue(new Error("discovery failed")),
      ensureService,
      discoverBinary,
    });
    await expect(runtime.connect()).rejects.toThrow("discovery failed");
    await expect(runtime.connect({ startLocalService: true })).rejects.toThrow("discovery failed");
    expect(ensureService).not.toHaveBeenCalled();
    expect(discoverBinary).not.toHaveBeenCalled();
    await runtime.stop();
  });

  it("preserves any healthy version racing with explicit startup and enforces compatibility", async () => {
    const ensureService = vi.fn().mockResolvedValue(managedEndpoint);
    const runtime = localRuntime({ ensureService, makeClient: () => client("0.0.0-beta-17794") });
    await expect(
      runtime.connect({ startLocalService: true, versionMismatch: "continue" }),
    ).rejects.toThrow("not supported");
    const version = ensureService.mock.calls[0]![0].version;
    expect(version("0.0.0-beta-17794")).toBe(true);
    expect(runtime.status().versionMismatch?.canContinue).toBe(false);
    await runtime.stop();
  });

  it("does not start after disposal while binary discovery is pending", async () => {
    const binary = Promise.withResolvers<{ path: string; version: string }>();
    const discoverBinary = vi.fn(() => binary.promise);
    const ensureService = vi.fn();
    const runtime = localRuntime({ discoverBinary, ensureService });
    const connecting = runtime.connect({ startLocalService: true });
    const rejected = expect(connecting).rejects.toThrow("stopped");
    await vi.waitFor(() => expect(discoverBinary).toHaveBeenCalledOnce());
    await runtime.stop();
    binary.resolve({ path: "/runtime", version: SUPPORTED_OPENCODE_VERSION });
    await rejected;
    expect(ensureService).not.toHaveBeenCalled();
    expect(runtime.status().phase).toBe("stopped");
  });

  it("does not revive a disposed connection when authorized service startup finishes", async () => {
    const service = Promise.withResolvers<Endpoint>();
    const ensureService = vi.fn(() => service.promise);
    const stopService = vi.fn();
    const runtime = localRuntime({ ensureService, stopService });
    const connecting = runtime.connect({ startLocalService: true });
    const rejected = expect(connecting).rejects.toThrow("stopped");
    await vi.waitFor(() => expect(ensureService).toHaveBeenCalledOnce());
    await runtime.stop();
    service.resolve(managedEndpoint);
    await rejected;
    expect(runtime.status()).toMatchObject({ phase: "stopped", connected: false });
    // Service.ensure cannot be cancelled. Disposal must not stop a shared service.
    expect(stopService).not.toHaveBeenCalled();
  });

  it.each([true, false])(
    "reconnect probes its endpoint before discovery (healthy: %s)",
    async (healthy) => {
      const api = client(SUPPORTED_OPENCODE_VERSION);
      const discoverService = vi
        .fn()
        .mockResolvedValueOnce(discoveredEndpoint)
        .mockResolvedValue(undefined);
      const ensureService = vi.fn();
      const discoverBinary = vi.fn();
      let now = 0;
      const waits: Array<() => void> = [];
      const runtime = localRuntime({
        discoverService,
        ensureService,
        discoverBinary,
        makeClient: () => api,
        now: () => now,
        wait: (_ms, signal) =>
          new Promise<void>((resolve) => {
            waits.push(resolve);
            signal.addEventListener("abort", () => resolve(), { once: true });
          }),
      });
      await runtime.connect();
      if (!healthy) vi.mocked(api.health.get).mockRejectedValue(new Error("offline"));
      now = 21_000;
      runtime.recoverEventStream("focus");
      await expect(runtime.connect()).rejects.toThrow("OpenCode event stream stale");
      await expect(runtime.client()).rejects.toThrow("OpenCode event stream stale");
      await expect(runtime.requestConnection()).rejects.toThrow("OpenCode event stream stale");
      waits[0]!();
      await vi.waitFor(() =>
        healthy
          ? expect(runtime.status().connected).toBe(true)
          : expect(runtime.status().canStartLocalService).toBe(true),
      );
      expect(discoverService).toHaveBeenCalledTimes(healthy ? 1 : 2);
      expect(ensureService).not.toHaveBeenCalled();
      expect(discoverBinary).not.toHaveBeenCalled();
      await runtime.stop();
    },
  );
  it("starts explicitly after missing reconnect discovery without waiting for retry backoff", async () => {
    const api = client(SUPPORTED_OPENCODE_VERSION);
    const discoverService = vi
      .fn()
      .mockResolvedValueOnce(discoveredEndpoint)
      .mockResolvedValue(undefined);
    const ensureService = vi.fn().mockResolvedValue(managedEndpoint);
    const discoverBinary = vi
      .fn()
      .mockResolvedValue({ path: "/runtime", version: SUPPORTED_OPENCODE_VERSION });
    const pendingWait = Promise.withResolvers<void>();
    const wait = vi.fn().mockResolvedValueOnce(undefined).mockReturnValue(pendingWait.promise);
    const onStatus = vi.fn();
    let now = 0;
    const runtime = localRuntime(
      {
        discoverService,
        ensureService,
        discoverBinary,
        wait,
        now: () => now,
        makeClient: (endpoint) =>
          endpoint === discoveredEndpoint ? api : client(SUPPORTED_OPENCODE_VERSION),
      },
      onStatus,
    );
    await runtime.connect();
    vi.mocked(api.health.get).mockRejectedValue(new Error("offline"));
    now = 21_000;
    runtime.recoverEventStream("focus");
    await vi.waitFor(() => expect(wait).toHaveBeenCalledTimes(2));
    expect(runtime.status()).toMatchObject({ connected: false, canStartLocalService: true });
    expect(onStatus).toHaveBeenCalledWith(
      expect.objectContaining({ connected: false, canStartLocalService: true }),
    );
    expect(ensureService).not.toHaveBeenCalled();
    expect(discoverBinary).not.toHaveBeenCalled();
    await expect(runtime.client()).rejects.toThrow("No reachable local OpenCode service was found");
    await expect(runtime.connect()).rejects.toThrow(
      "No reachable local OpenCode service was found",
    );
    await expect(runtime.requestConnection()).rejects.toThrow(
      "No reachable local OpenCode service was found",
    );
    const firstStart = runtime.connect({ startLocalService: true });
    const duplicateStart = runtime.connect({ startLocalService: true });
    await expect(firstStart).resolves.toMatchObject({
      connected: true,
      canStartLocalService: false,
    });
    await expect(duplicateStart).resolves.toMatchObject({ connected: true });
    expect(ensureService).toHaveBeenCalledOnce();
    expect(discoverService).toHaveBeenCalledTimes(3);
    pendingWait.resolve();
    await Promise.resolve();
    expect(runtime.status().connected).toBe(true);
    expect(ensureService).toHaveBeenCalledOnce();
    await runtime.stop();
  });

  it("retires hung reconnect discovery and ignores its late result after explicit start", async () => {
    const api = client(SUPPORTED_OPENCODE_VERSION);
    const pendingDiscovery = Promise.withResolvers<Endpoint | undefined>();
    const discoverService = vi
      .fn()
      .mockResolvedValueOnce(discoveredEndpoint)
      .mockReturnValueOnce(pendingDiscovery.promise)
      .mockResolvedValue(undefined);
    const ensureService = vi.fn().mockResolvedValue(managedEndpoint);
    let now = 0;
    const runtime = localRuntime({
      discoverService,
      ensureService,
      now: () => now,
      makeClient: (endpoint) =>
        endpoint === discoveredEndpoint ? api : client(SUPPORTED_OPENCODE_VERSION),
    });
    await runtime.connect();
    vi.mocked(api.health.get).mockRejectedValue(new Error("offline"));
    now = 21_000;
    runtime.recoverEventStream("focus");
    await vi.waitFor(() => expect(discoverService).toHaveBeenCalledTimes(2));
    await expect(runtime.connect({ startLocalService: true })).resolves.toMatchObject({
      connected: true,
    });
    const epoch = runtime.streamEpoch();
    pendingDiscovery.resolve(discoveredEndpoint);
    await Promise.resolve();
    await Promise.resolve();
    expect(runtime.status().connected).toBe(true);
    expect(runtime.streamEpoch()).toBe(epoch);
    expect(ensureService).toHaveBeenCalledOnce();
    await runtime.stop();
  });
});

describe("OpenCodeRuntimeLifecycle event stream", () => {
  it("reconnects a closed stream without duplicating delivered events", async () => {
    const firstEvent = { id: "event-1", type: "server.connected", data: {} } as OpenCodeEvent;
    const secondEvent = { id: "event-2", type: "server.connected", data: {} } as OpenCodeEvent;
    let makeClientCalls = 0;
    const clients = [
      streamClient(async function* () {
        yield firstEvent;
      }),
      streamClient(async function* ({ signal }) {
        yield secondEvent;
        await waitForAbort(signal);
      }),
    ];
    const onEvent = vi.fn();
    const onReconnect = vi.fn().mockResolvedValue(undefined);
    const adapter: OpenCodeRuntimeLifecycleAdapter = {
      discoverService: vi.fn().mockResolvedValue(discoveredEndpoint),
      ensureService: vi.fn(),
      stopService: vi.fn().mockResolvedValue(undefined),
      makeClient: () => clients[Math.min(Math.floor(makeClientCalls++ / 2), clients.length - 1)]!,
      discoverBinary: vi.fn().mockResolvedValue({
        path: "/usr/local/bin/opencode2",
        version: SUPPORTED_OPENCODE_VERSION,
      }),
      wait: vi.fn().mockResolvedValue(undefined),
      now: () => 100,
    };
    const runtime = new OpenCodeRuntimeLifecycle({
      adapter,
      onEvent,
      onReconnect,
      onStatus: vi.fn(),
    });

    await runtime.connect();
    await vi.waitFor(() => expect(onReconnect).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(onEvent).toHaveBeenCalledTimes(2));

    expect(onEvent.mock.calls).toEqual([
      [firstEvent, 1],
      [secondEvent, 2],
    ]);
    runtime.stop();
  });

  it("aborts the active stream without scheduling reconnect", async () => {
    const subscribeStopped = vi.fn();
    const wait = vi.fn().mockResolvedValue(undefined);
    const adapter: OpenCodeRuntimeLifecycleAdapter = {
      discoverService: vi.fn().mockResolvedValue(discoveredEndpoint),
      ensureService: vi.fn(),
      stopService: vi.fn().mockResolvedValue(undefined),
      makeClient: () =>
        streamClient(async function* ({ signal }) {
          yield await new Promise<OpenCodeEvent>((_resolve, reject) => {
            signal.addEventListener(
              "abort",
              () => {
                subscribeStopped();
                reject(signal.reason);
              },
              { once: true },
            );
          });
        }),
      discoverBinary: vi.fn().mockResolvedValue({
        path: "/usr/local/bin/opencode2",
        version: SUPPORTED_OPENCODE_VERSION,
      }),
      wait,
      now: () => 100,
    };
    const runtime = new OpenCodeRuntimeLifecycle({
      adapter,
      onEvent: vi.fn(),
      onReconnect: vi.fn(),
      onStatus: vi.fn(),
    });

    await runtime.connect();
    runtime.stop();
    await vi.waitFor(() => expect(subscribeStopped).toHaveBeenCalledOnce());

    expect(wait).not.toHaveBeenCalled();
  });
});

function streamClient(
  subscribe: (input: {
    signal: AbortSignal;
    onActivity?: () => void;
  }) => AsyncIterable<OpenCodeEvent>,
): OpenCodeClient {
  return {
    health: {
      get: vi.fn().mockResolvedValue({
        healthy: true,
        version: SUPPORTED_OPENCODE_VERSION,
        pid: 42,
      }),
    },
    event: { subscribe },
  } as unknown as OpenCodeClient;
}

describe("OpenCodeRuntimeLifecycle stream watchdog", () => {
  const runtimes: OpenCodeRuntimeLifecycle[] = [];
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });
  afterEach(() => {
    for (const runtime of runtimes.splice(0)) runtime.stop();
    vi.useRealTimers();
  });

  function fixture(failures: number[] = [], repair?: () => Promise<void>) {
    const subscriptions: Array<{ signal: AbortSignal; activity(): void; at: number }> = [];
    let active = 0;
    let peakActive = 0;
    const api = streamClient(async function* ({ signal, onActivity }) {
      subscriptions.push({ signal, activity: () => onActivity?.(), at: Date.now() });
      active += 1;
      peakActive = Math.max(peakActive, active);
      try {
        if (failures.includes(subscriptions.length)) throw new Error("subscribe failed");
        await waitForAbort(signal);
        yield* [];
      } finally {
        active -= 1;
      }
    });
    const wait = vi.fn(openCodeRuntimeLifecycleAdapter.wait);
    const onReconnect = vi.fn(repair ?? (async () => {}));
    const runtime = new OpenCodeRuntimeLifecycle({
      adapter: {
        discoverService: vi.fn().mockResolvedValue(discoveredEndpoint),
        ensureService: vi.fn(),
        stopService: vi.fn(),
        makeClient: () => api,
        discoverBinary: vi.fn(),
        wait,
        now: Date.now,
      },
      onEvent: vi.fn(),
      onReconnect,
      onStatus: vi.fn(),
    });
    runtimes.push(runtime);
    return { runtime, subscriptions, wait, onReconnect, peakActive: () => peakActive };
  }

  it("recovers a half-open stream once at 45s plus the existing 1s backoff", async () => {
    const { runtime, subscriptions, wait, onReconnect, peakActive } = fixture();
    await runtime.connect();
    await vi.advanceTimersByTimeAsync(44_999);
    expect(subscriptions).toHaveLength(1);
    expect(wait).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(subscriptions[0]!.signal.aborted).toBe(true);
    expect(runtime.status()).toMatchObject({
      connected: false,
      error: "OpenCode event stream stalled",
    });
    expect(wait).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(subscriptions.map(({ at }) => at)).toEqual([0, 46_000]);
    expect(onReconnect).toHaveBeenCalledOnce();
    expect(runtime.streamEpoch()).toBe(2);
    expect(peakActive()).toBe(1);
    expect(runtime.status().connected).toBe(true);
  });

  it("keeps a quiet stream healthy on raw keepalive activity and ignores retired callbacks", async () => {
    const { runtime, subscriptions, wait, onReconnect } = fixture();
    await runtime.connect();
    for (let index = 0; index < 8; index += 1) {
      await vi.advanceTimersByTimeAsync(15_000);
      subscriptions[0]!.activity();
    }
    expect(subscriptions).toHaveLength(1);
    expect(wait).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(46_000);
    expect(subscriptions).toHaveLength(2);
    expect(onReconnect).toHaveBeenCalledOnce();
    runtime.stop();
    subscriptions[0]!.activity();
    subscriptions[1]!.activity();
    await vi.advanceTimersByTimeAsync(90_000);
    expect(wait).toHaveBeenCalledOnce();
    expect(subscriptions).toHaveLength(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears the watchdog on explicit stop without recovery", async () => {
    const { runtime, subscriptions, wait, onReconnect } = fixture();
    await runtime.connect();
    await vi.advanceTimersByTimeAsync(44_999);
    runtime.stop();
    await vi.advanceTimersByTimeAsync(90_000);
    expect(subscriptions[0]!.signal.aborted).toBe(true);
    expect(subscriptions).toHaveLength(1);
    expect(wait).not.toHaveBeenCalled();
    expect(onReconnect).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("retries failed subscriptions at recovery completion without overlapping streams", async () => {
    const { runtime, subscriptions, wait, onReconnect, peakActive } = fixture([1, 2]);
    await runtime.connect();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(subscriptions).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(subscriptions.map(({ at }) => at)).toEqual([0, 1_000, 3_000]);
    expect(wait.mock.calls.map(([delay]) => delay)).toEqual([1_000, 2_000]);
    expect(onReconnect).toHaveBeenCalledTimes(2);
    expect(peakActive()).toBe(1);
    expect(runtime.status().connected).toBe(true);
  });

  it("serializes a watchdog expiry while snapshot recovery is still pending", async () => {
    const repair = Promise.withResolvers<void>();
    const { runtime, subscriptions, wait, onReconnect, peakActive } = fixture(
      [1],
      () => repair.promise,
    );
    await runtime.connect();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(onReconnect).toHaveBeenCalledOnce();
    await expect(runtime.client()).resolves.toBeDefined();
    await expect(runtime.connect()).resolves.toMatchObject({ connected: true });
    await vi.advanceTimersByTimeAsync(45_000);
    expect(subscriptions).toHaveLength(2);
    expect(subscriptions[1]!.signal.aborted).toBe(true);
    expect(wait).toHaveBeenCalledOnce();
    repair.resolve();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(subscriptions.map(({ at }) => at)).toEqual([0, 1_000, 48_000]);
    expect(wait.mock.calls.map(([delay]) => delay)).toEqual([1_000, 2_000]);
    expect(onReconnect).toHaveBeenCalledTimes(2);
    expect(peakActive()).toBe(1);
  });

  it("drops queued recovery when stopped during snapshot repair", async () => {
    const repair = Promise.withResolvers<void>();
    const { runtime, subscriptions, wait } = fixture([1], () => repair.promise);
    await runtime.connect();
    await vi.advanceTimersByTimeAsync(46_000);
    expect(subscriptions[1]!.signal.aborted).toBe(true);
    runtime.stop();
    repair.resolve();
    await vi.advanceTimersByTimeAsync(90_000);
    expect(runtime.status().phase).toBe("stopped");
    expect(subscriptions).toHaveLength(2);
    expect(wait).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("explicit startup retires hung snapshot repair and fences its late failure", async () => {
    const repair = Promise.withResolvers<void>();
    const { runtime, subscriptions, wait } = fixture([1], () => repair.promise);
    await runtime.connect();
    await vi.advanceTimersByTimeAsync(46_000);
    expect(runtime.status().connected).toBe(false);
    await expect(runtime.connect({ startLocalService: true })).resolves.toMatchObject({
      connected: true,
    });
    expect(subscriptions).toHaveLength(3);
    repair.reject(new Error("retired snapshot repair failed"));
    await vi.advanceTimersByTimeAsync(0);
    expect(runtime.status().connected).toBe(true);
    expect(subscriptions).toHaveLength(3);
    expect(wait).toHaveBeenCalledOnce();
  });
});

describe("OpenCodeRuntimeLifecycle heartbeat recovery", () => {
  const runtimes: OpenCodeRuntimeLifecycle[] = [];
  afterEach(() => {
    for (const runtime of runtimes.splice(0)) runtime.stop();
    vi.useRealTimers();
  });

  function setup() {
    vi.useFakeTimers();
    const subscriptions: { signal: AbortSignal; onActivity?: () => void }[] = [];
    const onReconnect = vi.fn().mockResolvedValue(undefined);
    const stopService = vi.fn();
    const ensureService = vi.fn();
    const runtime = new OpenCodeRuntimeLifecycle({
      adapter: {
        discoverService: vi.fn().mockResolvedValue(discoveredEndpoint),
        ensureService,
        stopService,
        discoverBinary: vi.fn(),
        makeClient: () =>
          streamClient(async function* (input) {
            subscriptions.push(input);
            await waitForAbort(input.signal);
            yield* [];
          }),
        wait: (_ms, signal) =>
          new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, _ms);
            signal.addEventListener(
              "abort",
              () => {
                clearTimeout(timer);
                resolve();
              },
              { once: true },
            );
          }),
        now: () => Date.now(),
      },
      onEvent: vi.fn(),
      onReconnect,
      onStatus: vi.fn(),
    });
    runtimes.push(runtime);
    return { runtime, subscriptions, onReconnect, stopService, ensureService };
  }

  it("reconnects a silent stream and resyncs without restarting the service", async () => {
    const { runtime, subscriptions, onReconnect, stopService, ensureService } = setup();
    await runtime.connect();
    await vi.advanceTimersByTimeAsync(44_999);
    expect(subscriptions[0]!.signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(subscriptions[0]!.signal.aborted).toBe(true);
    expect(runtime.status().phase).toBe("reconnecting");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(subscriptions).toHaveLength(2);
    expect(runtime.streamEpoch()).toBe(2);
    expect(onReconnect).toHaveBeenCalledOnce();
    expect(stopService).not.toHaveBeenCalled();
    expect(ensureService).not.toHaveBeenCalled();
  });

  it("keeps an idle stream healthy when only keepalive bytes arrive", async () => {
    const { runtime, subscriptions, onReconnect } = setup();
    await runtime.connect();
    for (let i = 0; i < 8; i++) {
      await vi.advanceTimersByTimeAsync(15_000);
      subscriptions[0]!.onActivity!();
    }
    expect(subscriptions).toHaveLength(1);
    expect(onReconnect).not.toHaveBeenCalled();
    runtime.stop();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(90_000);
    expect(subscriptions).toHaveLength(1);
  });

  it("only recovers stale foreground streams and coalesces recovery signals", async () => {
    const { runtime, subscriptions, onReconnect } = setup();
    await runtime.connect();
    await vi.advanceTimersByTimeAsync(19_999);
    runtime.recoverEventStream("focus");
    expect(subscriptions[0]!.signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    runtime.recoverEventStream("resume");
    runtime.recoverEventStream("online");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(subscriptions).toHaveLength(2);
    expect(onReconnect).toHaveBeenCalledOnce();
    // A queued activity callback from the old stream cannot keep its replacement alive.
    await vi.advanceTimersByTimeAsync(30_000);
    subscriptions[0]!.onActivity!();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(subscriptions[1]!.signal.aborted).toBe(true);
    runtime.stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(subscriptions).toHaveLength(2);
  });

  it("retries when a replacement stalls during snapshot resync", async () => {
    const { runtime, subscriptions, onReconnect } = setup();
    let finishResync!: () => void;
    onReconnect.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishResync = resolve;
        }),
    );
    await runtime.connect();
    await vi.advanceTimersByTimeAsync(46_000);
    expect(onReconnect).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(45_000);
    expect(subscriptions[1]!.signal.aborted).toBe(true);
    finishResync();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(subscriptions).toHaveLength(3);
    expect(onReconnect).toHaveBeenCalledTimes(2);
    expect(runtime.status().connected).toBe(true);
  });
});

async function waitForAbort(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return;
  await new Promise<void>((resolve) =>
    signal.addEventListener("abort", () => resolve(), { once: true }),
  );
}

function localRuntime(
  overrides: Partial<OpenCodeRuntimeLifecycleAdapter>,
  onStatus: (status: OpenCodeRuntimeStatus) => void = vi.fn(),
): OpenCodeRuntimeLifecycle {
  const adapter: OpenCodeRuntimeLifecycleAdapter = {
    discoverService: vi.fn().mockResolvedValue(undefined),
    ensureService: vi.fn().mockResolvedValue(managedEndpoint),
    stopService: vi.fn().mockResolvedValue(undefined),
    makeClient: vi.fn(() => client(SUPPORTED_OPENCODE_VERSION)),
    discoverBinary: vi.fn().mockResolvedValue({
      path: "/usr/local/bin/opencode2",
      version: SUPPORTED_OPENCODE_VERSION,
    }),
    wait: vi.fn().mockResolvedValue(undefined),
    now: () => 100,
    ...overrides,
  };
  return new OpenCodeRuntimeLifecycle({
    adapter,
    onEvent: vi.fn(),
    onReconnect: vi.fn().mockResolvedValue(undefined),
    onStatus,
  });
}
