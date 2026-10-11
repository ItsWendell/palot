import {
  GitHubCredentialError,
  type GitHubCredential,
  type GitHubCredentials,
} from "./github-credentials";
import { GitHubQuota, GitHubRateLimitPausedError, type GitHubPriority } from "./github-quota";

/** Polite to GitHub's secondary limits, which punish bursts of concurrent requests. */
export const GITHUB_CONCURRENCY = 8;
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const API_VERSION = "2022-11-28";
const ETAG_CACHE_LIMIT = 200;
const ETAG_BODY_LIMIT = 512 * 1024;

export type GitHubErrorCode =
  | "credentials"
  | "unsupported-host"
  | "auth"
  | "rate-limited"
  | "not-found"
  /** HTTP 403 without a rate limit, or a FORBIDDEN GraphQL error. */
  | "forbidden"
  /** HTTP 422 or an UNPROCESSABLE GraphQL error: GitHub rejected the input. */
  | "validation"
  | "network"
  | "response";

/** A GitHub failure. Messages never include tokens; `githubMessages` are GitHub's own words. */
export class GitHubApiError extends Error {
  constructor(
    readonly code: GitHubErrorCode,
    message: string,
    readonly options: {
      retryAt?: number;
      status?: number;
      cause?: unknown;
      /** GitHub's own error messages (GraphQL `errors[].message`, REST `message`/`errors`). */
      githubMessages?: string[];
    } = {},
  ) {
    super(message);
    this.name = "GitHubApiError";
  }
}

export function gitHubApiUrls(host: string): { rest: string; graphql: string } {
  const normalized = host.trim().toLowerCase();
  if (normalized === "github.com")
    return { rest: "https://api.github.com", graphql: "https://api.github.com/graphql" };
  if (normalized.endsWith(".ghe.com"))
    return { rest: `https://api.${normalized}`, graphql: `https://api.${normalized}/graphql` };
  return { rest: `https://${normalized}/api/v3`, graphql: `https://${normalized}/api/graphql` };
}

export interface GitHubRestResponse<T> {
  status: number;
  data: T;
  /** The answer came from Palot's ETag cache after a free 304. */
  notModified: boolean;
}

interface GitHubTransport {
  credentials: Pick<GitHubCredentials, "get" | "invalidate">;
  quota: GitHubQuota;
  fetch?: typeof globalThis.fetch;
  concurrency?: number;
}

export interface GitHubGraphQlError {
  type?: string;
  message?: string;
  /** Response path, e.g. `["pr3", "pullRequest"]`; the first entry is the top-level alias. */
  path?: Array<string | number>;
}

export interface GitHubGraphQlPartial<T> {
  data: T;
  errors: GitHubGraphQlError[];
}

/** The GitHub calls the rest of source control depends on; tests replace it with a fake. */
export interface GitHubGateway {
  rest<T>(input: {
    host: string;
    path: string;
    priority: GitHubPriority;
    method?: "GET" | "POST";
    body?: unknown;
  }): Promise<GitHubRestResponse<T>>;
  graphql<T>(input: {
    host: string;
    query: string;
    variables?: Record<string, unknown>;
    priority: GitHubPriority;
  }): Promise<T>;
  /**
   * Like `graphql`, but an answer with both `data` and `errors` (one aliased repository not
   * found, one field not readable) resolves with the data and the errors instead of failing
   * the whole document. Rate limits, refused credentials and answers without data still throw.
   */
  graphqlPartial<T>(input: {
    host: string;
    query: string;
    variables?: Record<string, unknown>;
    priority: GitHubPriority;
  }): Promise<GitHubGraphQlPartial<T>>;
  credential(host: string): Promise<Pick<GitHubCredential, "source" | "fingerprint">>;
  pausedUntil(host: string): number | null;
}

/**
 * Fetch-based GitHub REST and GraphQL transport: at most 8 requests in flight, ETag revalidation
 * for REST reads, quota tracking from rate-limit headers with a 10% interactive reserve, and a
 * rate-limit pause rather than repeated failures.
 */
export class GitHubClient implements GitHubGateway {
  private active = 0;
  private readonly waiters: Array<() => void> = [];
  private readonly etags = new Map<string, { etag: string; body: unknown }>();
  private readonly fetch: typeof globalThis.fetch;
  private readonly concurrency: number;

  constructor(private readonly transport: GitHubTransport) {
    this.fetch = transport.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.concurrency = transport.concurrency ?? GITHUB_CONCURRENCY;
  }

  async credential(host: string) {
    const value = await this.credentialFor(host);
    return { source: value.source, fingerprint: value.fingerprint };
  }

  pausedUntil(host: string): number | null {
    return this.transport.quota.hostPausedUntil(host.trim().toLowerCase());
  }

  async rest<T>(input: {
    host: string;
    path: string;
    priority: GitHubPriority;
    method?: "GET" | "POST";
    body?: unknown;
  }): Promise<GitHubRestResponse<T>> {
    const host = input.host.trim().toLowerCase();
    const method = input.method ?? "GET";
    const url = `${gitHubApiUrls(host).rest}/${input.path.replace(/^\/+/, "")}`;
    const credential = await this.credentialFor(host);
    const resource = input.path.replace(/^\/+/, "").startsWith("search/") ? "search" : "core";
    const cacheKey = `${credential.fingerprint}\0${url}`;
    const cached = method === "GET" ? this.etags.get(cacheKey) : undefined;
    const response = await this.send(credential, resource, input.priority, url, {
      method,
      headers: {
        accept: "application/vnd.github+json",
        ...(cached ? { "if-none-match": cached.etag } : {}),
        ...(input.body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
    });
    if (response.status === 304 && cached)
      return { status: 304, data: cached.body as T, notModified: true };
    const data = parseJson(response.text) as T;
    const etag = response.headers.get("etag");
    // Large answers (whole-file patches) are not kept in memory for revalidation.
    if (method === "GET" && etag && response.text.length <= ETAG_BODY_LIMIT) {
      this.etags.delete(cacheKey);
      this.etags.set(cacheKey, { etag, body: data });
      if (this.etags.size > ETAG_CACHE_LIMIT) this.etags.delete(this.etags.keys().next().value!);
    }
    return { status: response.status, data, notModified: false };
  }

  async graphql<T>(input: {
    host: string;
    query: string;
    variables?: Record<string, unknown>;
    priority: GitHubPriority;
  }): Promise<T> {
    return (await this.graphqlRequest<T>(input, false)).data;
  }

  graphqlPartial<T>(input: {
    host: string;
    query: string;
    variables?: Record<string, unknown>;
    priority: GitHubPriority;
  }): Promise<GitHubGraphQlPartial<T>> {
    return this.graphqlRequest<T>(input, true);
  }

  private async graphqlRequest<T>(
    input: {
      host: string;
      query: string;
      variables?: Record<string, unknown>;
      priority: GitHubPriority;
    },
    partial: boolean,
  ): Promise<GitHubGraphQlPartial<T>> {
    const host = input.host.trim().toLowerCase();
    const credential = await this.credentialFor(host);
    const response = await this.send(
      credential,
      "graphql",
      input.priority,
      gitHubApiUrls(host).graphql,
      {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify({ query: input.query, variables: input.variables ?? {} }),
      },
      partial ? "graphql-partial" : "graphql",
    );
    const body = parseJson(response.text) as { data?: T } | null;
    if (!body || body.data === undefined || body.data === null)
      throw new GitHubApiError("response", "GitHub returned an empty GraphQL answer.");
    return { data: body.data, errors: graphQlErrors(response.text) ?? [] };
  }

  private async credentialFor(host: string): Promise<GitHubCredential> {
    try {
      return await this.transport.credentials.get(host);
    } catch (error) {
      if (error instanceof GitHubCredentialError)
        throw new GitHubApiError(
          error.code === "unsupported-host" ? "unsupported-host" : "credentials",
          error.message,
          { cause: error },
        );
      throw error;
    }
  }

  private async send(
    credential: GitHubCredential,
    resource: string,
    priority: GitHubPriority,
    url: string,
    init: { method: string; headers: Record<string, string>; body?: string },
    kind: "rest" | "graphql" | "graphql-partial" = "rest",
  ): Promise<{ status: number; headers: Headers; text: string }> {
    const { quota } = this.transport;
    const scope = credential.fingerprint;
    // Fail fast without queueing when the request could not be admitted now.
    this.admit(scope, resource, priority)();
    await this.acquire();
    let lease: () => void;
    try {
      // A pause or a drained quota can arrive while the request waited for a slot.
      lease = this.admit(scope, resource, priority);
    } catch (error) {
      this.release();
      throw error;
    }
    let status: number;
    let headers: Headers;
    let text: string;
    try {
      const response = await this.fetch(url, {
        method: init.method,
        headers: {
          ...init.headers,
          authorization: `Bearer ${credential.token}`,
          "x-github-api-version": API_VERSION,
          "user-agent": "Palot",
        },
        ...(init.body === undefined ? {} : { body: init.body }),
        redirect: "error",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      status = response.status;
      headers = response.headers;
      text = await response.text();
      quota.observe(scope, headers);
    } catch (cause) {
      throw new GitHubApiError("network", `Could not reach GitHub at ${credential.host}.`, {
        cause,
      });
    } finally {
      lease();
      this.release();
    }
    if (text.length > MAX_RESPONSE_BYTES)
      throw new GitHubApiError("response", "GitHub returned an oversized answer.", { status });
    const graphql = kind !== "rest";
    const errors = graphql ? graphQlErrors(text) : null;
    if (isRateLimited(status, headers, text, errors)) {
      const retryAt = quota.pause(scope, headers);
      throw new GitHubApiError("rate-limited", "GitHub rate limit reached; Palot is waiting.", {
        retryAt,
        status,
      });
    }
    if (status === 401) {
      this.transport.credentials.invalidate(credential.host);
      throw new GitHubApiError(
        "auth",
        `GitHub refused the credential for ${credential.host}. Run \`gh auth login --hostname ${credential.host}\` and retry.`,
        { status },
      );
    }
    // Partial answers keep their data; the caller maps each error to its alias.
    if (kind === "graphql-partial" && errors && status >= 200 && status < 300 && hasData(text))
      return { status, headers, text };
    if (status === 404 || (errors && errors.every((error) => error.type === "NOT_FOUND")))
      throw new GitHubApiError(
        "not-found",
        "GitHub could not find the pull request, or the credential cannot see it.",
        { status },
      );
    if (errors) {
      const messages = errors.flatMap((error) => (error.message ? [error.message] : []));
      const types = errors.map((error) => error.type);
      throw new GitHubApiError(
        types.includes("FORBIDDEN") || messages.some(isPermissionMessage)
          ? "forbidden"
          : types.includes("UNPROCESSABLE")
            ? "validation"
            : "response",
        messages.length ? `GitHub returned an error: ${messages.join("; ")}` : "GitHub failed.",
        { status, githubMessages: messages },
      );
    }
    if ((status >= 200 && status < 300) || status === 304) return { status, headers, text };
    const messages = restMessages(text);
    const summary = messages.length
      ? `GitHub returned an error: ${messages.join("; ").slice(0, 500)}`
      : `GitHub returned HTTP ${status}.`;
    if (status === 403)
      throw new GitHubApiError("forbidden", summary, { status, githubMessages: messages });
    throw new GitHubApiError(status === 422 ? "validation" : "response", summary, {
      status,
      githubMessages: messages,
    });
  }

  private admit(scope: string, resource: string, priority: GitHubPriority): () => void {
    try {
      return this.transport.quota.admit(scope, resource, priority);
    } catch (error) {
      if (error instanceof GitHubRateLimitPausedError)
        throw new GitHubApiError("rate-limited", "GitHub rate limit reached; Palot is waiting.", {
          retryAt: error.retryAt,
        });
      throw error;
    }
  }

  private async acquire(): Promise<void> {
    if (this.active < this.concurrency) {
      this.active += 1;
      return;
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
  }

  private release(): void {
    const next = this.waiters.shift();
    if (next) next();
    else this.active -= 1;
  }
}

function parseJson(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new GitHubApiError("response", "GitHub returned an unreadable answer.");
  }
}

function graphQlErrors(text: string): GitHubGraphQlError[] | null {
  try {
    const body = JSON.parse(text) as { errors?: unknown };
    if (!Array.isArray(body.errors) || body.errors.length === 0) return null;
    return body.errors.map((error): GitHubGraphQlError => {
      if (!error || typeof error !== "object") return {};
      const value = error as Record<string, unknown>;
      return {
        ...(typeof value.type === "string" ? { type: value.type } : {}),
        ...(typeof value.message === "string" ? { message: value.message } : {}),
        ...(Array.isArray(value.path)
          ? {
              path: value.path.filter(
                (part): part is string | number =>
                  typeof part === "string" || typeof part === "number",
              ),
            }
          : {}),
      };
    });
  } catch {
    return null;
  }
}

function hasData(text: string): boolean {
  try {
    const body = JSON.parse(text) as { data?: unknown };
    return Boolean(body.data && typeof body.data === "object");
  } catch {
    return false;
  }
}

function isRateLimited(
  status: number,
  headers: Headers,
  text: string,
  errors: GitHubGraphQlError[] | null,
): boolean {
  if (status === 429) return true;
  if (errors?.some((error) => error.type === "RATE_LIMITED")) return true;
  if (errors && headers.get("x-ratelimit-remaining") === "0") return true;
  if (errors?.some((error) => /rate limit (already )?exceeded/i.test(error.message ?? "")))
    return true;
  return (
    status === 403 &&
    (headers.get("x-ratelimit-remaining") === "0" ||
      headers.get("retry-after") !== null ||
      /rate limit/i.test(text))
  );
}

/** REST failure text: `{ message, errors: [string | { message } | { field, code }] }`. */
function restMessages(text: string): string[] {
  try {
    const body = JSON.parse(text) as { message?: unknown; errors?: unknown };
    const details = Array.isArray(body.errors)
      ? body.errors.flatMap((error): string[] => {
          if (typeof error === "string") return [error];
          if (!error || typeof error !== "object") return [];
          const value = error as Record<string, unknown>;
          if (typeof value.message === "string") return [value.message];
          if (typeof value.field === "string" && typeof value.code === "string")
            return [`${value.field} ${value.code}`];
          return [];
        })
      : [];
    return [...(typeof body.message === "string" ? [body.message] : []), ...details].map(
      (message) => message.slice(0, 300),
    );
  } catch {
    return [];
  }
}

function isPermissionMessage(message: string): boolean {
  return /resource not accessible|does not have (the correct )?permission|must have (push|write|admin|maintain) access|not authorized to/i.test(
    message,
  );
}
