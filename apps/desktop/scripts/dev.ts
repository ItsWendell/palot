/** Supervises Vite and a restartable Palot Electron development process. */

import { type ChildProcess, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { watch, type FSWatcher } from "node:fs";
import { access, chmod, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { devControlFile, type DevControlInfo, parseDevControlInfo } from "./dev-control";
import { devWindowStartupEnvironment } from "./dev-startup";

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORKSPACE_ROOT = path.resolve(APP_ROOT, "../..");
const DATA_ROOT = path.join(WORKSPACE_ROOT, ".local/palot-dev");
const DEVELOPMENT_ID = createHash("sha256").update(WORKSPACE_ROOT).digest("hex").slice(0, 12);
const require = createRequire(import.meta.url);
const electronPath = require("electron") as string;
const viteWorker = path.join(APP_ROOT, "scripts/vite-dev-target.ts");
const controlFile = devControlFile(APP_ROOT);
const buildChildren = new Set<ChildProcess>();
const expectedExits = new WeakSet<ChildProcess>();
const outputWatchers: FSWatcher[] = [];
const RESTART_DEBOUNCE_MS = 150;
const FORCED_STOP_MS = 1_500;
const CRASH_WINDOW_MS = 10_000;
const MAX_RESTARTS_PER_WINDOW = 5;

let currentApp: ChildProcess | null = null;
let controlServer: Server | null = null;
let restartTimer: NodeJS.Timeout | null = null;
let restartQueue = Promise.resolve();
let recentRestarts: number[] = [];
let shuttingDown = false;
let ownsControlFile = false;
let controlToken = "";
let controlUrl = "";
let rendererUrl = "";
let cdpPort = 0;
let developmentEnvironment: NodeJS.ProcessEnv = process.env;

function runBuild(command: string, args: string[]): ChildProcess {
  const child = spawn(command, args, {
    cwd: APP_ROOT,
    env: developmentEnvironment,
    stdio: "inherit",
  });
  buildChildren.add(child);
  child.once("exit", (code) => {
    buildChildren.delete(child);
    if (!shuttingDown && code !== 0) void shutdown(code ?? 1);
  });
  return child;
}

async function waitForDevelopmentBuild(): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const [main, preload, renderer] = await Promise.allSettled([
      access(path.join(APP_ROOT, "out/main/index.js")),
      access(path.join(APP_ROOT, "out/preload/index.cjs")),
      fetch(rendererUrl, { signal: AbortSignal.timeout(250) }),
    ]);
    if (
      main.status === "fulfilled" &&
      preload.status === "fulfilled" &&
      renderer.status === "fulfilled" &&
      renderer.value.ok
    ) {
      return;
    }
    await sleep(100);
  }
  throw new Error("Timed out while waiting for the Vite development build");
}

async function startApp(): Promise<void> {
  if (shuttingDown || currentApp) return;
  const electronEnvironment: NodeJS.ProcessEnv = {
    ...developmentEnvironment,
    ELECTRON_RENDERER_URL: rendererUrl,
    PALOT_DEV_CONTROL_URL: controlUrl,
    PALOT_DEV_CONTROL_TOKEN: controlToken,
    PALOT_REMOTE_DEBUGGING_PORT: String(cdpPort),
  };
  delete electronEnvironment.ELECTRON_RUN_AS_NODE;
  const app = spawn(electronPath, ["."], {
    cwd: APP_ROOT,
    env: electronEnvironment,
    stdio: "inherit",
  });
  currentApp = app;
  await writeControlInfo();
  app.once("error", (error) => {
    if (currentApp === app) currentApp = null;
    if (!shuttingDown) scheduleRestart(`Electron failed: ${error.message}`);
  });
  app.once("exit", (code, signal) => {
    if (currentApp === app) currentApp = null;
    if (shuttingDown || expectedExits.has(app)) return;
    if (code === 0 && signal === null) void shutdown(0);
    else scheduleRestart(`Electron exited with ${signal ?? code ?? "unknown"}`);
  });
}

async function stopApp(): Promise<void> {
  const app = currentApp;
  if (!app) return;
  currentApp = null;
  expectedExits.add(app);
  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    app.once("exit", finish);
    app.kill("SIGTERM");
    setTimeout(() => {
      if (!settled) app.kill("SIGKILL");
      finish();
    }, FORCED_STOP_MS).unref();
  });
}

async function stopBuildChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    child.once("exit", finish);
    child.kill("SIGTERM");
    setTimeout(() => {
      if (!settled) child.kill("SIGKILL");
      finish();
    }, FORCED_STOP_MS).unref();
  });
}

function scheduleRestart(reason: string): void {
  if (shuttingDown) return;
  if (restartTimer) clearTimeout(restartTimer);
  restartTimer = setTimeout(() => {
    restartTimer = null;
    restartQueue = restartQueue
      .catch(() => undefined)
      .then(async () => {
        const now = Date.now();
        recentRestarts = recentRestarts.filter((timestamp) => now - timestamp < CRASH_WINDOW_MS);
        if (recentRestarts.length >= MAX_RESTARTS_PER_WINDOW) {
          console.error("Palot Dev stopped after five restarts in ten seconds.");
          await shutdown(1);
          return;
        }
        recentRestarts.push(now);
        console.log(`[palot-dev] Restarting Electron: ${reason}`);
        await stopApp();
        await waitForDevelopmentBuild();
        await startApp();
      });
  }, RESTART_DEBOUNCE_MS);
}

function watchBuildOutputs(): void {
  const outputs = [
    { directory: path.join(APP_ROOT, "out/main"), file: "index.js" },
    { directory: path.join(APP_ROOT, "out/preload"), file: "index.cjs" },
  ];
  for (const output of outputs) {
    outputWatchers.push(
      watch(output.directory, (_event, file) => {
        if (file === output.file) scheduleRestart(`${output.file} changed`);
      }),
    );
  }
}

async function startControlServer(): Promise<void> {
  controlToken = randomUUID();
  controlServer = createServer((request, response) => {
    if (
      request.method === "GET" &&
      request.url === "/health" &&
      request.headers.authorization === `Bearer ${controlToken}`
    ) {
      response.writeHead(200).end("ok");
      return;
    }
    if (
      request.method !== "POST" ||
      request.url !== "/restart" ||
      request.headers.authorization !== `Bearer ${controlToken}`
    ) {
      response.writeHead(404).end();
      return;
    }
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      if (body.length < 8_192) body += chunk;
    });
    request.on("end", () => {
      let reason = "Restart requested";
      try {
        const parsed = JSON.parse(body) as { reason?: unknown };
        if (typeof parsed.reason === "string" && parsed.reason.trim())
          reason = parsed.reason.trim();
      } catch {}
      response.writeHead(202, { "content-type": "application/json" }).end('{"accepted":true}');
      scheduleRestart(reason);
    });
  });
  await new Promise<void>((resolve, reject) => {
    controlServer?.once("error", reject);
    controlServer?.listen(0, "127.0.0.1", resolve);
  });
  const address = controlServer.address();
  if (!address || typeof address === "string") throw new Error("Could not bind dev control server");
  controlUrl = `http://127.0.0.1:${address.port}`;
  await writeControlInfo();
  ownsControlFile = true;
}

async function writeControlInfo(): Promise<void> {
  const info: DevControlInfo = {
    version: 2,
    pid: process.pid,
    electronPid: currentApp?.pid ?? null,
    url: controlUrl,
    token: controlToken,
    rendererUrl,
    cdpPort,
    dataRoot: DATA_ROOT,
  };
  await writeFile(controlFile, JSON.stringify(info), { mode: 0o600 });
  await chmod(controlFile, 0o600);
}

async function allocatePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not allocate a dev port");
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return address.port;
}

async function prepareDevelopmentEnvironment(): Promise<void> {
  const [rendererPort, remoteDebuggingPort] = await Promise.all([allocatePort(), allocatePort()]);
  rendererUrl = `http://127.0.0.1:${rendererPort}`;
  cdpPort = remoteDebuggingPort;
  developmentEnvironment = {
    ...process.env,
    ...devWindowStartupEnvironment(process.argv.slice(2)),
    PALOT_RENDERER_PORT: String(rendererPort),
    PALOT_DEV_INSTANCE_ID: DEVELOPMENT_ID,
    PALOT_LOG_DIR: path.join(DATA_ROOT, "logs"),
    PALOT_CONNECTION_PROFILE_ID: `dev:${WORKSPACE_ROOT}`,
  };
  console.log(`[palot-dev] Renderer: ${rendererUrl}`);
  console.log(`[palot-dev] Electron CDP: ${cdpPort}`);
  console.log(
    `[palot-dev] Window startup: ${
      developmentEnvironment.PALOT_START_HIDDEN === "1"
        ? "hidden"
        : developmentEnvironment.PALOT_START_INACTIVE === "1"
          ? "visible, inactive"
          : "focused"
    }`,
  );
  console.log(`[palot-dev] Logs: ${path.join(DATA_ROOT, "logs")}`);
}

async function removeStaleControlFile(): Promise<void> {
  let existing: DevControlInfo;
  try {
    existing = parseDevControlInfo(await readFile(controlFile, "utf8"));
  } catch {
    await rm(controlFile, { force: true });
    return;
  }
  const response = await fetch(new URL("/health", existing.url), {
    headers: { authorization: `Bearer ${existing.token}` },
    signal: AbortSignal.timeout(500),
  }).catch(() => null);
  if (response?.ok) {
    throw new Error(`Palot Dev is already supervised by process ${existing.pid}.`);
  }
  await rm(controlFile, { force: true });
}

async function shutdown(exitCode: number): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  if (restartTimer) clearTimeout(restartTimer);
  for (const watcher of outputWatchers) watcher.close();
  await stopApp();
  await Promise.all([...buildChildren].map(stopBuildChild));
  await new Promise<void>((resolve) => controlServer?.close(() => resolve()) ?? resolve());
  if (ownsControlFile) await rm(controlFile, { force: true });
  process.exit(exitCode);
}

process.once("SIGINT", () => void shutdown(130));
process.once("SIGTERM", () => void shutdown(143));
process.once("SIGHUP", () => void shutdown(129));

try {
  await removeStaleControlFile();
  await prepareDevelopmentEnvironment();
  runBuild(process.execPath, [viteWorker, "build", "vite.main.config.ts"]);
  runBuild(process.execPath, [viteWorker, "build", "vite.preload.config.ts"]);
  runBuild(process.execPath, [viteWorker, "serve", "vite.renderer.config.ts"]);
  await waitForDevelopmentBuild();
  await startControlServer();
  watchBuildOutputs();
  await startApp();
} catch (error) {
  console.error(error);
  await shutdown(1);
}
