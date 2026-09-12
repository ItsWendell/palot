import log from "electron-log/main";
import { errorDiagnostic } from "../shared";

export const openCodeLog = log.scope("opencode");
export const openCodeRequestLog = log.scope("opencode-request");

let clientRequestSequence = 0;

export function requestLabel(path: string): string {
  try {
    const url = new URL(path, "https://opencode.invalid");
    const query = [...new Set(url.searchParams.keys())];
    return query.length > 0 ? `${url.pathname}?${query.join("&")}` : url.pathname;
  } catch {
    return "<invalid-path>";
  }
}

export function observedOpenCodeFetch(fetch: typeof globalThis.fetch): typeof globalThis.fetch {
  return async (input, init) => {
    const id = `main-client-${++clientRequestSequence}`;
    const request = new Request(input, init);
    const startedAt = Date.now();
    const path = requestLabel(request.url);
    openCodeLog.debug("client request started", { id, method: request.method, path });
    try {
      const response = await fetch(request);
      const durationMs = Date.now() - startedAt;
      const details = { id, method: request.method, path, status: response.status, durationMs };
      if (response.status >= 400 || durationMs >= 1_000)
        openCodeLog.warn("client response", details);
      else openCodeLog.debug("client response", details);
      return response;
    } catch (error) {
      openCodeLog.error("client request failed", {
        id,
        method: request.method,
        path,
        durationMs: Date.now() - startedAt,
        error: errorDiagnostic(error),
      });
      throw error;
    }
  };
}
