import { open } from "node:fs/promises";
import path from "node:path";

const MAX_WORKSPACE_STATE_BYTES = 4 * 1024 * 1024;
const TEAM_ID = /^T[A-Z0-9]+$/;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Read Slack's public workspace directory only. Never inspect auth/session data. */
export async function localSlackTeamID(
  appDataDirectory: string,
  hostname: string,
): Promise<string | null> {
  try {
    const file = await open(
      path.join(appDataDirectory, "Slack", "storage", "root-state.json"),
      "r",
    );
    let contents: string;
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.size > MAX_WORKSPACE_STATE_BYTES) return null;
      // Bound the read itself too: a file can grow after stat(). Do not retain a
      // cache, so workspace renames/removals take effect on the next click.
      const buffer = Buffer.alloc(MAX_WORKSPACE_STATE_BYTES + 1);
      let offset = 0;
      while (offset < buffer.length) {
        const { bytesRead } = await file.read(buffer, offset, buffer.length - offset, offset);
        if (bytesRead === 0) break;
        offset += bytesRead;
      }
      if (offset > MAX_WORKSPACE_STATE_BYTES) return null;
      contents = buffer.subarray(0, offset).toString("utf8");
    } finally {
      await file.close();
    }

    const root: unknown = JSON.parse(contents);
    if (!record(root) || !record(root.workspaces)) return null;
    const matches = new Set<string>();
    for (const [id, workspace] of Object.entries(root.workspaces)) {
      if (
        !TEAM_ID.test(id) ||
        !record(workspace) ||
        workspace.id !== id ||
        typeof workspace.url !== "string"
      )
        continue;
      try {
        const url = new URL(workspace.url);
        if (
          url.protocol === "https:" &&
          !url.username &&
          !url.password &&
          !url.port &&
          url.hostname === hostname &&
          url.pathname === "/" &&
          !url.search &&
          !url.hash
        )
          matches.add(id);
      } catch {
        // Ignore invalid workspace entries without exposing their contents.
      }
    }
    // Never choose an arbitrary workspace when local metadata is ambiguous.
    return matches.size === 1 ? [...matches][0]! : null;
  } catch {
    return null;
  }
}
