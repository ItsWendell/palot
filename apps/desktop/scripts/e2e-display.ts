import { type ChildProcess } from "node:child_process";
import { constants } from "node:fs";
import { access, chmod, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import type { E2ERun } from "./e2e-lifecycle.ts";

export type DisplayMode = "desktop" | "private";

export function selectDisplay(value: string | undefined, platform = process.platform): DisplayMode {
  if (value && value !== "desktop" && value !== "private")
    throw new Error(`Unknown --display '${value}'. Choose private or desktop.`);
  const mode: DisplayMode =
    value === "private"
      ? "private"
      : value === "desktop"
        ? "desktop"
        : platform === "linux"
          ? "private"
          : "desktop";
  if (mode === "private" && platform !== "linux")
    throw new Error("--display=private requires Linux and Weston; use --display=desktop here.");
  return mode;
}

export async function findWestonBinary(pathEnvironment = process.env.PATH ?? ""): Promise<string> {
  for (const directory of pathEnvironment.split(path.delimiter).filter(Boolean)) {
    const candidate = path.join(directory, "weston");
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Keep searching PATH. Never fall back to the host display.
    }
  }
  throw new Error(
    "Private E2E display requires Weston on PATH. Install Weston or explicitly use --display=desktop (uses your desktop).",
  );
}

export function privateElectronEnvironment(
  environment: Record<string, string>,
  runtimeDirectory: string,
  socket: string,
): Record<string, string> {
  const isolated: Record<string, string> = {
    ...environment,
    XDG_RUNTIME_DIR: runtimeDirectory,
    WAYLAND_DISPLAY: socket,
  };
  delete isolated.DISPLAY;
  delete isolated.WAYLAND_SOCKET;
  return isolated;
}

/** Weston belongs to this E2E run, not the user's compositor or display session. */
export async function startPrivateDisplay(
  run: E2ERun,
  weston: string,
): Promise<{ runtimeDirectory: string; socket: string }> {
  run.check();
  const runtimeDirectory = await mkdtemp(path.join(tmpdir(), "pw-"));
  try {
    await chmod(runtimeDirectory, 0o700);
  } catch (error) {
    await rm(runtimeDirectory, { recursive: true, force: true });
    throw error;
  }
  const socket = "palot-wayland";
  const socketPath = path.join(runtimeDirectory, socket);
  let child: ChildProcess | undefined;
  // Linux sockaddr_un.sun_path is 108 bytes including NUL.
  if (Buffer.byteLength(socketPath) >= 108) {
    await rm(runtimeDirectory, { recursive: true, force: true });
    throw new Error(
      `Private display socket path is too long: ${socketPath}. Set TMPDIR to a short path.`,
    );
  }
  // This acquisition is registered before spawn, and still releases the directory
  // when startup fails or a signal interrupts setup.
  try {
    await run.acquire(
      "private Wayland runtime directory",
      async () => runtimeDirectory,
      async () => {
        if (child && child.exitCode === null && child.signalCode === null)
          throw new Error(
            `Weston is still running; retaining its runtime directory: ${runtimeDirectory}`,
          );
        await rm(runtimeDirectory, { recursive: true, force: true });
      },
      2,
    );
  } catch (error) {
    // An interruption before acquire registers its release must not leak the directory.
    await rm(runtimeDirectory, { recursive: true, force: true });
    throw error;
  }
  const displayPath = path.join(run.root, "display.json");
  const details = {
    mode: "private",
    backend: "headless",
    renderer: "pixman",
    width: 1920,
    height: 1080,
    scale: 1,
    runtimeDirectory,
    socket,
    log: "weston.log",
    ready: false,
  };
  await writeFile(displayPath, JSON.stringify(details, null, 2), { mode: 0o600 });
  const environment: NodeJS.ProcessEnv = { ...process.env, XDG_RUNTIME_DIR: runtimeDirectory };
  delete environment.DISPLAY;
  delete environment.WAYLAND_DISPLAY;
  delete environment.WAYLAND_SOCKET;
  const launched = run.spawn(
    "weston",
    weston,
    [
      "--backend=headless",
      "--renderer=pixman",
      "--width=1920",
      "--height=1080",
      "--scale=1",
      "--idle-time=0",
      "--no-config",
      `--socket=${socket}`,
      "--fake-seat",
    ],
    { env: environment, cwd: run.root },
    1,
  );
  child = launched.child;
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    run.check();
    if (child.exitCode !== null || child.signalCode !== null)
      throw new Error(
        `Weston exited before the private display was ready (${child.signalCode ?? child.exitCode}). See ${path.join(run.root, "weston.log")}`,
      );
    if ((await stat(socketPath).catch(() => null))?.isSocket()) {
      await writeFile(displayPath, JSON.stringify({ ...details, ready: true }, null, 2), {
        mode: 0o600,
      });
      return { runtimeDirectory, socket };
    }
    await sleep(100, undefined, { signal: run.signal });
  }
  throw new Error(
    `Weston did not create its private Wayland socket within 10 seconds. See ${path.join(run.root, "weston.log")}`,
  );
}
