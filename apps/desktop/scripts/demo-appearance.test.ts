import { mkdtemp, mkdir, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { seedDemoAppearance } from "./demo-appearance";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "palot-demo-appearance-"));
  roots.push(root);
  const appData = path.join(root, "config");
  await mkdir(appData);
  return { appData, destination: path.join(root, "appearance.json") };
}

async function profile(appData: string, name: string, preferences: object, timestamp: number) {
  const directory = path.join(appData, name);
  await mkdir(directory);
  const file = path.join(directory, "appearance.json");
  await writeFile(file, JSON.stringify({ preferences, unrelated: "do not copy" }));
  await writeFile(path.join(directory, "connections.json"), "do not copy");
  await utimes(file, timestamp, timestamp);
  return file;
}

it("snapshots the latest Palot appearance including its system palette, without linking user state", async () => {
  const options = await fixture();
  await profile(options.appData, "Palot", { source: "custom" }, 100);
  const preferences = {
    source: "system",
    systemPalette: "omarchy",
    omarchyTheme: { name: "Mountain Landscape", mode: "dark" },
  };
  const source = await profile(options.appData, "Palot (Nightly)", preferences, 200);
  await profile(options.appData, "Other app", { source: "wrong" }, 300);
  expect(await seedDemoAppearance(options)).toBe(source);
  expect(JSON.parse(await readFile(options.destination, "utf8"))).toEqual({ preferences });
  expect((await stat(options.destination)).mode & 0o777).toBe(0o600);
  await writeFile(options.destination, "{}");
  expect(JSON.parse(await readFile(source, "utf8")).preferences).toEqual(preferences);
});

it("accepts a worktree Dev profile and an explicit source override", async () => {
  const options = await fixture();
  const stable = await profile(options.appData, "Palot", { mode: "light" }, 100);
  const dev = await profile(options.appData, "Palot (Dev) (abc123)", { mode: "dark" }, 200);
  expect(await seedDemoAppearance(options)).toBe(dev);
  expect(await seedDemoAppearance({ ...options, source: stable })).toBe(stable);
  expect(JSON.parse(await readFile(options.destination, "utf8"))).toEqual({
    preferences: { mode: "light" },
  });
});

it("leaves a new machine on defaults when no appearance is saved", async () => {
  const options = await fixture();
  await mkdir(path.join(options.appData, "Palot"));
  expect(await seedDemoAppearance(options)).toBeNull();
  await expect(stat(options.destination)).rejects.toMatchObject({ code: "ENOENT" });
});

it("reports an invalid explicit source instead of copying arbitrary profile data", async () => {
  const options = await fixture();
  const source = path.join(options.appData, "invalid.json");
  await writeFile(source, '{"connections":[]}');
  await expect(seedDemoAppearance({ ...options, source })).rejects.toThrow(
    "Expected an appearance.json preferences object",
  );
  await expect(stat(options.destination)).rejects.toMatchObject({ code: "ENOENT" });
});
