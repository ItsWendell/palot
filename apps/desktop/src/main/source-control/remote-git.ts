import type { OpenCodeClient } from "@opencode/client";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { GitCommandError, GitRunner, type GitExec } from "./git";

export function quoteGitArgument(value: string): string {
  if (value.includes("\0"))
    throw new GitCommandError("invalid-input", "Git arguments cannot contain NUL characters.");
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

/** Preserve stderr and NUL-delimited Git stdout across the API's combined UTF-8 output. */
export function remoteGitCommand(command: string, input?: string): string {
  return `sh -c ${quoteGitArgument(`
set -u
umask 077
d=$(mktemp -d) || exit 125
trap 'rm -f "$d/out" "$d/err"; rmdir "$d"' EXIT HUP INT TERM
${input === undefined ? "" : `printf %s ${quoteGitArgument(input)} | `}${command} >"$d/out" 2>"$d/err"
code=$?
printf '%s\\n' "$code"
base64 <"$d/out" | tr -d '\\n'
printf '\\n'
base64 <"$d/err" | tr -d '\\n'
printf '\\n'
`)}`;
}

async function shell(
  client: OpenCodeClient,
  command: string,
  cwd: string,
  timeout: number,
  input?: string,
) {
  if (!cwd.startsWith("/") || cwd.includes("\0"))
    throw new GitCommandError("invalid-input", "Remote Git needs an absolute POSIX directory.");
  const location = { directory: cwd };
  const request = { signal: AbortSignal.timeout(timeout + 15_000) };
  const created = await client.shell
    .create(
      {
        location,
        cwd,
        command: remoteGitCommand(command, input),
        timeout,
        metadata: { "palot.sourceControl": true },
      },
      request,
    )
    .catch(() => {
      throw new GitCommandError(
        "unsupported-connection",
        "Remote Git needs a reachable OpenCode 2.2 server with the public shell API, or a local connection.",
      );
    });
  const id = created.data.id;
  try {
    let info = created.data;
    while (info.status === "running") {
      await delay(50, undefined, request);
      info = (await client.shell.get({ id, location }, request)).data;
    }
    if (info.status === "timeout") throw new GitCommandError("timeout", "Remote Git timed out.");
    if (info.status !== "exited" || info.exit !== 0)
      throw new GitCommandError(
        "git-failed",
        "Remote Git needs sh, mktemp and base64 on the server.",
      );
    let output = "";
    let cursor = 0;
    for (;;) {
      const page = (await client.shell.output({ id, location, cursor, limit: 1_048_576 }, request))
        .data;
      output += page.output;
      if (
        output.length > 48 * 1024 * 1024 ||
        page.truncated ||
        (page.cursor <= cursor && page.cursor < page.size)
      )
        throw new GitCommandError("git-failed", "Remote Git output is incomplete or too large.");
      cursor = page.cursor;
      if (cursor >= page.size) break;
    }
    const match = /^(\d+)\n([A-Za-z0-9+/=]*)\n([A-Za-z0-9+/=]*)\n$/.exec(output);
    if (!match)
      throw new GitCommandError("git-failed", "The remote shell returned an invalid Git response.");
    return {
      exitCode: Number(match[1]),
      stdout: Buffer.from(match[2]!, "base64").toString("utf8"),
      stderr: Buffer.from(match[3]!, "base64").toString("utf8"),
    };
  } finally {
    await client.shell
      .remove({ id, location }, { signal: AbortSignal.timeout(5_000) })
      .catch(() => undefined);
  }
}

/** Uses the selected server's public shell API, never a session or agent tool call. */
export function remoteGitRunner(client: OpenCodeClient): GitRunner {
  const exec: GitExec = (args, options) =>
    shell(
      client,
      `env GIT_TERMINAL_PROMPT=0 GCM_INTERACTIVE=never GIT_PAGER=cat GIT_EDITOR=true LC_ALL=C LANGUAGE=C git ${args.map(quoteGitArgument).join(" ")}`,
      options.cwd,
      options.timeout,
      options.input,
    );
  const directory = async (value: string) => {
    const result = await shell(client, "pwd -P", value, 15_000);
    if (result.exitCode || !result.stdout.trim().startsWith("/"))
      throw new GitCommandError("not-a-repository", "The remote directory is unavailable.");
    return result.stdout.trim();
  };
  return new GitRunner(
    exec,
    {
      directory,
      realpath: directory,
      executable: async (candidate) =>
        (await shell(client, `test -x ${quoteGitArgument(candidate)}`, "/", 15_000)).exitCode === 0,
    },
    path.posix,
  );
}
