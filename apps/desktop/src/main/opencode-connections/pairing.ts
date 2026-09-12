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
