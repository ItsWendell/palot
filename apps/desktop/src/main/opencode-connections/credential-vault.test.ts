// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { OpenCodeCredentialVault, safeStorageEncryption } from "./credential-vault";

vi.mock("electron-log/main", () => ({ default: { warn: vi.fn() } }));

class MemoryStore {
  readonly credentials: Record<string, string> = {};

  get(): Record<string, string> {
    return this.credentials;
  }

  set(_key: "credentials", value: Record<string, string>): void {
    for (const key of Object.keys(this.credentials)) delete this.credentials[key];
    Object.assign(this.credentials, value);
  }
}

const encryption = {
  available: async () => true,
  weak: () => false,
  encrypt: async (value: string) => Buffer.from(`encrypted:${value}`),
  decrypt: async (value: Buffer) => value.toString().replace(/^encrypted:/, ""),
};

/** Electron's safeStorage, where the deprecated sync and the async API share one format. */
function safeStorage(backend = "gnome_libsecret") {
  const encode = (value: string) => Buffer.from(`encrypted:${value}`);
  const decode = (value: Buffer) => value.toString().replace(/^encrypted:/, "");
  return {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: vi.fn(encode),
    decryptString: vi.fn(decode),
    isAsyncEncryptionAvailable: vi.fn(async () => true),
    encryptStringAsync: vi.fn(async (value: string) => encode(value)),
    decryptStringAsync: vi.fn(async (value: Buffer) => ({
      result: decode(value),
      shouldReEncrypt: false,
    })),
    getSelectedStorageBackend: vi.fn(() => backend as "basic_text"),
  };
}

describe("OpenCodeCredentialVault", () => {
  it("stores encrypted credentials and resolves only connection headers", async () => {
    const store = new MemoryStore();
    const vault = new OpenCodeCredentialVault(store, encryption);
    const id = await vault.storeCredential({
      type: "basic",
      username: "opencode",
      password: "secret",
    });

    expect(id).toEqual(expect.any(String));
    expect(Object.values(store.credentials)[0]).not.toContain("secret");
    expect(await vault.headers(id)).toEqual({
      authorization: `Basic ${Buffer.from("opencode:secret").toString("base64")}`,
    });
  });

  it("replaces and deletes the previous encrypted record", async () => {
    const store = new MemoryStore();
    const vault = new OpenCodeCredentialVault(store, encryption);
    const first = await vault.storeCredential({ type: "bearer", token: "first" });
    const second = await vault.replace(first, { type: "bearer", token: "second" });

    expect(first && store.credentials[first]).toBeUndefined();
    expect(await vault.headers(second)).toEqual({ authorization: "Bearer second" });
    if (second) vault.delete(second);
    expect(store.credentials).toEqual({});
  });

  it("fails closed when secure storage is unavailable", async () => {
    const vault = new OpenCodeCredentialVault(new MemoryStore(), {
      ...encryption,
      available: async () => false,
    });

    await expect(vault.storeCredential({ type: "bearer", token: "secret" })).rejects.toThrow(
      "Secure credential storage is unavailable",
    );
  });

  it("round-trips through the async safeStorage API without the deprecated sync calls", async () => {
    const storage = safeStorage();
    const vault = new OpenCodeCredentialVault(
      new MemoryStore(),
      safeStorageEncryption(storage, "darwin"),
    );

    const id = await vault.storeCredential({ type: "bearer", token: "secret" });
    expect(await vault.headers(id)).toEqual({ authorization: "Bearer secret" });
    expect(await vault.protection()).toBe("encrypted");
    expect(storage.encryptStringAsync).toHaveBeenCalledOnce();
    expect(storage.decryptStringAsync).toHaveBeenCalledOnce();
    expect(storage.isEncryptionAvailable).not.toHaveBeenCalled();
    expect(storage.encryptString).not.toHaveBeenCalled();
    expect(storage.decryptString).not.toHaveBeenCalled();
  });

  it("reads credentials saved by earlier versions with encryptString", async () => {
    const storage = safeStorage();
    const store = new MemoryStore();
    store.set("credentials", {
      legacy: storage
        .encryptString(JSON.stringify({ type: "bearer", token: "earlier" }))
        .toString("base64"),
    });
    const vault = new OpenCodeCredentialVault(store, safeStorageEncryption(storage, "darwin"));

    expect(await vault.headers("legacy")).toEqual({ authorization: "Bearer earlier" });
  });

  it("does not touch secure storage until a credential is saved or read", async () => {
    const storage = safeStorage();
    const vault = new OpenCodeCredentialVault(
      new MemoryStore(),
      safeStorageEncryption(storage, "darwin"),
    );

    expect(await vault.headers(null)).toBeUndefined();
    expect(await vault.storeCredential({ type: "none" })).toBeNull();
    for (const call of Object.values(storage)) expect(call).not.toHaveBeenCalled();
  });

  it("reports Linux basic_text as weak and keeps saving and reading", async () => {
    const store = new MemoryStore();
    const earlier = await new OpenCodeCredentialVault(store, encryption).storeCredential({
      type: "bearer",
      token: "earlier",
    });
    const vault = new OpenCodeCredentialVault(
      store,
      safeStorageEncryption(safeStorage("basic_text"), "linux"),
    );

    expect(await vault.protection()).toBe("basic-text");
    expect(await vault.headers(earlier)).toEqual({ authorization: "Bearer earlier" });
    const saved = await vault.storeCredential({ type: "bearer", token: "later" });
    expect(await vault.headers(saved)).toEqual({ authorization: "Bearer later" });
  });

  it.each([
    ["linux", "gnome_libsecret"],
    ["linux", "kwallet6"],
    ["darwin", "basic_text"],
    ["win32", "basic_text"],
  ] as const)("reports %s with %s as encrypted", async (platform, backend) => {
    const vault = new OpenCodeCredentialVault(
      new MemoryStore(),
      safeStorageEncryption(safeStorage(backend), platform),
    );
    expect(await vault.protection()).toBe("encrypted");
  });
});
