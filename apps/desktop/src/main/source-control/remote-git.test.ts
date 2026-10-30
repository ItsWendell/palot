// @vitest-environment node
import type { OpenCodeClient } from "@opencode/client";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { expect, it, vi } from "vitest";
import { remoteGitRunner } from "./remote-git";

const exec = promisify(execFile);

it("preserves NUL-delimited paths and quoted commit input through the public shell API", async () => {
  const root = await mkdtemp("/tmp/opencode/palot-remote-git-");
  const calls: Array<{ command: string; metadata: unknown; cwd: string }> = [];
  const output = new Map<string, string>();
  const remove = vi.fn(async ({ id }: { id: string }) => {
    output.delete(id);
  });
  const client = {
    shell: {
      create: async (input: { command: string; cwd: string; metadata: unknown }) => {
        calls.push(input);
        const id = `sh_${calls.length}`;
        const result = await exec("sh", ["-c", input.command], {
          cwd: input.cwd,
          env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" },
        });
        output.set(id, result.stdout);
        return { data: { id, status: "exited", exit: 0 } };
      },
      output: async ({ id, cursor }: { id: string; cursor: number }) => {
        const full = output.get(id)!;
        const next = Math.min(cursor + 23, full.length);
        return {
          data: {
            output: full.slice(cursor, next),
            cursor: next,
            size: full.length,
            truncated: false,
          },
        };
      },
      remove,
    },
  } as unknown as OpenCodeClient;
  const git = remoteGitRunner(client);
  const localGit = (...args: string[]) => exec("git", ["-C", root, ...args]);
  try {
    await localGit("init", "--initial-branch=main");
    await localGit("config", "user.name", "Fixture");
    await localGit("config", "user.email", "fixture@palot.invalid");
    await localGit("config", "core.hooksPath", "/dev/null");
    const filename = "quote' newline\n$(touch injected).txt";
    await writeFile(path.join(root, filename), "safe\n");
    expect((await git.status(root)).files.map((file) => file.path)).toEqual([filename]);
    await git.stage(root, [filename]);
    expect((await git.status(root)).files[0]?.staged).toBe(true);
    const message = "Quoted ' input\n\n$(touch injected); printf bad >&2";
    await git.commit(root, message);
    expect((await localGit("log", "-1", "--format=%B")).stdout.trim()).toBe(message);
    expect((await git.status(root)).files).toEqual([]);
    await expect(readFile(path.join(root, "injected"))).rejects.toMatchObject({ code: "ENOENT" });
    await git.changeBranch({ directory: root, action: "create", name: "remote-feature" });
    expect((await git.branch(root)).name).toBe("remote-feature");
    await expect(git.stage(root, ["../escape"])).rejects.toMatchObject({
      code: "path-outside-repository",
    });
    expect(
      calls.every((call) => Object.keys(call.metadata as object).join() === "palot.sourceControl"),
    ).toBe(true);
    expect(remove).toHaveBeenCalledTimes(calls.length);
    expect(output.size).toBe(0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("refuses incomplete remote output and still removes its shell record", async () => {
  const remove = vi.fn(async () => {});
  const client = {
    shell: {
      create: async () => ({ data: { id: "sh_fixture", status: "exited", exit: 0 } }),
      output: async () => ({ data: { output: "", cursor: 0, size: 5, truncated: true } }),
      remove,
    },
  } as unknown as OpenCodeClient;
  await expect(remoteGitRunner(client).status("/remote/repo")).rejects.toMatchObject({
    code: "git-failed",
  });
  expect(remove).toHaveBeenCalledOnce();
});

it("explains unavailable shell APIs without trying desktop Git", async () => {
  const create = vi.fn(async () => {
    throw new Error("API unavailable");
  });
  const client = { shell: { create } } as unknown as OpenCodeClient;
  await expect(remoteGitRunner(client).status("/remote/repo")).rejects.toMatchObject({
    code: "unsupported-connection",
    message: expect.stringContaining("OpenCode 2.2"),
  });
  expect(create).toHaveBeenCalledOnce();
});
