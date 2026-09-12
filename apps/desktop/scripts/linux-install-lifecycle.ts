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

export async function launchLinuxInstallation(executable: string, logPath: string): Promise<void> {
  const environment = { ...process.env };
  delete environment.ELECTRON_RUN_AS_NODE;
  const log = await open(logPath, "a", 0o600);
  try {
    const child = spawn(executable, ["--show"], {
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
