/** Deletes old E2E run directories from the primary checkout's .local/desktop-e2e. */

import { execFileSync } from "node:child_process";
import { lstat, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

/** Run directories start with the ISO timestamp of their start, such as 2026-11-10T16-42-22-737Z-smoke-AbC123. */
const RUN_DIRECTORY = /^\d{4}-\d{2}-\d{2}T[\d-]+Z-/;
const DAY = 24 * 60 * 60 * 1000;

export type PruneResult = { removed: string[]; bytes: number; kept: number };

/** Removes run directories last modified more than `days` ago, and the homes they kept outside the checkout. */
export async function pruneRuns(options: {
  root: string;
  days: number;
  dryRun?: boolean;
  now?: number;
}): Promise<PruneResult> {
  const cutoff = (options.now ?? Date.now()) - options.days * DAY;
  const result: PruneResult = { removed: [], bytes: 0, kept: 0 };
  let entries: string[];
  try {
    entries = await readdir(options.root);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return result;
    throw error;
  }
  for (const entry of entries.sort()) {
    if (!RUN_DIRECTORY.test(entry)) continue;
    const directory = path.join(options.root, entry);
    const info = await lstat(directory);
    if (!info.isDirectory()) continue;
    if (info.mtimeMs >= cutoff) {
      result.kept += 1;
      continue;
    }
    const home = await externalHome(directory);
    result.bytes += (await size(directory)) + (home ? await size(home) : 0);
    result.removed.push(directory);
    if (options.dryRun) continue;
    await rm(directory, { recursive: true, force: true });
    if (home) await rm(home, { recursive: true, force: true });
  }
  return result;
}

/** A failed run's home kept in the temporary directory, as recorded in its instance.json. */
async function externalHome(directory: string): Promise<string | null> {
  try {
    const { home } = JSON.parse(await readFile(path.join(directory, "instance.json"), "utf8")) as {
      home?: unknown;
    };
    // Only ever follow the harness's own temporary homes, whatever the manifest says.
    if (
      typeof home === "string" &&
      path.dirname(home) === tmpdir() &&
      path.basename(home).startsWith("palot-e2e-home-")
    )
      return (await lstat(home).catch(() => null))?.isDirectory() ? home : null;
  } catch {
    // Runs without a readable manifest have no recorded external home.
  }
  return null;
}

/** Bytes on disk below `target`, without following symbolic links. */
async function size(target: string): Promise<number> {
  const info = await lstat(target).catch(() => null);
  if (!info) return 0;
  if (!info.isDirectory()) return info.size;
  const children = await readdir(target).catch(() => []);
  let total = info.size;
  for (const child of children) total += await size(path.join(target, child));
  return total;
}

export function formatBytes(bytes: number): string {
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${unit === 0 ? value : value.toFixed(1)} ${units[unit]}`;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  // Bun forwards the root script's separator.
  if (args[0] === "--") args.shift();
  const { values } = parseArgs({
    args,
    strict: true,
    options: {
      days: { type: "string", default: "14" },
      "dry-run": { type: "boolean", default: false },
      root: { type: "string" },
      help: { type: "boolean", default: false },
    },
  });
  if (values.help) {
    console.log(`Usage: bun run test:e2e:prune -- [--days <n>] [--dry-run] [--root <directory>]

Delete E2E run directories that have not changed for more than --days days
(default 14), along with homes failed runs kept in the temporary directory.
--root defaults to the primary checkout's .local/desktop-e2e. --dry-run lists
what would go without deleting anything.`);
    return;
  }
  if (!/^\d+$/.test(values.days)) throw new Error("--days takes a whole number of days");
  const root =
    values.root ??
    path.join(
      path.dirname(
        execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
          cwd: path.dirname(fileURLToPath(import.meta.url)),
          encoding: "utf8",
        }).trim(),
      ),
      ".local/desktop-e2e",
    );
  const dryRun = values["dry-run"];
  const result = await pruneRuns({ root, days: Number(values.days), dryRun });
  for (const directory of result.removed)
    console.log(`${dryRun ? "Would remove" : "Removed"} ${directory}`);
  console.log(
    `${dryRun ? "Would remove" : "Removed"} ${result.removed.length} run ${result.removed.length === 1 ? "directory" : "directories"} older than ${values.days} days (${formatBytes(result.bytes)}); kept ${result.kept} in ${root}.`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main().catch((error: unknown) => {
    console.error(`Palot E2E prune: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
