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

/**
 * On macOS the first use of safeStorage reads "Palot Safe Storage" from the Keychain, which can
 * raise a system prompt. Only the async API keeps that wait off the main thread, so the vault
 * touches storage only when a credential is saved or read, or settings ask for its protection.
 */
interface EncryptionAdapter {
  available(): Promise<boolean>;
  /** The backend only obfuscates values with a fixed key, so anyone who can read the file can read them. */
  weak(): boolean;
  encrypt(value: string): Promise<Buffer>;
  decrypt(value: Buffer): Promise<string>;
}

type SafeStorage = Pick<
  Electron.SafeStorage,
  | "isAsyncEncryptionAvailable"
  | "encryptStringAsync"
  | "decryptStringAsync"
  | "getSelectedStorageBackend"
>;

export type CredentialProtection = OpenCodeCredentialProtection;
export { WEAK_CREDENTIAL_STORAGE_MESSAGE };

export function safeStorageEncryption(
  storage: SafeStorage,
  platform: NodeJS.Platform = process.platform,
): EncryptionAdapter {
  return {
    available: () => storage.isAsyncEncryptionAvailable(),
    weak: () => platform === "linux" && storage.getSelectedStorageBackend() === "basic_text",
    encrypt: (value) => storage.encryptStringAsync(value),
    // Values written by the deprecated encryptString decrypt here too.
    decrypt: async (value) => (await storage.decryptStringAsync(value)).result,
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
  async protection(): Promise<CredentialProtection> {
    if (!(await this.encryption.available())) return "unavailable";
    return this.encryption.weak() ? "basic-text" : "encrypted";
  }

  async storeCredential(input: OpenCodeCredentialInput): Promise<string | null> {
    if (input.type === "none") return null;
    if (!(await this.encryption.available()))
      throw new Error("Secure credential storage is unavailable");
    if (this.encryption.weak()) log.warn(WEAK_CREDENTIAL_STORAGE_MESSAGE);
    const id = randomUUID();
    const encrypted = (await this.encryption.encrypt(JSON.stringify(input))).toString("base64");
    this.store.set("credentials", { ...this.store.get("credentials"), [id]: encrypted });
    return id;
  }

  async replace(previousID: string | null, input: OpenCodeCredentialInput): Promise<string | null> {
    const nextID = await this.storeCredential(input);
    if (previousID) this.delete(previousID);
    return nextID;
  }

  delete(credentialID: string): void {
    const credentials = { ...this.store.get("credentials") };
    delete credentials[credentialID];
    this.store.set("credentials", credentials);
  }

  async headers(credentialID: string | null): Promise<Record<string, string> | undefined> {
    if (!credentialID) return undefined;
    const encoded = this.store.get("credentials")[credentialID];
    if (!encoded) throw new Error("OpenCode credentials were not found");
    if (!(await this.encryption.available()))
      throw new Error("Secure credential storage is unavailable");
    const credential = JSON.parse(
      await this.encryption.decrypt(Buffer.from(encoded, "base64")),
    ) as OpenCodeCredentialInput;
    return credentialHeaders(credential);
  }

  async basic(credentialID: string | null): Promise<{ username: string; password: string } | null> {
    if (!credentialID) return null;
    const encoded = this.store.get("credentials")[credentialID];
    if (!encoded || !(await this.encryption.available())) return null;
    const credential = JSON.parse(
      await this.encryption.decrypt(Buffer.from(encoded, "base64")),
    ) as OpenCodeCredentialInput;
    return credential.type === "basic"
      ? { username: credential.username, password: credential.password }
      : null;
  }
}
