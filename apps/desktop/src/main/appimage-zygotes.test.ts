import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  appImageZygotes,
  stopAppImageZygotesBeforeExit,
  type ProcReader,
} from "./appimage-zygotes";

const MAIN = 4_000;

/** A fake /proc: main (4000) with two threads, its children, and an unrelated process. */
function fakeProc(overrides: Record<string, string | undefined> = {}) {
  const stopped = new Set<number>();
  const stat = (pid: number, name: string, parent: number) =>
    stopped.has(pid) ? undefined : `${pid} (${name}) S ${parent} ${pid} ${pid} 0 -1`;
  const files = (): Record<string, string | undefined> => ({
    [`/proc/${MAIN}/task/${MAIN}/children`]: "4001 4002 ",
    [`/proc/${MAIN}/task/4010/children`]: "4003 4004",
    // Chromium rewrites a zygote's argv into one space-separated title.
    "/proc/4001/cmdline": "/tmp/.mount_Palot/palot --type=zygote --no-zygote-sandbox",
    "/proc/4001/stat": stat(4001, "palot", MAIN),
    // The OpenCode server and a GPU helper are children too, but not zygotes.
    "/proc/4002/cmdline": "/tmp/.mount_Palot/opencode\0serve\0",
    "/proc/4002/stat": stat(4002, "opencode", MAIN),
    "/proc/4003/cmdline": "/tmp/.mount_Palot/palot\0--type=gpu-process\0",
    "/proc/4003/stat": stat(4003, "palot", MAIN),
    // NUL-separated argv form, process name with a parenthesis.
    "/proc/4004/cmdline": "/tmp/.mount_Palot/palot\0--type=zygote\0",
    "/proc/4004/stat": stat(4004, "pal) ot", MAIN),
    // Another app's zygote: not a child of main.
    "/proc/5001/cmdline": "/opt/other/app --type=zygote",
    "/proc/5001/stat": stat(5001, "app", 5000),
    ...overrides,
  });
  const proc: ProcReader = {
    readFile: (path) => files()[path],
    readDirectory: (path) => (path === `/proc/${MAIN}/task` ? [`${MAIN}`, "4010"] : undefined),
  };
  return { proc, stopped };
}

describe("AppImage zygote cleanup", () => {
  it("selects only main's own zygotes", () => {
    expect(appImageZygotes(MAIN, fakeProc().proc)).toEqual([4001, 4004]);
  });

  it("skips a listed child that is no longer main's (a reused pid)", () => {
    const { proc } = fakeProc({ "/proc/4001/stat": "4001 (palot) S 1 4001 4001 0 -1" });
    expect(appImageZygotes(MAIN, proc)).toEqual([4004]);
  });

  it("kills the zygotes only for an AppImage on Linux", () => {
    const { proc, stopped } = fakeProc();
    const kill = vi.fn((pid: number) => void stopped.add(pid));
    expect(
      stopAppImageZygotesBeforeExit({
        pid: MAIN,
        platform: "linux",
        appImage: undefined,
        proc,
        kill,
      }),
    ).toEqual([]);
    expect(
      stopAppImageZygotesBeforeExit({
        pid: MAIN,
        platform: "darwin",
        appImage: "/a.AppImage",
        proc,
        kill,
      }),
    ).toEqual([]);
    expect(kill).not.toHaveBeenCalled();

    expect(
      stopAppImageZygotesBeforeExit({
        pid: MAIN,
        platform: "linux",
        appImage: "/a.AppImage",
        proc,
        kill,
      }),
    ).toEqual([4001, 4004]);
    expect(kill.mock.calls).toEqual([
      [4001, "SIGKILL"],
      [4004, "SIGKILL"],
    ]);
  });
});

describe.runIf(existsSync("/proc/self/task"))("AppImage zygote cleanup on this machine", () => {
  it("kills a child titled as a zygote and leaves other children running", async () => {
    const spawnTitled = async (title: string) => {
      const child = spawn("sleep", ["60"], { argv0: title, stdio: "ignore" });
      await new Promise((resolve) => child.once("spawn", resolve));
      return child;
    };
    const zygote = await spawnTitled("/tmp/.mount_Palot/palot --type=zygote --no-sandbox");
    const utility = await spawnTitled("/tmp/.mount_Palot/palot --type=utility");
    const running = (pid: number) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    };
    try {
      expect(
        stopAppImageZygotesBeforeExit({ platform: "linux", appImage: "/tmp/Palot.AppImage" }),
      ).toEqual([zygote.pid]);
      await new Promise((resolve) => zygote.once("exit", resolve));
      expect(running(utility.pid!)).toBe(true);
    } finally {
      zygote.kill("SIGKILL");
      utility.kill("SIGKILL");
    }
  });
});
