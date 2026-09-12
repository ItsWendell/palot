import { spawn } from "node:child_process";
import { homedir } from "node:os";

interface InstallationCommandResult {
  code: number;
  stdout: string;
  stderr: string;
  timedOut?: boolean;
  outputExceeded?: boolean;
}

const TERMINATION_GRACE_MS = 500;

/** Own the updater's process group, not just the CLI that launches the package manager. */
export function runOpenCodeInstallationCommand(
  file: string,
  args: string[],
  options: { timeout: number; maxBuffer: number },
): Promise<InstallationCommandResult> {
  if (process.platform !== "linux" && process.platform !== "darwin") {
    return Promise.reject(
      new Error("Local installation commands require Linux or macOS process groups."),
    );
  }
  if (
    !Number.isInteger(options.timeout) ||
    options.timeout <= 0 ||
    options.timeout > 2_147_483_647 ||
    !Number.isSafeInteger(options.maxBuffer) ||
    options.maxBuffer < 0
  ) {
    return Promise.reject(new Error("Invalid installation command limits."));
  }

  return new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      cwd: homedir(),
      detached: true,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    // Only this positive PID, created as a new group leader above, may be signalled.
    const group = child.pid;
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let bytes = 0;
    let code = 1;
    let timedOut = false;
    let outputExceeded = false;
    let settled = false;
    let cleaning = false;
    let grace: ReturnType<typeof setTimeout> | undefined;

    function signalGroup(signal: NodeJS.Signals | 0): boolean {
      if (group === undefined || !Number.isSafeInteger(group) || group <= 0) return false;
      try {
        process.kill(-group, signal);
        return true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
        // Never include command output, arguments, or environment in diagnostics.
        throw new Error("Unable to clean up the owned installation process group.");
      }
    }

    function finish(error?: unknown) {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      clearTimeout(grace);
      child.stdout.destroy();
      child.stderr.destroy();
      if (error) {
        reject(error);
        return;
      }
      resolve({
        code: cleaning || timedOut || outputExceeded ? 1 : code,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        ...(timedOut ? { timedOut: true } : {}),
        ...(outputExceeded ? { outputExceeded: true } : {}),
      });
    }

    function cleanup() {
      if (settled || cleaning) return;
      cleaning = true;
      clearTimeout(deadline);
      try {
        if (!signalGroup("SIGTERM")) {
          finish();
          return;
        }
        grace = setTimeout(() => {
          try {
            // Do not cancel escalation on leader exit/close: its children can ignore TERM
            // and may have closed their inherited pipes while continuing installation.
            signalGroup("SIGKILL");
            finish();
          } catch (error) {
            finish(error);
          }
        }, TERMINATION_GRACE_MS);
      } catch (error) {
        finish(error);
      }
    }

    function capture(chunks: Buffer[], chunk: Buffer) {
      if (settled || cleaning) return;
      const remaining = options.maxBuffer - bytes;
      const captured = chunk.subarray(0, remaining);
      if (captured.length) chunks.push(Buffer.from(captured));
      bytes += captured.length;
      if (chunk.length > remaining) {
        outputExceeded = true;
        cleanup();
      }
    }

    const deadline = setTimeout(() => {
      timedOut = true;
      cleanup();
    }, options.timeout);
    child.stdout.on("data", (chunk: Buffer) => capture(stdout, chunk));
    child.stderr.on("data", (chunk: Buffer) => capture(stderr, chunk));
    child.on("error", () => {
      code = 1;
      cleanup();
    });
    child.on("close", (exitCode) => {
      code = exitCode ?? 1;
      if (cleaning || settled) return;
      try {
        // Normally the official updater has awaited all its children, so this probe
        // returns immediately. A successful leader must not leave an orphan updater.
        if (signalGroup(0)) cleanup();
        else finish();
      } catch (error) {
        finish(error);
      }
    });
  });
}
