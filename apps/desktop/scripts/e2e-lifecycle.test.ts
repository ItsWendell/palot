// @vitest-environment node

import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let directory: string;
let fixture: string;
const helper = new URL("./e2e-lifecycle.ts", import.meta.url).href;
const model = new URL("../test/e2e/test-llm-server.ts", import.meta.url).href;
const zombieSource = [
  "import os, sys, time",
  "pid = os.fork()",
  "if pid == 0:",
  "    os.setsid()",
  "    os._exit(0)",
  "try:",
  "    time.sleep(0.1)",
  "    print(pid, flush=True)",
  "    sys.stdin.read(1)",
  "finally:",
  "    os.waitpid(pid, 0)",
].join("\n");

beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "palot-e2e-lifecycle-"));
  fixture = path.join(directory, "fixture.mjs");
  await writeFile(
    fixture,
    `
import { E2ERun, signalOwnedProcess } from ${JSON.stringify(helper)};
import { TestLLMServer } from ${JSON.stringify(model)};
import { setTimeout as sleep } from 'node:timers/promises';
import { createServer } from 'node:http';
import { spawn as spawnChild } from 'node:child_process';
const mode = process.argv[2];
const run = new E2ERun(mode);
let releases = 0;
try {
  await run.initialize(process.argv[3]);
  if (mode === 'build') {
    run.phase('build');
    const grandchild = "process.on('SIGTERM', () => {}); console.log('GRANDCHILD:' + process.pid); setInterval(() => {}, 1000)";
    const leader = "const { spawn } = require('node:child_process'); spawn(process.execPath, ['-e', " + JSON.stringify(grandchild) + "], { stdio: 'inherit' }); console.log('LEADER:' + process.pid); process.exit(0)";
    await run.spawn('build', process.execPath, ['-e', leader]).completed;
    run.check();
  } else if (mode === 'late-cleanup-failure') {
    run.pass();
    await run.close();
    run.uncertainCleanup('resource cleanup failed after process cleanup finished');
  } else if (mode === 'graceful-tree') {
    const worker = "console.log('WORKER_READY'); setInterval(() => {}, 1000)";
    const leader = [
      "const { spawn } = require('node:child_process');",
      "const worker = spawn(process.execPath, ['-e', " + JSON.stringify(worker) + "]);",
      "worker.stdout.once('data', () => console.log('TREE_READY'));",
      "let stopping = false;",
      "worker.once('exit', () => { if (!stopping) process.exit(42); });",
      "process.on('SIGTERM', () => setTimeout(() => {",
      "if (worker.exitCode !== null || worker.signalCode !== null) process.exit(43);",
      "stopping = true;",
      "worker.once('close', () => process.exit(0));",
      "worker.kill('SIGTERM');",
      "}, 100));",
    ].join('');
    run.spawn('electron', process.execPath, ['-e', leader]);
    await run.inspect();
  } else if (mode === 'bad-exit') {
    await run.spawn('electron', process.execPath, ['-e', 'process.exit(42)']).completed;
  } else if (mode === 'SIGUSR2' || mode === 'SIGKILL') {
    // SIGUSR2 terminates Node without generating a core or desktop crash notification.
    run.spawn('electron', process.execPath, ['-e', "process.on('SIGTERM', () => process.kill(process.pid, '" + mode + "')); console.log('SIGNAL_READY'); setInterval(() => {}, 1000)"]);
    await run.inspect();
  } else if (mode === 'late-start') {
    run.phase('service');
    const llm = new TestLLMServer();
    await run.acquire('late resource', async () => {
      console.log('ACQUIRING');
      await new Promise(resolve => {
        const timer = setInterval(() => {}, 1000);
        run.signal.addEventListener('abort', () => { clearInterval(timer); resolve(); }, { once: true });
      });
      await sleep(50);
      await llm.start();
      console.log('PUBLISHED:' + llm.url);
      return llm;
    }, async resource => {
      await resource?.close();
      console.log('RELEASED:' + ++releases);
    });
    console.log('FORBIDDEN:LATER_RESOURCE');
  } else if (mode === 'request') {
    // This server deliberately stays open until the client request has settled.
    // A successful test therefore proves fetch cancellation, not server shutdown.
    const server = createServer(() => console.log('REQUESTING'));
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    run.phase('seed');
    try {
      await run.fetch('http://127.0.0.1:' + server.address().port);
    } finally {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
  } else if (mode === 'failed-start') {
    run.phase('service');
    const llm = new TestLLMServer();
    await run.acquire('partially started resource', async () => {
      await llm.start();
      console.log('PUBLISHED:' + llm.url);
      throw new Error('startup failed after allocating a resource');
    }, async () => {
      await llm.close();
      console.log('RELEASED:' + ++releases);
    });
  } else if (mode === 'wait-model') {
    const llm = new TestLLMServer();
    await run.acquire('scripted LLM', () => llm.start(), () => llm.close());
    run.phase('assertions');
    console.log('WAITING');
    await llm.waitForCalls(1, 60000);
  } else if (mode === 'zombie-group') {
    const holder = spawnChild('python3', ['-u', '-c', ${JSON.stringify(zombieSource)}], { stdio: ['pipe', 'pipe', 'inherit'] });
    const stopped = new Promise(resolve => holder.once('close', resolve));
    try {
      const pid = await new Promise(resolve => holder.stdout.once('data', chunk => resolve(Number(String(chunk).trim()))));
      try { process.kill(-pid, 0); } catch (error) { console.log('RAW:' + error.code); }
      for (const signal of [0, 'SIGTERM', 'SIGKILL']) console.log('VERIFIED:' + await signalOwnedProcess(-pid, signal));
      run.pass();
    } finally {
      holder.stdin.end('x');
      await stopped;
    }
  } else if (mode === 'live-denied') {
    const { child, completed } = run.spawn('protected-helper', process.execPath, ['-e', 'setInterval(() => {}, 1000)']);
    await new Promise(resolve => child.once('spawn', resolve));
    const originalKill = process.kill;
    try {
      process.kill = (pid, signal) => {
        if (pid === child.pid && signal === 'SIGTERM') return true;
        if (pid === -child.pid) throw Object.assign(new Error('kill EPERM'), { code: 'EPERM', syscall: 'kill' });
        return originalKill(pid, signal);
      };
      run.pass();
      await run.close();
    } finally {
      process.kill = originalKill;
      originalKill(-child.pid, 'SIGKILL');
      await completed.catch(() => undefined);
    }
  } else if (mode === 'inspect') {
    run.phase('assertions');
    run.spawn('electron', process.execPath, ['-e', "console.log('RETAINED:' + process.pid); setInterval(() => {}, 1000)"]);
    run.discover({ cdpPort: 12345, pageWebSocketUrl: 'ws://127.0.0.1:12345/devtools/page/test' });
    run.fail(new Error('fixture assertion failed'));
    process.exitCode = 1;
    await run.inspect();
  }
} catch (error) {
  run.fail(error);
  process.exitCode ||= 1;
} finally {
  const first = run.close();
  console.log('SAME_CLEANUP:' + (first === run.close()));
  await first;
  run.dispose();
  console.log('DONE');
}
`,
  );
});

afterAll(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
});

function launch(mode: string, suffix = "") {
  const root = path.join(directory, mode + suffix);
  const child = spawn(process.execPath, ["--experimental-strip-types", fixture, mode, root], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (data) => {
    output += data;
  });
  child.stderr.on("data", (data) => {
    output += data;
  });
  const done = new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) =>
      signal ? reject(new Error(`Unexpected ${signal}: ${output}`)) : resolve(code),
    );
  });
  return {
    child,
    done,
    output: () => output,
    wait: async (text: string) => {
      if (output.includes(text)) return;
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => finish(new Error(`Missing ${text}: ${output}`)), 8_000);
        const check = () => {
          if (output.includes(text)) finish();
        };
        const closed = () => finish(new Error(`Exited before ${text}: ${output}`));
        function finish(error?: Error) {
          clearTimeout(timer);
          child.stdout.off("data", check);
          child.stderr.off("data", check);
          child.off("close", closed);
          if (error) reject(error);
          else resolve();
        }
        child.stdout.on("data", check);
        child.stderr.on("data", check);
        child.once("close", closed);
      });
    },
    manifest: async () => {
      const [run] = await readdir(root);
      if (!run) throw new Error("Expected lifecycle manifest");
      return JSON.parse(await readFile(path.join(root, run, "instance.json"), "utf8"));
    },
  };
}

function exists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function ensureStopped(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  await new Promise<void>((resolve) => child.once("close", () => resolve()));
}

describe("E2E resource lifecycle", () => {
  it("retains cleanup failures reported after process cleanup finishes", async () => {
    const run = launch("late-cleanup-failure");
    expect(await run.done).toBe(1);
    expect(await run.manifest()).toMatchObject({
      status: "passed",
      cleanup: {
        status: "uncertain",
        uncertainties: [expect.stringContaining("resource cleanup failed")],
      },
    });
  });
  it.runIf(process.platform !== "win32")(
    "lets the leader shut down its children before signalling the group",
    async () => {
      const run = launch("graceful-tree");
      try {
        await run.wait("TREE_READY");
        run.child.kill("SIGTERM");
        expect(await run.done).toBe(0);
        expect(await run.manifest()).toMatchObject({
          cleanup: { status: "complete", errors: [] },
          processes: [{ name: "electron", code: 0, signal: null, closed: true }],
        });
      } finally {
        await ensureStopped(run.child);
      }
    },
  );

  it("reports abnormal process exits as cleanup failures", async () => {
    const run = launch("bad-exit");
    expect(await run.done).toBe(1);
    expect(await run.manifest()).toMatchObject({
      cleanup: {
        status: "failed",
        errors: [{ error: expect.stringContaining("electron exited with 42") }],
      },
    });
  });

  it.skipIf(process.platform === "win32").each(["SIGUSR2", "SIGKILL"])(
    "does not hide an unexpected %s during cleanup",
    async (signal) => {
      const run = launch(signal);
      try {
        await run.wait("SIGNAL_READY");
        run.child.kill("SIGTERM");
        expect(await run.done).toBe(1);
        expect(await run.manifest()).toMatchObject({
          cleanup: {
            status: "failed",
            errors: [
              { error: expect.stringContaining(`electron exited with ${signal} during cleanup`) },
            ],
          },
          processes: [{ signal, closed: true }],
        });
      } finally {
        await ensureStopped(run.child);
      }
    },
  );

  it.runIf(process.platform === "darwin")(
    "verifies a real zombie-only group's EPERM instead of treating it as a live permission failure",
    async () => {
      const run = launch("zombie-group");
      try {
        expect(await run.done).toBe(0);
        expect(run.output()).toContain("RAW:EPERM");
        expect(run.output().match(/VERIFIED:false/g)).toHaveLength(3);
        expect(run.output()).toContain("has only zombie members");
        expect(await run.manifest()).toMatchObject({
          status: "passed",
          cleanup: { status: "complete", errors: [] },
        });
      } finally {
        await ensureStopped(run.child);
      }
    },
  );

  it.runIf(process.platform !== "win32")(
    "keeps live-group EPERM failures with resource, signal, target, and original cause",
    async () => {
      const run = launch("live-denied");
      try {
        expect(await run.done).toBe(1);
        expect(await run.manifest()).toMatchObject({
          status: "passed",
          cleanup: {
            status: "failed",
            errors: [
              {
                resource: expect.stringContaining("protected-helper process group (leader PID"),
                error: expect.stringContaining("signal SIGTERM: kill EPERM"),
                cause: { error: "kill EPERM", code: "EPERM", syscall: "kill" },
              },
            ],
          },
        });
        if (process.platform === "darwin") expect(run.output()).toContain("live group members");
      } finally {
        await ensureStopped(run.child);
      }
    },
    15_000,
  );

  it.each(["SIGINT", "SIGTERM"] as const)(
    "%s kills build descendants after their leader has exited and waits for pipe close",
    async (signal) => {
      const run = launch("build", signal);
      try {
        await run.wait("GRANDCHILD:");
        const pid = Number(run.output().match(/GRANDCHILD:(\d+)/)?.[1]);
        expect(exists(pid)).toBe(true);
        run.child.kill(signal);
        expect(await run.done).toBe(signal === "SIGINT" ? 130 : 143);
        expect(exists(pid)).toBe(false);
        expect(await run.manifest()).toMatchObject({
          status: "interrupted",
          failure: { phase: "build", status: "interrupted", error: signal },
          cleanup: { status: "complete" },
          processes: [{ name: "build", closed: true }],
        });
        expect(run.output()).toContain("SAME_CLEANUP:true");
      } finally {
        await ensureStopped(run.child);
      }
    },
    15_000,
  );

  it("awaits late resource publication after a signal, releases it once, and prevents later acquisition", async () => {
    const run = launch("late-start");
    try {
      await run.wait("ACQUIRING");
      run.child.kill("SIGTERM");
      expect(await run.done).toBe(143);
      expect(run.output()).toContain("PUBLISHED:");
      expect(run.output()).toContain("RELEASED:1");
      expect(run.output()).not.toContain("RELEASED:2");
      expect(run.output()).not.toContain("FORBIDDEN:");
      expect(run.output()).toContain("SAME_CLEANUP:true");
      const url = run.output().match(/PUBLISHED:(http:\/\/\S+)/)?.[1];
      expect(url).toBeTruthy();
      await expect(fetch(url!)).rejects.toThrow();
      expect(await run.manifest()).toMatchObject({
        status: "interrupted",
        cleanup: { status: "complete" },
      });
    } finally {
      await ensureStopped(run.child);
    }
  });

  it("closes the scripted model to unblock an assertion wait on SIGINT", async () => {
    const run = launch("wait-model");
    try {
      await run.wait("WAITING");
      run.child.kill("SIGINT");
      expect(await run.done).toBe(130);
      expect(await run.manifest()).toMatchObject({
        failure: { phase: "assertions" },
        cleanup: { status: "complete" },
      });
    } finally {
      await ensureStopped(run.child);
    }
  });

  it("aborts pending client fetches without waiting for the server to close", async () => {
    const run = launch("request");
    try {
      await run.wait("REQUESTING");
      run.child.kill("SIGTERM");
      expect(await run.done).toBe(143);
      expect(await run.manifest()).toMatchObject({
        failure: { phase: "seed" },
        cleanup: { status: "complete" },
      });
    } finally {
      await ensureStopped(run.child);
    }
  });

  it("cleans a partially started resource even when acquisition rejects", async () => {
    const run = launch("failed-start");
    try {
      expect(await run.done).toBe(1);
      expect(run.output()).toContain("RELEASED:1");
      expect(run.output()).not.toContain("RELEASED:2");
      expect(await run.manifest()).toMatchObject({
        status: "failed",
        failure: { phase: "service" },
        cleanup: { status: "complete" },
      });
      const url = run.output().match(/PUBLISHED:(http:\/\/\S+)/)?.[1];
      expect(url).toBeTruthy();
      await expect(fetch(url!)).rejects.toThrow();
    } finally {
      await ensureStopped(run.child);
    }
  });

  it("retains a failed inspection's process until a signal and preserves nonzero status", async () => {
    const run = launch("inspect");
    try {
      await run.wait("RETAINED:");
      await run.wait("agent-browser connect");
      const pid = Number(run.output().match(/RETAINED:(\d+)/)?.[1]);
      expect(exists(pid)).toBe(true);
      expect(run.child.exitCode).toBeNull();
      expect(await run.manifest()).toMatchObject({
        status: "failed",
        phase: "inspection",
        cleanup: { status: "pending" },
      });
      run.child.kill("SIGINT");
      expect(await run.done).toBe(1);
      expect(exists(pid)).toBe(false);
      expect(await run.manifest()).toMatchObject({
        status: "failed",
        failure: { phase: "assertions", error: "fixture assertion failed" },
        cleanup: { status: "complete" },
      });
    } finally {
      await ensureStopped(run.child);
    }
  });
});
