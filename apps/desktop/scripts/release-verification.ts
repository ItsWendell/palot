import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdtemp, open, readFile, readdir, rm } from "node:fs/promises";
import { arch, tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { FuseState, FuseV1Options, getCurrentFuseWire } from "@electron/fuses";
import { OpenCode } from "@opencode/client";
import { Service } from "@opencode/client/service";
import {
  PALOT_BUILD_CHANNELS,
  type PalotBuildChannel,
  resolveBuildIdentity,
} from "../src/shared/build-identity";
import { resolveMacPackageTarget } from "./mac-package";
import { resolveReleaseBuildInfo, verifyPackagedReleaseVersion } from "./release-build-info";
import { verifyBundledOpenCodeBinary } from "../src/main/opencode-runtime-release";
import { verifyLiquidGlassExports } from "./native-module-exports";
import { availableLoopbackPort, withReleaseSmokeService } from "./release-smoke-service";

const execFileAsync = promisify(execFile);

export const REQUIRED_ASAR_ENTRIES = [
  "/out/main/index.js",
  "/out/preload/index.cjs",
  "/out/renderer/index.html",
  "/package.json",
] as const;

export const REQUIRED_UNPACKED_ENTRIES = [
  "node_modules/electron-liquid-glass",
  "node_modules/node-gyp-build",
  "node_modules/objc-js",
] as const;

export const REQUIRED_LICENSE_RESOURCES = [
  "LICENSE.palot.txt",
  "THIRD_PARTY_NOTICES.md",
  "DEPENDENCY_LICENSES.md",
  "FONTS.md",
  "OFL-1.1.txt",
] as const;

const EXPECTED_FUSES = new Map<FuseV1Options, boolean>([
  [FuseV1Options.RunAsNode, false],
  [FuseV1Options.EnableCookieEncryption, true],
  [FuseV1Options.EnableNodeOptionsEnvironmentVariable, false],
  [FuseV1Options.EnableNodeCliInspectArguments, false],
  [FuseV1Options.EnableEmbeddedAsarIntegrityValidation, true],
  [FuseV1Options.OnlyLoadAppFromAsar, true],
  [FuseV1Options.LoadBrowserProcessSpecificV8Snapshot, false],
  [FuseV1Options.GrantFileProtocolExtraPrivileges, true],
]);

export function missingReleaseEntries(
  entries: readonly string[],
  required: readonly string[],
): string[] {
  const normalized = new Set(entries.map((entry) => entry.replaceAll("\\", "/")));
  return required.filter((entry) => !normalized.has(entry));
}

export function unexpectedFuseEntries(wire: Partial<Record<FuseV1Options, FuseState>>): string[] {
  const unexpected: string[] = [];
  for (const [fuse, expected] of EXPECTED_FUSES) {
    if (wire[fuse] !== FuseState.ENABLE && wire[fuse] !== FuseState.DISABLE) {
      unexpected.push(`${FuseV1Options[fuse]}=unavailable`);
      continue;
    }
    const actual = wire[fuse] === FuseState.ENABLE;
    if (actual !== expected) unexpected.push(`${FuseV1Options[fuse]}=${actual}`);
  }
  return unexpected;
}

export async function verifyUnsignedReleaseMetadata(
  releaseDirectory: string,
  expectedBuild: ReturnType<typeof resolveReleaseBuildInfo>,
): Promise<void> {
  const manifest = JSON.parse(
    await readFile(path.join(releaseDirectory, "release-manifest.json"), "utf8"),
  ) as {
    unsigned?: boolean;
    publish?: string;
    build?: unknown;
    artifacts?: Array<{ name: string; size: number; sha256: string }>;
    files?: { checksums?: string; sbom?: string; provenance?: string };
  };
  if (manifest.unsigned !== true || manifest.publish !== "never") {
    throw new Error("Release manifest is not marked as an unpublished unsigned candidate.");
  }
  if (JSON.stringify(manifest.build) !== JSON.stringify(expectedBuild)) {
    throw new Error("Release manifest build identity does not match the packaged application.");
  }
  if (!manifest.artifacts?.length) throw new Error("Release manifest has no artifacts.");

  const checksumLines: string[] = [];
  for (const artifact of manifest.artifacts) {
    const bytes = await readFile(path.join(releaseDirectory, artifact.name));
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (bytes.byteLength !== artifact.size || digest !== artifact.sha256) {
      throw new Error(`Release artifact digest mismatch: ${artifact.name}.`);
    }
    checksumLines.push(`${digest}  ${artifact.name}`);
  }
  const checksumName = manifest.files?.checksums;
  const sbomName = manifest.files?.sbom;
  const provenanceName = manifest.files?.provenance;
  if (!checksumName || !sbomName || !provenanceName) {
    throw new Error("Release manifest is missing evidence file names.");
  }
  const checksums = await readFile(path.join(releaseDirectory, checksumName), "utf8");
  if (checksums !== `${checksumLines.join("\n")}\n`) {
    throw new Error("SHA256SUMS does not match the release manifest.");
  }
  const sbom = JSON.parse(await readFile(path.join(releaseDirectory, sbomName), "utf8")) as {
    bomFormat?: string;
    specVersion?: string;
  };
  if (sbom.bomFormat !== "CycloneDX" || sbom.specVersion !== "1.6") {
    throw new Error("Release SBOM is missing or malformed.");
  }
  const provenance = JSON.parse(
    (await readFile(path.join(releaseDirectory, provenanceName), "utf8")).trim(),
  ) as { subject?: Array<{ name: string; digest?: { sha256?: string } }> };
  const expectedSubjects = manifest.artifacts.map((artifact) => ({
    name: artifact.name,
    digest: { sha256: artifact.sha256 },
  }));
  if (JSON.stringify(provenance.subject) !== JSON.stringify(expectedSubjects)) {
    throw new Error("Release provenance subjects do not match the manifest.");
  }
}

export function verifyPackagedBuildIdentity(
  packagedManifest: { version: string; palotBuild?: unknown },
  channel: PalotBuildChannel,
  environment: NodeJS.ProcessEnv = process.env,
): ReturnType<typeof resolveReleaseBuildInfo> {
  verifyPackagedReleaseVersion(packagedManifest.version, channel, environment);
  const expectedBuild = resolveReleaseBuildInfo({ ...environment, PALOT_BUILD_CHANNEL: channel });
  expectedBuild.version = packagedManifest.version;
  if (JSON.stringify(packagedManifest.palotBuild) !== JSON.stringify(expectedBuild)) {
    throw new Error("Packaged build identity does not match the current release identity.");
  }
  return expectedBuild;
}

export async function verifyMacRelease(input: {
  appBundle: string;
  channel: PalotBuildChannel;
  expectedArchitecture: "arm64" | "x86_64";
  smoke?: boolean;
  /** An explicitly requested local certificate, never a claim of Developer ID trust. */
  localSigningIdentity?: string;
}): Promise<ReturnType<typeof resolveReleaseBuildInfo>> {
  const identity = resolveBuildIdentity({ development: false, configuredChannel: input.channel });
  const appBundle = path.resolve(input.appBundle);
  const contents = path.join(appBundle, "Contents");
  const executable = path.join(contents, "MacOS", identity.productName);
  const asar = path.join(contents, "Resources", "app.asar");
  const unpacked = `${asar}.unpacked`;
  const runtimeDirectory = path.join(contents, "Resources", "opencode");
  await Promise.all([access(executable), access(asar), access(runtimeDirectory)]);
  await execFileAsync("codesign", ["--verify", "--deep", "--strict", appBundle], {
    maxBuffer: 4 * 1_024 * 1_024,
  });
  const { stderr: signatureDetails } = await execFileAsync(
    "codesign",
    ["--display", "--verbose=4", appBundle],
    { maxBuffer: 4 * 1_024 * 1_024 },
  );
  if (input.localSigningIdentity) {
    if (!signatureDetails.split("\n").includes(`Authority=${input.localSigningIdentity}`)) {
      throw new Error("Application signature does not match the requested local signing identity.");
    }
  } else if (!signatureDetails.includes("Signature=adhoc")) {
    throw new Error("Unsigned release candidate is not ad-hoc signed.");
  }

  const [{ stdout: identifier }, { stdout: bundleName }, { stdout: architectures }] =
    await Promise.all([
      execFileAsync("/usr/libexec/PlistBuddy", [
        "-c",
        "Print :CFBundleIdentifier",
        path.join(contents, "Info.plist"),
      ]),
      execFileAsync("/usr/libexec/PlistBuddy", [
        "-c",
        "Print :CFBundleName",
        path.join(contents, "Info.plist"),
      ]),
      execFileAsync("lipo", ["-archs", executable]),
    ]);
  if (identifier.trim() !== identity.appId) {
    throw new Error(`Bundle identifier is ${identifier.trim()}, expected ${identity.appId}.`);
  }
  if (bundleName.trim() !== identity.productName) {
    throw new Error(`Bundle name is ${bundleName.trim()}, expected ${identity.productName}.`);
  }
  if (!architectures.trim().split(/\s+/).includes(input.expectedArchitecture)) {
    throw new Error(
      `Executable architecture is ${architectures.trim() || "unknown"}, expected ${input.expectedArchitecture}.`,
    );
  }
  const unexpectedMachO = await unexpectedMachOEntries(contents, input.expectedArchitecture);
  if (unexpectedMachO.length > 0) {
    throw new Error(
      `Packaged app contains Mach-O files without ${input.expectedArchitecture}: ${unexpectedMachO.join(", ")}.`,
    );
  }
  const runtime = await verifyBundledOpenCodeBinary({
    directory: runtimeDirectory,
    architecture: input.expectedArchitecture === "x86_64" ? "x64" : "arm64",
  });

  const unexpectedFuses = unexpectedFuseEntries(await getCurrentFuseWire(executable));
  if (unexpectedFuses.length > 0) {
    throw new Error(`Packaged Electron fuses do not match policy: ${unexpectedFuses.join(", ")}.`);
  }

  const asarExecutable = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../node_modules/.bin/asar",
  );
  const { stdout: listed } = await execFileAsync(asarExecutable, ["list", asar], {
    maxBuffer: 64 * 1_024 * 1_024,
  });
  const missingAsar = missingReleaseEntries(listed.split("\n"), REQUIRED_ASAR_ENTRIES);
  if (missingAsar.length > 0)
    throw new Error(`Packaged app is missing: ${missingAsar.join(", ")}.`);
  if (listed.split("\n").some((entry) => entry.startsWith("/out/") && entry.endsWith(".map"))) {
    throw new Error("Packaged app contains production source maps.");
  }

  const extractionDirectory = await mkdtemp(path.join(tmpdir(), "palot-release-manifest-"));
  let expectedBuild: ReturnType<typeof resolveReleaseBuildInfo>;
  try {
    await execFileAsync(asarExecutable, ["extract-file", asar, "package.json"], {
      cwd: extractionDirectory,
    });
    const packagedManifest = JSON.parse(
      await readFile(path.join(extractionDirectory, "package.json"), "utf8"),
    ) as { version: string; palotBuild?: unknown };
    expectedBuild = verifyPackagedBuildIdentity(packagedManifest, input.channel);
  } finally {
    await rm(extractionDirectory, { recursive: true, force: true });
  }

  const missingUnpacked: string[] = [];
  for (const entry of REQUIRED_UNPACKED_ENTRIES) {
    try {
      await access(path.join(unpacked, entry));
    } catch {
      missingUnpacked.push(entry);
    }
  }
  if (missingUnpacked.length > 0) {
    throw new Error(`Packaged native dependencies are missing: ${missingUnpacked.join(", ")}.`);
  }
  await verifyLiquidGlassExports(path.join(unpacked, "node_modules", "electron-liquid-glass"));

  const licenseDirectory = path.join(contents, "Resources", "licenses");
  await Promise.all(
    REQUIRED_LICENSE_RESOURCES.map((entry) => access(path.join(licenseDirectory, entry))),
  );
  const notices = await readFile(path.join(licenseDirectory, "THIRD_PARTY_NOTICES.md"), "utf8");
  for (const marker of [
    "electron-liquid-glass",
    "Palot Orbits",
    "node-gyp-build",
    "objc-js",
    "TanStack Markdown",
  ]) {
    if (!notices.includes(marker)) throw new Error(`Packaged notices are missing ${marker}.`);
  }
  const dependencyLicenses = await readFile(
    path.join(licenseDirectory, "DEPENDENCY_LICENSES.md"),
    "utf8",
  );
  if (
    !dependencyLicenses.includes("# Installed dependency licenses") ||
    dependencyLicenses.length < 10_000
  ) {
    throw new Error("Packaged dependency license inventory is incomplete.");
  }

  if (input.smoke) {
    await withReleaseSmokeService(
      {
        binary: runtime.path,
        version: runtime.version,
        evidenceRoot: path.resolve(
          path.dirname(fileURLToPath(import.meta.url)),
          "../../../.local/release-smoke",
        ),
      },
      async ({ home, environment, endpoint, signal }) => {
        const health = await OpenCode.make({
          baseUrl: endpoint.url,
          headers: Service.headers(endpoint),
        }).health.get();
        await smokeMacRelease(
          executable,
          home,
          environment,
          { version: runtime.version, pid: health.pid },
          signal,
        );
      },
    );
  }
  return expectedBuild;
}

export async function unexpectedMachOEntries(
  root: string,
  expectedArchitecture: "arm64" | "x86_64",
): Promise<string[]> {
  const unexpected: string[] = [];
  for (const file of await filesRecursively(root)) {
    if (!(await isMachO(file))) continue;
    const { stdout } = await execFileAsync("lipo", ["-archs", file], {
      timeout: 5_000,
      maxBuffer: 64 * 1_024,
    });
    if (!stdout.trim().split(/\s+/).includes(expectedArchitecture)) {
      unexpected.push(path.relative(root, file));
    }
  }
  return unexpected.sort();
}

async function filesRecursively(directory: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const resolved = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await filesRecursively(resolved)));
    else if (entry.isFile()) files.push(resolved);
  }
  return files;
}

async function isMachO(file: string): Promise<boolean> {
  const handle = await open(file, "r");
  try {
    const magic = Buffer.allocUnsafe(4);
    const { bytesRead } = await handle.read(magic, 0, magic.length, 0);
    if (bytesRead !== magic.length) return false;
    return new Set([
      "cafebabe",
      "cafebabf",
      "bebafeca",
      "bfbafeca",
      "feedface",
      "feedfacf",
      "cefaedfe",
      "cffaedfe",
    ]).has(magic.toString("hex"));
  } finally {
    await handle.close();
  }
}

export interface ReleaseSmokeState {
  preload?: boolean;
  loaded?: boolean;
  onboarding?: boolean;
  loading?: boolean;
  runtime?: { connected?: boolean; version?: string | null; pid?: number | null };
  chromeTier?: string;
}

export function assertReleaseSmokeState(
  value: ReleaseSmokeState,
  expected: { version: string; pid: number },
): void {
  if (!value.preload) throw new Error("Packaged preload bridge is unavailable.");
  if ((!value.loaded && !value.onboarding) || value.loading) {
    throw new Error("Packaged renderer did not reach a useful state.");
  }
  if (
    !value.runtime?.connected ||
    value.runtime.version !== expected.version ||
    value.runtime.pid !== expected.pid
  ) {
    throw new Error("Packaged renderer is not connected to the owned smoke runtime.");
  }
}

async function smokeMacRelease(
  executable: string,
  userData: string,
  environment: Record<string, string>,
  expectedRuntime: { version: string; pid: number },
  signal: AbortSignal,
): Promise<void> {
  const port = await availableLoopbackPort();
  const child = spawn(executable, [`--remote-debugging-port=${port}`], {
    detached: false,
    stdio: ["ignore", "pipe", "pipe"],
    cwd: userData,
    env: environment,
  });
  let output = "";
  child.stdout?.on("data", (chunk) => {
    output = `${output}${String(chunk)}`.slice(-8_192);
  });
  child.stderr?.on("data", (chunk) => {
    output = `${output}${String(chunk)}`.slice(-8_192);
  });
  try {
    const deadline = Date.now() + 30_000;
    let lastError: unknown;
    while (Date.now() < deadline) {
      signal.throwIfAborted();
      if (child.exitCode !== null || child.signalCode !== null) {
        throw new Error(
          `Packaged Electron exited before exposing a renderer (${child.signalCode ?? child.exitCode}).${output ? `\n${output}` : ""}`,
        );
      }
      try {
        const response = await fetch(`http://127.0.0.1:${port}/json`, {
          signal: AbortSignal.timeout(1_000),
        });
        const targets = (await response.json()) as Array<{
          type?: string;
          url?: string;
          title?: string;
        }>;
        const renderer = targets.find(
          (target) =>
            target.type === "page" &&
            typeof target.title === "string" &&
            target.title.length > 0 &&
            target.url?.startsWith("file:"),
        );
        if (renderer) {
          const websocket = (
            targets as Array<{
              type?: string;
              url?: string;
              title?: string;
              webSocketDebuggerUrl?: string;
            }>
          ).find((target) => target === renderer)?.webSocketDebuggerUrl;
          if (!websocket) throw new Error("Packaged renderer did not expose a CDP target.");
          const socket = new WebSocket(websocket);
          try {
            await Promise.race([
              new Promise<void>((resolve, reject) => {
                socket.addEventListener("open", () => resolve(), { once: true });
                socket.addEventListener(
                  "error",
                  () => reject(new Error("Could not inspect packaged renderer.")),
                  { once: true },
                );
              }),
              sleep(2_000).then(() => {
                throw new Error("Packaged renderer inspection timed out.");
              }),
            ]);
            const result = await evaluate(
              socket,
              1,
              `(async () => ({
             preload: typeof window.palot?.runtimeStatus === "function",
             loaded: Boolean(document.querySelector('[aria-label="Current task"], [aria-label="New task"]')),
             onboarding: Boolean(document.querySelector('[aria-label^="Step "]')),
             loading: Boolean(document.querySelector('[aria-label="Loading Palot"]')),
             runtime: await window.palot?.runtimeStatus(),
             chromeTier: await window.palot?.getChromeTier(),
             url: location.href,
             text: document.body.innerText.slice(0, 500)
           }))()`,
            );
            const value = result as ReleaseSmokeState;
            assertReleaseSmokeState(value, expectedRuntime);
            console.log(
              `Packaged smoke connected to owned OpenCode ${expectedRuntime.version}; chrome=${value.chromeTier}.`,
            );
            return;
          } finally {
            socket.close();
          }
        }
      } catch (error) {
        lastError = error;
      }
      await sleep(250);
    }
    const detail = lastError instanceof Error ? ` Last inspection error: ${lastError.message}` : "";
    let applicationLog = "";
    try {
      applicationLog = (await readFile(path.join(userData, "logs", "main.log"), "utf8")).slice(
        -16_384,
      );
    } catch {
      // The app may have failed before logging was initialized.
    }
    throw new Error(
      `Packaged Electron smoke did not expose a renderer within 30 seconds.${detail}${output ? `\n${output}` : ""}${applicationLog ? `\n${applicationLog}` : ""}`,
    );
  } finally {
    await terminate(child);
  }
}

async function terminate(child: ReturnType<typeof spawn>): Promise<void> {
  if (child.exitCode !== null) return;
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  child.kill("SIGTERM");
  await Promise.race([exited, sleep(5_000)]);
  if (child.exitCode === null) {
    child.kill("SIGKILL");
    await Promise.race([exited, sleep(5_000)]);
    if (child.exitCode === null && processExists(child.pid)) {
      throw new Error(`Packaged Electron process ${child.pid ?? "unknown"} did not terminate.`);
    }
  }
}

function processExists(pid: number | undefined): boolean {
  if (pid === undefined) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function evaluate(socket: WebSocket, id: number, expression: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.removeEventListener("message", onMessage);
      reject(new Error("Packaged renderer evaluation timed out."));
    }, 2_000);
    const onMessage = (event: MessageEvent) => {
      const message = JSON.parse(String(event.data)) as {
        id?: number;
        result?: { result?: { value?: unknown }; exceptionDetails?: unknown };
      };
      if (message.id !== id) return;
      clearTimeout(timeout);
      socket.removeEventListener("message", onMessage);
      if (message.result?.exceptionDetails)
        reject(new Error("Packaged renderer evaluation failed."));
      else resolve(message.result?.result?.value);
    };
    socket.addEventListener("message", onMessage);
    socket.send(
      JSON.stringify({
        id,
        method: "Runtime.evaluate",
        params: { expression, returnByValue: true, awaitPromise: true },
      }),
    );
  });
}

if (import.meta.main) {
  if (process.platform !== "darwin") throw new Error("macOS release verification requires macOS.");
  const [channelArgument = "nightly", ...argumentsAfterChannel] = process.argv.slice(2);
  const appArgument = argumentsAfterChannel.find((argument) => !argument.startsWith("--"));
  const flags = argumentsAfterChannel.filter((argument) => argument.startsWith("--"));
  if (
    !PALOT_BUILD_CHANNELS.includes(channelArgument as PalotBuildChannel) ||
    channelArgument === "dev"
  ) {
    throw new Error(`Unsupported packaged channel: ${channelArgument}`);
  }
  const channel = channelArgument as PalotBuildChannel;
  const identity = resolveBuildIdentity({ development: false, configuredChannel: channel });
  const target = resolveMacPackageTarget(arch());
  const appBundle = appArgument
    ? path.resolve(appArgument)
    : path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        "..",
        "release",
        target.releaseDirectory,
        `${identity.productName}.app`,
      );
  const expectedBuild = await verifyMacRelease({
    appBundle,
    channel,
    expectedArchitecture: target.machoArchitecture,
    smoke: flags.includes("--smoke"),
    localSigningIdentity: flags
      .find((flag) => flag.startsWith("--local-signing-identity="))
      ?.slice("--local-signing-identity=".length),
  });
  await verifyUnsignedReleaseMetadata(path.dirname(path.dirname(appBundle)), expectedBuild);
  console.log(`Verified ${identity.displayName} at ${appBundle}`);
}
