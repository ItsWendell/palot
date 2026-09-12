/** Assemble a complete, immutable desktop release before giving a job write access. */
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PalotReleaseBuildInfo } from "../src/shared/release-build-info";
import { artifactIdentity, resolveReleaseBuildInfo } from "./release-build-info";

export const RELEASE_TARGETS = ["linux-x64", "mac-arm64"] as const;
type Target = (typeof RELEASE_TARGETS)[number];
interface Digest {
  name: string;
  size: number;
  sha256: string;
}
interface Manifest {
  unsigned: boolean;
  publish: string;
  build: PalotReleaseBuildInfo;
  artifacts: Digest[];
  files: { checksums: string; sbom: string; provenance: string };
}

function fileName(value: unknown): asserts value is string {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)) {
    throw new Error(`Unsafe release file name: ${String(value)}`);
  }
}

export function assertReleaseIdentity(build: PalotReleaseBuildInfo): void {
  if (
    build.dirty !== false ||
    !/^[a-f0-9]{40}$/.test(build.commitSha) ||
    !/^[1-9]\d*$/.test(build.buildNumber) ||
    !["stable", "nightly"].includes(build.channel)
  ) {
    throw new Error(
      "Publication requires a clean, exact commit and a CI build number (stable or nightly).",
    );
  }
  const expected = resolveReleaseBuildInfo({
    PALOT_BUILD_CHANNEL: build.channel,
    PALOT_RELEASE_TAG: `v${build.version}`,
    PALOT_COMMIT_SHA: build.commitSha,
    PALOT_BUILD_NUMBER: build.buildNumber,
    PALOT_BUILD_DIRTY: "0",
  });
  if (!sameBuild(build, expected)) throw new Error("Release contract identity mismatch.");
}

function sameBuild(a: PalotReleaseBuildInfo, b: PalotReleaseBuildInfo): boolean {
  return (
    a.version === b.version &&
    a.channel === b.channel &&
    a.commitSha === b.commitSha &&
    a.buildNumber === b.buildNumber &&
    a.dirty === b.dirty &&
    a.openCodeContractVersion === b.openCodeContractVersion
  );
}

export function assertArtifactSet(
  names: string[],
  target: Target,
  build: PalotReleaseBuildInfo,
): void {
  const prefix = build.channel === "stable" ? "Palot" : "Palot-Nightly";
  const stem = `${prefix}-${build.version}-${artifactIdentity(build)}`;
  // electron-builder uses each distro's architecture spelling for installers.
  const suffixes =
    target === "linux-x64"
      ? ["linux-x86_64.AppImage", "linux-amd64.deb", "linux-x86_64.rpm", "linux-x64.tar.gz"]
      : ["mac-arm64.dmg", "mac-arm64.zip"];
  const required = suffixes.map((suffix) => `${stem}-${suffix}`);
  const optional = target === "mac-arm64" ? required.map((name) => `${name}.blockmap`) : [];
  if (
    new Set(names).size !== names.length ||
    required.some((name) => !names.includes(name)) ||
    names.some((name) => !required.includes(name) && !optional.includes(name))
  ) {
    throw new Error(
      `Incomplete or unexpected ${target} artifact set; expected ${required.join(", ")}.`,
    );
  }
}

async function digest(directory: string, name: string): Promise<Digest> {
  fileName(name);
  const location = path.join(directory, name);
  const stat = await lstat(location);
  if (!stat.isFile() || stat.size === 0)
    throw new Error(`Not a nonempty regular release file: ${name}`);
  const hash = createHash("sha256");
  for await (const bytes of createReadStream(location)) hash.update(bytes);
  return { name, size: stat.size, sha256: hash.digest("hex") };
}

async function verifiedFiles(
  directory: string,
  target: Target,
  expected: PalotReleaseBuildInfo,
): Promise<string[]> {
  const manifest = JSON.parse(
    await readFile(path.join(directory, "release-manifest.json"), "utf8"),
  ) as Manifest;
  if (
    manifest.unsigned !== true ||
    manifest.publish !== "never" ||
    !sameBuild(manifest.build, expected)
  ) {
    throw new Error(`Candidate identity mismatch: ${target}`);
  }
  assertArtifactSet(
    manifest.artifacts.map((artifact) => artifact.name),
    target,
    expected,
  );
  for (const artifact of manifest.artifacts) {
    const actual = await digest(directory, artifact.name);
    if (actual.size !== artifact.size || actual.sha256 !== artifact.sha256) {
      throw new Error(`Release digest mismatch: ${artifact.name}`);
    }
  }
  for (const name of Object.values(manifest.files)) fileName(name);
  if (
    manifest.files.checksums !== "SHA256SUMS" ||
    !manifest.files.sbom.endsWith(".cdx.json") ||
    !manifest.files.provenance.endsWith(".intoto.jsonl")
  )
    throw new Error("Invalid evidence names.");
  const checksums = await readFile(path.join(directory, manifest.files.checksums), "utf8");
  if (checksums !== manifest.artifacts.map((item) => `${item.sha256}  ${item.name}\n`).join("")) {
    throw new Error("Candidate checksums do not match manifest.");
  }
  const sbom = JSON.parse(await readFile(path.join(directory, manifest.files.sbom), "utf8"));
  if (
    sbom.bomFormat !== "CycloneDX" ||
    sbom.specVersion !== "1.6" ||
    sbom.metadata?.component?.version !== expected.version
  )
    throw new Error("Invalid candidate SBOM.");
  const provenance = JSON.parse(
    await readFile(path.join(directory, manifest.files.provenance), "utf8"),
  );
  if (
    JSON.stringify(provenance.subject) !==
    JSON.stringify(
      manifest.artifacts.map((item) => ({
        name: item.name,
        digest: { sha256: item.sha256 },
      })),
    )
  )
    throw new Error("Invalid candidate provenance subjects.");
  const files = [
    ...manifest.artifacts.map((item) => item.name),
    ...Object.values(manifest.files),
    "release-manifest.json",
  ];
  if (new Set(files).size !== files.length) throw new Error("Duplicate candidate evidence names.");
  for (const name of files) await digest(directory, name);
  return files;
}

export async function stageRelease(
  directory: string,
  output: string,
  target: Target,
  build: PalotReleaseBuildInfo,
): Promise<void> {
  assertReleaseIdentity(build);
  if (!RELEASE_TARGETS.includes(target)) throw new Error(`Unsupported release target: ${target}`);
  const files = await verifiedFiles(directory, target, build);
  await mkdir(output, { recursive: true });
  if ((await readdir(output)).length) throw new Error("Release staging directory must be empty.");
  for (const name of files) {
    await digest(directory, name);
    await copyFile(path.join(directory, name), path.join(output, name));
  }
}

export async function assembleRelease(
  directory: string,
  output: string,
  build: PalotReleaseBuildInfo,
): Promise<void> {
  assertReleaseIdentity(build);
  const entries = await readdir(directory);
  if (
    entries.length !== RELEASE_TARGETS.length ||
    RELEASE_TARGETS.some((target) => !entries.includes(target))
  ) {
    throw new Error("Both qualified release targets are required, with no extra targets.");
  }
  // Validate the full matrix before producing any upload files.
  const sets = await Promise.all(
    RELEASE_TARGETS.map(async (target) => ({
      target,
      files: await verifiedFiles(path.join(directory, target), target, build),
    })),
  );
  await mkdir(output, { recursive: true });
  if ((await readdir(output)).length) throw new Error("Release output directory must be empty.");
  const names = new Set<string>();
  for (const { target, files } of sets) {
    for (const name of files) {
      const outputName = ["SHA256SUMS", "release-manifest.json"].includes(name)
        ? `${target}-${name}`
        : name;
      if (names.has(outputName)) throw new Error(`Duplicate cross-platform asset: ${outputName}`);
      names.add(outputName);
      if (name === "release-manifest.json") {
        const manifest = JSON.parse(
          await readFile(path.join(directory, target, name), "utf8"),
        ) as Manifest;
        manifest.files.checksums = `${target}-SHA256SUMS`;
        await writeFile(path.join(output, outputName), `${JSON.stringify(manifest, null, 2)}\n`);
      } else await copyFile(path.join(directory, target, name), path.join(output, outputName));
    }
  }
  const assets = await Promise.all([...names].sort().map((name) => digest(output, name)));
  await writeFile(
    path.join(output, "release.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        build,
        targets: RELEASE_TARGETS,
        assets,
        macOSSigning: "ad-hoc; not Developer ID signed or notarized",
        updates: "manual downloads; no legacy auto-update feeds",
      },
      null,
      2,
    )}\n`,
  );
  assets.push(await digest(output, "release.json"));
  await writeFile(
    path.join(output, "SHA256SUMS"),
    assets.map((item) => `${item.sha256}  ${item.name}\n`).join(""),
  );
}

if (import.meta.main) {
  const [command, directory, output, target] = process.argv.slice(2);
  if (!directory || !output)
    throw new Error(
      "Usage: desktop-release.ts <stage|assemble> <input> <output> [linux-x64|mac-arm64]",
    );
  const build = resolveReleaseBuildInfo();
  if (command === "stage") await stageRelease(directory, output, target as Target, build);
  else if (command === "assemble") await assembleRelease(directory, output, build);
  else throw new Error(`Unknown release command: ${command}`);
}
