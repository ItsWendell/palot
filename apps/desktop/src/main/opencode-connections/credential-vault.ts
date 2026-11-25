import { randomUUID } from "node:crypto";
import { safeStorage } from "electron";
import log from "electron-log/main";
import Store from "electron-store";
import type { OpenCodeCredentialInput, OpenCodeCredentialProtection } from "../../shared";
import { WEAK_CREDENTIAL_STORAGE_MESSAGE } from "../../shared/opencode-contract";

interface CredentialStore {
  credentials: Record<string, string>;
}

interface CredentialStoreBackend {
  get(key: "credentials"): Record<string, string>;
  set(key: "credentials", value: Record<string, string>): void;
}

interface EncryptionAdapter {
  available(): boolean;
  /** The backend only obfuscates values with a fixed key, so anyone who can read the file can read them. */
  weak(): boolean;
  encrypt(value: string): Buffer;
  decrypt(value: Buffer): string;
}

type SafeStorage = Pick<
  Electron.SafeStorage,
  "isEncryptionAvailable" | "encryptString" | "decryptString" | "getSelectedStorageBackend"
>;

export type CredentialProtection = OpenCodeCredentialProtection;
export { WEAK_CREDENTIAL_STORAGE_MESSAGE };

export function safeStorageEncryption(
  storage: SafeStorage,
  platform: NodeJS.Platform = process.platform,
): EncryptionAdapter {
  return {
    available: () => storage.isEncryptionAvailable(),
    weak: () => platform === "linux" && storage.getSelectedStorageBackend() === "basic_text",
    encrypt: (value) => storage.encryptString(value),
    decrypt: (value) => storage.decryptString(value),
  };
}

/** The request headers a credential becomes, without storing it. */
export function credentialHeaders(
  credential: OpenCodeCredentialInput,
): Record<string, string> | undefined {
  if (credential.type === "basic") {
    return {
      authorization: `Basic ${Buffer.from(`${credential.username}:${credential.password}`).toString("base64")}`,
    };
  }
  if (credential.type === "bearer") return { authorization: `Bearer ${credential.token}` };
  if (credential.type === "headers") return { ...credential.headers };
  return undefined;
}

export class OpenCodeCredentialVault {
  private readonly store: CredentialStoreBackend;

  constructor(
    store?: CredentialStoreBackend,
    private readonly encryption: EncryptionAdapter = safeStorageEncryption(safeStorage),
  ) {
    this.store =
      store ??
      new Store<CredentialStore>({
        name: "opencode-credentials",
        cwd: process.env.PALOT_E2E_USER_DATA ?? process.env.PALOT_RELEASE_SMOKE_USER_DATA,
        defaults: { credentials: {} },
        configFileMode: 0o600,
      });
  }

  /**
   * Remote OpenCode servers that need a password can only be reached through a saved
   * credential, so `basic-text` still saves; settings can show this to warn the user.
   */
  protection(): CredentialProtection {
    if (!this.encryption.available()) return "unavailable";
    return this.encryption.weak() ? "basic-text" : "encrypted";
  }

  storeCredential(input: OpenCodeCredentialInput): string | null {
    if (input.type === "none") return null;
    if (!this.encryption.available()) throw new Error("Secure credential storage is unavailable");
    if (this.encryption.weak()) log.warn(WEAK_CREDENTIAL_STORAGE_MESSAGE);
    const id = randomUUID();
    const encrypted = this.encryption.encrypt(JSON.stringify(input)).toString("base64");
    this.store.set("credentials", { ...this.store.get("credentials"), [id]: encrypted });
    return id;
  }

  replace(previousID: string | null, input: OpenCodeCredentialInput): string | null {
    const nextID = this.storeCredential(input);
    if (previousID) this.delete(previousID);
    return nextID;
  }

  delete(credentialID: string): void {
    const credentials = { ...this.store.get("credentials") };
    delete credentials[credentialID];
    this.store.set("credentials", credentials);
  }

  headers(credentialID: string | null): Record<string, string> | undefined {
    if (!credentialID) return undefined;
    if (!this.encryption.available()) throw new Error("Secure credential storage is unavailable");
    const encoded = this.store.get("credentials")[credentialID];
    if (!encoded) throw new Error("OpenCode credentials were not found");
    const credential = JSON.parse(
      this.encryption.decrypt(Buffer.from(encoded, "base64")),
    ) as OpenCodeCredentialInput;
    return credentialHeaders(credential);
  }

  basic(credentialID: string | null): { username: string; password: string } | null {
    if (!credentialID) return null;
    const encoded = this.store.get("credentials")[credentialID];
    if (!encoded || !this.encryption.available()) return null;
    const credential = JSON.parse(
      this.encryption.decrypt(Buffer.from(encoded, "base64")),
    ) as OpenCodeCredentialInput;
    return credential.type === "basic"
      ? { username: credential.username, password: credential.password }
      : null;
  }
}
