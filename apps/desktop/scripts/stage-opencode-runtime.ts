import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, copyFile, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  type BundledOpenCodeArchitecture,
  bundledOpenCodeRuntime,
} from "../src/main/opencode-runtime-release";

const execFileAsync = promisify(execFile);
const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export async function stageOpenCodeRuntime(
  architecture: BundledOpenCodeArchitecture,
  platform: NodeJS.Platform = process.platform,
): Promise<string> {
  if (platform !== "darwin" && platform !== "linux") {
    throw new Error("Bundled OpenCode runtime staging supports macOS and Linux.");
  }
  const expected = bundledOpenCodeRuntime(architecture, platform);
  const temporaryDirectory = await mkdtemp(path.join(tmpdir(), `palot-opencode-${architecture}-`));
  const stagingRoot = path.join(APP_ROOT, "resources", "opencode");
  const destination =
    platform === "linux"
      ? path.join(stagingRoot, platform, architecture)
      : path.join(stagingRoot, architecture);
  const pending = `${destination}.pending-${process.pid}`;
  try {
    const { stdout } = await execFileAsync(
      "npm",
      [
        "pack",
        `${expected.packageName}@${expected.version}`,
        "--silent",
        "--pack-destination",
        temporaryDirectory,
      ],
      { maxBuffer: 64 * 1_024 },
    );
    const archiveName = stdout.trim().split("\n").at(-1);
    if (!archiveName)
      throw new Error(`npm pack did not return an archive for ${expected.packageName}.`);
    const extractionRoot = path.join(temporaryDirectory, "extracted");
    await mkdir(extractionRoot);
    await execFileAsync("tar", [
      "-xzf",
      path.join(temporaryDirectory, archiveName),
      "-C",
      extractionRoot,
    ]);

    const packageRoot = path.join(extractionRoot, "package");
    const packageManifest = JSON.parse(
      await readFile(path.join(packageRoot, "package.json"), "utf8"),
    ) as {
      name?: string;
      version?: string;
    };
    if (
      packageManifest.name !== expected.packageName ||
      packageManifest.version !== expected.version
    ) {
      throw new Error(
        `OpenCode package mismatch: got ${packageManifest.name ?? "unknown"}@${packageManifest.version ?? "unknown"}, expected ${expected.packageName}@${expected.version}.`,
      );
    }
    const sourceBinary = path.join(packageRoot, "bin", "opencode");
    const binarySha256 = await sha256(sourceBinary);
    if (binarySha256 !== expected.sourceSha256) {
      throw new Error(
        `OpenCode ${architecture} source SHA-256 mismatch: got ${binarySha256}, expected ${expected.sourceSha256}.`,
      );
    }
    if (platform === "darwin") {
      const { stdout: architectures } = await execFileAsync("lipo", ["-archs", sourceBinary]);
      const expectedMachOArchitecture = architecture === "x64" ? "x86_64" : "arm64";
      if (!architectures.trim().split(/\s+/).includes(expectedMachOArchitecture)) {
        throw new Error(
          `OpenCode binary architecture is ${architectures.trim() || "unknown"}, expected ${expectedMachOArchitecture}.`,
        );
      }
    } else {
      const binary = await readFile(sourceBinary);
      const machine = binary.readUInt16LE(18);
      if (
        binary.subarray(0, 4).toString() !== "\x7fELF" ||
        binary[4] !== 2 ||
        binary[5] !== 1 ||
        machine !== (architecture === "x64" ? 62 : 183)
      ) {
        throw new Error(`OpenCode binary is not a Linux ${architecture} ELF executable.`);
      }
    }

    await rm(pending, { recursive: true, force: true });
    await mkdir(pending, { recursive: true });
    await copyFile(sourceBinary, path.join(pending, "opencode2"));
    await chmod(path.join(pending, "opencode2"), 0o755);
    await writeFile(path.join(pending, "manifest.json"), `${JSON.stringify(expected, null, 2)}\n`);
    await rm(destination, { recursive: true, force: true });
    await rename(pending, destination);
    return destination;
  } finally {
    await rm(pending, { recursive: true, force: true });
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

async function sha256(file: string): Promise<string> {
  const hash = createHash("sha256");
  hash.update(await readFile(file));
  return hash.digest("hex");
}

if (import.meta.main) {
  const architecture = process.argv[2];
  if (architecture !== "arm64" && architecture !== "x64") {
    throw new Error("Usage: bun run scripts/stage-opencode-runtime.ts <arm64|x64>");
  }
  console.log(await stageOpenCodeRuntime(architecture));
}
