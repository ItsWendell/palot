import { spawn } from "node:child_process";
import { userInfo } from "node:os";
import path from "node:path";

const SHELL_TIMEOUT_MS = 5_000;
/** Shells whose rc files can install a DEBUG trap that prints before each command. */
const DEBUG_TRAP_SHELLS = new Set(["bash", "zsh", "sh", "ksh", "ksh93"]);
const ENVIRONMENT_MARKER = "__PALOT_SHELL_ENVIRONMENT__";

type ShellMode = "-il" | "-l";
export type ShellProbe =
  | { type: "loaded"; environment: Record<string, string> }
  | { type: "failed" }
  | { type: "timeout" };
export type SpawnShell = typeof spawn;

export function parseShellEnvironment(output: Buffer): Record<string, string> {
  const environment: Record<string, string> = {};
  for (const entry of output.toString("utf8").split("\0")) {
    const separator = entry.indexOf("=");
    if (separator <= 0) continue;
    environment[entry.slice(0, separator)] = entry.slice(separator + 1);
  }
  return environment;
}

export function mergePath(shellPath: string | undefined, appPath: string | undefined): string {
  return [...new Set([shellPath, appPath].flatMap((value) => value?.split(path.delimiter) ?? []))]
    .filter(Boolean)
    .join(path.delimiter);
}

export function shellProbeCommand(shell: string): string {
  const capture = `echo ${ENVIRONMENT_MARKER}; env -0`;
  // A DEBUG trap that echoes each command would print between the marker and `env -0`.
  // OpenBSD ksh (also its /bin/sh) exits on `trap - DEBUG`, so a subshell tries it first.
  return DEBUG_TRAP_SHELLS.has(path.basename(shell).toLowerCase())
    ? `(trap - DEBUG) 2>/dev/null && trap - DEBUG; ${capture}`
    : capture;
}

/** Parses the probe's output, skipping anything rc files or traps printed before the marker. */
export function parseShellProbeOutput(output: Buffer): Record<string, string> {
  const marker = output.indexOf(`${ENVIRONMENT_MARKER}\n`);
  return parseShellEnvironment(
    marker === -1 ? output : output.subarray(marker + ENVIRONMENT_MARKER.length + 1),
  );
}

/** Runs one login-shell probe without blocking the main process while slow rc files run. */
export function probeShellEnvironment(
  shell: string,
  mode: ShellMode,
  spawnShell: SpawnShell = spawn,
  timeoutMs = SHELL_TIMEOUT_MS,
): Promise<ShellProbe> {
  return new Promise((resolve) => {
    let settled = false;
    let timer: NodeJS.Timeout | undefined;
    const finish = (probe: ShellProbe) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(probe);
    };
    const chunks: Buffer[] = [];
    let child: ReturnType<SpawnShell>;
    try {
      child = spawnShell(shell, [mode, "-c", shellProbeCommand(shell)], {
        stdio: ["ignore", "pipe", "ignore"],
        windowsHide: true,
      });
    } catch {
      return finish({ type: "failed" });
    }
    timer = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill();
      finish({ type: "timeout" });
    }, timeoutMs);
    child.stdout?.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.on("error", () => finish({ type: "failed" }));
    child.on("close", (status) => {
      if (status !== 0) return finish({ type: "failed" });
      const environment = parseShellProbeOutput(Buffer.concat(chunks));
      finish(
        Object.keys(environment).length > 0 ? { type: "loaded", environment } : { type: "failed" },
      );
    });
  });
}

let hydration: Promise<void> | undefined;

/** Loads the login shell's environment once; later callers share the same probe. */
export function hydrateShellEnvironment(spawnShell: SpawnShell = spawn): Promise<void> {
  return (hydration ??= loadShellEnvironment(spawnShell));
}

async function loadShellEnvironment(spawnShell: SpawnShell): Promise<void> {
  if (process.platform === "win32") return;

  let loginShell: string | undefined;
  try {
    loginShell = userInfo().shell || undefined;
  } catch {
    loginShell = undefined;
  }
  const shell = process.env.SHELL || loginShell || "/bin/sh";
  if (["nu", "nu.exe"].includes(path.basename(shell).toLowerCase())) return;

  for (const mode of ["-il", "-l"] as const) {
    const probe = await probeShellEnvironment(shell, mode, spawnShell);
    if (probe.type !== "loaded") continue;

    const shellEnvironment = probe.environment;
    const appPath = process.env.PATH;
    for (const [key, value] of Object.entries(shellEnvironment)) {
      if (process.env[key] === undefined) process.env[key] = value;
    }
    process.env.PATH = mergePath(shellEnvironment.PATH, appPath);
    console.info(`[environment] Loaded login shell environment from ${shell}`);
    return;
  }

  console.warn(`[environment] Could not load login shell environment from ${shell}`);
}
