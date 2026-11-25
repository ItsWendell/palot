import { OpenCode, withMediaRefs, type OpenCodeClient } from "@opencode/client";
import { errorDiagnostic, type OpenCodeRuntimeStatus, type PalotApi } from "../../shared";
import { mediaRefsEnabled, supportsMediaRefs } from "../lib/media-refs";
import { openCodeRequestSignal, openCodeTransportTimeoutMs } from "./opencode-request";
import { createOpenCodeReadQueue } from "./opencode-request-queue";

const CLIENT_BASE_URL = "https://opencode.invalid";
const requestInstanceID = crypto.randomUUID();
let requestSequence = 0;
type Target = Readonly<Pick<OpenCodeRuntimeStatus, "connectionID" | "profileID">>;
let testClient: OpenCodeClient | null = null;
let focusedTarget: Target | null = null;
const targets = new Map<string, Target>();
const clients = new Map<string, { client: OpenCodeClient; mediaRefs: boolean }>();
/** Connections whose server can return `media:` references from message and inbox reads. */
const mediaRefConnections = new Map<string, boolean>();
const retiredListeners = new Set<(connectionID: string) => void>();

/**
 * Called with a connection ID once its profile has connected again under a new ID, so caches
 * keyed by the old connection can be released.
 */
export function onOpenCodeConnectionRetired(listener: (connectionID: string) => void): () => void {
  retiredListeners.add(listener);
  return () => retiredListeners.delete(listener);
}
const budgets = new Map<
  string,
  {
    read: ReturnType<typeof createOpenCodeReadQueue>;
    git: ReturnType<typeof createOpenCodeReadQueue>;
  }
>();

export function registerOpenCodeRuntime(runtime: OpenCodeRuntimeStatus): void {
  const existing = targets.get(runtime.connectionID);
  if (existing && existing.profileID !== runtime.profileID) {
    throw new Error("OpenCode connection owner cannot change");
  }
  if (runtime.version)
    mediaRefConnections.set(runtime.connectionID, supportsMediaRefs(runtime.version));
  if (!existing) {
    for (const target of targets.values()) {
      if (target.profileID !== runtime.profileID) continue;
      for (const listener of retiredListeners) listener(target.connectionID);
    }
  }
  targets.set(
    runtime.connectionID,
    Object.freeze({ connectionID: runtime.connectionID, profileID: runtime.profileID }),
  );
}

/** The server profile behind a connection; the focused one when omitted. */
export function openCodeProfileID(connectionID?: string): string | undefined {
  return (connectionID === undefined ? focusedTarget : targets.get(connectionID))?.profileID;
}

export function setFocusedOpenCodeRuntime(runtime: OpenCodeRuntimeStatus | null): void {
  if (runtime) registerOpenCodeRuntime(runtime);
  focusedTarget = runtime ? targets.get(runtime.connectionID)! : null;
}

function readBudget(target: Target | null) {
  const key = target?.connectionID ?? "";
  let budget = budgets.get(key);
  if (!budget) {
    budget = { read: createOpenCodeReadQueue(6), git: createOpenCodeReadQueue(2) };
    budgets.set(key, budget);
  }
  return budget;
}

interface MissingLocationResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: ArrayBuffer | null;
}

/**
 * Directories each connection answered `LocationNotFoundError` for. Reads scoped to them are
 * answered locally with that same response until a request for the directory succeeds (the
 * task's missing-folder check, `GET /api/location`, always reaches the server), so a deleted
 * worktree stops costing a round trip per poll.
 */
const missingLocations = new Map<string, Map<string, MissingLocationResponse>>();
const LOCATION_PROBE_PATH = "/api/location";

function requestDirectory(request: Request, url: URL): string | null {
  const query = url.searchParams.get("location[directory]");
  if (query) return query;
  const header = request.headers.get("x-opencode-directory");
  if (!header) return null;
  try {
    return decodeURIComponent(header);
  } catch {
    return header;
  }
}

function locationNotFoundDirectory(body: ArrayBuffer | null): string | null {
  if (!body) return null;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(body)) as {
      _tag?: unknown;
      location?: { directory?: unknown };
    };
    return parsed?._tag === "LocationNotFoundError" &&
      typeof parsed.location?.directory === "string"
      ? parsed.location.directory
      : null;
  } catch {
    return null;
  }
}

/** Whether a connection's reads for a directory are short-circuited as not found. */
export function isOpenCodeLocationMissing(connectionID: string, directory: string): boolean {
  return missingLocations.get(connectionID)?.has(directory) ?? false;
}

function bridge(): PalotApi {
  if (typeof window === "undefined" || typeof window.palot?.openCodeRequest !== "function") {
    throw new Error("Palot OpenCode transport is unavailable");
  }
  return window.palot;
}

function requestPath(request: Request): string {
  const url = new URL(request.url);
  if (url.origin !== CLIENT_BASE_URL)
    throw new Error("OpenCode client selected an unexpected origin");
  return `${url.pathname}${url.search}`;
}

function requestLabel(path: string): string {
  const url = new URL(path, CLIENT_BASE_URL);
  const query = [...new Set(url.searchParams.keys())];
  return query.length > 0 ? `${url.pathname}?${query.join("&")}` : url.pathname;
}

function logRequest(
  level: "debug" | "warn" | "error",
  event: string,
  details: Record<string, unknown>,
): void {
  console[level](`[opencode-client] ${event} ${JSON.stringify(details)}`);
}

function targetedFetch(target: Target | null): typeof globalThis.fetch {
  return async (input, init) => {
    const budget = readBudget(target);
    const request = input instanceof Request ? input : new Request(input, init);
    const signal = openCodeRequestSignal(
      request.signal,
      openCodeTransportTimeoutMs(request.method, new URL(request.url).pathname),
    );
    signal.throwIfAborted();
    const id = `request-${requestInstanceID}-${++requestSequence}`;
    const rendererStartedAt = Date.now();
    const path = requestPath(request);
    const label = requestLabel(path);
    const headers: Record<string, string> = {};
    request.headers.forEach((value, key) => {
      headers[key] = value;
    });
    let release: (() => void) | undefined;
    let abort: (() => void) | undefined;
    const url = new URL(request.url);
    const directory = requestDirectory(request, url);
    const missing = missingLocations.get(target?.connectionID ?? "");
    const skipped =
      directory && request.method === "GET" && url.pathname !== LOCATION_PROBE_PATH
        ? missing?.get(directory)
        : undefined;
    if (skipped) {
      logRequest("debug", "request skipped", { id, method: request.method, path: label });
      return new Response(skipped.body?.slice(0) ?? null, {
        status: skipped.status,
        statusText: skipped.statusText,
        headers: skipped.headers,
      });
    }
    logRequest("debug", "request started", {
      id,
      method: request.method,
      path: label,
    });
    try {
      if (request.method === "GET") {
        const pathname = new URL(request.url).pathname;
        const gitRead = /^\/api\/(vcs|worktree)(\/|$)/.test(pathname);
        release = await (gitRead ? budget.git : budget.read)(signal);
      }
      signal.throwIfAborted();
      const body = request.body ? await request.arrayBuffer() : null;
      signal.throwIfAborted();
      const transport = bridge();
      const cancelled = new Promise<never>((_resolve, reject) => {
        abort = () => {
          void transport.cancelOpenCodeRequest(id).catch(() => undefined);
          reject(signal.reason);
        };
        signal.addEventListener("abort", abort, { once: true });
      });
      const response = transport.openCodeRequest({
        ...target,
        id,
        rendererStartedAt,
        path,
        method: request.method,
        headers,
        body,
      });
      const result = await Promise.race([response, cancelled]);
      signal.throwIfAborted();
      const durationMs = Date.now() - rendererStartedAt;
      const details = {
        id,
        method: request.method,
        path: label,
        status: result.status,
        durationMs,
        main: result.timings,
      };
      if (directory) {
        const key = target?.connectionID ?? "";
        const notFound = result.status === 404 ? locationNotFoundDirectory(result.body) : null;
        if (notFound) {
          const entries = missingLocations.get(key) ?? new Map<string, MissingLocationResponse>();
          entries.set(notFound, {
            status: result.status,
            statusText: result.statusText,
            headers: result.headers,
            body: result.body?.slice(0) ?? null,
          });
          missingLocations.set(key, entries);
        } else if (result.status < 400) {
          missingLocations.get(key)?.delete(directory);
        }
      }
      if (result.status >= 400 || durationMs >= 1_000) {
        logRequest("warn", "response", details);
      } else {
        logRequest("debug", "response", details);
      }
      return new Response(result.body, {
        status: result.status,
        statusText: result.statusText,
        headers: result.headers,
      });
    } catch (error) {
      const details = {
        id,
        method: request.method,
        path: label,
        durationMs: Date.now() - rendererStartedAt,
        aborted: signal.aborted,
        error: errorDiagnostic(error),
      };
      if (signal.aborted) logRequest("debug", "request cancelled", details);
      else logRequest("error", "request failed", details);
      throw error;
    } finally {
      if (abort) signal.removeEventListener("abort", abort);
      release?.();
    }
  };
}

export const openCodeFetch: typeof globalThis.fetch = (input, init) =>
  targetedFetch(focusedTarget)(input, init);

/**
 * A fetch to one connection for routes the pinned client no longer names, such as older
 * servers' paths. `path` is the server path, for example `/api/experimental/generate`.
 */
export function openCodeConnectionFetch(
  connectionID: string | undefined,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const target = connectionID === undefined ? focusedTarget : targets.get(connectionID);
  if (target === undefined) throw new Error(`Unknown OpenCode connection: ${connectionID}`);
  return targetedFetch(target)(`${CLIENT_BASE_URL}${path}`, init);
}

export function openCodeClient(connectionID?: string): OpenCodeClient {
  if (testClient) return testClient;
  const target = connectionID === undefined ? focusedTarget : targets.get(connectionID);
  if (target === undefined) throw new Error(`Unknown OpenCode connection: ${connectionID}`);
  const key = target?.connectionID ?? "";
  const mediaRefs = mediaRefsEnabled() && (mediaRefConnections.get(key) ?? supportsMediaRefs(null));
  let cached = clients.get(key);
  if (!cached || cached.mediaRefs !== mediaRefs) {
    const client = OpenCode.make({ baseUrl: CLIENT_BASE_URL, fetch: targetedFetch(target) });
    // Message and inbox reads return server-stored media as `media:<hash>` references, which
    // `lib/media-refs.ts` resolves. Session export is not wrapped and keeps inline bytes.
    cached = { client: mediaRefs ? withMediaRefs(client) : client, mediaRefs };
    clients.set(key, cached);
  }
  return cached.client;
}

export function resetOpenCodeClientForTest(): void {
  testClient = null;
  focusedTarget = null;
  targets.clear();
  clients.clear();
  mediaRefConnections.clear();
  budgets.clear();
  missingLocations.clear();
  requestSequence = 0;
}

export function setOpenCodeClientForTest(client: OpenCodeClient): void {
  testClient = client;
}
