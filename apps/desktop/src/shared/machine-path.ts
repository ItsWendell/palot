/**
 * OpenCode's machine path syntax (the experimental `machines` flag): a tool path such as
 * `devbox:/srv/app/a.ts` or `devbox:~/notes.md` names a file on another machine linked to the
 * server. This mirrors OpenCode 2.4.1's `core/src/machine/path.ts` and the dev branch's
 * `environment/path.ts`, which also reads `local:/…` (and `local:C:\…`) as this server's path.
 *
 * Windows drives (`C:\x`), URLs (`https://`, `skill://`), `mailto:x`, workspace ids
 * (`wrk_…:/`) and unrooted text (`gpu:work`) are never machine paths.
 *
 * Runs in the renderer sandbox; no Node globals.
 */

/** OpenCode's machine name rule: lowercase, starts with a letter, 2 to 63 characters. */
export const MACHINE_NAME_PATTERN = /^[a-z][a-z0-9-]{1,62}$/;

/** The environment name OpenCode reserves for the server's own files. */
export const LOCAL_ENVIRONMENT = "local";

export interface MachinePath {
  /** The machine's name, as `experimental.machine.list` reports it in `id`. */
  machine: string;
  /** The path on that machine as written: `/…` or `~…`. */
  path: string;
}

/** Whether OpenCode accepts `name` for a new machine. */
export function isMachineName(name: string): boolean {
  return MACHINE_NAME_PATTERN.test(name) && name !== LOCAL_ENVIRONMENT;
}

function split(text: string): { name: string; rest: string } | null {
  const colon = text.indexOf(":");
  if (colon <= 0) return null;
  return { name: text.slice(0, colon), rest: text.slice(colon + 1) };
}

const rooted = (rest: string) =>
  (rest.startsWith("/") || rest.startsWith("~")) && !rest.startsWith("//");

/** Splits `devbox:/work/a` or `devbox:~/a` into machine and path; null for anything else. */
export function parseMachinePath(text: string | null | undefined): MachinePath | null {
  if (!text) return null;
  const named = split(text.trim());
  if (!named || !isMachineName(named.name) || !rooted(named.rest)) return null;
  return { machine: named.name, path: named.rest };
}

/**
 * The path a `local:` prefix names on the server (`local:/a` → `/a`, `local:C:\a` → `C:\a`),
 * or the text unchanged when it has no such prefix.
 */
export function stripLocalPrefix(text: string): string {
  if (!text.startsWith(`${LOCAL_ENVIRONMENT}:`)) return text;
  const rest = text.slice(LOCAL_ENVIRONMENT.length + 1);
  if (rooted(rest) || /^[A-Za-z]:[\\/]/.test(rest)) return rest;
  return text;
}

/** `devbox:/a`: what `parseMachinePath` reads back. */
export function formatMachinePath(path: MachinePath): string {
  return `${path.machine}:${path.path}`;
}

/** The machines a set of tool paths name, in first-seen order. */
export function machinesInPaths(paths: Iterable<string | null | undefined>): string[] {
  const machines: string[] = [];
  for (const path of paths) {
    const machine = parseMachinePath(path)?.machine;
    if (machine && !machines.includes(machine)) machines.push(machine);
  }
  return machines;
}
