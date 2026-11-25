// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Any safeStorage call can raise a macOS Keychain prompt, so startup paths must make none.
const { safeStorage } = vi.hoisted(() => ({
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: vi.fn(),
    decryptString: vi.fn(),
    isAsyncEncryptionAvailable: vi.fn(async () => true),
    encryptStringAsync: vi.fn(async (value: string) => Buffer.from(value)),
    decryptStringAsync: vi.fn(async (value: Buffer) => ({
      result: value.toString(),
      shouldReEncrypt: false,
    })),
    getSelectedStorageBackend: vi.fn(() => "gnome_libsecret"),
  },
}));

vi.mock("electron", () => ({
  app: { isPackaged: false },
  safeStorage,
  BrowserWindow: { getAllWindows: () => [] },
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

let runtime: typeof import("./opencode-runtime").openCodeRuntime;

beforeEach(async () => {
  vi.resetModules();
  vi.stubEnv("PALOT_CONNECTION_PROFILE_ID", "");
  for (const call of Object.values(safeStorage)) call.mockClear();
  runtime = (await import("./opencode-runtime")).openCodeRuntime;
});

afterEach(async () => {
  await runtime.shutdown();
  vi.unstubAllEnvs();
});

describe("OpenCode runtime keychain access", () => {
  it("lists profiles at startup without touching safeStorage", () => {
    // The profilesList IPC handler returns exactly this snapshot.
    expect(runtime.profileSnapshot().profiles.length).toBeGreaterThan(0);
    for (const call of Object.values(safeStorage)) expect(call).not.toHaveBeenCalled();
  });

  it("reports credential protection on request through the async API only", async () => {
    expect(await runtime.credentialProtection()).toBe("encrypted");
    expect(safeStorage.isAsyncEncryptionAvailable).toHaveBeenCalledOnce();
    expect(safeStorage.isEncryptionAvailable).not.toHaveBeenCalled();
  });
});
