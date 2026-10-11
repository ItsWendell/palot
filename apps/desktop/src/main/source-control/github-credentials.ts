import { createHash } from "node:crypto";
import { execFile } from "node:child_process";

/** How long a `gh` token is reused, so `gh auth switch` applies soon. */
export const GITHUB_TOKEN_TTL_MS = 5 * 60_000;
/** How long a missing credential is remembered, so a fresh `gh auth login` applies quickly. */
export const GITHUB_MISSING_TTL_MS = 10_000;
const GH_TIMEOUT_MS = 10_000;

export type GitHubCredentialSource = "env" | "gh";

export interface GitHubCredential {
  host: string;
  /** Never log, return over IPC, or put in an error. */
  token: string;
  source: GitHubCredentialSource;
  /** `host:sha256(token)` prefix, safe for cache and quota keys. */
  fingerprint: string;
}

export type GitHubCredentialErrorCode =
  | "gh-missing"
  | "not-signed-in"
  | "gh-failed"
  | "unsupported-host";

export class GitHubCredentialError extends Error {
  constructor(
    readonly code: GitHubCredentialErrorCode,
    readonly host: string,
  ) {
    super(
      code === "gh-missing"
        ? `No GitHub credential for ${host}: set GH_TOKEN, or install the GitHub CLI and run \`gh auth login\`.`
        : code === "not-signed-in"
          ? `No GitHub credential for ${host}: run \`gh auth login --hostname ${host}\`.`
          : code === "unsupported-host"
            ? `GitHub host ${host} is not configured. Palot reads github.com and the host GH_HOST names.`
            : `The GitHub CLI could not provide a credential for ${host}. Check \`gh auth status\`.`,
    );
    this.name = "GitHubCredentialError";
  }
}

export type GhTokenReader = (host: string) => Promise<string>;

/** Hosts gh treats as GitHub.com-like for `GH_TOKEN`: github.com and GHE.com data residency. */
export function isGitHubDotCom(host: string): boolean {
  return host === "github.com" || host.endsWith(".ghe.com");
}

/**
 * Hosts Palot sends credentials to: github.com and the host `GH_HOST` names. A remote URL or a
 * persisted link picks the host, so anything else is refused before a token is looked up.
 */
export function isSupportedGitHubHost(
  host: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  const normalized = host.trim().toLowerCase();
  return normalized === "github.com" || env.GH_HOST?.trim().toLowerCase() === normalized;
}

/** Hosts whose GitHub status Palot reports: github.com, then GH_HOST when it names another. */
export function configuredGitHubHosts(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string[] {
  const configured = env.GH_HOST?.trim().toLowerCase();
  return configured && configured !== "github.com" ? ["github.com", configured] : ["github.com"];
}

const TOKEN_VARIABLES = [
  "GH_TOKEN",
  "GITHUB_TOKEN",
  "GH_ENTERPRISE_TOKEN",
  "GITHUB_ENTERPRISE_TOKEN",
] as const;

/**
 * The environment for `gh auth token`. Token variables are removed: gh would otherwise answer
 * with an environment token for a host Palot's own environment rule refused (an enterprise
 * token for any non-github.com host), so only gh's stored login for that host is returned.
 */
export function ghEnvironment(
  env: Readonly<Record<string, string | undefined>>,
): Record<string, string | undefined> {
  const next: Record<string, string | undefined> = {
    ...env,
    GH_DEBUG: "",
    GH_PROMPT_DISABLED: "1",
    NO_COLOR: "1",
  };
  for (const name of TOKEN_VARIABLES) delete next[name];
  return next;
}

/**
 * The environment token for a host, in gh's precedence order. gh hands `GH_ENTERPRISE_TOKEN` to
 * any non-github.com host; Palot only sends it to the host `GH_HOST` names, because the remote
 * URL picks the host and a hostile remote must not receive an enterprise token.
 */
export function environmentToken(
  host: string,
  env: Readonly<Record<string, string | undefined>>,
): string | null {
  const names = isGitHubDotCom(host)
    ? ["GH_TOKEN", "GITHUB_TOKEN"]
    : env.GH_HOST?.trim().toLowerCase() === host
      ? ["GH_ENTERPRISE_TOKEN", "GITHUB_ENTERPRISE_TOKEN"]
      : [];
  for (const name of names) {
    const value = env[name]?.trim();
    if (value) return value;
  }
  return null;
}

/** Runs `gh auth token` without a shell, prompts, or debug output that could echo the token. */
export const readGhToken: GhTokenReader = (host) =>
  new Promise((resolve, reject) => {
    execFile(
      "gh",
      ["auth", "token", "--hostname", host],
      {
        timeout: GH_TIMEOUT_MS,
        windowsHide: true,
        env: ghEnvironment(process.env),
      },
      (error, stdout) => {
        if (!error) {
          const token = String(stdout).trim();
          if (token) resolve(token);
          else reject(new GitHubCredentialError("not-signed-in", host));
          return;
        }
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "ENOENT") reject(new GitHubCredentialError("gh-missing", host));
        else if (typeof code === "number" && !error.killed)
          reject(new GitHubCredentialError("not-signed-in", host));
        else reject(new GitHubCredentialError("gh-failed", host));
      },
    );
  });

type CacheEntry =
  | { expiresAt: number; credential: GitHubCredential }
  | { expiresAt: number; error: GitHubCredentialError };

/**
 * Where GitHub tokens come from: `GH_TOKEN`/`GITHUB_TOKEN` (or the enterprise pair for GH_HOST),
 * then `gh auth token`. The environment is read on every call; `gh` answers are cached.
 */
export class GitHubCredentials {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly inFlight = new Map<string, Promise<GitHubCredential>>();
  private readonly env: () => Readonly<Record<string, string | undefined>>;
  private readonly readGh: GhTokenReader;
  private readonly now: () => number;

  constructor(
    options: {
      env?: () => Readonly<Record<string, string | undefined>>;
      readGh?: GhTokenReader;
      now?: () => number;
    } = {},
  ) {
    this.env = options.env ?? (() => process.env);
    this.readGh = options.readGh ?? readGhToken;
    this.now = options.now ?? Date.now;
  }

  async get(rawHost: string): Promise<GitHubCredential> {
    const host = rawHost.trim().toLowerCase();
    if (!isSupportedGitHubHost(host, this.env()))
      throw new GitHubCredentialError("unsupported-host", host);
    const fromEnv = environmentToken(host, this.env());
    if (fromEnv) return credential(host, fromEnv, "env");
    const cached = this.cache.get(host);
    if (cached && cached.expiresAt > this.now()) {
      if ("error" in cached) throw cached.error;
      return cached.credential;
    }
    const pending = this.inFlight.get(host);
    if (pending) return pending;
    const lookup = this.lookup(host).finally(() => this.inFlight.delete(host));
    this.inFlight.set(host, lookup);
    return lookup;
  }

  /** Drops a token GitHub refused, so the next read asks `gh` again. */
  invalidate(rawHost: string): void {
    this.cache.delete(rawHost.trim().toLowerCase());
  }

  private async lookup(host: string): Promise<GitHubCredential> {
    try {
      const token = await this.readGh(host);
      const value = credential(host, token, "gh");
      this.cache.set(host, { expiresAt: this.now() + GITHUB_TOKEN_TTL_MS, credential: value });
      return value;
    } catch (cause) {
      const error =
        cause instanceof GitHubCredentialError
          ? cause
          : new GitHubCredentialError("gh-failed", host);
      // A transient gh failure (timeout, locked keyring) is asked again on the next read.
      if (error.code !== "gh-failed")
        this.cache.set(host, { expiresAt: this.now() + GITHUB_MISSING_TTL_MS, error });
      else this.cache.delete(host);
      throw error;
    }
  }
}

function credential(host: string, token: string, source: GitHubCredentialSource) {
  const digest = createHash("sha256").update(token).digest("hex").slice(0, 16);
  return { host, token, source, fingerprint: `${host}:${digest}` } satisfies GitHubCredential;
}
