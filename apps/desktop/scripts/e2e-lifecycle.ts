import { execFile, spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { chmodSync, createWriteStream, renameSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp } from "node:fs/promises";
import path from "node:path";
import { finished } from "node:stream/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

type Failure = { phase: string; status: "failed" | "interrupted"; error: string };
type ProcessInfo = {
  name: string;
  pid?: number;
  closed: boolean;
  code?: number | null;
  signal?: string | null;
};
type Discovery = {
  servicePID?: number;
  servicePort?: number;
  cdpPort?: number;
  pageWebSocketUrl?: string;
  llmPort?: number;
};
type CleanupError = {
  resource: string;
  error: string;
  code?: string;
  syscall?: string;
  cause?: Omit<CleanupError, "resource" | "cause">;
};

/** One owner for a run, including acquisitions that are still pending when interrupted. */
export class E2ERun {
  readonly controller = new AbortController();
  readonly signal = this.controller.signal;
  readonly fetch: typeof globalThis.fetch = (input, init) =>
    globalThis.fetch(input, {
      ...init,
      signal: AbortSignal.any([
        this.signal,
        ...(input instanceof Request ? [input.signal] : []),
        ...(init?.signal ? [init.signal] : []),
      ]),
    });
  root = "";
  private state: {
    runnerPID: number;
    scenario: string;
    phase: string;
    status: "running" | "passed" | "failed" | "interrupted";
    cleanup: {
      status: "pending" | "running" | "complete" | "failed" | "uncertain";
      errors: CleanupError[];
      uncertainties: string[];
    };
    processes: ProcessInfo[];
    failure?: Failure;
  } & Discovery;
  private releases: Array<{ resource: string; close: () => Promise<void> }> = [];
  private closing?: Promise<void>;
  private stopRequested = false;
  private inspecting = false;
  private publicationError?: Error;
  private stopWaiters: Array<() => void> = [];
  private readonly onInt = () => this.interrupt("SIGINT");
  private readonly onTerm = () => this.interrupt("SIGTERM");

  constructor(scenario: string, flags: Record<string, boolean> = {}) {
    this.state = {
      ...flags,
      runnerPID: process.pid,
      scenario,
      phase: "artifacts",
      status: "running",
      cleanup: { status: "pending", errors: [], uncertainties: [] },
      processes: [],
    };
    process.on("SIGINT", this.onInt);
    process.on("SIGTERM", this.onTerm);
  }

  async initialize(artifactsRoot: string): Promise<void> {
    await mkdir(artifactsRoot, { recursive: true });
    const stamp = new Date().toISOString().replaceAll(/[:.]/g, "-");
    this.root = await mkdtemp(path.join(artifactsRoot, `${stamp}-${this.state.scenario}-`));
    chmodSync(this.root, 0o700);
    this.publish();
    console.log(`Palot E2E artifacts: ${this.root}`);
    this.check();
  }

  get manifest(): string {
    return path.join(this.root, "instance.json");
  }
  get failed(): boolean {
    return this.state.status === "failed" || this.state.status === "interrupted";
  }
  get cleanupFailed(): boolean {
    return this.state.cleanup.status === "failed" || this.state.cleanup.status === "uncertain";
  }

  uncertainCleanup(reason: string): void {
    this.state.cleanup.uncertainties.push(errorMessage(new Error(reason)));
    // Preserve late cleanup failures even when the main cleanup phase has finished.
    if (this.state.cleanup.status === "complete") {
      this.state.cleanup.status = "uncertain";
      process.exitCode ||= 1;
    }
    this.publish();
    console.error(`Palot E2E cleanup uncertain: ${reason}`);
  }

  check(): void {
    this.signal.throwIfAborted();
    if (this.closing) throw new Error("E2E run is closing");
    if (this.publicationError) throw this.publicationError;
  }

  phase(phase: string): void {
    this.check();
    this.state.phase = phase;
    this.publish();
    console.log(`Palot E2E: ${phase}`);
  }

  discover(fields: Discovery): void {
    Object.assign(this.state, fields);
    this.publish();
  }

  fail(error: unknown): void {
    if (this.state.failure) return;
    this.state.status = "failed";
    this.state.failure = { phase: this.state.phase, status: "failed", error: errorMessage(error) };
    this.publish();
  }

  pass(): void {
    this.check();
    this.state.status = "passed";
    this.publish();
  }

  async inspect(): Promise<void> {
    this.check();
    this.inspecting = true;
    this.phase("inspection");
    console.log(`Palot E2E inspect: agent-browser connect '${this.state.pageWebSocketUrl}'`);
    console.log(`Palot E2E manifest: ${this.manifest}`);
    await new Promise<void>((resolve) => this.stopWaiters.push(resolve));
  }

  /** Do not race acquisition against cancellation. Cleanup awaits publication, even on failure. */
  async acquire<T>(
    resource: string,
    start: () => Promise<T>,
    stop: (value: T | undefined) => Promise<void>,
  ): Promise<T> {
    this.check();
    const pending = Promise.resolve().then(() => {
      this.check();
      return start();
    });
    let released: Promise<void> | undefined;
    this.releases.push({
      resource,
      close: () =>
        (released ??= (async () => {
          const value = await pending.catch(() => undefined);
          await stop(value);
        })()),
    });
    const value = await pending;
    this.check();
    return value;
  }

  /** Every child gets its own process group and a combined, owner-only console log. */
  spawn(
    name: string,
    command: string,
    args: string[],
    options: SpawnOptions = {},
  ): {
    child: ChildProcess;
    completed: Promise<void>;
  } {
    this.check();
    const log = createWriteStream(path.join(this.root, `${name}.log`), { mode: 0o600 });
    const logDone = finished(log);
    // Attach immediately: disk errors must not become unhandled rejections.
    void logDone.catch(() => undefined);
    const child = spawn(command, args, {
      ...options,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const info: ProcessInfo = { name, pid: child.pid, closed: false };
    this.state.processes.push(info);
    child.stdout?.on("data", (chunk) => {
      log.write(chunk);
      process.stdout.write(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      log.write(chunk);
      process.stderr.write(chunk);
    });
    let spawnError: Error | undefined;
    child.once("error", (error) => {
      spawnError = error;
      log.write(`${error.message}\n`);
    });
    const closed = new Promise<void>((resolve) =>
      child.once("close", (code, signal) => {
        Object.assign(info, { closed: true, code, signal });
        log.end();
        this.publish();
        resolve();
      }),
    );
    const completed = (async () => {
      await closed;
      await logDone;
      if (spawnError) throw spawnError;
      if (info.code !== 0)
        throw new Error(`${name} exited with ${info.signal ?? info.code ?? "unknown"}`);
    })();
    void completed.catch(() => undefined);
    this.releases.push({
      resource: `${name} process group (leader PID ${child.pid ?? "unavailable"})`,
      close: async () => {
        let stopping = false;
        let forced = false;
        if (child.pid) {
          // Let the leader shut down its children first. Killing Electron's zygote/GPU
          // alongside the browser can trigger a fatal GPU restart during app.quit().
          // Use exitCode/signalCode, not close: descendants may still hold the pipes.
          if (child.exitCode === null && child.signalCode === null) {
            stopping = await signalOwnedProcess(child.pid, "SIGTERM");
            const deadline = Date.now() + 5_000;
            while (child.exitCode === null && child.signalCode === null && Date.now() < deadline) {
              await sleep(25);
            }
          }
          // The owned group can outlive its leader. Retain bounded fallback cleanup.
          const target = process.platform === "win32" ? child.pid : -child.pid;
          let live = await signalOwnedProcess(target, "SIGTERM");
          const deadline = Date.now() + 2_000;
          while (live && Date.now() < deadline) {
            await sleep(25);
            live = await signalOwnedProcess(target, 0);
          }
          if (live) {
            const leaderAlive = child.exitCode === null && child.signalCode === null;
            forced = (await signalOwnedProcess(target, "SIGKILL")) && leaderAlive;
          }
        }
        await closed;
        await logDone;
        if (spawnError) throw spawnError;
        const expectedSignal =
          (stopping && info.signal === "SIGTERM") || (forced && info.signal === "SIGKILL");
        if (info.code !== 0 && !expectedSignal)
          throw new Error(
            `${name} exited with ${info.signal ?? info.code ?? "unknown"} during cleanup`,
          );
      },
    });
    this.publish();
    return { child, completed };
  }

  private interrupt(signal: "SIGINT" | "SIGTERM"): void {
    if (this.stopRequested) return;
    this.stopRequested = true;
    if (!this.inspecting && !this.state.failure) {
      this.state.status = "interrupted";
      this.state.failure = { phase: this.state.phase, status: "interrupted", error: signal };
      process.exitCode = signal === "SIGINT" ? 130 : 143;
    }
    this.controller.abort(new Error(`E2E interrupted by ${signal}`));
    console.error(
      `Palot E2E: ${signal}, stopping owned resources${this.state.phase === "service" ? "; waiting for Service.ensure (SDK startup bound: 120s)" : ""}`,
    );
    for (const resolve of this.stopWaiters.splice(0)) resolve();
    // Same promise as finally, not a second cleanup path.
    void this.close().catch((error) => console.error("Palot E2E cleanup failed:", error));
  }

  close(): Promise<void> {
    return (this.closing ??= this.cleanup());
  }

  private async cleanup(): Promise<void> {
    this.state.phase = "cleanup";
    this.state.cleanup.status = "running";
    this.publish();
    const results = await Promise.all(
      this.releases.map(async (release) => {
        try {
          await release.close();
          return [];
        } catch (error) {
          return [{ resource: release.resource, ...cleanupError(error) }];
        }
      }),
    );
    this.state.cleanup.errors = results.flat();
    if (this.publicationError)
      this.state.cleanup.errors.push({
        resource: "instance manifest",
        ...cleanupError(this.publicationError),
      });
    this.state.cleanup.status = this.state.cleanup.errors.length
      ? "failed"
      : this.state.cleanup.uncertainties.length
        ? "uncertain"
        : "complete";
    if (this.cleanupFailed) process.exitCode ||= 1;
    this.state.phase = "finished";
    this.publish();
    if (this.state.cleanup.status === "uncertain")
      console.error("Palot E2E cleanup remains uncertain:", this.state.cleanup.uncertainties);
    else if (this.cleanupFailed)
      console.error("Palot E2E cleanup failed:", this.state.cleanup.errors);
    else console.log("Palot E2E cleanup complete");
  }

  dispose(): void {
    process.off("SIGINT", this.onInt);
    process.off("SIGTERM", this.onTerm);
  }

  private publish(): void {
    if (!this.root) return;
    const temporary = `${this.manifest}.tmp`;
    try {
      writeFileSync(temporary, JSON.stringify({ ...this.state, runRoot: this.root }, null, 2), {
        mode: 0o600,
      });
      renameSync(temporary, this.manifest);
    } catch (error) {
      // An evidence write must not interrupt child close events or skip resource cleanup.
      this.publicationError = new Error(`Cannot update E2E manifest: ${errorMessage(error)}`);
      process.exitCode = 1;
      console.error(this.publicationError.message);
    }
  }
}

/** Only use a PID or negative PGID obtained from a child owned by this runner. */
export async function signalOwnedProcess(
  target: number,
  signal: NodeJS.Signals | 0,
): Promise<boolean> {
  if (!Number.isSafeInteger(target) || Math.abs(target) <= 1) {
    throw new Error("Expected an owned child PID or negative process group ID");
  }
  try {
    process.kill(target, signal);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
    let evidence = "";
    if (
      process.platform === "darwin" &&
      target < 0 &&
      (error as NodeJS.ErrnoException).code === "EPERM"
    ) {
      // XNU returns EPERM for zombie-only groups, even for kill(pgid, 0).
      // Never interpret EPERM alone as exit: verify the exact group's members.
      try {
        const { stdout } = await execFileAsync("ps", ["-axo", "pid=,pgid=,uid=,stat="], {
          timeout: 1_000,
        });
        const processes = stdout
          .trim()
          .split("\n")
          .map((row) => {
            const [pid, pgid, uid, state] = row.trim().split(/\s+/);
            return { pid: Number(pid), pgid: Number(pgid), uid: Number(uid), state };
          });
        if (
          processes.some(
            (member) =>
              !Number.isSafeInteger(member.pid) ||
              !Number.isSafeInteger(member.pgid) ||
              !Number.isSafeInteger(member.uid) ||
              !member.state,
          )
        ) {
          throw new Error("Cannot parse ps output while verifying process group");
        }
        const members = processes.filter((member) => member.pgid === -target);
        if (members.length === 0) return false;
        if (members.every((member) => member.state?.startsWith("Z"))) {
          console.log(
            `Palot E2E: owned group ${-target} has only zombie members: ${members.map((member) => member.pid).join(", ")}`,
          );
          return false;
        }
        evidence = `; live group members: ${JSON.stringify(members)}`;
      } catch (probeError) {
        evidence = `; could not verify group members: ${errorMessage(probeError)}`;
      }
    }
    throw new Error(`kill target ${target}, signal ${signal}: ${errorMessage(error)}${evidence}`, {
      cause: error,
    });
  }
}

function cleanupError(error: unknown): Omit<CleanupError, "resource"> {
  const details = (value: unknown) => {
    const system = value as NodeJS.ErrnoException | undefined;
    return {
      error: errorMessage(value),
      ...(typeof system?.code === "string" ? { code: system.code } : {}),
      ...(typeof system?.syscall === "string" ? { syscall: system.syscall } : {}),
    };
  };
  return {
    ...details(error),
    ...(error instanceof Error && error.cause ? { cause: details(error.cause) } : {}),
  };
}

function errorMessage(error: unknown): string {
  // Do not serialize SDK errors: they can carry request headers, auth, and environment.
  return (error instanceof Error ? error.message : "Unknown E2E failure")
    .replace(/(authorization["'\s:=]+)(?:basic|bearer)\s+[^\s,"'}]+/gi, "$1[redacted]")
    .replace(/((?:password|token|api[-_]?key)["'\s:=]+)[^\s,"'}]+/gi, "$1[redacted]")
    .replace(/(https?:\/\/)[^/\s@]+@/gi, "$1[redacted]@")
    .slice(0, 2_000);
}
