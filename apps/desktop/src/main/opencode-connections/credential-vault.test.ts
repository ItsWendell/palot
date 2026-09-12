// @vitest-environment node

import { describe, expect, it } from "vitest";
import { OpenCodeCredentialVault } from "./credential-vault";

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
});
