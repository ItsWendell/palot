import { spawn, type ChildProcess } from "node:child_process";
import { userInfo } from "node:os";
import type { ProjectScriptRunStatus } from "../../shared/project-scripts-contract";

export interface ScriptProcessInput {
  command: string;
  cwd: string;
  timeoutMs: number;
  env?: Record<string, string>;
  /** Keeps the last this-many characters of combined output. */
  outputLimit: number;
  signal?: AbortSignal;
}

export interface ScriptProcessResult {
  status: Exclude<ProjectScriptRunStatus, "error"> | "error";
  exitCode: number | null;
  signal: string | null;
  output: string;
  outputTruncated: boolean;
  error: string | null;
}

/** Grace period between asking a timed-out script to stop and killing it. */
const KILL_GRACE_MS = 2_000;

/** The user's shell and the arguments that run one command string through it. */
export function shellInvocation(
  command: string,
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): { file: string; args: string[] } {
  if (platform === "win32")
    return { file: env.ComSpec || "cmd.exe", args: ["/d", "/s", "/c", command] };
  let loginShell: string | undefined;
  try {
    loginShell = userInfo().shell || undefined;
  } catch {
    loginShell = undefined;
  }
  return { file: env.SHELL || loginShell || "/bin/sh", args: ["-c", command] };
}

/**
 * Run one command through the user's shell with `cwd` as the working directory. Output is
 * captured, never streamed to a terminal; a timeout stops the whole process group.
 */
export function runScriptProcess(input: ScriptProcessInput): Promise<ScriptProcessResult> {
  const { file, args } = shellInvocation(input.command);
  return new Promise((resolve) => {
    let output = "";
    let truncated = false;
    let timedOut = false;
    let settled = false;
    let child: ChildProcess;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const append = (chunk: Buffer) => {
      output += chunk.toString("utf8");
      if (output.length > input.outputLimit) {
        output = output.slice(-input.outputLimit);
        truncated = true;
      }
    };
    const finish = (result: Omit<ScriptProcessResult, "output" | "outputTruncated">) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(killTimer);
      input.signal?.removeEventListener("abort", abort);
      resolve({ ...result, output, outputTruncated: truncated });
    };
    try {
      child = spawn(file, args, {
        cwd: input.cwd,
        env: { ...process.env, ...input.env },
        stdio: ["ignore", "pipe", "pipe"],
        // Own process group, so a timeout also stops what the script started.
        detached: process.platform !== "win32",
        windowsHide: true,
        windowsVerbatimArguments: process.platform === "win32",
      });
    } catch (error) {
      resolve({
        status: "error",
        exitCode: null,
        signal: null,
        output: "",
        outputTruncated: false,
        error: error instanceof Error ? error.message : "The script could not start.",
      });
      return;
    }
    const stop = () => {
      terminate(child, "SIGTERM");
      killTimer = setTimeout(() => terminate(child, "SIGKILL"), KILL_GRACE_MS);
      killTimer.unref?.();
    };
    timer = setTimeout(() => {
      timedOut = true;
      stop();
    }, input.timeoutMs);
    const abort = () => stop();
    input.signal?.addEventListener("abort", abort, { once: true });
    child.stdout?.on("data", append);
    child.stderr?.on("data", append);
    child.once("error", (error) =>
      finish({ status: "error", exitCode: null, signal: null, error: error.message }),
    );
    child.once("close", (code, signal) => {
      if (timedOut)
        finish({
          status: "timed-out",
          exitCode: code,
          signal,
          error: `Stopped after ${Math.round(input.timeoutMs / 1000)} seconds.`,
        });
      else if (input.signal?.aborted)
        finish({ status: "error", exitCode: code, signal, error: "Stopped because Palot quit." });
      else
        finish({
          status: code === 0 ? "passed" : "failed",
          exitCode: code,
          signal,
          error: null,
        });
    });
  });
}

function terminate(child: ChildProcess, signal: NodeJS.Signals) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  try {
    if (process.platform !== "win32" && child.pid) process.kill(-child.pid, signal);
    else child.kill(signal);
  } catch {
    child.kill(signal);
  }
}
