// @vitest-environment node
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, describe, expect, it } from "vitest";
import { runOpenCodeInstallationCommand } from "./opencode-installation-process";

const directories: string[] = [];
const ownedGroups: number[] = [];

afterEach(async () => {
  for (const pid of ownedGroups.splice(0)) {
    try {
      process.kill(-pid, "SIGKILL");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
  }
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function fixture(mode: "timeout" | "overflow" | "orphan") {
  await mkdir("/tmp/opencode", { recursive: true });
  const directory = await mkdtemp("/tmp/opencode/installation-process-");
  directories.push(directory);
  const heartbeat = path.join(directory, "heartbeat");
  const owner = path.join(directory, "owner");
  const script = path.join(directory, "fixture.cjs");
  await writeFile(
    script,
    `
    const { spawn } = require('node:child_process');
    const { renameSync, writeFileSync } = require('node:fs');
    const heartbeat = ${JSON.stringify(heartbeat)};
    if (process.argv[2] === 'child') {
      process.on('SIGTERM', () => {});
      let count = 0;
      // SIGKILL can interrupt a truncating write. Publish whole heartbeats so
      // process cleanup cannot leave an empty file and invalidate this probe.
      const beat = () => {
        writeFileSync(heartbeat + '.pending', String(++count));
        renameSync(heartbeat + '.pending', heartbeat);
      };
      beat();
      setInterval(beat, 10);
      process.send('ready');
    } else {
      writeFileSync(${JSON.stringify(owner)}, String(process.pid));
      const child = spawn(process.execPath, [__filename, 'child'], {
        stdio: ['ignore', ${mode === "orphan" ? "'ignore', 'ignore'" : "'inherit', 'inherit'"}, 'ipc']
      });
      child.once('message', () => {
        child.disconnect();
        child.unref();
        ${mode === "overflow" ? "process.stdout.write('x'.repeat(8192));" : ""}
        process.exit(0);
      });
    }
  `,
  );
  return {
    script,
    heartbeat,
    async rememberOwner() {
      const pid = Number(await readFile(owner, "utf8"));
      expect(Number.isSafeInteger(pid) && pid > 0).toBe(true);
      ownedGroups.push(pid);
    },
  };
}

describe.skipIf(process.platform !== "linux" && process.platform !== "darwin")(
  "installation command process ownership",
  () => {
    it("passes literal arguments, uses the home directory, and completes without a grace-period wait", async () => {
      const started = Date.now();
      const result = await runOpenCodeInstallationCommand(
        process.execPath,
        [
          "-e",
          "process.stdout.write(JSON.stringify([process.cwd(), ...process.argv.slice(1)])); process.stderr.write('warning')",
          "$(not-a-command); *",
        ],
        { timeout: 5000, maxBuffer: 4096 },
      );
      expect(result).toEqual({
        code: 0,
        stdout: JSON.stringify([homedir(), "$(not-a-command); *"]),
        stderr: "warning",
      });
      expect(Date.now() - started).toBeLessThan(1500);
    });

    it("returns exit failures and spawn failures without exposing diagnostics", async () => {
      expect(
        await runOpenCodeInstallationCommand(process.execPath, ["-e", "process.exit(7)"], {
          timeout: 1000,
          maxBuffer: 128,
        }),
      ).toEqual({ code: 7, stdout: "", stderr: "" });
      expect(
        await runOpenCodeInstallationCommand("/nonexistent/palot-test-command", [], {
          timeout: 1000,
          maxBuffer: 128,
        }),
      ).toEqual({ code: 1, stdout: "", stderr: "" });
    });

    it("bounds stdout and stderr together", async () => {
      const result = await runOpenCodeInstallationCommand(
        process.execPath,
        ["-e", "process.stdout.write('a'.repeat(80)); process.stderr.write('b'.repeat(80));"],
        { timeout: 1000, maxBuffer: 100 },
      );
      expect(result.outputExceeded).toBe(true);
      expect(result.code).toBe(1);
      expect(Buffer.byteLength(result.stdout) + Buffer.byteLength(result.stderr)).toBe(100);
    });

    it.each(["timeout", "overflow", "orphan"] as const)(
      "cleans a TERM-resistant descendant after the leader exits (%s)",
      async (mode) => {
        const files = await fixture(mode);
        const unrelated = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
          detached: true,
          stdio: "ignore",
        });
        if (unrelated.pid) ownedGroups.push(unrelated.pid);
        const started = Date.now();
        try {
          const result = await runOpenCodeInstallationCommand(process.execPath, [files.script], {
            timeout: 700,
            maxBuffer: 128,
          });
          expect(result.code).toBe(1);
          expect(result.timedOut).toBe(mode === "timeout" ? true : undefined);
          expect(result.outputExceeded).toBe(mode === "overflow" ? true : undefined);
          expect(Date.now() - started).toBeLessThan(2700);
          // A zombie may still answer kill(pid, 0) until init reaps it. Verify the
          // installation mutation has actually stopped instead of inspecting names.
          await delay(50);
          const stopped = await readFile(files.heartbeat, "utf8");
          expect(Number(stopped)).toBeGreaterThan(0);
          await delay(100);
          expect(await readFile(files.heartbeat, "utf8")).toBe(stopped);
          expect(unrelated.exitCode).toBeNull();
          expect(unrelated.signalCode).toBeNull();
          expect(() => process.kill(unrelated.pid!, 0)).not.toThrow();
        } finally {
          // Preserve cleanup ownership even if the implementation/assertions fail.
          await files.rememberOwner();
        }
      },
    );
  },
);
