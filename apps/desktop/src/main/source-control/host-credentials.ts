import { execFile } from "node:child_process";
import Store from "electron-store";
import type {
  CodeHostAccount,
  CodeHostKind,
  SaveCodeHostInput,
} from "../../shared/source-control-contract";
import { OpenCodeCredentialVault } from "../opencode-connections/credential-vault";
import { SourceControlError } from "./errors";

interface SavedHost {
  url: string;
  kind: Exclude<CodeHostKind, "github">;
  credentialID: string;
}
interface HostStore {
  get(key: "hosts"): SavedHost[];
  set(key: "hosts", value: SavedHost[]): void;
}
type Vault = Pick<OpenCodeCredentialVault, "storeCredential" | "headers" | "delete">;
type DetectToken = (host: string) => Promise<string | null>;

export function codeHostUrl(input: string): URL {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new SourceControlError("invalid-input", "Enter a full HTTPS host URL.");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  )
    throw new SourceControlError(
      "invalid-input",
      "Use an HTTPS host URL without credentials, a path, query or fragment.",
    );
  return url;
}

const detectGlab: DetectToken = (host) =>
  new Promise((resolve) => {
    execFile(
      "glab",
      ["auth", "token", "--hostname", host],
      {
        timeout: 3_000,
        maxBuffer: 64 * 1024,
        windowsHide: true,
        env: { ...process.env, GLAB_PROMPT_DISABLED: "1" },
      },
      (error, stdout) => resolve(error ? null : stdout.trim() || null),
    );
  });

/** Host metadata is plain; secrets use the same encrypted vault as connection credentials. */
export class HostCredentials {
  private readonly store: HostStore;
  private readonly detected = new Map<string, { at: number; token: string | null }>();
  constructor(
    store?: HostStore,
    private readonly vault: Vault = new OpenCodeCredentialVault(),
    private readonly env: () => NodeJS.ProcessEnv = () => process.env,
    private readonly glab: DetectToken = detectGlab,
  ) {
    this.store =
      store ??
      new Store<{ hosts: SavedHost[] }>({
        name: "source-control-hosts",
        cwd: process.env.PALOT_E2E_USER_DATA ?? process.env.PALOT_RELEASE_SMOKE_USER_DATA,
        defaults: { hosts: [] },
      });
  }

  accounts(): CodeHostAccount[] {
    const env = this.env();
    const entries: CodeHostAccount[] = [
      {
        host: "gitlab.com",
        url: "https://gitlab.com",
        kind: "gitlab",
        source: null,
        configured: false,
      },
      {
        host: "bitbucket.org",
        url: "https://bitbucket.org",
        kind: "bitbucket",
        source: null,
        configured: false,
      },
    ];
    for (const [kind, variable, fallback] of [
      ["gitlab", "GITLAB_HOST", "gitlab.com"],
      ["forgejo", "FORGEJO_HOST", "codeberg.org"],
      ["bitbucket", "BITBUCKET_HOST", "bitbucket.org"],
    ] as const) {
      const hostValue = env[variable] || (kind === "gitlab" ? env.GL_HOST : undefined) || fallback;
      let url: URL;
      try {
        url = codeHostUrl(hostValue.includes("://") ? hostValue : `https://${hostValue}`);
      } catch {
        continue;
      }
      if (kind === "bitbucket" && url.host !== "bitbucket.org") continue;
      const token = this.envToken(kind, url.host);
      if (!token && !env[variable] && !(kind === "gitlab" && env.GL_HOST)) continue;
      const account = {
        host: url.host,
        url: url.origin,
        kind,
        source: token ? ("env" as const) : null,
        configured: Boolean(token),
      };
      const index = entries.findIndex((entry) => entry.host === account.host);
      if (index >= 0) entries[index] = account;
      else entries.push(account);
    }
    for (const saved of this.store.get("hosts")) {
      const url = codeHostUrl(saved.url);
      const account: CodeHostAccount = {
        host: url.host,
        url: url.origin,
        kind: saved.kind,
        source: "saved",
        configured: true,
      };
      const index = entries.findIndex((entry) => entry.host === account.host);
      if (index >= 0) entries[index] = account;
      else entries.push(account);
    }
    return entries;
  }

  save(input: SaveCodeHostInput): void {
    const url = codeHostUrl(input.url);
    if (url.host === "github.com" || (input.kind === "bitbucket" && url.host !== "bitbucket.org"))
      throw new SourceControlError(
        "invalid-input",
        "Bitbucket Cloud uses https://bitbucket.org; GitHub uses its existing CLI credentials.",
      );
    if (!input.token.trim() || /[\r\n\0]/.test(input.token))
      throw new SourceControlError(
        "invalid-input",
        "Enter a non-empty token without control characters.",
      );
    const previous = this.store.get("hosts");
    const old = previous.find((entry) => entry.url === url.origin);
    const credentialID = this.vault.storeCredential({ type: "bearer", token: input.token.trim() });
    if (!credentialID) throw new Error("Could not save token");
    try {
      this.store.set("hosts", [
        ...previous.filter((entry) => entry.url !== url.origin),
        { url: url.origin, kind: input.kind, credentialID },
      ]);
    } catch (error) {
      this.vault.delete(credentialID);
      throw error;
    }
    if (old) this.vault.delete(old.credentialID);
    this.detected.delete(url.host);
  }

  remove(host: string): void {
    const entries = this.store.get("hosts");
    this.store.set(
      "hosts",
      entries.filter((entry) => new URL(entry.url).host !== host),
    );
    for (const entry of entries)
      if (new URL(entry.url).host === host) this.vault.delete(entry.credentialID);
    this.detected.delete(host);
  }

  async token(host: string): Promise<string> {
    const account = this.accounts().find((entry) => entry.host === host);
    if (!account)
      throw new SourceControlError(
        "unsupported-remote",
        "Configure this code host in Settings → Source control first.",
      );
    const saved = this.store.get("hosts").find((entry) => new URL(entry.url).host === host);
    if (saved) {
      const header = this.vault.headers(saved.credentialID)?.authorization;
      if (header?.startsWith("Bearer ")) return header.slice(7);
      throw new SourceControlError(
        "host-unauthenticated",
        "The saved code host token is unavailable. Save it again in Settings → Source control.",
      );
    }
    const token = this.envToken(account.kind, host);
    if (token) return token;
    if (account.kind === "gitlab") {
      let cached = this.detected.get(host);
      if (!cached || Date.now() - cached.at > 60_000) {
        cached = { at: Date.now(), token: await this.glab(host) };
        this.detected.set(host, cached);
      }
      if (cached.token) return cached.token;
    }
    throw new SourceControlError(
      "host-unauthenticated",
      `Save a token for ${host} in Settings → Source control${account.kind === "gitlab" ? " or sign in with glab auth login" : ""}.`,
    );
  }

  private envToken(kind: CodeHostKind, host: string): string | undefined {
    const env = this.env();
    const configured =
      kind === "gitlab"
        ? env.GITLAB_HOST || env.GL_HOST || "gitlab.com"
        : kind === "forgejo"
          ? env.FORGEJO_HOST || "codeberg.org"
          : "bitbucket.org";
    let expected: string;
    try {
      expected = codeHostUrl(
        configured.includes("://") ? configured : `https://${configured}`,
      ).host;
    } catch {
      return;
    }
    if (host !== expected) return;
    return (
      (kind === "gitlab"
        ? env.GITLAB_TOKEN || env.GL_TOKEN
        : kind === "forgejo"
          ? env.FORGEJO_TOKEN || env.GITEA_TOKEN
          : env.BITBUCKET_TOKEN
      )?.trim() || undefined
    );
  }
}
