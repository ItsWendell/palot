import { spawn } from "node:child_process";
import { open, readFile, readdir, readlink } from "node:fs/promises";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

/** Match executable paths, never process names shared by other channels or services. */
export async function installedLinuxProcesses(executables: readonly string[]): Promise<number[]> {
  const matches = await Promise.all(
    (await readdir("/proc"))
      .filter((pid) => /^\d+$/.test(pid))
      .map(async (pid) => {
        try {
          const executable = (await readlink(`/proc/${pid}/exe`)).replace(/ \(deleted\)$/, "");
          if (!executables.includes(executable)) return null;
          const args = (await readFile(`/proc/${pid}/cmdline`, "utf8")).split("\0");
          // Chromium rewrites argv into a space-separated process title on Linux.
          // Its --type flag can therefore be inside argv[0], not a separate argument.
          // Signalling those children kills the zygote while the main app is quitting,
          // provoking GPU launch/fallback fatals during asynchronous quit cleanup.
          if (args.some((arg) => /(?:^|\s)--type=/.test(arg))) return null;
          // A forked child can exec another binary between the two /proc reads.
          // Never combine the installed executable with that new program's argv.
          const currentExecutable = (await readlink(`/proc/${pid}/exe`)).replace(
            / \(deleted\)$/,
            "",
          );
          if (currentExecutable !== executable) return null;
          return Number(pid);
        } catch (error) {
          if (["ENOENT", "ESRCH", "EACCES"].includes((error as NodeJS.ErrnoException).code ?? ""))
            return null;
          throw error;
        }
      }),
  );
  return matches.filter((pid): pid is number => pid !== null);
}

export async function stopLinuxInstallation(
  executables: readonly string[],
  timeoutMs = 30_000,
): Promise<void> {
  for (const pid of await installedLinuxProcesses(executables)) {
    try {
      process.kill(pid, "SIGTERM");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
  }
  const deadline = Date.now() + timeoutMs;
  while ((await installedLinuxProcesses(executables)).length) {
    if (Date.now() >= deadline)
      throw new Error(
        "Could not quit the installed app; the existing installation was not replaced.",
      );
    await sleep(250);
  }
}

/**
 * The command that starts the installed app. With a systemd user manager the app gets its own
 * scope in `app.slice`, like a desktop launch. Chromium moves only its main process into a scope
 * of its own; the zygote, GPU and renderer children stay where they started. Launched from the
 * installer's cgroup, restarting that unit (for example an OpenCode service running an agent's
 * shell) kills those children and takes the app down.
 */
export function linuxLaunchCommand(
  executable: string,
  systemdScope: boolean,
): { command: string; args: string[] } {
  if (!systemdScope) return { command: executable, args: ["--show"] };
  return {
    command: "systemd-run",
    args: [
      "--user",
      "--scope",
      "--quiet",
      "--collect",
      "--slice=app.slice",
      `--description=${path.basename(executable)}`,
      "--",
      executable,
      "--show",
    ],
  };
}

/** Whether `systemd-run --user` can create scopes: the user manager answers and the tool exists. */
export async function systemdUserScopesAvailable(): Promise<boolean> {
  const answers = (command: string, args: string[]) =>
    new Promise<boolean>((resolve) => {
      const child = spawn(command, args, { stdio: "ignore" });
      child.once("error", () => resolve(false));
      child.once("exit", (code) => resolve(code === 0));
    });
  return (
    (await answers("systemctl", ["--user", "show-environment"])) &&
    (await answers("systemd-run", ["--version"]))
  );
}

export async function launchLinuxInstallation(
  executable: string,
  logPath: string,
  options: { systemdScope?: boolean } = {},
): Promise<void> {
  const environment = { ...process.env };
  delete environment.ELECTRON_RUN_AS_NODE;
  const { command, args } = linuxLaunchCommand(
    executable,
    options.systemdScope ?? (await systemdUserScopesAvailable()),
  );
  const log = await open(logPath, "a", 0o600);
  try {
    const child = spawn(command, args, {
      cwd: path.dirname(executable),
      env: environment,
      detached: true,
      stdio: ["ignore", log.fd, log.fd],
    });
    await new Promise<void>((resolve, reject) => {
      child.once("error", reject);
      child.once("spawn", resolve);
    });
    child.unref();
    const deadline = Date.now() + 10_000;
    let runningSince: number | null = null;
    while (Date.now() < deadline) {
      const running = (await installedLinuxProcesses([executable])).length > 0;
      runningSince = running ? (runningSince ?? Date.now()) : null;
      if (runningSince !== null && Date.now() - runningSince >= 2_000) return;
      if (child.exitCode !== null || child.signalCode !== null) break;
      await sleep(250);
    }
    throw new Error(`Installed app did not stay running. See ${logPath}`);
  } finally {
    await log.close();
  }
}
