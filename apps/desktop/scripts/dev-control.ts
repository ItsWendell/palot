/** Shared discovery contract for the local Palot development supervisor. */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

export interface DevControlInfo {
  version: 2;
  pid: number;
  electronPid: number | null;
  url: string;
  token: string;
  rendererUrl: string;
  cdpPort: number;
  dataRoot: string;
}

export function devControlFile(appRoot: string): string {
  const id = createHash("sha256").update(path.resolve(appRoot)).digest("hex").slice(0, 16);
  return path.join(tmpdir(), `palot-dev-${id}.json`);
}

export function parseDevControlInfo(value: string): DevControlInfo {
  const parsed = JSON.parse(value) as Partial<DevControlInfo>;
  if (
    parsed.version !== 2 ||
    typeof parsed.pid !== "number" ||
    (typeof parsed.electronPid !== "number" && parsed.electronPid !== null) ||
    typeof parsed.url !== "string" ||
    typeof parsed.token !== "string" ||
    typeof parsed.rendererUrl !== "string" ||
    typeof parsed.cdpPort !== "number" ||
    typeof parsed.dataRoot !== "string"
  ) {
    throw new Error("The Palot development control file is invalid.");
  }
  return parsed as DevControlInfo;
}

/** Discover a live renderer, not just ports left behind by a previous supervisor. */
export async function discoverDevInstance(appRoot: string) {
  let info: DevControlInfo;
  try {
    info = parseDevControlInfo(await readFile(devControlFile(appRoot), "utf8"));
  } catch {
    throw new Error("No valid Palot Dev instance in this worktree. Start it with bun run dev.");
  }
  const health = await fetch(new URL("/health", info.url), {
    headers: { authorization: `Bearer ${info.token}` },
    signal: AbortSignal.timeout(1_000),
  }).catch(() => null);
  if (!health?.ok) {
    throw new Error(
      "Palot Dev is no longer responding in this worktree. Start it with bun run dev.",
    );
  }

  const notReady = "Palot Dev is starting or restarting. Retry bun run dev:info shortly.";
  if (info.electronPid === null) throw new Error(notReady);
  let targets: Array<{ type?: string; url?: string; webSocketDebuggerUrl?: string }>;
  try {
    const response = await fetch(`http://127.0.0.1:${info.cdpPort}/json/list`, {
      signal: AbortSignal.timeout(1_000),
    });
    if (!response.ok) throw new Error(notReady);
    targets = await response.json();
    if (!Array.isArray(targets)) throw new Error(notReady);
  } catch {
    throw new Error(notReady);
  }
  const renderer = new URL(info.rendererUrl);
  const target = targets.find((candidate) => {
    if (candidate.type !== "page" || !candidate.url || !candidate.webSocketDebuggerUrl)
      return false;
    try {
      const url = new URL(candidate.url);
      return url.origin === renderer.origin && url.pathname === renderer.pathname;
    } catch {
      return false;
    }
  });
  if (!target) throw new Error(notReady);

  return {
    supervisorPid: info.pid,
    electronPid: info.electronPid,
    rendererUrl: info.rendererUrl,
    cdpPort: info.cdpPort,
    pageWebSocketUrl: target.webSocketDebuggerUrl,
    dataRoot: info.dataRoot,
    logDirectory: path.join(info.dataRoot, "logs"),
  };
}
