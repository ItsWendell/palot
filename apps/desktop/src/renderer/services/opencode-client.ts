import { OpenCode, type OpenCodeClient } from "@opencode/client";
import { errorDiagnostic, type OpenCodeRuntimeStatus, type PalotApi } from "../../shared";
import { openCodeRequestSignal } from "./opencode-request";
import { createOpenCodeReadQueue } from "./opencode-request-queue";

const CLIENT_BASE_URL = "https://opencode.invalid";
const requestInstanceID = crypto.randomUUID();
let requestSequence = 0;
type Target = Readonly<Pick<OpenCodeRuntimeStatus, "connectionID" | "profileID">>;
let testClient: OpenCodeClient | null = null;
let focusedTarget: Target | null = null;
const targets = new Map<string, Target>();
const clients = new Map<string, OpenCodeClient>();
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
  targets.set(
    runtime.connectionID,
    Object.freeze({ connectionID: runtime.connectionID, profileID: runtime.profileID }),
  );
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
    const signal = openCodeRequestSignal(request.signal);
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

export function openCodeClient(connectionID?: string): OpenCodeClient {
  if (testClient) return testClient;
  const target = connectionID === undefined ? focusedTarget : targets.get(connectionID);
  if (target === undefined) throw new Error(`Unknown OpenCode connection: ${connectionID}`);
  const key = target?.connectionID ?? "";
  let client = clients.get(key);
  if (!client) {
    client = OpenCode.make({ baseUrl: CLIENT_BASE_URL, fetch: targetedFetch(target) });
    clients.set(key, client);
  }
  return client;
}

export function resetOpenCodeClientForTest(): void {
  testClient = null;
  focusedTarget = null;
  targets.clear();
  clients.clear();
  budgets.clear();
  requestSequence = 0;
}

export function setOpenCodeClientForTest(client: OpenCodeClient): void {
  testClient = client;
}
