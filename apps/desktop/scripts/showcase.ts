import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = path.resolve(appRoot, "../..");
const scene =
  process.argv.slice(2).find((argument) => !argument.startsWith("--")) ?? "readme-cover";
if (scene !== "readme-cover") throw new Error(`Unknown showcase scene '${scene}'`);

const child = spawn(
  process.execPath,
  [
    "--experimental-strip-types",
    path.join(appRoot, "scripts/e2e.ts"),
    "showcase-readme-cover",
    "--showcase",
    "--keep",
  ],
  {
    cwd: appRoot,
    env: {
      ...process.env,
      PALOT_SHOWCASE_BACKGROUND: path.join(appRoot, "showcase/backgrounds/dawn-haze.png"),
      PALOT_SHOWCASE_OUTPUT_DIRECTORY: path.join(workspaceRoot, "docs/assets"),
    },
    stdio: "inherit",
  },
);

const signal = await new Promise<NodeJS.Signals | null>((resolve, reject) => {
  child.once("error", reject);
  child.once("exit", (code, exitSignal) => {
    if (code && code !== 0) reject(new Error(`Showcase capture exited with code ${code}`));
    else resolve(exitSignal);
  });
});
if (signal) process.kill(process.pid, signal);
