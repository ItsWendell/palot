// @vitest-environment node
import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs/promises";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  installedLinuxProcesses,
  launchLinuxInstallation,
  stopLinuxInstallation,
} from "./linux-install-lifecycle";

vi.mock("node:fs/promises", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:fs/promises")>()),
}));

const children: ChildProcess[] = [];
const directories: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const child of children.splice(0)) {
    if (child.exitCode !== null || child.signalCode !== null) continue;
    await new Promise<void>((resolve) => {
      child.once("exit", () => resolve());
      child.kill("SIGKILL");
    });
  }
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function fixture(ignoreTermination = false, processTitle?: string, extraArgs: string[] = []) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "palot-install-test-"));
  directories.push(directory);
  const executable = path.join(directory, "palot-nightly");
  await copyFile("/bin/bash", executable);
  const child = spawn(
    executable,
    [
      "-c",
      // Block in a Bash builtin, not a fork/exec loop that creates transient copies
      // of the installed executable while process discovery reads /proc.
      `${ignoreTermination ? "trap '' TERM; " : ""}echo ready; while :; do read -r; done`,
      ...extraArgs,
    ],
    { stdio: ["pipe", "pipe", "ignore"], argv0: processTitle },
  );
  children.push(child);
  await new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.stdout!.once("data", () => resolve());
  });
  return { child, executable, directory };
}

describe.skipIf(process.platform !== "linux")("Linux install lifecycle", () => {
  it("excludes a forked child that execs another binary during discovery", async () => {
    const target = await fixture(false, "palot-nightly --type=gpu-process --other-flag");
    const readlink = fs.readlink;
    const readFile = fs.readFile;
    let executableReads = 0;
    vi.spyOn(fs, "readlink").mockImplementation(async (...args) => {
      if (args[0] === `/proc/${target.child.pid}/exe`) {
        return executableReads++ === 0 ? target.executable : "/usr/bin/sleep";
      }
      return readlink(...args);
    });
    vi.spyOn(fs, "readFile").mockImplementation(async (...args) => {
      if (args[0] === `/proc/${target.child.pid}/cmdline`) return "sleep\0" + "0.1\0";
      return readFile(...args);
    });
    expect(await installedLinuxProcesses([target.executable])).toEqual([]);
  });

  it.each(["zygote", "gpu-process", "utility", "renderer"])(
    "does not signal a Chromium %s child with a rewritten process title",
    async (type) => {
      const target = await fixture(false, `palot-nightly --type=${type} --other-flag`);
      expect(await installedLinuxProcesses([target.executable])).toEqual([]);
      await stopLinuxInstallation([target.executable]);
      expect(target.child.exitCode).toBeNull();
      expect(target.child.signalCode).toBeNull();
      expect(() => process.kill(target.child.pid!, 0)).not.toThrow();
    },
  );

  it("still excludes children with NUL-separated type arguments", async () => {
    const target = await fixture(false, undefined, ["--type=zygote"]);
    expect(await installedLinuxProcesses([target.executable])).toEqual([]);
  });

  it("does not mistake an embedded type-like substring for a child flag", async () => {
    const target = await fixture(false, "palot-nightly --label=not--type=renderer");
    expect(await installedLinuxProcesses([target.executable])).toEqual([target.child.pid]);
    await stopLinuxInstallation([target.executable]);
  });

  it("stops only the exact installed executable, preserving another installation", async () => {
    const target = await fixture();
    const other = await fixture();
    expect(await installedLinuxProcesses([target.executable])).toEqual([target.child.pid]);
    await stopLinuxInstallation([target.executable]);
    expect(await installedLinuxProcesses([target.executable])).toEqual([]);
    expect(await installedLinuxProcesses([other.executable])).toEqual([other.child.pid]);
  });

  it("aborts replacement when an application refuses to exit", async () => {
    const target = await fixture(true);
    await expect(stopLinuxInstallation([target.executable], 100)).rejects.toThrow(
      "was not replaced",
    );
    expect(await installedLinuxProcesses([target.executable])).toEqual([target.child.pid]);
  });

  it("reports a launch that exits immediately", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "palot-launch-test-"));
    directories.push(directory);
    const executable = path.join(directory, "palot-nightly");
    await copyFile("/bin/false", executable);
    await expect(
      launchLinuxInstallation(executable, path.join(directory, "launch.log")),
    ).rejects.toThrow("did not stay running");
  });
});
