// @vitest-environment node

import { mkdir, mkdtemp, readdir, rm, stat, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { pruneRuns } from "./e2e-prune.ts";

const DAY = 24 * 60 * 60 * 1000;
const now = Date.now();
let root: string;
let home: string;

async function run(name: string, ageDays: number, manifest?: { home: string }) {
  const directory = path.join(root, name);
  await mkdir(path.join(directory, "logs"), { recursive: true });
  await writeFile(path.join(directory, "logs/main.log"), "x".repeat(1000));
  if (manifest) {
    await writeFile(path.join(directory, "instance.json"), JSON.stringify(manifest));
    await symlink(manifest.home, path.join(directory, "home"), "dir");
  }
  const time = new Date(now - ageDays * DAY);
  await utimes(directory, time, time);
  return directory;
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "palot-e2e-prune-"));
  home = await mkdtemp(path.join(tmpdir(), "palot-e2e-home-"));
  await writeFile(path.join(home, "state"), "y".repeat(500));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(home, { recursive: true, force: true });
});

describe("E2E prune", () => {
  it("removes only run directories older than the cutoff, with their kept homes", async () => {
    const old = await run("2026-10-01T10-00-00-000Z-smoke-AAAAAA", 20, { home });
    await run("2026-11-09T10-00-00-000Z-usage-BBBBBB", 1);
    await mkdir(path.join(root, "unrelated"));
    await writeFile(path.join(root, "last-run.json"), "{}");

    const preview = await pruneRuns({ root, days: 14, dryRun: true, now });
    expect(preview.removed).toEqual([old]);
    expect(preview.kept).toBe(1);
    expect(preview.bytes).toBeGreaterThan(1500);
    expect(await readdir(root)).toHaveLength(4);

    const result = await pruneRuns({ root, days: 14, now });
    expect(result.removed).toEqual([old]);
    expect((await readdir(root)).sort()).toEqual([
      "2026-11-09T10-00-00-000Z-usage-BBBBBB",
      "last-run.json",
      "unrelated",
    ]);
    await expect(stat(home)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("never follows a manifest home outside the harness's temporary homes", async () => {
    const outside = path.join(root, "unrelated");
    await mkdir(outside);
    await run("2026-10-01T10-00-00-000Z-smoke-AAAAAA", 20, { home: outside });
    await pruneRuns({ root, days: 14, now });
    expect(await readdir(root)).toEqual(["unrelated"]);
    expect((await stat(outside)).isDirectory()).toBe(true);
  });

  it("accepts a missing artifacts directory", async () => {
    expect(await pruneRuns({ root: path.join(root, "missing"), days: 14 })).toEqual({
      removed: [],
      bytes: 0,
      kept: 0,
    });
  });
});
