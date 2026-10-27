import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { constants, createReadStream, lstatSync, readFileSync, readdirSync } from "node:fs";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { SUPPORTED_OPENCODE_VERSION } from "./opencode-version";
import type { ExternalOpenCodeRuntimePolicy } from "../shared/opencode-release-contract";

const execFileAsync = promisify(execFile);

/** Missing policy means the bundle is still required, not intentionally absent. */
export function readExternalOpenCodeRuntimePolicy(
  directory: string,
): ExternalOpenCodeRuntimePolicy | null {
  const file = path.join(directory, "policy.json");
  let info;
  try {
    info = lstatSync(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  if (!info.isFile() || info.size > 1024) throw new Error("Invalid OpenCode runtime policy file.");
  const policy: unknown = JSON.parse(readFileSync(file, "utf8"));
  if (
    !policy ||
    typeof policy !== "object" ||
    Array.isArray(policy) ||
    Object.keys(policy).length !== 2 ||
    !("schemaVersion" in policy) ||
    policy.schemaVersion !== 1 ||
    !("bundled" in policy) ||
    policy.bundled !== false
  )
    throw new Error("Invalid OpenCode runtime policy: expected schemaVersion 1 and bundled false.");
  if (readdirSync(directory).some((entry) => entry !== "policy.json"))
    throw new Error("Bundle-free OpenCode policy must not ship a runtime or manifest.");
  return { schemaVersion: 1, bundled: false };
}

export type BundledOpenCodeArchitecture = "arm64" | "x64";

export interface BundledOpenCodeRuntimeManifest {
  architecture: BundledOpenCodeArchitecture;
  binarySha256: string;
  packageName: string;
  sourceSha256: string;
  version: string;
}

// Preserve the exact upstream-signed npm executables. Staging verifies their
// hardened signatures; outer app signing must not replace the runtime signature.
export const BUNDLED_OPENCODE_RUNTIMES = {
  arm64: {
    architecture: "arm64",
    binarySha256: "0614b30fd17c27258b16cd6ea9ab03e1160fa9897e4cefd2d9a5d86f71a0af11",
    packageName: "@opencode/cli-darwin-arm64",
    sourceSha256: "0614b30fd17c27258b16cd6ea9ab03e1160fa9897e4cefd2d9a5d86f71a0af11",
    version: "2.2.0",
  },
  x64: {
    architecture: "x64",
    binarySha256: "c4c7a3e939b7346e6f88506eabc14ee879ccf7a1977bf07e58793651a6d921e7",
    packageName: "@opencode/cli-darwin-x64-baseline",
    sourceSha256: "c4c7a3e939b7346e6f88506eabc14ee879ccf7a1977bf07e58793651a6d921e7",
    version: "2.2.0",
  },
} as const satisfies Record<BundledOpenCodeArchitecture, BundledOpenCodeRuntimeManifest>;

export const LINUX_OPENCODE_RUNTIMES = {
  x64: {
    architecture: "x64",
    binarySha256: "87a4d6ac3c1b5691d4fb5e88f473992016b37ede6611c5cb7092fcdb1d91fad0",
    sourceSha256: "87a4d6ac3c1b5691d4fb5e88f473992016b37ede6611c5cb7092fcdb1d91fad0",
    packageName: "@opencode/cli-linux-x64-baseline",
    version: SUPPORTED_OPENCODE_VERSION,
  },
  arm64: {
    architecture: "arm64",
    binarySha256: "bb701fa4152889037f95e5444af572f97abe8c14b879e96434f689c21e678062",
    sourceSha256: "bb701fa4152889037f95e5444af572f97abe8c14b879e96434f689c21e678062",
    packageName: "@opencode/cli-linux-arm64",
    version: SUPPORTED_OPENCODE_VERSION,
  },
} as const satisfies Record<BundledOpenCodeArchitecture, BundledOpenCodeRuntimeManifest>;

export function bundledOpenCodeRuntime(
  architecture: NodeJS.Architecture,
  platform: NodeJS.Platform = process.platform,
): BundledOpenCodeRuntimeManifest {
  if (architecture !== "arm64" && architecture !== "x64") {
    throw new Error(`Unsupported bundled OpenCode architecture: ${architecture}`);
  }
  if (platform === "linux") return LINUX_OPENCODE_RUNTIMES[architecture];
  if (platform === "darwin") {
    const runtime: BundledOpenCodeRuntimeManifest = BUNDLED_OPENCODE_RUNTIMES[architecture];
    if (runtime.version !== SUPPORTED_OPENCODE_VERSION) {
      throw new Error(
        `Bundled macOS OpenCode ${SUPPORTED_OPENCODE_VERSION} is unavailable: verified signed runtime hashes are required (${architecture}).`,
      );
    }
    return runtime;
  }
  throw new Error(`Unsupported bundled OpenCode platform: ${platform}`);
}

export async function verifyBundledOpenCodeBinary(input: {
  directory: string;
  architecture?: NodeJS.Architecture;
  expected?: BundledOpenCodeRuntimeManifest;
}): Promise<{ path: string; version: string }> {
  const architecture = input.architecture ?? process.arch;
  const expected = input.expected ?? bundledOpenCodeRuntime(architecture);
  const candidate = path.join(input.directory, "opencode2");
  const manifest = JSON.parse(
    await readFile(path.join(input.directory, "manifest.json"), "utf8"),
  ) as BundledOpenCodeRuntimeManifest;
  if (
    manifest.architecture !== expected.architecture ||
    manifest.binarySha256 !== expected.binarySha256 ||
    manifest.packageName !== expected.packageName ||
    manifest.sourceSha256 !== expected.sourceSha256 ||
    manifest.version !== expected.version
  ) {
    throw new Error("bundled manifest does not match Palot's pinned runtime contract");
  }
  await access(candidate, constants.X_OK);
  const binarySha256 = await fileSha256(candidate);
  if (binarySha256 !== expected.binarySha256) {
    throw new Error(`bundled SHA-256 is ${binarySha256}, expected ${expected.binarySha256}`);
  }
  if (process.platform === "darwin") {
    const { stdout } = await execFileAsync("lipo", ["-archs", candidate], {
      timeout: 5_000,
      maxBuffer: 64 * 1_024,
    });
    const expectedMachOArchitecture = architecture === "x64" ? "x86_64" : architecture;
    if (!stdout.trim().split(/\s+/).includes(expectedMachOArchitecture)) {
      throw new Error(
        `bundled executable architecture is ${stdout.trim() || "unknown"}, expected ${expectedMachOArchitecture}`,
      );
    }
  }
  const { stdout, stderr } = await execFileAsync(candidate, ["--version"], {
    timeout: 30_000,
    maxBuffer: 64 * 1_024,
  });
  const version = `${stdout}\n${stderr}`.match(
    /(?:^|\s)v?(\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?)(?:\s|$)/,
  )?.[1];
  if (version !== expected.version) {
    throw new Error(`bundled version is ${version ?? "unreadable"}, expected ${expected.version}`);
  }
  return { path: candidate, version };
}

async function fileSha256(candidate: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(candidate);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}
