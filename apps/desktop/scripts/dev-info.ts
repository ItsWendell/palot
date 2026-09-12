/** Prints connection details for this worktree's Palot development instance. */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { discoverDevInstance } from "./dev-control";

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

try {
  const { values } = parseArgs({ options: { help: { type: "boolean", short: "h" } } });
  if (values.help) {
    console.log(`Usage: bun run dev:info

Print JSON for this worktree's live supervisor and Electron renderer.
Exits nonzero if the instance is stopped, starting, or restarting. Does not start it.
Includes pageWebSocketUrl and logDirectory; never prints the control token.

Examples:
  bun run --silent dev:info
  info="$(bun run --silent dev:info)" && agent-browser connect "$(printf '%s' "$info" | jq -er .pageWebSocketUrl)"`);
  } else {
    console.log(JSON.stringify(await discoverDevInstance(APP_ROOT)));
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "Could not discover Palot Dev.");
  process.exitCode = 1;
}
