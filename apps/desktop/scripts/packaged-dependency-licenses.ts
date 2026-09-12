import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { extractFile, listPackage, statFile, uncache } from "@electron/asar";
import { generateDependencyLicenses } from "./generate-dependency-licenses";
import { provenancedPackageRoots, readValidatedBuildInputs } from "./build-inputs";
import reviewedEvidence from "../resources/licenses/DEPENDENCY_LICENSE_EVIDENCE.json";
import { verifyRuntimeNoticeInputs } from "./runtime-notice-inputs";
import type { PalotReleaseBuildInfo } from "../src/shared/release-build-info";
// The pinned builder exports this at runtime but strips its internal declaration.
// Reuse its exact transformation rather than maintaining a second metadata policy.
const { createTransformer } = createRequire(import.meta.url)(
  "app-builder-lib/out/fileTransformer",
) as {
  createTransformer(
    source: string,
    configuration: object,
    metadata: object,
  ): (file: string) => Promise<string | null> | null;
};

/** Read metadata and license evidence from the actual ASAR; never execute it. */
export async function extractPackagedLicenseRoots(
  asar: string,
  output: string,
  sourceNodeModules?: string,
): Promise<string[]> {
  uncache(asar);
  const entries = listPackage(asar, { isPack: false }).map((entry) => entry.replaceAll("\\", "/"));
  const manifests = entries.filter(
    (entry) => entry.startsWith("/node_modules/") && entry.endsWith("/package.json"),
  );
  const roots: string[] = [];
  for (const [index, manifest] of manifests.entries()) {
    const prefix = manifest.slice(0, -"package.json".length);
    // Do not mistake documentation/examples/test fixtures for installed package roots.
    const segments = prefix.split("/").filter(Boolean);
    const container = segments.lastIndexOf("node_modules");
    const name = segments.slice(container + 1);
    if (
      !(name.length === 1 && !name[0]!.startsWith("@")) &&
      !(name.length === 2 && name[0]!.startsWith("@"))
    )
      continue;
    const directory = path.join(output, String(index));
    await mkdir(directory, { recursive: true });
    const metadataBytes = extractFile(asar, manifest.slice(1));
    const metadata = JSON.parse(metadataBytes.toString());
    const evidence = reviewedEvidence.find(
      (item) => item.name === metadata.name && item.version === metadata.version && !item.workspace,
    );
    for (const entry of entries.filter((item) => item.startsWith(prefix))) {
      const relative = entry.slice(prefix.length);
      if (relative === evidence?.file) {
        if (path.isAbsolute(relative) || relative.split("/").includes(".."))
          throw new Error("Unsafe license evidence path.");
        await mkdir(path.dirname(path.join(directory, relative)), { recursive: true });
        await writeFile(path.join(directory, relative), extractFile(asar, entry.slice(1)));
        continue;
      }
      if (relative.includes("/") || relative === "." || relative === "..") continue;
      if (
        relative !== "package.json" &&
        !/^(licen[cs]e|copying|notice|readme)(?:$|[._-])/i.test(relative)
      )
        continue;
      await writeFile(path.join(directory, relative), extractFile(asar, entry.slice(1)));
    }
    // electron-builder omits dependency READMEs. Retain a recorded grant from the
    // source installation only when its manifest matches, including the pinned
    // builder's standard removal of scripts/development-only metadata.
    if (sourceNodeModules && evidence && !entries.includes(`${prefix}${evidence.file}`)) {
      const source = path.join(sourceNodeModules, evidence.name);
      try {
        const sourceManifest = path.join(source, "package.json");
        const sourceBytes = await readFile(sourceManifest);
        const transformed = await createTransformer(
          path.dirname(sourceNodeModules),
          {},
          {},
        )(sourceManifest);
        const expectedBytes = transformed == null ? sourceBytes : Buffer.from(transformed);
        if (!sourceBytes.equals(metadataBytes) && !expectedBytes.equals(metadataBytes)) {
          throw new Error(`Packaged/source license metadata mismatch: ${evidence.name}`);
        }
        if (path.isAbsolute(evidence.file) || evidence.file.split("/").includes(".."))
          throw new Error("Unsafe source license evidence path.");
        const content = await readFile(path.join(source, evidence.file));
        await mkdir(path.dirname(path.join(directory, evidence.file)), { recursive: true });
        await writeFile(path.join(directory, evidence.file), content);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        // The strict collector below reports missing evidence; never mark it complete.
      }
    }
    roots.push(directory);
  }
  return roots;
}

/** Build roots must come from verified build inputs, not a list of license successes. */
export async function generatePackagedDependencyLicenses(input: {
  asar: string;
  extractedMetadataDirectory: string;
  buildPackageDirectories: readonly string[];
  output: string;
  sourceNodeModules?: string;
}): Promise<Array<{ name: string; version: string; manifestSha256: string }>> {
  if (input.buildPackageDirectories.length === 0)
    throw new Error("Missing bundler package inventory.");
  const packaged = await extractPackagedLicenseRoots(
    input.asar,
    input.extractedMetadataDirectory,
    input.sourceNodeModules,
  );
  const directories = [...input.buildPackageDirectories, ...packaged];
  // Deduplicate byte-identical manifests only after validating every physical root's notices.
  await generateDependencyLicenses({
    packageDirectories: directories,
    output: input.output,
    check: true,
  });
  const packages = new Map<string, { name: string; version: string; manifestSha256: string }>();
  for (const directory of directories) {
    const bytes = await readFile(path.join(directory, "package.json"));
    const { name, version } = JSON.parse(bytes.toString());
    const manifestSha256 = createHash("sha256").update(bytes).digest("hex");
    packages.set(manifestSha256, { name, version, manifestSha256 });
  }
  return [...packages.values()].sort((a, b) =>
    `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`),
  );
}

export async function writePackagedDependencyNotices(
  appRoot: string,
  resources: string,
): Promise<void> {
  const manifest = readValidatedBuildInputs({ appRoot });
  const asar = path.join(resources, "app.asar");
  uncache(asar);
  const entries = listPackage(asar, { isPack: false });
  const expected = new Map(
    manifest.outputs
      .filter((file) => !file.path.endsWith(".map"))
      .map((file) => [`/out/${file.path}`, file.sha256]),
  );
  for (const entry of entries.filter((file) => file.startsWith("/out/"))) {
    // ASAR lists directories too; only entries with file bytes have a digest.
    if ("files" in statFile(asar, entry.slice(1), false)) continue;
    const wanted = expected.get(entry);
    if (
      !wanted ||
      createHash("sha256")
        .update(extractFile(asar, entry.slice(1)))
        .digest("hex") !== wanted
    ) {
      throw new Error(`Unaccounted or changed packaged bundle: ${entry}`);
    }
    expected.delete(entry);
  }
  if (expected.size)
    throw new Error(`Missing packaged build outputs: ${[...expected.keys()].join(", ")}`);
  const runtimeNotices = new Set<string>();
  const licenseDirectory = path.join(resources, "licenses");
  for (const output of manifest.outputs.filter((file) => file.path.endsWith(".wasm"))) {
    if (!/^renderer\/assets\/ghostty-vt-[^/]+\.wasm$/.test(output.path))
      throw new Error(`Unmapped WebAssembly artifact: ${output.path}`);
    for (const notice of await verifyRuntimeNoticeInputs({
      artifactId: "ghostty-web-wasm",
      artifactPath: path.join(appRoot, "out", output.path),
      licenseDirectory,
    }))
      runtimeNotices.add(notice);
  }
  const runtime = JSON.parse(
    await readFile(path.join(resources, "opencode", "manifest.json"), "utf8"),
  );
  for (const notice of await verifyRuntimeNoticeInputs({
    artifactId: `opencode-${process.platform}-${runtime.architecture}`,
    artifactPath: path.join(resources, "opencode", "opencode2"),
    licenseDirectory,
  }))
    runtimeNotices.add(notice);
  const scratchRoot = path.resolve(appRoot, "../../.local/packaged-notices");
  await mkdir(scratchRoot, { recursive: true });
  const scratch = await mkdtemp(path.join(scratchRoot, "capture-"));
  try {
    const packages = await generatePackagedDependencyLicenses({
      asar,
      extractedMetadataDirectory: scratch,
      buildPackageDirectories: provenancedPackageRoots(manifest).map((pkg) => pkg.root),
      output: path.join(resources, "licenses", "DEPENDENCY_LICENSES.md"),
      sourceNodeModules: path.resolve(appRoot, "../../node_modules"),
    });
    await writeFile(
      path.join(resources, "licenses", "PACKAGED_DEPENDENCIES.json"),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          build: {
            commit: manifest.binding.commit,
            channel: manifest.binding.channel,
            version: manifest.binding.version,
          },
          lockfileSha256: manifest.binding.lockfile.sha256,
          scope:
            "conservative loaded bundler modules and package manifests extracted from this application",
          packages,
          runtimeNotices: [...runtimeNotices].sort(),
          reportSha256: createHash("sha256")
            .update(await readFile(path.join(licenseDirectory, "DEPENDENCY_LICENSES.md")))
            .digest("hex"),
        },
        null,
        2,
      )}\n`,
    );
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

export async function verifyPackagedDependencyNotices(
  resources: string,
  build: PalotReleaseBuildInfo,
): Promise<void> {
  const licenses = path.join(resources, "licenses");
  const inventory = JSON.parse(
    await readFile(path.join(licenses, "PACKAGED_DEPENDENCIES.json"), "utf8"),
  );
  if (
    inventory.schemaVersion !== 1 ||
    inventory.build?.commit !== build.commitSha ||
    inventory.build?.channel !== build.channel ||
    inventory.build?.version !== build.version ||
    !Array.isArray(inventory.packages) ||
    inventory.packages.length === 0
  )
    throw new Error("Packaged notice inventory identity mismatch.");
  const report = await readFile(path.join(licenses, "DEPENDENCY_LICENSES.md"));
  if (createHash("sha256").update(report).digest("hex") !== inventory.reportSha256)
    throw new Error("Packaged dependency notices changed.");
  const runtime = JSON.parse(
    await readFile(path.join(resources, "opencode", "manifest.json"), "utf8"),
  );
  await verifyRuntimeNoticeInputs({
    artifactId: `opencode-${process.platform}-${runtime.architecture}`,
    artifactPath: path.join(resources, "opencode", "opencode2"),
    licenseDirectory: licenses,
  });
  const asar = path.join(resources, "app.asar");
  uncache(asar);
  const wasm = listPackage(asar, { isPack: false }).filter((name) => name.endsWith(".wasm"));
  if (wasm.length !== 1) throw new Error("Unexpected packaged WebAssembly artifact set.");
  // Verification can run from a read-only DMG: use OS temporary storage, never the bundle.
  const temporary = await mkdtemp(path.join(tmpdir(), "palot-wasm-notices-"));
  try {
    const file = path.join(temporary, "ghostty.wasm");
    await writeFile(file, extractFile(asar, wasm[0]!.slice(1)));
    await verifyRuntimeNoticeInputs({
      artifactId: "ghostty-web-wasm",
      artifactPath: file,
      licenseDirectory: licenses,
    });
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const [appRoot, resources] = process.argv.slice(2);
  if (!appRoot || !resources)
    throw new Error("Usage: packaged-dependency-licenses.ts <app-root> <packaged-resources>");
  await writePackagedDependencyNotices(path.resolve(appRoot), path.resolve(resources));
}
