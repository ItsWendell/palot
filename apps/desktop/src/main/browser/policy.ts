// Derived from OpenCode v2.0.14 (MIT), Copyright (c) 2025 opencode.
// https://github.com/anomalyco/opencode/blob/v2.0.14/packages/desktop/src/main/browser/policy.ts
// URL policy shared by the pane and page. Electron-free so it stays unit-testable under Bun.

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function destinationOrigin(input: string) {
  if (!URL.canParse(input)) return;
  const url = new URL(input);
  return /^https?:$/.test(url.protocol) && !url.username && !url.password ? url.origin : undefined;
}

/** A file URL for this machine: no host, so UNC shares and remote hosts are rejected. */
export function localFileURL(input: string) {
  if (!URL.canParse(input)) return;
  const url = new URL(input);
  // Chromium does not interpret encoded separators as a path boundary. Decoding them
  // here would make an out-of-root URL appear to be inside a workspace directory.
  if (/%(?:2f|5c)/i.test(url.pathname)) return;
  return url.protocol === "file:" && !url.hostname ? url.href : undefined;
}

/** Case-insensitive on Windows, where drive letters and paths compare that way. */
function canonicalPath(input: string, encoded = false) {
  const value = (encoded ? decodeURIComponent(input) : input)
    .replaceAll("\\", "/")
    .replace(/^\/([A-Za-z]:\/)/, "$1");
  return process.platform === "win32" ? value.toLowerCase() : value;
}

/**
 * Whether a file URL points inside one of the allowed directories. The agent already has read
 * access to the session's workspace, so files there may be shown; anything else stays behind the
 * server's file permissions.
 */
export function fileURLWithin(input: string, roots: ReadonlyArray<string>) {
  const href = localFileURL(input);
  if (!href || roots.length === 0) return false;
  let path: string;
  try {
    path = canonicalPath(new URL(href).pathname, true);
  } catch {
    // Malformed percent escapes are not a workspace file path.
    return false;
  }
  const within = (target: string, root: string) => {
    const prefix = canonicalPath(root).replace(/\/+$/, "");
    return target === prefix || target.startsWith(`${prefix}/`);
  };
  try {
    const target = canonicalPath(realpathSync.native(fileURLToPath(href)));
    return roots.some((root) => {
      if (!within(path, root)) return false;
      try {
        return within(target, realpathSync.native(root));
      } catch {
        return false;
      }
    });
  } catch {
    return false;
  }
}

export type Policy = { readonly fileRoots?: ReadonlyArray<string> };

export function allowedDestination(input: string, policy?: Policy) {
  return !!destinationOrigin(input) || fileURLWithin(input, policy?.fileRoots ?? []);
}

export function normalizeURL(input: string, policy?: Policy) {
  const value = input.trim() || "about:blank";
  const local = /^(?:localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::\d+)?(?:[/?#]|$)/i.test(value);
  const url =
    value === "about:blank" || /^[a-z][a-z\d+.-]*:\/\//i.test(value)
      ? value
      : `${local ? "http" : "https"}://${value}`;
  if (url !== "about:blank" && !allowedDestination(url, policy))
    throw new Error(
      policy?.fileRoots?.length
        ? "Only HTTP, HTTPS, about:blank, and file URLs inside the workspace are supported."
        : "Only HTTP, HTTPS, and about:blank URLs are supported.",
    );
  return url;
}
