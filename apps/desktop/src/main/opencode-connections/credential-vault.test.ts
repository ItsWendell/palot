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
  available: () => true,
  weak: () => false,
  encrypt: (value: string) => Buffer.from(`encrypted:${value}`),
  decrypt: (value: Buffer) => value.toString().replace(/^encrypted:/, ""),
};

describe("OpenCodeCredentialVault", () => {
  it("stores encrypted credentials and resolves only connection headers", () => {
    const store = new MemoryStore();
    const vault = new OpenCodeCredentialVault(store, encryption);
    const id = vault.storeCredential({ type: "basic", username: "opencode", password: "secret" });

    expect(id).toEqual(expect.any(String));
    expect(Object.values(store.credentials)[0]).not.toContain("secret");
    expect(vault.headers(id)).toEqual({
      authorization: `Basic ${Buffer.from("opencode:secret").toString("base64")}`,
    });
  });

  it("replaces and deletes the previous encrypted record", () => {
    const store = new MemoryStore();
    const vault = new OpenCodeCredentialVault(store, encryption);
    const first = vault.storeCredential({ type: "bearer", token: "first" });
    const second = vault.replace(first, { type: "bearer", token: "second" });

    expect(first && store.credentials[first]).toBeUndefined();
    expect(vault.headers(second)).toEqual({ authorization: "Bearer second" });
    if (second) vault.delete(second);
    expect(store.credentials).toEqual({});
  });

  it("fails closed when secure storage is unavailable", () => {
    const vault = new OpenCodeCredentialVault(new MemoryStore(), {
      ...encryption,
      available: () => false,
    });

    expect(() => vault.storeCredential({ type: "bearer", token: "secret" })).toThrow(
      "Secure credential storage is unavailable",
    );
  });

  function safeStorage(backend: string) {
    return {
      isEncryptionAvailable: () => true,
      getSelectedStorageBackend: () => backend as "basic_text",
      encryptString: (value: string) => Buffer.from(`encrypted:${value}`),
      decryptString: (value: Buffer) => value.toString().replace(/^encrypted:/, ""),
    };
  }

  it("reports Linux basic_text as weak and keeps saving and reading", () => {
    const store = new MemoryStore();
    const earlier = new OpenCodeCredentialVault(store, encryption).storeCredential({
      type: "bearer",
      token: "earlier",
    });
    const vault = new OpenCodeCredentialVault(
      store,
      safeStorageEncryption(safeStorage("basic_text"), "linux"),
    );

    expect(vault.protection()).toBe("basic-text");
    expect(vault.headers(earlier)).toEqual({ authorization: "Bearer earlier" });
    const saved = vault.storeCredential({ type: "bearer", token: "later" });
    expect(vault.headers(saved)).toEqual({ authorization: "Bearer later" });
  });

  it.each([
    ["linux", "gnome_libsecret"],
    ["linux", "kwallet6"],
    ["darwin", "basic_text"],
    ["win32", "basic_text"],
  ] as const)("reports %s with %s as encrypted", (platform, backend) => {
    const vault = new OpenCodeCredentialVault(
      new MemoryStore(),
      safeStorageEncryption(safeStorage(backend), platform),
    );
    expect(vault.protection()).toBe("encrypted");
  });
});
