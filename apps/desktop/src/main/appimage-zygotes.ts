import { readdirSync, readFileSync } from "node:fs";

/**
 * Chromium's zygotes exit only after the main process does. Run from an AppImage, the image is
 * unmounted as soon as main exits, so the zygotes are left running on a vanished mount (and die
 * later with SIGBUS, or linger). Killing them while main still holds the image mounted avoids
 * that. Adapted from T3 Code (#36057). Linux only: everything is read from /proc.
 */

/** The parts of /proc this reads, so tests can supply a fake one. */
export interface ProcReader {
  readFile(path: string): string | undefined;
  readDirectory(path: string): string[] | undefined;
}

export const nodeProc: ProcReader = {
  readFile(path) {
    try {
      return readFileSync(path, "utf8");
    } catch {
      return undefined;
    }
  },
  readDirectory(path) {
    try {
      return readdirSync(path);
    } catch {
      return undefined;
    }
  },
};

const KILL_WAIT_MS = 1_000;

/** Chromium starts helpers from its own threads, so every thread's `children` list is read. */
function childPids(proc: ProcReader, pid: number): number[] {
  const tasks = proc.readDirectory(`/proc/${pid}/task`) ?? [];
  const children = tasks.flatMap((task) =>
    (proc.readFile(`/proc/${pid}/task/${task}/children`) ?? "")
      .split(/\s+/)
      .filter((value) => /^\d+$/.test(value))
      .map(Number),
  );
  return [...new Set(children)].filter((child) => child > 1 && child !== pid);
}

/** The parent pid from `/proc/<pid>/stat`, read after the `)` that ends the process name. */
function parentPid(proc: ProcReader, pid: number): number | null {
  const stat = proc.readFile(`/proc/${pid}/stat`);
  if (!stat) return null;
  const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
  const parent = Number(fields[1]);
  return Number.isSafeInteger(parent) ? parent : null;
}

/** A zygote rewrites its argv into one space-separated title, so both forms are split. */
function isZygote(proc: ProcReader, pid: number): boolean {
  return (proc.readFile(`/proc/${pid}/cmdline`) ?? "").split(/[\0 ]/).includes("--type=zygote");
}

/** A zombie has already released its memory mappings. */
function isRunning(proc: ProcReader, pid: number): boolean {
  const stat = proc.readFile(`/proc/${pid}/stat`);
  if (stat === undefined) return false;
  const state = stat.charAt(stat.lastIndexOf(")") + 2);
  return state !== "Z" && state !== "X";
}

/**
 * The zygotes to stop: children of `pid` (listed by its threads), whose command line has
 * `--type=zygote` and whose parent is still `pid`. Nothing else is ever selected.
 */
export function appImageZygotes(pid: number, proc: ProcReader = nodeProc): number[] {
  return childPids(proc, pid).filter(
    (child) => isZygote(proc, child) && parentPid(proc, child) === pid,
  );
}

/**
 * Kills this process's Chromium zygotes before it exits, when it runs from an AppImage on
 * Linux. Synchronous, for the process `exit` event, where nothing asynchronous completes.
 */
export function stopAppImageZygotesBeforeExit(
  options: {
    pid?: number;
    platform?: NodeJS.Platform;
    appImage?: string | undefined;
    proc?: ProcReader;
    kill?: (pid: number, signal: NodeJS.Signals) => void;
  } = {},
): number[] {
  const platform = options.platform ?? process.platform;
  const appImage = "appImage" in options ? options.appImage : process.env.APPIMAGE;
  if (platform !== "linux" || !appImage) return [];
  const pid = options.pid ?? process.pid;
  const proc = options.proc ?? nodeProc;
  const kill = options.kill ?? ((target, signal) => process.kill(target, signal));
  const zygotes = appImageZygotes(pid, proc);
  for (const zygote of zygotes) {
    try {
      kill(zygote, "SIGKILL");
    } catch {
      // Already gone.
    }
  }
  waitUntilStopped(proc, zygotes, KILL_WAIT_MS);
  return zygotes;
}

function waitUntilStopped(proc: ProcReader, pids: number[], maxMs: number): void {
  if (pids.length === 0) return;
  const tick = new Int32Array(new SharedArrayBuffer(4));
  let running = pids.filter((pid) => isRunning(proc, pid));
  for (let waited = 0; waited < maxMs && running.length > 0; waited += 10) {
    Atomics.wait(tick, 0, 0, 10);
    running = running.filter((pid) => isRunning(proc, pid));
  }
}
