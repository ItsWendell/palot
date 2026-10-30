// @vitest-environment node

import { execFileSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { GitRunner, parsePorcelainV2 } from "./git";

const roots: string[] = [];
const savedEnv = { ...process.env };

beforeAll(async () => {
  // Isolate from the developer's global Git configuration and hooks.
  const home = await mkdtemp(path.join(os.tmpdir(), "palot-git-home-"));
  roots.push(home);
  const config = path.join(home, "gitconfig");
  await writeFile(
    config,
    "[user]\n\tname = Palot Test\n\temail = test@palot.invalid\n[init]\n\tdefaultBranch = main\n",
  );
  process.env.GIT_CONFIG_GLOBAL = config;
  process.env.GIT_CONFIG_NOSYSTEM = "1";
});

afterAll(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  for (const key of ["GIT_CONFIG_GLOBAL", "GIT_CONFIG_NOSYSTEM"]) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

afterEach(async () => {
  await Promise.all(roots.splice(1).map((root) => rm(root, { recursive: true, force: true })));
});

async function repository() {
  const root = await mkdtemp(path.join(os.tmpdir(), "palot-git-"));
  roots.push(root);
  execFileSync("git", ["init", "--quiet", root]);
  return root;
}

const git = new GitRunner();

describe("GitRunner", () => {
  it("creates, switches and renames branches without losing dirty work", async () => {
    const root = await repository();
    execFileSync("git", ["-C", root, "commit", "--allow-empty", "-qm", "Base"]);
    expect(
      (
        await git.changeBranch({
          directory: root,
          action: "create",
          name: "palot/new",
          base: "main",
        })
      ).branch.name,
    ).toBe("palot/new");
    expect(
      (await git.changeBranch({ directory: root, action: "rename", name: "palot/renamed" })).branch
        .name,
    ).toBe("palot/renamed");
    await writeFile(path.join(root, "untracked.txt"), "keep me");
    for (const action of ["switch", "create", "rename"] as const)
      await expect(
        git.changeBranch({ directory: root, action, name: "main" }),
      ).rejects.toMatchObject({ code: "dirty-worktree" });
    expect((await git.status(root)).files.map((file) => file.path)).toEqual(["untracked.txt"]);
    await git.stage(root, ["untracked.txt"]);
    await git.commit(root, "Keep work");
    expect(
      (await git.changeBranch({ directory: root, action: "switch", name: "main" })).branch.name,
    ).toBe("main");
    for (const name of ["--force", "@{-1}", "bad name", "refs/heads/../escape"])
      await expect(
        git.changeBranch({ directory: root, action: "create", name }),
      ).rejects.toMatchObject({ code: "invalid-input" });
  });

  it("switches a remote branch into a tracking branch and refuses an existing destination", async () => {
    const root = await repository();
    execFileSync("git", ["-C", root, "commit", "--allow-empty", "-qm", "Base"]);
    execFileSync("git", ["-C", root, "remote", "add", "origin", root]);
    execFileSync("git", ["-C", root, "update-ref", "refs/remotes/origin/topic", "HEAD"]);
    expect(
      (await git.changeBranch({ directory: root, action: "switch", name: "origin/topic" })).branch,
    ).toMatchObject({ name: "topic", upstream: "origin/topic" });
    await expect(
      git.changeBranch({ directory: root, action: "rename", name: "main" }),
    ).rejects.toMatchObject({ code: "git-failed" });
    expect((await git.status(root)).branch.name).toBe("topic");
  });

  it("stages, unstages and commits selected files", async () => {
    const root = await repository();
    await writeFile(path.join(root, "a.txt"), "a\n");
    await writeFile(path.join(root, "b file.txt"), "b\n");
    await mkdir(path.join(root, "src"));
    await writeFile(path.join(root, "src", "c.ts"), "c\n");

    const initial = await git.status(path.join(root, "src"));
    expect(initial.branch).toMatchObject({ name: "main", oid: null, upstream: null });
    expect(initial.files.map((file) => [file.path, file.untracked])).toEqual([
      ["a.txt", true],
      ["b file.txt", true],
      ["src/c.ts", true],
    ]);

    const staged = await git.stage(root, ["a.txt", "b file.txt"]);
    expect(staged.files.filter((file) => file.staged).map((file) => file.path)).toEqual([
      "a.txt",
      "b file.txt",
    ]);
    const unstaged = await git.unstage(root, ["b file.txt"]);
    expect(unstaged.files.filter((file) => file.staged).map((file) => file.path)).toEqual([
      "a.txt",
    ]);

    const commit = await git.commit(root, "Add a\n\nBody line\n");
    expect(commit.summary).toBe("Add a");
    expect(commit.oid).toMatch(/^[0-9a-f]{40}$/);
    expect(commit.branch.oid).toBe(commit.oid);

    await writeFile(path.join(root, "a.txt"), "changed\n");
    await git.stage(root, ["a.txt"]);
    const after = await git.unstage(root, ["a.txt"]);
    expect(after.files.find((file) => file.path === "a.txt")).toMatchObject({
      index: ".",
      worktree: "M",
      staged: false,
      unstaged: true,
    });
  });

  it("explains an empty commit", async () => {
    const root = await repository();
    await expect(git.commit(root, "Nothing")).rejects.toMatchObject({ code: "nothing-to-commit" });
  });

  it("rejects paths outside the repository or inside .git", async () => {
    const root = await repository();
    for (const value of ["../escape.txt", "/etc/passwd", ".git/config", "src/../../escape"]) {
      await expect(git.stage(root, [value])).rejects.toMatchObject({
        code: "path-outside-repository",
      });
    }
  });

  it("treats paths literally rather than as globs", async () => {
    const root = await repository();
    await writeFile(path.join(root, "a.txt"), "a\n");
    await writeFile(path.join(root, "b.txt"), "b\n");
    await expect(git.stage(root, ["*.txt"])).rejects.toMatchObject({ code: "git-failed" });
    expect((await git.status(root)).files.some((file) => file.staged)).toBe(false);
  });

  it("returns hook output when a commit hook rejects the commit", async () => {
    const root = await repository();
    const hook = path.join(root, ".git", "hooks", "pre-commit");
    await writeFile(hook, "#!/bin/sh\necho 'lint failed: missing semicolon' >&2\nexit 1\n");
    await chmod(hook, 0o755);
    await writeFile(path.join(root, "a.txt"), "a\n");
    await git.stage(root, ["a.txt"]);
    await expect(git.commit(root, "Add a")).rejects.toMatchObject({
      code: "hook-failed",
      detail: expect.stringContaining("lint failed: missing semicolon"),
    });
  });

  it("pushes a branch without an upstream and sets it", async () => {
    const root = await repository();
    const remote = await mkdtemp(path.join(os.tmpdir(), "palot-git-remote-"));
    roots.push(remote);
    execFileSync("git", ["init", "--quiet", "--bare", remote]);
    execFileSync("git", ["-C", root, "remote", "add", "origin", remote]);
    await writeFile(path.join(root, "a.txt"), "a\n");
    await git.stage(root, ["a.txt"]);
    await git.commit(root, "Add a");

    await expect(git.push(root)).rejects.toMatchObject({ code: "default-branch-confirmation" });
    const pushed = await git.push(root, true);
    expect(pushed).toMatchObject({ remote: "origin", branch: "main", setUpstream: true });
    expect(pushed.branchStatus).toMatchObject({ upstream: "origin/main", ahead: 0, behind: 0 });

    await writeFile(path.join(root, "a.txt"), "b\n");
    await git.stage(root, ["a.txt"]);
    const second = await git.commit(root, "Change a");
    expect(second.branch.ahead).toBe(1);
    await expect(git.push(root, true)).resolves.toMatchObject({ setUpstream: false });
  });

  it("fetches ahead/behind, refuses divergent pulls by default, and rebases only explicitly", async () => {
    const root = await repository();
    const remote = await mkdtemp(path.join(os.tmpdir(), "palot-pull-remote-"));
    roots.push(remote);
    execFileSync("git", ["init", "--quiet", "--bare", remote]);
    execFileSync("git", ["-C", root, "remote", "add", "origin", remote]);
    await writeFile(path.join(root, "base.txt"), "base\n");
    await git.stage(root, ["base.txt"]);
    await git.commit(root, "Base");
    await git.push(root, true);
    execFileSync("git", ["-C", root, "checkout", "-qb", "feature"]);
    await git.push(root);
    const other = await repository();
    execFileSync("git", ["-C", other, "remote", "add", "origin", remote]);
    execFileSync("git", ["-C", other, "fetch", "--quiet", "origin"]);
    execFileSync("git", ["-C", other, "checkout", "-qb", "feature", "--track", "origin/feature"]);
    const change = async (directory: string, file: string) => {
      await writeFile(path.join(directory, file), file);
      await git.stage(directory, [file]);
      return git.commit(directory, `Add ${file}`);
    };
    await change(other, "remote.txt");
    await git.push(other);
    expect((await git.fetch(root)).branch).toMatchObject({ behind: 1, ahead: 0 });
    expect((await git.pull(root)).branch).toMatchObject({ behind: 0, ahead: 0 });
    const local = await change(root, "local.txt");
    await change(other, "remote2.txt");
    await git.push(other);
    await expect(git.pull(root)).rejects.toMatchObject({ code: "branch-diverged" });
    expect((await git.status(root)).branch.oid).toBe(local.oid);
    expect((await git.pull(root, "rebase")).branch).toMatchObject({ ahead: 1, behind: 0 });
    await git.push(root);
    await writeFile(path.join(root, "base.txt"), "uncommitted secret\n");
    const context = await git.pullRequestContext(root, "main");
    expect(context).toMatchObject({ branch: "feature", base: "main", pushed: true });
    expect(context.diff).toContain("remote2.txt");
    expect(context.diff).not.toContain("uncommitted secret");
    await expect(git.pullRequestContext(root, "--output=/tmp/invalid")).rejects.toMatchObject({
      code: "invalid-input",
    });
  });

  it("confirms a feature branch configured to push to the default branch", async () => {
    const root = await repository();
    const remote = await mkdtemp(path.join(os.tmpdir(), "palot-default-remote-"));
    roots.push(remote);
    execFileSync("git", ["init", "--quiet", "--bare", remote]);
    execFileSync("git", ["-C", root, "remote", "add", "origin", remote]);
    await writeFile(path.join(root, "a.txt"), "a");
    await git.stage(root, ["a.txt"]);
    await git.commit(root, "Base");
    await git.push(root, true);
    execFileSync("git", ["-C", root, "checkout", "-qb", "feature"]);
    execFileSync("git", ["-C", root, "branch", "--set-upstream-to=origin/main"]);
    await expect(git.push(root)).rejects.toMatchObject({ code: "default-branch-confirmation" });
  });

  it("reports a directory outside any repository", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "palot-not-git-"));
    roots.push(directory);
    await expect(git.status(directory)).rejects.toMatchObject({ code: "not-a-repository" });
    await expect(git.status("relative/path")).rejects.toMatchObject({ code: "invalid-input" });
  });
});

describe("parsePorcelainV2", () => {
  it("reads branch headers, renames, conflicts and untracked files", () => {
    const output = [
      "# branch.oid 0123456789abcdef0123456789abcdef01234567",
      "# branch.head feature/x",
      "# branch.upstream origin/feature/x",
      "# branch.ab +2 -1",
      "1 .M N... 100644 100644 100644 aaaa bbbb src/a file.ts",
      "2 R. N... 100644 100644 100644 aaaa bbbb R100 new name.ts",
      "old name.ts",
      "u UU N... 100644 100644 100644 100644 aaaa bbbb cccc conflict.ts",
      "? notes.md",
      "",
    ].join("\0");
    expect(parsePorcelainV2(output)).toEqual({
      branch: {
        name: "feature/x",
        oid: "0123456789abcdef0123456789abcdef01234567",
        upstream: "origin/feature/x",
        ahead: 2,
        behind: 1,
      },
      truncated: false,
      files: [
        expect.objectContaining({ path: "src/a file.ts", index: ".", worktree: "M" }),
        expect.objectContaining({
          path: "new name.ts",
          originalPath: "old name.ts",
          index: "R",
          staged: true,
        }),
        expect.objectContaining({ path: "conflict.ts", conflicted: true, staged: false }),
        expect.objectContaining({ path: "notes.md", untracked: true }),
      ],
    });
  });
});
