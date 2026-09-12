import { spawnSync } from "node:child_process";
import { userInfo } from "node:os";
import path from "node:path";

const SHELL_TIMEOUT_MS = 5_000;

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

export function hydrateShellEnvironment(): void {
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
    const result = spawnSync(shell, [mode, "-c", "env -0"], {
      stdio: ["ignore", "pipe", "ignore"],
      timeout: SHELL_TIMEOUT_MS,
      windowsHide: true,
    });
    if (result.error || result.status !== 0) continue;

    const shellEnvironment = parseShellEnvironment(result.stdout);
    if (Object.keys(shellEnvironment).length === 0) continue;
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
