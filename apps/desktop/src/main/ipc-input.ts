/** Hand-written validation for renderer input that crosses the IPC boundary. */

import path from "node:path";
import * as v from "valibot";
import { normalizeServerName } from "../shared/server-name";
import { normalizeSshConfig } from "./ssh/config";
import type {
  OpenCodeCredentialInput,
  OpenCodePairImportInput,
  OpenCodePairPayload,
  OpenCodeProfileCreateInput,
  OpenCodeProfileUpdateInput,
  AttentionSnapshotInput,
} from "../shared";

export const identifier = v.pipe(v.string(), v.minLength(1), v.maxLength(512));

// The verbs the generated OpenCode client sends; nothing else needs to reach the service.
const OPENCODE_REQUEST_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);
const MAX_REQUEST_ID_LENGTH = 200;
const MAX_REQUEST_PATH_LENGTH = 8_192;
const MAX_REQUEST_HEADERS = 64;
const MAX_REQUEST_HEADER_NAME_LENGTH = 256;
const MAX_REQUEST_HEADER_VALUE_LENGTH = 8_192;

export function parseOpenCodeRequest(input: unknown) {
  if (!input || typeof input !== "object") throw new Error("OpenCode request is invalid");
  const value = input as Record<string, unknown>;
  if (
    typeof value.id !== "string" ||
    value.id.length > MAX_REQUEST_ID_LENGTH ||
    typeof value.rendererStartedAt !== "number" ||
    !Number.isFinite(value.rendererStartedAt) ||
    typeof value.path !== "string" ||
    value.path.length > MAX_REQUEST_PATH_LENGTH ||
    typeof value.method !== "string" ||
    !OPENCODE_REQUEST_METHODS.has(value.method) ||
    !value.headers ||
    typeof value.headers !== "object" ||
    Array.isArray(value.headers) ||
    (value.body !== null && !(value.body instanceof ArrayBuffer))
  ) {
    throw new Error("OpenCode request is invalid");
  }
  const entries = Object.entries(value.headers);
  if (entries.length > MAX_REQUEST_HEADERS) throw new Error("OpenCode request headers are invalid");
  const headers: Record<string, string> = {};
  for (const [key, header] of entries) {
    if (
      typeof header !== "string" ||
      key.length > MAX_REQUEST_HEADER_NAME_LENGTH ||
      header.length > MAX_REQUEST_HEADER_VALUE_LENGTH
    ) {
      throw new Error("OpenCode request headers are invalid");
    }
    headers[key] = header;
  }
  return {
    id: value.id,
    profileID: v.parse(v.optional(identifier), value.profileID),
    connectionID: v.parse(v.optional(identifier), value.connectionID),
    rendererStartedAt: value.rendererStartedAt,
    path: value.path,
    method: value.method,
    headers,
    body: value.body as ArrayBuffer | null,
  };
}

export function parseCredential(input: unknown): OpenCodeCredentialInput {
  if (!input || typeof input !== "object") throw new Error("OpenCode credential is invalid");
  const value = input as Record<string, unknown>;
  if (value.type === "none") return { type: "none" };
  if (
    value.type === "basic" &&
    typeof value.username === "string" &&
    typeof value.password === "string"
  ) {
    return { type: "basic", username: value.username, password: value.password };
  }
  if (value.type === "bearer" && typeof value.token === "string") {
    return { type: "bearer", token: value.token };
  }
  if (
    value.type === "headers" &&
    value.headers &&
    typeof value.headers === "object" &&
    !Array.isArray(value.headers)
  ) {
    const headers: Record<string, string> = {};
    for (const [key, header] of Object.entries(value.headers)) {
      if (typeof header !== "string") throw new Error("OpenCode credential headers are invalid");
      headers[key] = header;
    }
    return { type: "headers", headers };
  }
  throw new Error("OpenCode credential is invalid");
}

export function parseProfileCreate(input: unknown): OpenCodeProfileCreateInput {
  if (!input || typeof input !== "object") throw new Error("OpenCode profile is invalid");
  const value = input as Record<string, unknown>;
  const name = v.parse(v.pipe(v.string(), v.minLength(1), v.maxLength(120)), value.name);
  if (value.kind === "local") return { kind: "local", name };
  if (value.kind === "ssh") return { kind: "ssh", name, ssh: normalizeSshConfig(value.ssh) };
  if (value.kind === "remote" && Array.isArray(value.urls)) {
    return {
      kind: "remote",
      name,
      urls: value.urls.map((url) => v.parse(v.string(), url)),
      credential: parseCredential(value.credential),
      allowPlainHttp: v.parse(v.boolean(), value.allowPlainHttp),
    };
  }
  throw new Error("OpenCode profile is invalid");
}

export function parseProfileUpdate(input: unknown): OpenCodeProfileUpdateInput {
  if (!input || typeof input !== "object") throw new Error("OpenCode profile is invalid");
  const value = input as Record<string, unknown>;
  const id = v.parse(identifier, value.id);
  const parsed = parseProfileCreate({ ...value, credential: value.credential ?? { type: "none" } });
  if (parsed.kind === "remote") {
    return {
      ...parsed,
      id,
      ...(value.credential === undefined ? { credential: undefined } : {}),
    };
  }
  return { ...parsed, id };
}

function parsePairPayload(input: unknown): OpenCodePairPayload {
  if (!input || typeof input !== "object") throw new Error("OpenCode pairing payload is invalid");
  const value = input as Record<string, unknown>;
  if (!Array.isArray(value.urls)) throw new Error("OpenCode pairing URLs are invalid");
  return {
    urls: value.urls.map((url) => v.parse(v.string(), url)),
    username: v.parse(v.pipe(v.string(), v.minLength(1)), value.username),
    password: v.parse(v.pipe(v.string(), v.minLength(1)), value.password),
  };
}

export function parsePairImport(input: unknown): OpenCodePairImportInput {
  if (!input || typeof input !== "object") throw new Error("OpenCode pairing import is invalid");
  const value = input as Record<string, unknown>;
  let name: string | undefined;
  if (value.name !== undefined) {
    const normalized = normalizeServerName(value.name);
    if (!normalized) throw new Error("Server name is invalid");
    name = normalized;
  }
  if (value.link !== undefined) {
    if (value.payload !== undefined)
      throw new Error("Use a pairing link or reusable credentials, not both");
    return {
      link: v.parse(v.pipe(v.string(), v.minLength(1), v.maxLength(2_048)), value.link),
      allowPlainHttp: v.parse(v.boolean(), value.allowPlainHttp),
      ...(name ? { name } : {}),
    };
  }
  return {
    payload: parsePairPayload(value.payload),
    allowPlainHttp: v.parse(v.boolean(), value.allowPlainHttp),
    ...(name ? { name } : {}),
  };
}

const MAX_ATTACHMENT_PATH_LENGTH = 16_384;

/**
 * Paths of files dropped or pasted into the composer. Only absolute local paths are accepted, so
 * nothing resolves against the main process's working directory; Windows UNC paths are refused
 * because opening one makes the machine authenticate to whichever host the path names.
 */
export function parseAttachmentPaths(
  input: unknown,
  { limit, pathApi = path }: { limit: number; pathApi?: typeof path.posix },
): string[] {
  if (!input || typeof input !== "object") throw new Error("Attachment paths are invalid.");
  const value = (input as { paths?: unknown }).paths;
  if (!Array.isArray(value) || value.length === 0) throw new Error("Attachment paths are invalid.");
  if (value.length > limit) throw new Error(`Attach up to ${limit} files at a time.`);
  for (const item of value) {
    if (
      typeof item !== "string" ||
      !item ||
      item.length > MAX_ATTACHMENT_PATH_LENGTH ||
      item.includes("\0") ||
      !pathApi.isAbsolute(item) ||
      (pathApi.sep === "\\" && /^[\\/]{2}/.test(item))
    ) {
      throw new Error("Attachment paths must be absolute local file paths.");
    }
  }
  return [...new Set(value as string[])];
}

export function parseAttentionSnapshot(input: unknown): AttentionSnapshotInput {
  if (!input || typeof input !== "object") throw new Error("Attention snapshot input is invalid");
  const value = input as Record<string, unknown>;
  if (!Array.isArray(value.sessions) || value.sessions.length > 2_000) {
    throw new Error("Attention snapshot sessions are invalid");
  }
  for (const item of value.sessions) {
    if (!item || typeof item !== "object") throw new Error("Attention session is invalid");
    const session = item as Record<string, unknown>;
    if (typeof session.id !== "string" || typeof session.projectID !== "string") {
      throw new Error("Attention session identity is invalid");
    }
  }
  return {
    connectionID: v.parse(identifier, value.connectionID),
    sessions: value.sessions as AttentionSnapshotInput["sessions"],
  };
}
