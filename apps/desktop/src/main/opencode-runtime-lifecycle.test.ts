// @vitest-environment node

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import { promisify } from "node:util";
import type { OpenCodeClient, OpenCodeEvent } from "@opencode/client";
import type { Endpoint } from "@opencode/client/service";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenCodeRuntimeStatus, OpenCodeVersionMismatch } from "../shared/opencode-contract";
import { SUPPORTED_OPENCODE_VERSION } from "./opencode-version";
import {
  OpenCodeRuntimeLifecycle,
  discoverBundledOpenCodeBinary,
  exemptLoopbackFromEnvironmentProxy,
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
      const binary = { path: "/palot/resources/opencode/opencode2", version: "2.0.7" };
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
    server: { info: vi.fn().mockResolvedValue({ version, pid, urls: [], paths: { tmp: "/tmp" } }) },
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
    adapter,
  };
}

describe("login service lifecycle routing", () => {
  it("keeps normal connections read-only and routes explicit restart through the OS manager", async () => {
    const { runtime, adapter } = lifecycle({ discoveredVersion: "2.0.7" });
    adapter.controlLoginService = vi.fn().mockResolvedValue(managedEndpoint);
    await runtime.connect();
    expect(adapter.controlLoginService).not.toHaveBeenCalled();
    await runtime.restartLocalService();
    expect(adapter.controlLoginService).toHaveBeenCalledWith("restart", expect.any(Object));
    expect(adapter.stopService).not.toHaveBeenCalled();
    expect(adapter.ensureService).not.toHaveBeenCalled();
    expect(runtime.status()).toMatchObject({ connected: true, pid: 84 });
    await runtime.stop();
  });

  it("uses the OS manager for confirmed startup but never as recovery", async () => {
    const { runtime, adapter } = lifecycle({ discoveredVersion: "2.0.7" });
    vi.mocked(adapter.discoverService).mockResolvedValue(undefined);
    adapter.controlLoginService = vi.fn().mockResolvedValue(managedEndpoint);
    await expect(runtime.connect()).rejects.toThrow("No reachable local");
    expect(adapter.controlLoginService).not.toHaveBeenCalled();
    await runtime.connect({ startLocalService: true });
    expect(adapter.controlLoginService).toHaveBeenCalledWith("start", expect.any(Object));
    expect(adapter.ensureService).not.toHaveBeenCalled();
    await runtime.stop();
  });

  it("does not bypass a manager conflict with an SDK stop or spawn", async () => {
    const { runtime, adapter } = lifecycle({ discoveredVersion: "2.0.7" });
    adapter.controlLoginService = vi.fn().mockRejectedValue(new Error("Different login binary"));
    await runtime.connect();
    await expect(runtime.restartLocalService()).rejects.toThrow("Different login binary");
    expect(adapter.stopService).not.toHaveBeenCalled();
    expect(adapter.ensureService).not.toHaveBeenCalled();
    await runtime.stop();
  });
});

describe("OpenCodeRuntimeLifecycle version mismatch", () => {
  it.each(["2.0.0", "2.0.3", "2.0.6"])(
    "refuses incompatible stable %s even with explicit continuation",
    async (version) => {
      const { runtime, adapter } = lifecycle({ discoveredVersion: version, allowed: true });
      await expect(
        runtime.connect({ versionMismatch: "continue", approvedVersion: version }),
      ).rejects.toThrow("not supported");
      expect(runtime.status().versionMismatch?.canContinue).toBe(false);
      expect(adapter.ensureService).not.toHaveBeenCalled();
      expect(adapter.stopService).not.toHaveBeenCalled();
      await runtime.stop();
    },
  );
  it.each(["2.0.7", "2.0.8", "2.1.0"])(
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

  it("requires fresh consent for the beta reviewed against an older contract", async () => {
    const { runtime, ensureService } = lifecycle({ discoveredVersion: "0.0.0-beta-19507" });
    await expect(runtime.connect()).rejects.toThrow("does not match");
    expect(runtime.status().versionMismatch).toMatchObject({
      detectedVersion: "0.0.0-beta-19507",
      canContinue: true,
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
    vi.mocked(changingClient.server.info)
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
      version: "2.0.7",
    });
    const ensureService = vi.fn().mockResolvedValue(managedEndpoint);
    const runtime = new OpenCodeRuntimeLifecycle({
      discoverLocalBinary,
      adapter: {
        discoverService: vi.fn().mockResolvedValue(undefined),
        ensureService,
        stopService: vi.fn(),
        makeClient: () => client("2.0.7"),
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
    // Keep the background service watch asleep so only the two connects discover.
    const runtime = localRuntime({ discoverService, ensureService, discoverBinary, wait: asleep });
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

  it("connects by itself once a missing local service appears", async () => {
    const discoverService = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValue(discoveredEndpoint);
    const ensureService = vi.fn();
    const statuses: OpenCodeRuntimeStatus[] = [];
    const runtime = localRuntime({ discoverService, ensureService }, (status) =>
      statuses.push(status),
    );
    await expect(runtime.connect()).rejects.toThrow("No reachable");
    await vi.waitFor(() => expect(runtime.status().connected).toBe(true));
    // The watch only discovers; it never starts a service on its own.
    expect(ensureService).not.toHaveBeenCalled();
    // One error for the failed connect; the empty probe in between stays silent.
    expect(statuses.filter((status) => status.phase === "error")).toHaveLength(1);
    await runtime.stop();
  });

  it("ignores a registered service that does not answer", async () => {
    const dead = {
      server: { info: vi.fn().mockRejectedValue(new Error("connection refused")) },
    } as unknown as OpenCodeClient;
    const discoverService = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValue(discoveredEndpoint);
    let probes = 0;
    const wait = vi.fn((_ms: number, signal: AbortSignal) =>
      ++probes <= 3 ? Promise.resolve() : asleep(_ms, signal),
    );
    const statuses: OpenCodeRuntimeStatus[] = [];
    const runtime = localRuntime(
      { discoverService, makeClient: vi.fn(() => dead), wait },
      (status) => statuses.push(status),
    );
    await expect(runtime.connect()).rejects.toThrow("No reachable");
    const afterConnect = statuses.length;
    await vi.waitFor(() => expect(wait).toHaveBeenCalledTimes(4));
    expect(dead.server.info).toHaveBeenCalledTimes(3);
    expect(statuses).toHaveLength(afterConnect);
    await runtime.stop();
  });

  it("stops watching for a local service when the connection is stopped", async () => {
    const discoverService = vi.fn().mockResolvedValue(undefined);
    let release: (() => void) | undefined;
    const wait = vi.fn(
      (_ms: number, signal: AbortSignal) =>
        new Promise<void>((resolve, reject) => {
          release = resolve;
          signal.addEventListener("abort", () => reject(signal.reason));
        }),
    );
    const runtime = localRuntime({ discoverService, wait });
    await expect(runtime.connect()).rejects.toThrow("No reachable");
    await vi.waitFor(() => expect(wait).toHaveBeenCalledTimes(1));
    await runtime.stop();
    release?.();
    await Promise.resolve();
    expect(discoverService).toHaveBeenCalledTimes(1);
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
      if (!healthy) vi.mocked(api.server.info).mockRejectedValue(new Error("offline"));
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
    vi.mocked(api.server.info).mockRejectedValue(new Error("offline"));
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
    vi.mocked(api.server.info).mockRejectedValue(new Error("offline"));
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
    server: {
      info: vi.fn().mockResolvedValue({
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

  function fixture(failures: number[] = [], repair?: () => Promise<void>, silent: number[] = []) {
    const subscriptions: Array<{ signal: AbortSignal; activity(): void; at: number }> = [];
    let active = 0;
    let peakActive = 0;
    const api = streamClient(async function* ({ signal, onActivity }) {
      subscriptions.push({ signal, activity: () => onActivity?.(), at: Date.now() });
      active += 1;
      peakActive = Math.max(peakActive, active);
      try {
        if (failures.includes(subscriptions.length)) throw new Error("subscribe failed");
        if (!silent.includes(subscriptions.length)) yield connectedEvent();
        await waitForAbort(signal);
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

  it("fails a subscription that never confirms server.connected even while heartbeats arrive", async () => {
    const { runtime, subscriptions, wait, onReconnect } = fixture([], undefined, [1]);
    await runtime.connect();
    await vi.advanceTimersByTimeAsync(15_000);
    subscriptions[0]!.activity();
    await vi.advanceTimersByTimeAsync(4_999);
    expect(subscriptions[0]!.signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(subscriptions[0]!.signal.aborted).toBe(true);
    expect(runtime.status()).toMatchObject({
      connected: false,
      error: "OpenCode event stream did not confirm its subscription",
    });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(subscriptions.map(({ at }) => at)).toEqual([0, 21_000]);
    expect(wait.mock.calls.map(([delay]) => delay)).toEqual([1_000]);
    expect(onReconnect).toHaveBeenCalledOnce();
    // The confirmed replacement is only bounded by the heartbeat watchdog.
    await vi.advanceTimersByTimeAsync(30_000);
    expect(subscriptions).toHaveLength(2);
    expect(runtime.status().connected).toBe(true);
  });

  it("keeps escalating backoff across replacements that fail before proving stable", async () => {
    const { runtime, subscriptions, wait, onReconnect } = fixture([], undefined, [2, 3, 4]);
    await runtime.connect();
    // Stream 1 is confirmed, then goes silent: a long-lived stream restarts at 1s.
    await vi.advanceTimersByTimeAsync(46_000);
    expect(subscriptions.map(({ at }) => at)).toEqual([0, 46_000]);
    // Streams 2-4 never confirm. Each successful re-establish would otherwise reset to
    // 1s and resync snapshots every ~21s; the delay keeps doubling instead.
    await vi.advanceTimersByTimeAsync(20_000 + 2_000 + 20_000 + 4_000 + 20_000 + 8_000);
    expect(subscriptions.map(({ at }) => at)).toEqual([0, 46_000, 68_000, 92_000, 120_000]);
    expect(wait.mock.calls.map(([delay]) => delay)).toEqual([1_000, 2_000, 4_000, 8_000]);
    expect(onReconnect).toHaveBeenCalledTimes(4);
    // Stream 5 confirms and lives past the stable threshold, so the next stall restarts at 1s.
    await vi.advanceTimersByTimeAsync(45_000 + 1_000);
    expect(subscriptions.at(-1)!.at).toBe(166_000);
    expect(wait.mock.calls.at(-1)![0]).toBe(1_000);
    expect(runtime.status().connected).toBe(true);
  });

  it("backs off up to 30s from a server that confirms each stream and closes it at once", async () => {
    let opened = 0;
    const api = streamClient(async function* () {
      opened += 1;
      yield connectedEvent();
    });
    const wait = vi.fn(openCodeRuntimeLifecycleAdapter.wait);
    const onReconnect = vi.fn(async () => {});
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
    await runtime.connect();
    // Each reconnect succeeds and its stream confirms, but none stays up long enough to count.
    await vi.advanceTimersByTimeAsync(1_000 + 2_000 + 4_000 + 8_000 + 16_000 + 30_000 + 30_000);
    expect(wait.mock.calls.map(([delay]) => delay)).toEqual([
      1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000, 30_000,
    ]);
    expect(opened).toBe(8);
    expect(runtime.status()).toMatchObject({
      phase: "reconnecting",
      error: "OpenCode event stream closed",
    });
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
            yield connectedEvent();
            await waitForAbort(input.signal);
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

function connectedEvent(): OpenCodeEvent {
  return { id: `connected-${Date.now()}`, type: "server.connected", data: {} } as OpenCodeEvent;
}

async function waitForAbort(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return;
  await new Promise<void>((resolve) =>
    signal.addEventListener("abort", () => resolve(), { once: true }),
  );
}

/** An adapter `wait` that only ends when its signal aborts. */
function asleep(_milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason));
  });
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

describe("local service traffic with an environment proxy", () => {
  it("merges loopback hosts into NO_PROXY only when Node's environment proxy is on", () => {
    const off: NodeJS.ProcessEnv = { HTTP_PROXY: "http://proxy.test", NO_PROXY: "corp.internal" };
    exemptLoopbackFromEnvironmentProxy(off, []);
    expect(off).toEqual({ HTTP_PROXY: "http://proxy.test", NO_PROXY: "corp.internal" });

    const merged = "corp.internal,LOCALHOST,other.internal,127.0.0.1,::1,[::1]";
    const on: NodeJS.ProcessEnv = {
      NODE_USE_ENV_PROXY: "1",
      NO_PROXY: "corp.internal, LOCALHOST",
      no_proxy: "other.internal,",
    };
    exemptLoopbackFromEnvironmentProxy(on, []);
    expect(on).toMatchObject({ NO_PROXY: merged, no_proxy: merged });

    const loopback = "127.0.0.1,localhost,::1,[::1]";
    for (const [env, execArgv] of [
      [{ NODE_OPTIONS: "--max-old-space-size=4096 --use-env-proxy" }, []],
      [{}, ["--use-env-proxy"]],
    ] as const) {
      const target: NodeJS.ProcessEnv = { ...env };
      exemptLoopbackFromEnvironmentProxy(target, execArgv);
      expect(target).toMatchObject({ NO_PROXY: loopback, no_proxy: loopback });
    }

    const wildcard: NodeJS.ProcessEnv = { NODE_USE_ENV_PROXY: "1", no_proxy: "corp.internal,*" };
    exemptLoopbackFromEnvironmentProxy(wildcard, []);
    expect(wildcard).toMatchObject({ NO_PROXY: "*", no_proxy: "*" });
  });

  it("keeps client and WebSocket traffic to a loopback service off the proxy", async () => {
    const proxied: string[] = [];
    const proxy = createServer((request, response) => {
      proxied.push(`${request.method} ${request.url}`);
      response.writeHead(502).end();
    }).on("connect", (request, socket) => {
      proxied.push(`CONNECT ${request.url}`);
      socket.end("HTTP/1.1 502 Bad Gateway\r\n\r\n");
    });
    const service = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ version: SUPPORTED_OPENCODE_VERSION, pid: 1, urls: [] }));
    }).on("upgrade", (request, socket) => {
      const accept = createHash("sha1")
        .update(`${request.headers["sec-websocket-key"]}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
        .digest("base64");
      socket.end(
        `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
      );
    });
    const listen = (server: Server, host: string) =>
      new Promise<number>((resolve) =>
        server.listen(0, host, () => resolve((server.address() as { port: number }).port)),
      );
    const proxyUrl = `http://127.0.0.1:${await listen(proxy, "127.0.0.1")}`;
    const port = await listen(service, "::");
    try {
      const proxyEnv = {
        NODE_USE_ENV_PROXY: "1",
        ...Object.fromEntries(
          ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY"].flatMap((key) => [
            [key, proxyUrl],
            [key.toLowerCase(), proxyUrl],
          ]),
        ),
        NO_PROXY: "",
        no_proxy: "",
      };
      const exempted: NodeJS.ProcessEnv = { ...proxyEnv };
      exemptLoopbackFromEnvironmentProxy(exempted, []);
      // Node reads NODE_USE_ENV_PROXY only at startup, so a child process stands in for Electron's
      // main process. It applies the merged NO_PROXY after startup, as connect() does.
      const script = `
        const { OpenCode } = await import("@opencode/client");
        const probe = () => Promise.all(JSON.parse(process.env.TEST_SERVICES).map(async (baseUrl) => [
          await OpenCode.make({ baseUrl, fetch: (input, init) => globalThis.fetch(input, init) })
            .server.info().then(() => "ok", () => "proxied"),
          await new Promise((resolve) => {
            const socket = new WebSocket(baseUrl.replace("http", "ws"));
            socket.onopen = () => { socket.close(); resolve("ok"); };
            socket.onerror = () => resolve("proxied");
          }),
        ]));
        const before = await probe();
        process.env.NO_PROXY = process.env.no_proxy = process.env.TEST_NO_PROXY;
        console.log(JSON.stringify({ before, after: await probe() }));`;
      const inherited = Object.entries(process.env).filter(
        ([key]) => !/(_proxy|^node_options)$/i.test(key),
      );
      const { stdout } = await promisify(execFile)(
        process.execPath,
        ["--input-type=module", "-e", script],
        {
          env: {
            ...Object.fromEntries(inherited),
            ...proxyEnv,
            TEST_NO_PROXY: exempted.NO_PROXY,
            TEST_SERVICES: JSON.stringify(
              ["127.0.0.1", "localhost", "[::1]"].map((host) => `http://${host}:${port}`),
            ),
          },
        },
      );
      const result = JSON.parse(stdout) as { before: string[][]; after: string[][] };
      // Control: without the exemption the proxy receives every loopback request.
      expect(result.before.flat()).toEqual(Array(6).fill("proxied"));
      const proxiedBefore = proxied.length;
      expect(proxiedBefore).toBeGreaterThan(0);
      expect(result.after.flat()).toEqual(Array(6).fill("ok"));
      expect(proxied).toHaveLength(proxiedBefore);
    } finally {
      proxy.close();
      service.close();
    }
  }, 20_000);
});
