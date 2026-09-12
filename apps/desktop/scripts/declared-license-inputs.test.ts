import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import declarations from "../resources/licenses/DEPENDENCY_LICENSE_DECLARATIONS.json";
import { createDeclaredLicenseCollector } from "./declared-license-inputs";

const directories: string[] = [];
const digest = (text: string) => createHash("sha256").update(text).digest("hex");
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), "palot-declared-license-"));
  directories.push(directory);
  const record = structuredClone(declarations[0]!);
  const identity = { name: record.name, version: record.version, license: record.license };
  const manifest = JSON.stringify(identity);
  record.manifestSha256 = digest(manifest);
  const canonical = await readFile(
    path.resolve(import.meta.dirname, "../resources/licenses/upstream", record.standard.file),
    "utf8",
  );
  const textFile = path.join(directory, record.standard.file);
  await writeFile(path.join(directory, "package.json"), manifest);
  await writeFile(textFile, canonical);
  const collect = createDeclaredLicenseCollector([record], directory);
  const run = (license = record.license) =>
    collect(directory, record.name, record.version, license);
  return { directory, record, identity, manifest, canonical, textFile, collect, run };
}

it("renders complete standard terms without assigning a template copyright to the package", async () => {
  const { run, canonical } = await fixture();
  const result = await run();
  expect(result).toMatchObject({ sourceLabel: "Declared SPDX license: MIT; standard terms" });
  expect(result?.name).toContain("Standard SPDX spdx/license-list-data/text/MIT.txt");
  expect(result?.content).toBe(
    canonical.replace("Copyright (c) <year> <copyright holders>\n\n", ""),
  );
  expect(result?.content).toContain("The above copyright notice and this permission notice");
  expect(result?.content).toContain('THE SOFTWARE IS PROVIDED "AS IS"');
  expect(result?.content).not.toContain("<year>");
});

it("does not infer a standard-text fallback for unrecorded names or versions", async () => {
  const { collect, directory, record } = await fixture();
  expect(await collect(directory, "unrecorded-package", record.version, "MIT")).toBeNull();
  expect(await collect(directory, record.name, "0.0.14", "MIT")).toBeNull();
});

it("rejects a conflicting caller license and a changed installed manifest", async () => {
  const { run, directory, manifest } = await fixture();
  await expect(run("Apache-2.0")).rejects.toThrow("declared license conflicts");
  await writeFile(path.join(directory, "package.json"), `${manifest}\n`);
  await expect(run()).rejects.toThrow("installed manifest SHA-256 changed");
});

it.each([
  ["name", "different-package"],
  ["version", "0.0.14"],
  ["license", "Apache-2.0"],
])("rejects installed %s mismatch independently of manifest hashing", async (field, value) => {
  const { run, directory, record, identity } = await fixture();
  const changed = JSON.stringify({ ...identity, [field]: value });
  record.manifestSha256 = digest(changed);
  await writeFile(path.join(directory, "package.json"), changed);
  await expect(run()).rejects.toThrow("installed package identity or license conflicts");
});

it("rejects conflicting upstream metadata and incomplete archive evidence", async () => {
  const { run, record } = await fixture();
  record.source.license = "Apache-2.0";
  await expect(run()).rejects.toThrow("source declaration or standard-text provenance");
  record.source.license = "MIT";
  record.integrity = "";
  await expect(run()).rejects.toThrow("source declaration or standard-text provenance");
});

it("rejects changed, missing, and symlinked canonical text", async () => {
  const { run, canonical, directory, textFile } = await fixture();
  await writeFile(textFile, `${canonical}\n`);
  await expect(run()).rejects.toThrow("standard text is invalid or its SHA-256 changed");
  await rm(textFile);
  await expect(run()).rejects.toThrow();
  const target = path.join(directory, "other-text.txt");
  await writeFile(target, canonical);
  await symlink(target, textFile);
  await expect(run()).rejects.toThrow("retained regular file, not a symlink");
});

it("rejects ranges that omit grant text even when the canonical file hash matches", async () => {
  const { run, record } = await fixture();
  record.standard.termsFirstLine += 1;
  await expect(run()).rejects.toThrow("retain all terms");
});
