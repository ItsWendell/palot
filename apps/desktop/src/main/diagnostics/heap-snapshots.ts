import type { OpenCodeClient } from "@opencode/client";
import { app, BrowserWindow, shell, type WebContents } from "electron";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";
import { writeHeapSnapshot } from "node:v8";
import type { OpenCodeRuntimeStatus, PalotApi } from "../../shared/opencode-contract";
import { isMissingOpenCodeRoute } from "../../shared/opencode-missing-route";
import { palotDataLocations } from "../data-recovery";
import { windowRole } from "../ipc-security";
import { openCodeRuntime } from "../opencode-runtime";
import { supportsClientHostedMcp } from "../opencode-version";

type Capture = Awaited<ReturnType<PalotApi["heapSnapshots"]>>;
type Snapshot = {
  process: "main" | "renderer" | "server";
  label: string;
  startedAt: string;
  completedAt: string;
  status: "captured" | "error" | "unsupported" | "skipped";
  pid?: number;
  windowID?: number;
  title?: string;
  file?: string;
  memory?: NodeJS.MemoryUsage;
  error?: string;
  reason?: string;
};

let capturing = false;
// Reveal only captures made by this window, never a path supplied by a renderer.
const captures = new WeakMap<WebContents, Map<string, Capture>>();

export async function heapSnapshots(owner: WebContents, input: unknown): Promise<Capture> {
  if (!input || typeof input !== "object") throw new Error("Heap snapshot action is invalid.");
  const action = input as { type?: unknown; captureID?: unknown };
  if (action.type === "reveal") {
    const capture =
      typeof action.captureID === "string" ? captures.get(owner)?.get(action.captureID) : undefined;
    if (!capture) throw new Error("Heap snapshot capture is unavailable.");
    shell.showItemInFolder(capture.directory);
    return capture;
  }
  if (action.type !== "capture") throw new Error("Heap snapshot action is invalid.");
  const capture = await captureHeapSnapshots();
  const owned = captures.get(owner) ?? new Map<string, Capture>();
  owned.set(capture.captureID, capture);
  captures.set(owner, owned);
  return capture;
}

export async function captureHeapSnapshots(): Promise<Capture> {
  if (capturing) throw new Error("Heap snapshots are already being captured.");
  capturing = true;
  try {
    const startedAt = new Date().toISOString();
    // Pin the focused connection before any asynchronous work; never follow a later switch.
    const runtime = openCodeRuntime.runtimeStatus();
    const windows = BrowserWindow.getAllWindows().filter(
      (window) =>
        !window.isDestroyed() &&
        !window.webContents.isDestroyed() &&
        windowRole(window) !== undefined,
    );
    const root = path.resolve(palotDataLocations().logs, "diagnostics");
    await mkdir(root, { recursive: true, mode: 0o700 });
    // mkdtemp creates an owner-only folder. Snapshots can contain credentials and task content.
    const directory = await mkdtemp(path.join(root, `heap-${startedAt.replace(/[:.]/g, "-")}-`));
    const before = memorySummary();
    const snapshots: Snapshot[] = [];

    // A snapshot can double the process's memory. Serialize every capture, including the server.
    snapshots.push(await captureServer(runtime, directory));
    for (const window of windows) snapshots.push(await captureWindow(window, directory));
    // Main goes last: writing its heap blocks the loop receiving the renderer snapshots.
    snapshots.push(captureMain(directory));

    const complete = snapshots.every(
      (snapshot) => snapshot.status === "captured" || snapshot.status === "skipped",
    );
    await writeFile(
      path.join(directory, "manifest.json"),
      JSON.stringify(
        {
          format: 1,
          startedAt,
          completedAt: new Date().toISOString(),
          complete,
          warning:
            "Heap snapshots may contain credentials, prompts, and file contents. Share carefully.",
          application: {
            name: app.getName(),
            version: app.getVersion(),
            packaged: app.isPackaged,
            platform: process.platform,
            architecture: process.arch,
            versions: process.versions,
          },
          connection: {
            connectionID: runtime.connectionID,
            profileID: runtime.profileID,
            topology: runtime.topology ?? "unknown",
          },
          memoryUnits: { main: "bytes", server: "bytes", appMetrics: "KiB" },
          before,
          after: memorySummary(),
          snapshots,
        },
        null,
        2,
      ),
      { encoding: "utf8", mode: 0o600 },
    );
    return { captureID: randomUUID(), directory, complete };
  } finally {
    capturing = false;
  }
}

function memorySummary() {
  return {
    capturedAt: new Date().toISOString(),
    main: process.memoryUsage(),
    appMetrics: app.getAppMetrics(),
  };
}

async function captureServer(runtime: OpenCodeRuntimeStatus, directory: string): Promise<Snapshot> {
  const startedAt = new Date().toISOString();
  const base = { process: "server" as const, label: "OpenCode server", startedAt };
  if (runtime.topology !== "same-machine" || !runtime.connected) {
    return {
      ...base,
      completedAt: new Date().toISOString(),
      status: "skipped",
      reason:
        runtime.topology === "remote-machine"
          ? "Remote server: snapshot paths are server-local."
          : !runtime.connected
            ? "The OpenCode server is not connected."
            : "The server's machine topology is unknown.",
    };
  }
  try {
    const snapshot = await openCodeRuntime
      .scopedConnection(runtime.connectionID)
      .withClient((client: OpenCodeClient) => client.debug.heapDump({ directory }));
    if (path.dirname(snapshot.path) !== directory) {
      throw new Error(`The server wrote its snapshot outside the capture folder: ${snapshot.path}`);
    }
    return {
      ...base,
      completedAt: new Date().toISOString(),
      status: "captured",
      pid: snapshot.pid,
      file: path.basename(snapshot.path),
      memory: snapshot.memory,
    };
  } catch (error) {
    // debug.heapDump arrived in 2.1.4 with client-hosted MCP; newer servers report real errors.
    const unsupported = isMissingOpenCodeRoute(error) && !supportsClientHostedMcp(runtime.version);
    return {
      ...base,
      completedAt: new Date().toISOString(),
      status: unsupported ? "unsupported" : "error",
      error: unsupported
        ? "Server too old: update and restart OpenCode to capture its heap snapshot."
        : errorMessage(error),
    };
  }
}

async function captureWindow(window: BrowserWindow, directory: string): Promise<Snapshot> {
  const base = {
    process: "renderer" as const,
    label: `${windowRole(window)} window ${window.id}`,
    windowID: window.id,
    startedAt: new Date().toISOString(),
  };
  let pid: number | undefined;
  let title: string | undefined;
  try {
    pid = window.webContents.getOSProcessId();
    title = window.getTitle();
    const file = `window-${window.id}-${pid}.heapsnapshot`;
    await window.webContents.takeHeapSnapshot(path.join(directory, file));
    return { ...base, pid, title, file, status: "captured", completedAt: new Date().toISOString() };
  } catch (error) {
    return {
      ...base,
      pid,
      title,
      status: "error",
      completedAt: new Date().toISOString(),
      error: errorMessage(error),
    };
  }
}

function captureMain(directory: string): Snapshot {
  const base = {
    process: "main" as const,
    label: "Palot main process",
    pid: process.pid,
    startedAt: new Date().toISOString(),
  };
  try {
    const file = path.basename(
      writeHeapSnapshot(path.join(directory, `main-${process.pid}.heapsnapshot`)),
    );
    return { ...base, file, status: "captured", completedAt: new Date().toISOString() };
  } catch (error) {
    return {
      ...base,
      status: "error",
      completedAt: new Date().toISOString(),
      error: errorMessage(error),
    };
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
