// @vitest-environment node
import { expect, it, vi } from "vitest";
import type { OpenCodeProfile, OpenCodeRuntimeStatus } from "../shared/opencode-contract";

vi.mock("electron", () => ({ BrowserWindow: { getAllWindows: () => [] } }));
vi.mock("electron-store", () => ({
  default: class {
    private readonly values: Map<string, unknown>;
    constructor(options: { defaults?: Record<string, unknown> } = {}) {
      this.values = new Map(Object.entries(options.defaults ?? {}));
    }
    get(key: string) {
      return this.values.get(key);
    }
    set(key: string, value: unknown) {
      this.values.set(key, value);
    }
    delete(key: string) {
      this.values.delete(key);
    }
  },
}));
vi.mock("./opencode-observability", () => ({
  openCodeLog: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("./opencode-connections/credential-vault", () => ({
  OpenCodeCredentialVault: class {
    headers() {
      return undefined;
    }
  },
}));
vi.mock("./opencode-release-manager", () => ({ getOpenCodeReleaseManager: vi.fn() }));
vi.mock("./opencode-local-installations", () => ({ getOpenCodeInstallations: vi.fn() }));
// Stands in for the real lifecycle: once stopped, it refuses to connect like the real one does.
vi.mock("./opencode-runtime-lifecycle", () => {
  let next = 0;
  return {
    OpenCodeRuntimeLifecycle: class {
      readonly connectionID = `connection-${++next}`;
      readonly contractVersion = "test";
      readonly profileID: string;
      private stopped = false;
      private connected = false;
      constructor(options: { profile: OpenCodeProfile }) {
        this.profileID = options.profile.id;
      }
      status(): OpenCodeRuntimeStatus {
        return {
          profileID: this.profileID,
          connectionID: this.connectionID,
          connected: this.connected,
          phase: this.connected ? "connected" : "stopped",
        } as OpenCodeRuntimeStatus;
      }
      streamEpoch() {
        return 0;
      }
      async connect() {
        if (this.stopped) throw new Error("OpenCode connection has been disposed");
        this.connected = true;
        return this.status();
      }
      async client() {
        if (this.stopped) throw new Error("OpenCode connection has been disposed");
        return {};
      }
      async requestConnection() {
        if (this.stopped) throw new Error("OpenCode connection has been disposed");
        return { endpoint: { url: "http://127.0.0.1:4096" }, headers: undefined };
      }
      async stop() {
        this.stopped = true;
        this.connected = false;
      }
    },
  };
});

import { OpenCodeRuntime } from "./opencode-runtime";

it("keeps a disconnected focused profile disabled until the user starts it", async () => {
  const runtime = new OpenCodeRuntime();
  const first = await runtime.connect();
  await runtime.disconnectProfile(first.profileID);

  // Background callers (tray, notifications, agent tools) must not bring it back.
  await expect(runtime.withClient(async () => "ok")).rejects.toThrow("disposed");
  await expect(runtime.requestConnection()).rejects.toThrow("disposed");
  await expect(runtime.connect()).rejects.toThrow("disposed");
  expect(runtime.listRuntimes()).toEqual([]);

  const status = await runtime.connect({ startLocalService: true });

  expect(status).toMatchObject({ profileID: first.profileID, connected: true });
  expect(status.connectionID).not.toBe(first.connectionID);
  expect(runtime.listRuntimes().map((item) => item.connectionID)).toEqual([status.connectionID]);
  await expect(runtime.withClient(async () => "ok")).resolves.toBe("ok");
  await runtime.shutdown();
});
