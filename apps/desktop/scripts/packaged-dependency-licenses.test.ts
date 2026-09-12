// @vitest-environment node
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createPackage } from "@electron/asar";
import { afterEach, expect, it, vi } from "vitest";
import {
  extractPackagedLicenseRoots,
  generatePackagedDependencyLicenses,
} from "./packaged-dependency-licenses";

vi.mock("../resources/licenses/DEPENDENCY_LICENSE_EVIDENCE.json", async () => {
  const { createHash } = await import("node:crypto");
  return {
    default: [
      {
        name: "example",
        version: "1.0.0",
        license: "MIT",
        file: "grant.js",
        sha256: createHash("sha256")
          .update("/*\nFixture grant\n*/\nthrow new Error('never execute');\n")
          .digest("hex"),
        firstLine: 2,
        lastLine: 2,
        source: "fixture",
      },
    ],
  };
});

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});
async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), "palot-packaged-notices-"));
  directories.push(directory);
  const source = path.join(directory, "source");
  const root = path.join(source, "node_modules/example");
  await mkdir(root, { recursive: true });
  await writeFile(
    path.join(root, "package.json"),
    JSON.stringify({ name: "example", version: "1.0.0", license: "MIT" }),
  );
  await writeFile(path.join(root, "LICENSE"), "Complete fixture grant");
  await writeFile(path.join(root, "NOTICE"), "Required fixture notice");
  await writeFile(path.join(root, "index.js"), "throw new Error('must not execute')");
  return { directory, source, root, asar: path.join(directory, "app.asar") };
}

it("extracts scoped and nested real packages, excluding arbitrary example manifests and code", async () => {
  const f = await fixture();
  for (const relative of [
    "node_modules/@scope/pkg",
    "node_modules/example/node_modules/child",
    "node_modules/example/examples/demo",
  ]) {
    const dir = path.join(f.source, relative);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "package.json"), "{}");
  }
  await createPackage(f.source, f.asar);
  const roots = await extractPackagedLicenseRoots(f.asar, path.join(f.directory, "extracted"));
  expect(roots).toHaveLength(3);
  for (const root of roots) await expect(readFile(path.join(root, "index.js"))).rejects.toThrow();
});

it("retains packaged notices and fails if actual packaged license text is missing", async () => {
  const f = await fixture();
  await createPackage(f.source, f.asar);
  const output = path.join(f.directory, "notices.md");
  await generatePackagedDependencyLicenses({
    asar: f.asar,
    extractedMetadataDirectory: path.join(f.directory, "first"),
    buildPackageDirectories: [f.root],
    output,
  });
  expect(await readFile(output, "utf8")).toContain("Required fixture notice");
  await rm(path.join(f.root, "LICENSE"));
  await createPackage(f.source, f.asar);
  await expect(
    generatePackagedDependencyLicenses({
      asar: f.asar,
      extractedMetadataDirectory: path.join(f.directory, "second"),
      buildPackageDirectories: [f.root],
      output,
    }),
  ).rejects.toThrow("inventory issues");
});

it("retains exact source-header evidence without executing the selected file", async () => {
  const f = await fixture();
  await rm(path.join(f.root, "LICENSE"));
  await writeFile(
    path.join(f.root, "grant.js"),
    "/*\nFixture grant\n*/\nthrow new Error('never execute');\n",
  );
  await createPackage(f.source, f.asar);
  const output = path.join(f.directory, "notices.md");
  await generatePackagedDependencyLicenses({
    asar: f.asar,
    extractedMetadataDirectory: path.join(f.directory, "extracted"),
    buildPackageDirectories: [f.root],
    output,
  });
  const report = await readFile(output, "utf8");
  expect(report).toContain("Fixture grant");
  expect(report).not.toContain("throw new Error");
});

it("retains omitted source notice evidence only for byte-matched packaged metadata", async () => {
  const f = await fixture();
  await rm(path.join(f.root, "LICENSE"));
  const metadata = { name: "example", version: "1.0.0", license: "MIT" };
  // The packager serializes a manifest after dropping package scripts.
  await writeFile(path.join(f.root, "package.json"), JSON.stringify(metadata, null, 2));
  await createPackage(f.source, f.asar);
  await writeFile(
    path.join(f.root, "package.json"),
    JSON.stringify({ ...metadata, scripts: { test: "fixture" } }),
  );
  await writeFile(
    path.join(f.root, "grant.js"),
    "/*\nFixture grant\n*/\nthrow new Error('never execute');\n",
  );
  const options = {
    asar: f.asar,
    extractedMetadataDirectory: path.join(f.directory, "extracted"),
    buildPackageDirectories: [f.root],
    sourceNodeModules: path.join(f.source, "node_modules"),
    output: path.join(f.directory, "notices.md"),
  };
  await generatePackagedDependencyLicenses(options);
  expect(await readFile(options.output, "utf8")).toContain("Fixture grant");
  await writeFile(
    path.join(f.root, "package.json"),
    JSON.stringify({ name: "example", version: "1.0.1", license: "MIT" }),
  );
  await expect(
    generatePackagedDependencyLicenses({
      ...options,
      extractedMetadataDirectory: path.join(f.directory, "mismatched"),
    }),
  ).rejects.toThrow("metadata mismatch");
});
