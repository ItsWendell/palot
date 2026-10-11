import { execFile } from "node:child_process";
import { access, constants, realpath, stat } from "node:fs/promises";
import path from "node:path";
import type {
  GitBranchStatus,
  GitCommitResult,
  GitFileStatus,
  GitPushResult,
  GitStatusCode,
  GitWorkingTreeStatus,
  SourceControlErrorCode,
} from "../../shared/source-control-contract";

const READ_TIMEOUT_MS = 15_000;
const WRITE_TIMEOUT_MS = 60_000;
/** Commit hooks (lint, tests) and pushes over slow links need longer. */
const HOOK_TIMEOUT_MS = 5 * 60_000;
const MAX_BUFFER = 32 * 1024 * 1024;
const MAX_FILES = 5_000;
const MAX_DETAIL = 8_000;
const MAX_PATHS = 2_000;

export class GitCommandError extends Error {
  constructor(
    readonly code: SourceControlErrorCode,
    message: string,
    readonly detail?: string,
  ) {
    super(message);
    this.name = "GitCommandError";
  }
}

interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export type GitExec = (
  args: string[],
  options: { cwd: string; timeout: number; input?: string },
) => Promise<RunResult>;

/** Runs git without a shell, prompts, pager, or locale-dependent messages. */
export const execGit: GitExec = (args, options) =>
  new Promise((resolve, reject) => {
    const child = execFile(
      "git",
      args,
      {
        cwd: options.cwd,
        timeout: options.timeout,
        maxBuffer: MAX_BUFFER,
        windowsHide: true,
        encoding: "utf8",
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: "0",
          GCM_INTERACTIVE: "never",
          GIT_PAGER: "cat",
          GIT_EDITOR: "true",
          LC_ALL: "C",
          LANGUAGE: "C",
        },
      },
      (error, stdout, stderr) => {
        if (!error) {
          resolve({ stdout, stderr, exitCode: 0 });
          return;
        }
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "ENOENT") {
          reject(new GitCommandError("git-failed", "Git is not installed or not on PATH."));
          return;
        }
        if (error.killed || (error as { signal?: string }).signal) {
          reject(
            new GitCommandError(
              "timeout",
              `git ${args.find((arg) => !arg.startsWith("-")) ?? ""} timed out.`,
              trimDetail(`${stdout}\n${stderr}`),
            ),
          );
          return;
        }
        resolve({ stdout, stderr, exitCode: typeof code === "number" ? code : 1 });
      },
    );
    // Git may exit before reading stdin (a failing hook); that is reported through its exit code.
    child.stdin?.on("error", () => undefined);
    if (options.input === undefined) child.stdin?.end();
    else child.stdin?.end(options.input);
  });

/**
 * Local Git writes for a task directory. Every command runs at the repository root with
 * explicit arguments, literal pathspecs and a timeout; paths from the renderer must stay inside
 * the repository and outside `.git`.
 */
export class GitRunner {
  constructor(private readonly exec: GitExec = execGit) {}

  async root(directory: string): Promise<string> {
    if (!path.isAbsolute(directory))
      throw new GitCommandError("invalid-input", "The directory must be an absolute path.");
    let resolved: string;
    try {
      resolved = await realpath(directory);
      if (!(await stat(resolved)).isDirectory()) throw new Error("not a directory");
    } catch {
      throw new GitCommandError("not-a-repository", "The task directory does not exist.");
    }
    const result = await this.exec(["rev-parse", "--show-toplevel"], {
      cwd: resolved,
      timeout: READ_TIMEOUT_MS,
    });
    const top = result.stdout.trim();
    if (result.exitCode !== 0 || !top)
      throw new GitCommandError(
        "not-a-repository",
        "The task directory is not inside a Git repository.",
        trimDetail(result.stderr),
      );
    return realpath(top);
  }

  async status(directory: string): Promise<GitWorkingTreeStatus> {
    const root = await this.root(directory);
    return this.statusAt(root);
  }

  async branch(directory: string): Promise<GitBranchStatus> {
    const root = await this.root(directory);
    const result = await this.git(root, [
      "--no-optional-locks",
      "status",
      "--porcelain=v2",
      "--branch",
      "-z",
      "--untracked-files=no",
      "--ignore-submodules=all",
    ]);
    return parsePorcelainV2(result.stdout).branch;
  }

  async stage(directory: string, paths: string[]): Promise<GitWorkingTreeStatus> {
    const root = await this.root(directory);
    const safe = validatePaths(root, paths);
    // `--all` stages deletions of the named paths too.
    await this.git(root, ["--literal-pathspecs", "add", "--all", "--", ...safe], WRITE_TIMEOUT_MS);
    return this.statusAt(root);
  }

  async unstage(directory: string, paths: string[]): Promise<GitWorkingTreeStatus> {
    const root = await this.root(directory);
    const safe = validatePaths(root, paths);
    if (await this.hasHead(root))
      await this.git(
        root,
        ["--literal-pathspecs", "restore", "--staged", "--", ...safe],
        WRITE_TIMEOUT_MS,
      );
    else
      await this.git(
        root,
        [
          "--literal-pathspecs",
          "rm",
          "--cached",
          "-r",
          "--quiet",
          "--ignore-unmatch",
          "--",
          ...safe,
        ],
        WRITE_TIMEOUT_MS,
      );
    return this.statusAt(root);
  }

  async commit(directory: string, message: string): Promise<GitCommitResult> {
    const root = await this.root(directory);
    if (!message.trim())
      throw new GitCommandError("invalid-input", "Write a commit message first.");
    const staged = await this.exec(["diff", "--cached", "--quiet", "--no-ext-diff"], {
      cwd: root,
      timeout: READ_TIMEOUT_MS,
    });
    if (staged.exitCode === 0)
      throw new GitCommandError("nothing-to-commit", "Nothing is staged to commit.");
    const result = await this.exec(["commit", "--file=-", "--cleanup=whitespace"], {
      cwd: root,
      timeout: HOOK_TIMEOUT_MS,
      input: message,
    });
    if (result.exitCode !== 0) throw await this.commitError(root, result);
    const head = await this.git(root, ["log", "-1", "--format=%H%x00%s"]);
    const [oid = "", summary = ""] = head.stdout.trim().split("\0");
    return { oid, summary, branch: (await this.statusAt(root)).branch };
  }

  async push(directory: string): Promise<GitPushResult> {
    const root = await this.root(directory);
    const branch = (await this.statusAt(root)).branch;
    if (!branch.name)
      throw new GitCommandError("detached-head", "Check out a branch before pushing.");
    if (!branch.oid) throw new GitCommandError("nothing-to-commit", "Commit before pushing.");
    let remote: string;
    let setUpstream = false;
    let args: string[];
    if (branch.upstream) {
      remote =
        (await this.config(root, `branch.${branch.name}.remote`)) ?? branch.upstream.split("/")[0]!;
      args = ["push", "--porcelain"];
    } else {
      remote = await this.defaultRemote(root, branch.name);
      setUpstream = true;
      args = ["push", "--porcelain", "--set-upstream", remote, `HEAD:refs/heads/${branch.name}`];
    }
    const result = await this.exec(args, { cwd: root, timeout: HOOK_TIMEOUT_MS });
    if (result.exitCode !== 0) throw pushError(result);
    return {
      remote,
      branch: branch.name,
      setUpstream,
      branchStatus: (await this.statusAt(root)).branch,
    };
  }

  /** `git remote get-url origin` and the current branch, for pull request detection. */
  async remoteAndBranch(
    directory: string,
  ): Promise<{ remote: string | null; branch: string | null }> {
    const root = await this.root(directory);
    const branch = (await this.statusAt(root)).branch.name;
    const remoteName = branch
      ? ((await this.config(root, `branch.${branch}.remote`)) ?? "origin")
      : "origin";
    const url = await this.exec(["remote", "get-url", remoteName], {
      cwd: root,
      timeout: READ_TIMEOUT_MS,
    });
    if (url.exitCode === 0 && url.stdout.trim()) return { remote: url.stdout.trim(), branch };
    if (remoteName !== "origin") {
      const origin = await this.exec(["remote", "get-url", "origin"], {
        cwd: root,
        timeout: READ_TIMEOUT_MS,
      });
      if (origin.exitCode === 0 && origin.stdout.trim())
        return { remote: origin.stdout.trim(), branch };
    }
    return { remote: null, branch };
  }

  private async statusAt(root: string): Promise<GitWorkingTreeStatus> {
    const result = await this.git(root, [
      "--no-optional-locks",
      "status",
      "--porcelain=v2",
      "--branch",
      "-z",
      "--untracked-files=all",
    ]);
    return { root, ...parsePorcelainV2(result.stdout) };
  }

  private async hasHead(root: string): Promise<boolean> {
    const result = await this.exec(["rev-parse", "--verify", "--quiet", "HEAD"], {
      cwd: root,
      timeout: READ_TIMEOUT_MS,
    });
    return result.exitCode === 0;
  }

  private async config(root: string, key: string): Promise<string | null> {
    const result = await this.exec(["config", "--get", key], {
      cwd: root,
      timeout: READ_TIMEOUT_MS,
    });
    return result.exitCode === 0 && result.stdout.trim() ? result.stdout.trim() : null;
  }

  private async defaultRemote(root: string, branch: string): Promise<string> {
    const configured =
      (await this.config(root, `branch.${branch}.pushRemote`)) ??
      (await this.config(root, "remote.pushDefault"));
    if (configured) return configured;
    const remotes = (await this.git(root, ["remote"])).stdout.split("\n").filter(Boolean);
    if (remotes.includes("origin")) return "origin";
    if (remotes.length === 1) return remotes[0]!;
    throw new GitCommandError(
      "no-remote",
      remotes.length === 0
        ? "This repository has no remote to push to."
        : "This branch has no upstream and the repository has several remotes; set one with `git push -u`.",
    );
  }

  private async commitError(root: string, result: RunResult): Promise<GitCommandError> {
    const output = `${result.stdout}\n${result.stderr}`;
    const detail = trimDetail(output);
    if (
      /Please tell me who you are|unable to auto-detect email address|empty ident name/i.test(
        output,
      )
    )
      return new GitCommandError(
        "identity-missing",
        "Git needs your name and email before committing (git config user.name / user.email).",
        detail,
      );
    if (/nothing to commit|no changes added to commit/i.test(output))
      return new GitCommandError("nothing-to-commit", "Nothing is staged to commit.", detail);
    if (await this.hasCommitHooks(root))
      return new GitCommandError("hook-failed", "A commit hook rejected the commit.", detail);
    return new GitCommandError("git-failed", "Git could not create the commit.", detail);
  }

  private async hasCommitHooks(root: string): Promise<boolean> {
    const hooksPath = await this.config(root, "core.hooksPath");
    for (const hook of ["pre-commit", "commit-msg", "prepare-commit-msg"]) {
      const result = hooksPath
        ? null
        : await this.exec(["rev-parse", "--git-path", `hooks/${hook}`], {
            cwd: root,
            timeout: READ_TIMEOUT_MS,
          });
      const candidate = hooksPath
        ? path.resolve(root, hooksPath, hook)
        : path.resolve(root, result!.stdout.trim());
      try {
        await access(candidate, constants.X_OK);
        return true;
      } catch {
        // Not present or not executable.
      }
    }
    return false;
  }

  private async git(root: string, args: string[], timeout = READ_TIMEOUT_MS): Promise<RunResult> {
    const result = await this.exec(args, { cwd: root, timeout });
    if (result.exitCode !== 0)
      throw new GitCommandError(
        "git-failed",
        `git ${args.find((arg) => !arg.startsWith("-")) ?? ""} failed.`,
        trimDetail(`${result.stdout}\n${result.stderr}`),
      );
    return result;
  }
}

function pushError(result: RunResult): GitCommandError {
  const output = `${result.stdout}\n${result.stderr}`;
  const detail = trimDetail(output);
  if (
    /Authentication failed|could not read Username|Permission denied \(publickey|terminal prompts disabled|HTTP 403|returned error: 403|Invalid username or password/i.test(
      output,
    )
  )
    return new GitCommandError("auth-failed", "The remote rejected Git's credentials.", detail);
  if (/\[rejected\]|non-fast-forward|fetch first|\[remote rejected\]/i.test(output))
    return new GitCommandError(
      "push-rejected",
      "The remote rejected the push; pull or rebase first.",
      detail,
    );
  if (/pre-push hook|hook declined/i.test(output))
    return new GitCommandError("hook-failed", "A push hook rejected the push.", detail);
  if (
    /Could not resolve host|unable to access|Connection (refused|timed out)|Network is unreachable/i.test(
      output,
    )
  )
    return new GitCommandError("network", "Could not reach the remote.", detail);
  if (
    /does not appear to be a git repository|No such remote|No configured push destination/i.test(
      output,
    )
  )
    return new GitCommandError("no-remote", "The push remote is missing or invalid.", detail);
  return new GitCommandError("git-failed", "Git could not push.", detail);
}

/** Keeps paths relative, inside the repository, and outside `.git`. */
export function validatePaths(root: string, paths: string[]): string[] {
  if (!Array.isArray(paths) || paths.length === 0)
    throw new GitCommandError("invalid-input", "Choose at least one file.");
  if (paths.length > MAX_PATHS)
    throw new GitCommandError("invalid-input", `Choose at most ${MAX_PATHS} files at once.`);
  return paths.map((value) => {
    if (typeof value !== "string" || !value || value.includes("\0") || path.isAbsolute(value))
      throw new GitCommandError("path-outside-repository", "A file path is invalid.");
    const resolved = path.resolve(root, value);
    const relative = path.relative(root, resolved);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative))
      throw new GitCommandError("path-outside-repository", `${value} is outside the repository.`);
    const first = relative.split(path.sep)[0]!;
    if (first.toLowerCase() === ".git")
      throw new GitCommandError("path-outside-repository", "Paths inside .git are not allowed.");
    return relative.split(path.sep).join("/");
  });
}

export function parsePorcelainV2(output: string): Omit<GitWorkingTreeStatus, "root"> {
  const branch: GitBranchStatus = { name: null, oid: null, upstream: null, ahead: 0, behind: 0 };
  const files: GitFileStatus[] = [];
  let truncated = false;
  const records = output.split("\0");
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index]!;
    if (!record) continue;
    if (record.startsWith("# ")) {
      const [, key, ...rest] = record.split(" ");
      const value = rest.join(" ");
      if (key === "branch.oid") branch.oid = value === "(initial)" ? null : value;
      else if (key === "branch.head") branch.name = value === "(detached)" ? null : value;
      else if (key === "branch.upstream") branch.upstream = value;
      else if (key === "branch.ab") {
        const match = /^\+(\d+) -(\d+)$/.exec(value);
        if (match) {
          branch.ahead = Number(match[1]);
          branch.behind = Number(match[2]);
        }
      }
      continue;
    }
    const kind = record[0];
    let file: GitFileStatus | null = null;
    if (kind === "1") {
      const parts = split(record, 9);
      file = entry(parts[1]!, parts[8]!, null, false);
    } else if (kind === "2") {
      const parts = split(record, 10);
      // With -z the rename source is the next record.
      const original = records[index + 1] ?? null;
      index += 1;
      file = entry(parts[1]!, parts[9]!, original, false);
    } else if (kind === "u") {
      const parts = split(record, 11);
      file = entry(parts[1]!, parts[10]!, null, true);
    } else if (kind === "?") {
      file = {
        path: record.slice(2),
        originalPath: null,
        index: ".",
        worktree: ".",
        staged: false,
        unstaged: true,
        untracked: true,
        conflicted: false,
      };
    }
    if (!file) continue;
    if (files.length >= MAX_FILES) {
      truncated = true;
      continue;
    }
    files.push(file);
  }
  return { branch, files, truncated };
}

/** Splits into `count` fields; the last keeps any spaces (the path). */
function split(record: string, count: number): string[] {
  const parts: string[] = [];
  let rest = record;
  for (let index = 0; index < count - 1; index += 1) {
    const space = rest.indexOf(" ");
    if (space < 0) break;
    parts.push(rest.slice(0, space));
    rest = rest.slice(space + 1);
  }
  parts.push(rest);
  return parts;
}

const CODES = new Set<GitStatusCode>([".", "M", "T", "A", "D", "R", "C", "U"]);

function entry(xy: string, filePath: string, originalPath: string | null, conflicted: boolean) {
  const index = code(xy[0]);
  const worktree = code(xy[1]);
  return {
    path: filePath,
    originalPath,
    index,
    worktree,
    staged: !conflicted && index !== ".",
    unstaged: conflicted || worktree !== ".",
    untracked: false,
    conflicted,
  } satisfies GitFileStatus;
}

function code(value: string | undefined): GitStatusCode {
  return value && CODES.has(value as GitStatusCode) ? (value as GitStatusCode) : ".";
}

function trimDetail(value: string): string | undefined {
  const text = value.trim();
  if (!text) return undefined;
  return text.length > MAX_DETAIL ? `…${text.slice(-MAX_DETAIL)}` : text;
}
