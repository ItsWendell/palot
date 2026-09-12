/** Runs one pinned Vite development target without invoking Bun's shared bunx cache. */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { build, createServer } from "vite-plus";

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [mode, configName] = process.argv.slice(2);

if ((mode !== "build" && mode !== "serve") || !configName) {
  throw new Error("Usage: vite-dev-target.ts <build|serve> <config-file>");
}

const configFile = path.join(APP_ROOT, configName);
if (mode === "build") {
  await build({ configFile, build: { watch: {} } });
} else {
  const server = await createServer({ configFile });
  await server.listen();
}
