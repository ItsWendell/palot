import type { OpenCodePairPayload } from "../../shared";
import { normalizeOpenCodeUrls } from "./profile-store";

export function parseOpenCodePairPayload(value: unknown): OpenCodePairPayload {
  if (!value || typeof value !== "object") throw new Error("OpenCode pairing payload is invalid");
  const payload = value as Record<string, unknown>;
  if (
    !Array.isArray(payload.urls) ||
    payload.urls.some((url) => typeof url !== "string") ||
    typeof payload.username !== "string" ||
    typeof payload.password !== "string" ||
    !payload.username ||
    !payload.password
  ) {
    throw new Error("OpenCode pairing payload is invalid");
  }
  return {
    urls: normalizeOpenCodeUrls(payload.urls),
    username: payload.username,
    password: payload.password,
  };
}

export function serializeOpenCodePairPayload(payload: OpenCodePairPayload): string {
  return JSON.stringify(parseOpenCodePairPayload(payload));
}

/** Parse only OpenCode's public, one-use /auth/connect/:code URL. Never fetch on paste. */
export function parseOneTimePairingLink(value: string): { origin: string; code: string } {
  if (value.length > 2_048) throw new Error("OpenCode pairing link is too long");
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("Enter a complete OpenCode pairing link");
  }
  const code = url.pathname.match(/^\/auth\/connect\/([A-Za-z0-9_-]{16,128})$/)?.[1];
  if (
    (url.protocol !== "https:" && url.protocol !== "http:") ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !code
  ) {
    throw new Error("Enter an OpenCode one-time pairing link without extra URL parameters");
  }
  return { origin: url.origin, code };
}
