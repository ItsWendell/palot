import { createHash, randomUUID } from "node:crypto";
import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import { arch, platform, release } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import desktopPackage from "../package.json" with { type: "json" };
import type { PalotReleaseBuildInfo } from "../src/shared/release-build-info";
import { artifactIdentity, REPOSITORY_ROOT, resolveReleaseBuildInfo } from "./release-build-info";

const GENERATED_FILE_NAMES = new Set(["SHA256SUMS", "release-manifest.json"]);
const ARTIFACT_EXTENSIONS = [
  ".dmg",
  ".zip",
  ".exe",
  ".AppImage",
  ".deb",
  ".rpm",
  ".tar.gz",
  ".blockmap",
] as const;

interface ArtifactDigest {
  name: string;
  size: number;
  sha256: string;
}

export async function removePreviousUnsignedReleaseArtifacts(input: {
  releaseDirectory: string;
  buildInfo: PalotReleaseBuildInfo;
}): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(input.releaseDirectory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const marker = `${input.buildInfo.version}-${artifactIdentity(input.buildInfo)}`;
  const removed = entries
    .filter(
      (entry) =>
        entry.isFile() && (GENERATED_FILE_NAMES.has(entry.name) || entry.name.includes(marker)),
    )
    .map((entry) => entry.name);
  await Promise.all(
    removed.map((entry) => rm(path.join(input.releaseDirectory, entry), { force: true })),
  );
  return removed.toSorted();
}

export async function generateUnsignedReleaseMetadata(input: {
  releaseDirectory: string;
  buildInfo: PalotReleaseBuildInfo;
}): Promise<void> {
  const artifactMarker = `${input.buildInfo.version}-${artifactIdentity(input.buildInfo)}`;
  const artifacts = (await collectReleaseArtifacts(input.releaseDirectory)).filter((artifact) =>
    artifact.name.includes(artifactMarker),
  );
  if (artifacts.length === 0) {
    throw new Error(`No unsigned release artifacts found in ${input.releaseDirectory}.`);
  }
  const generatedAt = new Date().toISOString();
  const identity = artifactIdentity(input.buildInfo);
  const target = `${platform()}-${arch()}`;
  const sbomName = `Palot-${input.buildInfo.version}-${identity}-${target}.cdx.json`;
  const provenanceName = `Palot-${input.buildInfo.version}-${identity}-${target}.intoto.jsonl`;
  const lockBytes = await readFile(path.join(REPOSITORY_ROOT, "bun.lock"));

  await Promise.all([
    writeFile(
      path.join(input.releaseDirectory, "SHA256SUMS"),
      `${artifacts.map((item) => `${item.sha256}  ${item.name}`).join("\n")}\n`,
    ),
    writeJson(path.join(input.releaseDirectory, "release-manifest.json"), {
      schemaVersion: 1,
      generatedAt,
      unsigned: true,
      publish: "never",
      sourceMaps: "generated as hidden maps and excluded from packaged artifacts",
      build: input.buildInfo,
      artifacts,
      files: { checksums: "SHA256SUMS", sbom: sbomName, provenance: provenanceName },
    }),
    writeJson(path.join(input.releaseDirectory, sbomName), await createSbom(input.buildInfo)),
    writeFile(
      path.join(input.releaseDirectory, provenanceName),
      `${JSON.stringify({
        _type: "https://in-toto.io/Statement/v1",
        subject: artifacts.map((item) => ({
          name: item.name,
          digest: { sha256: item.sha256 },
        })),
        predicateType: "https://slsa.dev/provenance/v1",
        predicate: {
          buildDefinition: {
            buildType: "https://github.com/ItsWendell/palot/unsigned-electron-release/v1",
            externalParameters: {
              channel: input.buildInfo.channel,
              buildNumber: input.buildInfo.buildNumber,
              openCodeContractVersion: input.buildInfo.openCodeContractVersion,
              publish: "never",
              signing: "unsigned",
            },
            internalParameters: { dirty: input.buildInfo.dirty },
            resolvedDependencies: [
              {
                uri: "git+https://github.com/ItsWendell/palot.git",
                digest: { gitCommit: input.buildInfo.commitSha },
              },
              {
                uri: "file:bun.lock",
                digest: { sha256: sha256(lockBytes) },
              },
            ],
          },
          runDetails: {
            builder: { id: "https://github.com/ItsWendell/palot/local-unsigned-builder/v1" },
            metadata: { invocationId: input.buildInfo.buildNumber, startedOn: generatedAt },
            byproducts: [],
          },
        },
      })}\n`,
    ),
  ]);
}

export async function collectReleaseArtifacts(directory: string): Promise<ArtifactDigest[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const artifacts: ArtifactDigest[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || GENERATED_FILE_NAMES.has(entry.name)) continue;
    if (entry.name.endsWith(".cdx.json") || entry.name.endsWith(".intoto.jsonl")) continue;
    if (!ARTIFACT_EXTENSIONS.some((extension) => entry.name.endsWith(extension))) continue;
    const bytes = await readFile(path.join(directory, entry.name));
    artifacts.push({ name: entry.name, size: bytes.byteLength, sha256: sha256(bytes) });
  }
  return artifacts.toSorted((left, right) => left.name.localeCompare(right.name));
}

async function createSbom(buildInfo: PalotReleaseBuildInfo): Promise<Record<string, unknown>> {
  const lock = parseJsonWithTrailingCommas(
    await readFile(path.join(REPOSITORY_ROOT, "bun.lock"), "utf8"),
  ) as { packages: Record<string, [string, string, unknown, string?]> };
  const components = Object.values(lock.packages)
    .map(([locator]) => componentFromLocator(locator))
    .filter((component): component is NonNullable<typeof component> => component !== null)
    .toSorted((left, right) => left["bom-ref"].localeCompare(right["bom-ref"]));
  return {
    bomFormat: "CycloneDX",
    specVersion: "1.6",
    serialNumber: `urn:uuid:${randomUUID()}`,
    version: 1,
    metadata: {
      timestamp: new Date().toISOString(),
      tools: {
        components: [{ type: "application", name: "Palot release metadata", version: "1" }],
      },
      component: {
        type: "application",
        name: desktopPackage.name,
        version: buildInfo.version,
        properties: [
          { name: "palot:commitSha", value: buildInfo.commitSha },
          { name: "palot:channel", value: buildInfo.channel },
          { name: "palot:openCodeContractVersion", value: buildInfo.openCodeContractVersion },
        ],
      },
      properties: [
        {
          name: "palot:scope",
          value: "complete pinned workspace lockfile; release bundle is a subset",
        },
      ],
    },
    components,
  };
}

export function componentFromLocator(
  locator: string,
): { type: "library"; name: string; version: string; "bom-ref": string; purl?: string } | null {
  const separator = locator.lastIndexOf("@");
  if (separator <= 0 || separator === locator.length - 1) return null;
  const name = locator.slice(0, separator);
  const version = locator.slice(separator + 1);
  const bomRef = `${name}@${version}`;
  const purl = /^\d+\.\d+\.\d+/.test(version)
    ? `pkg:npm/${name.startsWith("@") ? name.replace("/", "%2F") : name}@${version}`
    : undefined;
  return { type: "library", name, version, "bom-ref": bomRef, ...(purl ? { purl } : {}) };
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

function parseJsonWithTrailingCommas(value: string): unknown {
  return JSON.parse(value.replaceAll(/,\s*([}\]])/g, "$1"));
}

if (import.meta.main) {
  const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
  const releaseDirectory = path.resolve(
    process.argv[2] ?? path.join(scriptDirectory, "../release"),
  );
  await generateUnsignedReleaseMetadata({
    releaseDirectory,
    buildInfo: resolveReleaseBuildInfo(),
  });
  console.log(
    `Generated unsigned release metadata in ${releaseDirectory} on ${platform()} ${release()} ${arch()}.`,
  );
}
