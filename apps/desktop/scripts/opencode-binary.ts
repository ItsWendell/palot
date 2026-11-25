/** Finds the exact-version OpenCode CLI that E2E runs and strobe benchmarks start as their service. */

import { execFile, execFileSync } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { access } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import packageJson from "../package.json" with { type: "json" };

const execFileAsync = promisify(execFile);

/** The OpenCode version the desktop app's generated client was built against. */
export const OPENCODE_VERSION = packageJson.devDependencies["@opencode/client"];

/** Where a downloaded CLI for `version` lives in the primary checkout. */
export function localOpenCodeBinary(primaryCheckout: string, version: string): string {
  return path.join(primaryCheckout, ".local/opencode-bin", version, "opencode");
}

/** Candidates in order: OPENCODE_BIN, the primary checkout's copy, then common install locations. */
export function openCodeCandidates(options: {
  version: string;
  primaryCheckout: string;
  environment?: NodeJS.ProcessEnv;
  home?: string;
}): string[] {
  const environment = options.environment ?? process.env;
  const home = options.home ?? homedir();
  const pathDirectories = (environment.PATH ?? "").split(path.delimiter).filter(Boolean);
  return [
    ...new Set(
      [
        environment.OPENCODE_BIN,
        localOpenCodeBinary(options.primaryCheckout, options.version),
        path.join(home, ".opencode/bin/opencode2"),
        path.join(home, ".local/bin/opencode2"),
        path.join(home, ".bun/bin/opencode2"),
        "/opt/homebrew/bin/opencode2",
        "/usr/local/bin/opencode2",
        ...pathDirectories.map((directory) => path.join(directory, "opencode2")),
      ].filter((candidate): candidate is string => Boolean(candidate)),
    ),
  ];
}

/** Whether `--version` output names exactly `version`, not a version it is a prefix of. */
export function reportsVersion(output: string, version: string): boolean {
  return output.split(/\s+/).some((token) => token.replace(/^v/, "") === version);
}

export async function findOpenCodeBinary(options: {
  version?: string;
  primaryCheckout: string;
  signal?: AbortSignal;
}): Promise<string> {
  const version = options.version ?? OPENCODE_VERSION;
  for (const candidate of openCodeCandidates({ ...options, version })) {
    options.signal?.throwIfAborted();
    try {
      await access(candidate, constants.X_OK);
      const { stdout, stderr } = await execFileAsync(candidate, ["--version"], {
        timeout: 5_000,
        signal: options.signal,
      });
      if (reportsVersion(`${stdout}\n${stderr}`, version)) return candidate;
    } catch {
      continue;
    }
  }
  throw missingBinary(version, options.primaryCheckout);
}

/** The same search for synchronous module setup, such as the strobe fixture's environment. */
export function findOpenCodeBinarySync(options: {
  version?: string;
  primaryCheckout: string;
}): string {
  const version = options.version ?? OPENCODE_VERSION;
  for (const candidate of openCodeCandidates({ ...options, version })) {
    try {
      accessSync(candidate, constants.X_OK);
      const output = execFileSync(candidate, ["--version"], {
        timeout: 5_000,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      if (reportsVersion(output, version)) return candidate;
    } catch {
      continue;
    }
  }
  throw missingBinary(version, options.primaryCheckout);
}

/** The checkout that owns `directory`'s repository, also from inside a linked worktree. */
export function primaryCheckoutSync(directory: string): string {
  const commonDirectory = execFileSync(
    "git",
    ["rev-parse", "--path-format=absolute", "--git-common-dir"],
    { cwd: directory, encoding: "utf8" },
  );
  return path.dirname(commonDirectory.trim());
}

function missingBinary(version: string, primaryCheckout: string): Error {
  return new Error(
    `OpenCode ${version} is required. Set OPENCODE_BIN to its executable path, or put it at ${localOpenCodeBinary(primaryCheckout, version)}.`,
  );
}
