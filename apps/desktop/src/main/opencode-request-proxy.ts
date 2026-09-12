import type { OpenCodeRequestInput, OpenCodeResponseOutput } from "../shared/opencode-contract";
import { actionableErrorMessage, errorDiagnostic } from "../shared/diagnostics";
import { openCodeRequestLog, requestLabel } from "./opencode-observability";

const MAX_REQUEST_BODY_BYTES = 16 * 1024 * 1024;
const MAX_RESPONSE_BODY_BYTES = 64 * 1024 * 1024;
const BLOCKED_HEADERS = new Set([
  "authorization",
  "cookie",
  "host",
  "origin",
  "proxy-authorization",
]);
const DECODED_RESPONSE_HEADERS = new Set([
  "content-encoding",
  "content-length",
  "transfer-encoding",
]);

export interface OpenCodeRequestConnection {
  endpoint: { url: string };
  headers: Record<string, string> | undefined;
  /** Main-only generation guard; never sent over IPC. */
  validate?(): void;
}

export interface OpenCodeRequestProxyOptions {
  connection(
    target: Pick<OpenCodeRequestInput, "profileID" | "connectionID">,
  ): Promise<OpenCodeRequestConnection>;
  fetch(input: URL, init: RequestInit): Promise<Response>;
}

interface RequestSender {
  id: number;
}

type RequestStage = "connection" | "request-validation" | "service-fetch" | "response-body";

class OpenCodeRequestStageError extends Error {
  constructor(
    readonly requestID: string,
    readonly stage: RequestStage,
    cause: unknown,
  ) {
    super(
      `OpenCode request failed during ${stage}: ${actionableErrorMessage(cause, "Unknown error")}`,
      { cause },
    );
    this.name = "OpenCodeRequestStageError";
  }
}

function assertRequestID(value: string): void {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(value)) throw new Error("OpenCode request ID is invalid");
}

function requestUrl(baseUrl: string, path: string): URL {
  if (!path.startsWith("/") || path.startsWith("//")) {
    throw new Error("OpenCode request path must be relative to the connected service");
  }
  const url = new URL(path, baseUrl);
  const endpoint = new URL(baseUrl);
  if (url.origin !== endpoint.origin) {
    throw new Error("OpenCode request path escaped the connected service");
  }
  return url;
}

function requestHeaders(
  input: Record<string, string>,
  connectionHeaders: Record<string, string> | undefined,
): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(input)) {
    if (!BLOCKED_HEADERS.has(key.toLowerCase())) headers.set(key, value);
  }
  for (const [key, value] of Object.entries(connectionHeaders ?? {})) headers.set(key, value);
  return headers;
}

async function responseBody(response: Response): Promise<ArrayBuffer | null> {
  if ([101, 204, 205, 304].includes(response.status) || response.body === null) return null;
  const declaredLength = Number(response.headers.get("content-length"));
  if (
    !response.headers.has("content-encoding") &&
    Number.isFinite(declaredLength) &&
    declaredLength > MAX_RESPONSE_BODY_BYTES
  ) {
    await response.body.cancel().catch(() => undefined);
    throw new Error("OpenCode response body is too large");
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_RESPONSE_BODY_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new Error("OpenCode response body is too large");
    }
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body.buffer;
}

function responseHeaders(response: Response): Record<string, string> {
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    if (!DECODED_RESPONSE_HEADERS.has(key)) headers[key] = value;
  });
  return headers;
}

export class OpenCodeRequestProxy {
  readonly #controllers = new Map<number, Map<string, AbortController>>();
  readonly #fetch: OpenCodeRequestProxyOptions["fetch"];

  constructor(private readonly options: OpenCodeRequestProxyOptions) {
    this.#fetch = options.fetch;
  }

  async request(
    sender: RequestSender,
    input: OpenCodeRequestInput,
  ): Promise<OpenCodeResponseOutput> {
    const mainStartedAt = Date.now();
    const label = requestLabel(input.path);
    const rendererToMainMs = Math.max(0, mainStartedAt - input.rendererStartedAt);
    assertRequestID(input.id);
    if (input.body && input.body.byteLength > MAX_REQUEST_BODY_BYTES) {
      throw new Error("OpenCode request body is too large");
    }
    const byID = this.#controllers.get(sender.id) ?? new Map<string, AbortController>();
    if (byID.has(input.id)) throw new Error("OpenCode request ID is already active");
    this.#controllers.set(sender.id, byID);
    const controller = new AbortController();
    byID.set(input.id, controller);
    openCodeRequestLog.debug("request received", {
      id: input.id,
      senderID: sender.id,
      method: input.method,
      path: label,
      rendererToMainMs,
    });
    try {
      const connectionStartedAt = Date.now();
      let connection: OpenCodeRequestConnection;
      try {
        connection = await this.options.connection({
          profileID: input.profileID,
          connectionID: input.connectionID,
        });
      } catch (error) {
        throw new OpenCodeRequestStageError(input.id, "connection", error);
      }
      const connectionMs = Date.now() - connectionStartedAt;
      let url: URL;
      try {
        url = requestUrl(connection.endpoint.url, input.path);
      } catch (error) {
        throw new OpenCodeRequestStageError(input.id, "request-validation", error);
      }
      const serviceStartedAt = Date.now();
      let response: Response;
      try {
        const headers = requestHeaders(input.headers, connection.headers);
        connection.validate?.();
        headers.set("x-palot-request-id", input.id);
        response = await this.#fetch(url, {
          method: input.method,
          headers,
          body: input.body ?? undefined,
          signal: controller.signal,
        });
      } catch (error) {
        throw new OpenCodeRequestStageError(input.id, "service-fetch", error);
      }
      const serviceMs = Date.now() - serviceStartedAt;
      const responseBodyStartedAt = Date.now();
      let body: ArrayBuffer | null;
      try {
        body = await responseBody(response);
        connection.validate?.();
      } catch (error) {
        throw new OpenCodeRequestStageError(input.id, "response-body", error);
      }
      const responseBodyMs = Date.now() - responseBodyStartedAt;
      const headers = responseHeaders(response);
      const mainTotalMs = Date.now() - mainStartedAt;
      const details = {
        id: input.id,
        method: input.method,
        path: label,
        status: response.status,
        rendererToMainMs,
        connectionMs,
        serviceMs,
        responseBodyMs,
        mainTotalMs,
      };
      if (response.status >= 400 || mainTotalMs >= 1_000) {
        openCodeRequestLog.warn("request completed", details);
      } else {
        openCodeRequestLog.debug("request completed", details);
      }
      return {
        status: response.status,
        statusText: response.statusText,
        headers,
        body,
        timings: { rendererToMainMs, connectionMs, serviceMs, responseBodyMs, mainTotalMs },
      };
    } catch (error) {
      if (controller.signal.aborted) {
        const mainTotalMs = Date.now() - mainStartedAt;
        openCodeRequestLog.debug("request cancelled", {
          id: input.id,
          senderID: sender.id,
          method: input.method,
          path: label,
          rendererToMainMs,
          mainTotalMs,
        });
        return {
          status: 499,
          statusText: "Client Closed Request",
          headers: {},
          body: null,
          timings: {
            rendererToMainMs,
            connectionMs: 0,
            serviceMs: 0,
            responseBodyMs: 0,
            mainTotalMs,
          },
        };
      }
      openCodeRequestLog.error("request failed", {
        id: input.id,
        senderID: sender.id,
        method: input.method,
        path: label,
        rendererToMainMs,
        mainTotalMs: Date.now() - mainStartedAt,
        aborted: controller.signal.aborted,
        stage: error instanceof OpenCodeRequestStageError ? error.stage : "main-proxy",
        error: errorDiagnostic(error),
      });
      throw error;
    } finally {
      byID.delete(input.id);
      if (byID.size === 0) this.#controllers.delete(sender.id);
    }
  }

  cancel(sender: RequestSender, requestID: string): void {
    assertRequestID(requestID);
    this.#controllers.get(sender.id)?.get(requestID)?.abort();
  }

  cancelAll(sender: RequestSender): void {
    const requests = this.#controllers.get(sender.id);
    if (!requests) return;
    for (const controller of requests.values()) controller.abort();
    this.#controllers.delete(sender.id);
  }

  cancelAllRequests(): void {
    for (const requests of this.#controllers.values()) {
      for (const controller of requests.values()) controller.abort();
    }
    this.#controllers.clear();
  }
}
