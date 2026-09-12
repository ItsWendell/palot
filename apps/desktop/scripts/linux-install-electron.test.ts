// @vitest-environment node
import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, cp, mkdtemp, readFile, rename, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { expect, it } from "vitest";
import { installedLinuxProcesses, stopLinuxInstallation } from "./linux-install-lifecycle";

// Opt-in: needs a Linux display, but no Palot build, user state, service, or credentials.
it.skipIf(process.platform !== "linux" || process.env.PALOT_TEST_LINUX_ELECTRON !== "1")(
  "quits isolated Electron asynchronously before replacing its installation",
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "palot-install-electron-"));
    const installation = path.join(root, "installation");
    const require = createRequire(import.meta.url);
    const source = path.dirname(require("electron") as string);
    try {
      await cp(source, installation, { recursive: true, mode: constants.COPYFILE_FICLONE });
    } catch (error) {
      await rm(root, { recursive: true, force: true });
      throw error;
    }
    const executable = path.join(installation, "electron");
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      PALOT_INSTALL_FIXTURE_ROOT: root,
      XDG_CONFIG_HOME: path.join(root, "config"),
      XDG_CACHE_HOME: path.join(root, "cache"),
      XDG_DATA_HOME: path.join(root, "data"),
    };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(
      executable,
      [path.join(import.meta.dirname, "fixtures/linux-install-electron.cjs")],
      {
        env,
        cwd: installation,
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let output = "";
    child.stdout.on("data", (data) => {
      output += data;
    });
    child.stderr.on("data", (data) => {
      output += data;
    });
    child.once("error", (error) => {
      output += error.message;
    });
    const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
      (resolve) => {
        child.once("close", (code, signal) => resolve({ code, signal }));
      },
    );
    try {
      const deadline = Date.now() + 15_000;
      while (true) {
        try {
          await access(path.join(root, "ready"));
          break;
        } catch {}
        if (child.exitCode !== null || child.signalCode !== null || Date.now() >= deadline)
          throw new Error(`Electron fixture did not become ready: ${output}`);
        await sleep(50);
      }
      expect(await installedLinuxProcesses([executable])).toEqual([child.pid]);
      await stopLinuxInstallation([executable], 5_000);
      const events = (await readFile(path.join(root, "events.jsonl"), "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line).event);
      expect(events).toEqual(["before-quit", "cleanup-complete", "before-quit", "will-quit"]);
      // The installer may rename/delete files only after asynchronous cleanup finishes.
      await rename(installation, `${installation}.previous`);
      expect(await exited, output).toEqual({ code: 0, signal: null });
      expect(output).not.toContain("GPU process launch failed");
      expect(output).not.toContain("FATAL:");
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      try {
        if (child.pid !== undefined) process.kill(-child.pid, "SIGKILL");
      } catch {}
      await exited;
      await rm(root, { recursive: true, force: true });
    }
  },
  30_000,
);
