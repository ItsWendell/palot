// @vitest-environment node

import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runScriptProcess, shellInvocation } from "./runner";

describe.skipIf(process.platform === "win32")("runScriptProcess", () => {
  let directory: string;
  beforeEach(async () => {
    directory = await realpath(await mkdtemp(path.join(tmpdir(), "palot-runner-")));
  });
  afterEach(() => rm(directory, { recursive: true, force: true }));

  const run = (command: string, overrides: { timeoutMs?: number; outputLimit?: number } = {}) =>
    runScriptProcess({
      command,
      cwd: directory,
      timeoutMs: overrides.timeoutMs ?? 10_000,
      outputLimit: overrides.outputLimit ?? 10_000,
      env: { PALOT_TASK_ID: "session-1" },
    });

  it("runs through the shell in the given directory and captures both streams", async () => {
    const result = await run('pwd; echo "$PALOT_TASK_ID"; echo oops >&2');
    expect(result).toMatchObject({ status: "passed", exitCode: 0, error: null });
    expect(result.output).toContain(directory);
    expect(result.output).toContain("session-1");
    expect(result.output).toContain("oops");
  });

  it("reports a nonzero exit as failed", async () => {
    expect(await run("echo nope; exit 3")).toMatchObject({
      status: "failed",
      exitCode: 3,
      output: "nope\n",
    });
  });

  it("stops the whole process group at the timeout", async () => {
    const startedAt = Date.now();
    const result = await run("sleep 30 & sleep 30; echo never", { timeoutMs: 200 });
    expect(result.status).toBe("timed-out");
    expect(result.output).not.toContain("never");
    expect(Date.now() - startedAt).toBeLessThan(5_000);
  });

  it("keeps the tail of long output", async () => {
    const result = await run("seq 1 2000", { outputLimit: 100 });
    expect(result.outputTruncated).toBe(true);
    expect(result.output.length).toBe(100);
    expect(result.output.endsWith("2000\n")).toBe(true);
  });

  it("reports a missing working directory as an error", async () => {
    const result = await runScriptProcess({
      command: "true",
      cwd: path.join(directory, "missing"),
      timeoutMs: 1_000,
      outputLimit: 100,
    });
    expect(result.status).toBe("error");
  });
});

describe("shellInvocation", () => {
  it("uses the user's shell with -c, or cmd.exe on Windows", () => {
    expect(shellInvocation("make test", "linux", { SHELL: "/bin/zsh" })).toEqual({
      file: "/bin/zsh",
      args: ["-c", "make test"],
    });
    expect(shellInvocation("make test", "win32", {})).toEqual({
      file: "cmd.exe",
      args: ["/d", "/s", "/c", "make test"],
    });
  });
});
