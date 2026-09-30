// @vitest-environment node

import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  findWestonBinary,
  privateElectronEnvironment,
  selectDisplay,
  startPrivateDisplay,
} from "./e2e-display.ts";
import { E2ERun } from "./e2e-lifecycle.ts";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function setup() {
  const root = await mkdtemp(path.join(tmpdir(), "palot-display-test-"));
  roots.push(root);
  const run = new E2ERun("display-test");
  await run.initialize(root);
  const weston = path.join(root, "weston");
  await writeFile(
    weston,
    `#!/usr/bin/env node
const net = require('node:net');
const fs = require('node:fs');
if (process.env.FAKE_WESTON_EXIT) process.exit(12);
const socket = process.argv.find(arg => arg.startsWith('--socket=')).slice(9);
const server = net.createServer();
if (process.env.FAKE_WESTON_STALL) setInterval(() => {}, 100);
else server.listen(require('node:path').join(process.env.XDG_RUNTIME_DIR, socket), () => {
  fs.writeFileSync(process.env.FAKE_WESTON_ARGS, JSON.stringify({ args: process.argv.slice(2), display: process.env.DISPLAY, wayland: process.env.WAYLAND_DISPLAY }));
});
process.on('SIGTERM', () => {
  if (process.env.FAKE_WESTON_STALL) process.exit(0);
  fs.writeFileSync(process.env.FAKE_WESTON_STOP, fs.existsSync(process.env.FAKE_ELECTRON_STOP) ? 'after-electron' : 'before-electron');
  server.close(() => process.exit(0));
});
`,
  );
  await chmod(weston, 0o700);
  return { root, run, weston };
}

describe("private E2E display", () => {
  it("selects Linux private by default and rejects unsupported modes", () => {
    expect(selectDisplay(undefined, "linux")).toBe("private");
    expect(selectDisplay(undefined, "darwin")).toBe("desktop");
    expect(selectDisplay("desktop", "linux")).toBe("desktop");
    expect(() => selectDisplay("private", "win32")).toThrow("requires Linux");
    expect(() => selectDisplay("hyprland", "linux")).toThrow("Unknown --display");
  });

  it("requires Weston rather than falling back to the host display", async () => {
    await expect(findWestonBinary("")).rejects.toThrow("explicitly use --display=desktop");
    const { root, run, weston } = await setup();
    try {
      expect(await findWestonBinary(root)).toBe(weston);
    } finally {
      await run.close();
      run.dispose();
    }
  });

  it("isolates Wayland and stops Weston after Electron, then removes its runtime", async () => {
    const { root, run, weston } = await setup();
    const args = path.join(root, "args.json");
    const westonStop = path.join(root, "weston-stopped");
    const electronStop = path.join(root, "electron-stopped");
    const previous = {
      FAKE_WESTON_ARGS: process.env.FAKE_WESTON_ARGS,
      FAKE_WESTON_STOP: process.env.FAKE_WESTON_STOP,
      FAKE_ELECTRON_STOP: process.env.FAKE_ELECTRON_STOP,
    };
    Object.assign(process.env, {
      FAKE_WESTON_ARGS: args,
      FAKE_WESTON_STOP: westonStop,
      FAKE_ELECTRON_STOP: electronStop,
    });
    try {
      const display = await startPrivateDisplay(run, weston);
      expect((await stat(display.runtimeDirectory)).mode & 0o777).toBe(0o700);
      expect(
        privateElectronEnvironment(
          { DISPLAY: ":0", WAYLAND_SOCKET: "3", OTHER: "ok" },
          display.runtimeDirectory,
          display.socket,
        ),
      ).toEqual({
        XDG_RUNTIME_DIR: display.runtimeDirectory,
        WAYLAND_DISPLAY: display.socket,
        OTHER: "ok",
      });
      const details = JSON.parse(await readFile(path.join(run.root, "display.json"), "utf8"));
      expect(details).toMatchObject({
        mode: "private",
        backend: "headless",
        renderer: "pixman",
        ready: true,
        log: "weston.log",
      });
      const invocation = JSON.parse(await readFile(args, "utf8"));
      expect(invocation.args).toEqual([
        "--backend=headless",
        "--renderer=pixman",
        "--width=1920",
        "--height=1080",
        "--scale=1",
        "--idle-time=0",
        "--no-config",
        "--socket=palot-wayland",
        "--fake-seat",
      ]);
      expect(invocation.display).toBeUndefined();
      expect(invocation.wayland).toBeUndefined();
      run.spawn("electron", process.execPath, [
        "-e",
        `process.on('SIGTERM', () => { require('node:fs').writeFileSync(${JSON.stringify(electronStop)}, 'done'); process.exit(0) }); console.log('ready'); setInterval(() => {}, 100)`,
      ]);
      await new Promise<void>((resolve) => setTimeout(resolve, 200));
      await run.close();
      expect(await readFile(westonStop, "utf8")).toBe("after-electron");
      await expect(stat(display.runtimeDirectory)).rejects.toMatchObject({ code: "ENOENT" });
      expect(run.cleanupFailed).toBe(false);
    } finally {
      await run.close();
      run.dispose();
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it("retains startup evidence and releases the directory after an early Weston exit", async () => {
    const { run, weston } = await setup();
    process.env.FAKE_WESTON_EXIT = "1";
    try {
      await expect(startPrivateDisplay(run, weston)).rejects.toThrow("Weston exited before");
      expect(JSON.parse(await readFile(path.join(run.root, "display.json"), "utf8"))).toMatchObject(
        { ready: false },
      );
      await run.close();
      expect(run.cleanupFailed).toBe(true); // Unexpected compositor exit is never a successful cleanup.
      const runtime = JSON.parse(await readFile(run.manifest, "utf8")).processes.find(
        (process: { name: string }) => process.name === "weston",
      );
      expect(runtime.code).toBe(12);
    } finally {
      delete process.env.FAKE_WESTON_EXIT;
      await run.close();
      run.dispose();
    }
  });

  it("cancels readiness without waiting for the timeout and cleans up", async () => {
    const { run, weston } = await setup();
    process.env.FAKE_WESTON_STALL = "1";
    try {
      const pending = startPrivateDisplay(run, weston);
      setTimeout(() => run.controller.abort(new Error("test cancellation")), 250);
      await expect(pending).rejects.toThrow(/abort/i);
      const details = JSON.parse(await readFile(path.join(run.root, "display.json"), "utf8"));
      await run.close();
      await expect(stat(details.runtimeDirectory)).rejects.toMatchObject({ code: "ENOENT" });
      expect(run.cleanupFailed).toBe(false);
    } finally {
      delete process.env.FAKE_WESTON_STALL;
      await run.close();
      run.dispose();
    }
  });
});
