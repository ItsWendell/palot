import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { build } from "vite-plus";
import { beginBuildInputCapture, finishBuildInputCapture, type BuildPhase } from "./build-inputs";
import { verifyRendererCss } from "./renderer-css-contract";

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG_FILES = process.argv.includes("--renderer-only")
  ? ["vite.renderer.config.ts"]
  : ["vite.main.config.ts", "vite.preload.config.ts", "vite.renderer.config.ts"];

const runDir = beginBuildInputCapture(
  APP_ROOT,
  CONFIG_FILES.map((file) => file.split(".")[1] as BuildPhase),
);
process.env.PALOT_BUILD_INPUTS_RUN_DIR = runDir;

if (process.platform === "darwin" && !process.argv.includes("--renderer-only")) {
  // Workspace dist files are generated, not checked in. Build the native wrapper
  // for fresh checkouts too; the architecture-specific native prebuild is vendored.
  const { stdout } = await promisify(execFile)(process.execPath, ["run", "build"], {
    cwd: path.resolve(APP_ROOT, "../../packages/electron-liquid-glass"),
  });
  console.log(stdout);
}

for (const configFile of CONFIG_FILES) {
  await build({
    configFile: path.join(APP_ROOT, configFile),
  });
  if (configFile === "vite.renderer.config.ts") {
    await verifyRendererCss(path.join(APP_ROOT, "out/renderer"));
  }
}

finishBuildInputCapture(runDir);
console.log(`Build input provenance: ${path.join(runDir, "manifest.json")}`);
