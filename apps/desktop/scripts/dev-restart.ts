/** Requests a safe Electron restart from the running Palot development supervisor. */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { devControlFile, parseDevControlInfo } from "./dev-control";

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const reason = process.argv.slice(2).join(" ").trim() || "Agent requested restart";
const controlFile = devControlFile(APP_ROOT);

let control;
try {
  control = parseDevControlInfo(await readFile(controlFile, "utf8"));
} catch (error) {
  throw new Error("Palot Dev is not running. Start it with bun run dev first.", { cause: error });
}

const response = await fetch(new URL("/restart", control.url), {
  method: "POST",
  headers: {
    authorization: `Bearer ${control.token}`,
    "content-type": "application/json",
  },
  body: JSON.stringify({ reason }),
  signal: AbortSignal.timeout(3_000),
});
if (!response.ok) throw new Error(`Palot Dev rejected the restart request (${response.status}).`);

console.log("Palot Dev restart scheduled.");
