/** Builds, locally signs, installs, and launches Palot Nightly on macOS. */

import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { getRawHeader } from "@electron/asar";
import {
  access,
  copyFile,
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  readlink,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { arch, homedir } from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { resolveBuildIdentity } from "../src/shared/build-identity";
import { withInstallStaging } from "./install-staging";
import { resolveMacPackageTarget } from "./mac-package";
import { resolveReleaseBuildInfo } from "./release-build-info";
import { verifyMacRelease } from "./release-verification";

if (process.platform !== "darwin") throw new Error("Palot Nightly installation requires macOS.");

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPOSITORY_ROOT = path.resolve(APP_ROOT, "../..");
const identity = resolveBuildIdentity({ development: false, configuredChannel: "nightly" });
const packageTarget = resolveMacPackageTarget(arch());
const signingIdentity = process.env.PALOT_LOCAL_SIGNING_IDENTITY ?? "Palot Local Development";
const forceFullPackage = process.argv.slice(2).includes("--full");
const installRoot = process.env.PALOT_INSTALL_ROOT ?? "/Applications";
const destination = path.join(installRoot, `${identity.productName}.app`);
let installationSignal: AbortSignal | undefined;
const releaseDirectory = path.join(APP_ROOT, "release", packageTarget.releaseDirectory);
const source = path.join(releaseDirectory, `${identity.productName}.app`);
const cacheDirectory = path.join(
  APP_ROOT,
  "release",
  `.nightly-cache-${packageTarget.architecture}`,
);
const cachedBundle = path.join(cacheDirectory, `${identity.productName}.app`);
const cachedContent = path.join(cacheDirectory, "app-content");
const packageManifest = path.join(cacheDirectory, "package-fingerprint");
const skeletonManifest = path.join(cacheDirectory, "skeleton-fingerprint");
const asarExecutable = path.join(REPOSITORY_ROOT, "node_modules", ".bin", "asar");
const execFileAsync = promisify(execFile);
const buildEnvironment = {
  ...process.env,
  PALOT_BUILD_CHANNEL: "nightly",
  PALOT_LOCAL_PACKAGE: "1",
};

await timed("Application build", () =>
  run(process.execPath, ["run", "scripts/build.ts"], buildEnvironment),
);

const packageHash = await packageFingerprint();
const skeletonHash = await skeletonFingerprint();
const storedSkeletonHash = await readFile(skeletonManifest, "utf8").catch(() => "");
const hasReusableSkeleton = (await exists(cachedBundle)) && storedSkeletonHash === skeletonHash;
const packageIsCurrent =
  !forceFullPackage &&
  hasReusableSkeleton &&
  (await exists(cachedContent)) &&
  (await readFile(packageManifest, "utf8").catch(() => "")) === packageHash;

if (packageIsCurrent) {
  console.log("[nightly] Reusing cached Electron package.");
} else {
  console.log("[nightly] Refreshing the Electron package cache.");
  await timed("Electron package", async () => {
    await rm(releaseDirectory, { recursive: true, force: true });
    await run(
      process.execPath,
      [
        "run",
        "scripts/package.ts",
        "nightly",
        "--skip-build",
        "--mac",
        "--dir",
        packageTarget.builderArgument,
      ],
      buildEnvironment,
    );
  });
  if (!(await exists(source))) throw new Error(`Could not find the built app at ${source}.`);
  await timed("Package verification", () =>
    verifyMacRelease({
      appBundle: source,
      channel: "nightly",
      expectedArchitecture: packageTarget.machoArchitecture,
    }),
  );
  await mkdir(cacheDirectory, { recursive: true });
  await timed("Package cache", async () => {
    if (!hasReusableSkeleton || forceFullPackage) {
      await rm(cacheDirectory, { recursive: true, force: true });
      await mkdir(cacheDirectory, { recursive: true });
      await cloneBundle(source, cachedBundle);
      await signBundle(cachedBundle, true);
    } else {
      const sourceContents = path.join(source, "Contents");
      const cachedContents = path.join(cachedBundle, "Contents");
      await rm(path.join(cachedContents, "Resources"), { recursive: true, force: true });
      await cp(path.join(sourceContents, "Resources"), path.join(cachedContents, "Resources"), {
        recursive: true,
      });
      await copyFile(
        path.join(sourceContents, "Info.plist"),
        path.join(cachedContents, "Info.plist"),
      );
      await copyFile(path.join(sourceContents, "PkgInfo"), path.join(cachedContents, "PkgInfo"));
    }
    await extractPackagedContent(source, cachedContent);
    await writeFile(packageManifest, packageHash);
    await writeFile(skeletonManifest, skeletonHash);
  });
}

await withInstallStaging(installRoot, identity.productName, async (staging, signal) => {
  installationSignal = signal;
  await timed("Staging clone", () => cloneBundle(cachedBundle, staging));
  await timed("Application archive", async () => {
    await rm(path.join(cachedContent, "out"), { recursive: true, force: true });
    await cp(path.join(APP_ROOT, "out"), path.join(cachedContent, "out"), {
      recursive: true,
      filter: (sourcePath) => !sourcePath.endsWith(".map"),
    });

    const temporaryAsar = path.join(cacheDirectory, `app-${process.pid}.asar`);
    const temporaryUnpacked = `${temporaryAsar}.unpacked`;
    await rm(temporaryAsar, { force: true });
    await rm(temporaryUnpacked, { recursive: true, force: true });
    await run(asarExecutable, [
      "pack",
      cachedContent,
      temporaryAsar,
      "--unpack-dir",
      "{node_modules/electron-liquid-glass,node_modules/node-gyp-build,node_modules/objc-js}",
      "--unpack",
      "**/*.node",
    ]);

    const resources = path.join(staging, "Contents", "Resources");
    await rm(path.join(resources, "app.asar"), { force: true });
    await rm(path.join(resources, "app.asar.unpacked"), { recursive: true, force: true });
    await rename(temporaryAsar, path.join(resources, "app.asar"));
    if (await exists(temporaryUnpacked)) {
      await rename(temporaryUnpacked, path.join(resources, "app.asar.unpacked"));
    }
    await updateAsarIntegrity(staging);
    await signBundle(staging, false, "-");
  });
  await timed("Package verification", () =>
    verifyMacRelease({
      appBundle: staging,
      channel: "nightly",
      expectedArchitecture: packageTarget.machoArchitecture,
    }),
  );
  await timed("Local signing", () => signBundle(staging, false));
  await timed("Signature verification", () => verifySignature(staging));
  await run(
    "osascript",
    ["-e", `tell application id "${identity.appId}" to quit`],
    undefined,
    true,
  );
  await waitForApplicationExit(identity.appId);

  signal.throwIfAborted();
  let backup: string | null = null;
  if (await exists(destination)) {
    const trash = path.join(homedir(), ".Trash");
    await mkdir(trash, { recursive: true });
    backup = path.join(
      trash,
      `${identity.productName} ${new Date().toISOString().replaceAll(":", "-")}.app`,
    );
    await rename(destination, backup);
  }

  try {
    await rename(staging, destination);
  } catch (error) {
    if (backup && !(await exists(destination))) await rename(backup, destination);
    throw error;
  }

  const launchEnvironment = { ...process.env };
  delete launchEnvironment.ELECTRON_RUN_AS_NODE;
  await run("open", [destination], launchEnvironment);
  await waitForApplicationLaunch(identity.appId);
  console.log(`Installed ${identity.displayName} at ${destination}`);
  console.log(`Signing identity: ${signingIdentity}`);
  if (backup) console.log(`Previous installation moved to ${backup}`);
});

async function exists(target: string): Promise<boolean> {
  return access(target).then(
    () => true,
    () => false,
  );
}

async function waitForApplicationExit(appID: string): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    installationSignal?.throwIfAborted();
    if (!(await isApplicationRunning(appID))) return;
    await sleep(250);
  }
  throw new Error(`Could not quit ${identity.displayName}; the existing app was not replaced.`);
}

async function waitForApplicationLaunch(appID: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  let runningSince: number | null = null;
  while (Date.now() < deadline) {
    installationSignal?.throwIfAborted();
    if (await isApplicationRunning(appID)) {
      runningSince ??= Date.now();
      if (Date.now() - runningSince >= 2_000) return;
    } else {
      runningSince = null;
    }
    await sleep(250);
  }
  throw new Error(`${identity.displayName} did not remain running after installation.`);
}

async function isApplicationRunning(appID: string): Promise<boolean> {
  const { stdout } = await execFileAsync("osascript", [
    "-e",
    `application id "${appID}" is running`,
  ]);
  return stdout.trim() === "true";
}

async function packageFingerprint(): Promise<string> {
  const hash = createHash("sha256");
  hash.update(`nightly-package-v3\0${packageTarget.architecture}\0`);
  hash.update(JSON.stringify(resolveReleaseBuildInfo(buildEnvironment)));
  hash.update("\0");
  const inputs = [
    path.join(REPOSITORY_ROOT, "bun.lock"),
    path.join(APP_ROOT, "package.json"),
    path.join(APP_ROOT, "electron-builder.yml"),
    path.join(APP_ROOT, "scripts", "package.ts"),
    path.join(APP_ROOT, "scripts", "mac-package.ts"),
    path.join(APP_ROOT, "src", "shared", "build-identity.ts"),
    path.join(APP_ROOT, "resources", "icons"),
    path.join(APP_ROOT, "drizzle"),
    path.join(REPOSITORY_ROOT, "node_modules", "electron", "package.json"),
    path.join(REPOSITORY_ROOT, "node_modules", "electron-log"),
    path.join(REPOSITORY_ROOT, "node_modules", "electron-store"),
    path.join(REPOSITORY_ROOT, "node_modules", "conf"),
    path.join(REPOSITORY_ROOT, "node_modules", "electron-liquid-glass"),
    path.join(REPOSITORY_ROOT, "node_modules", "node-gyp-build"),
    path.join(REPOSITORY_ROOT, "node_modules", "objc-js"),
    path.join(REPOSITORY_ROOT, "node_modules", "bindings"),
    path.join(REPOSITORY_ROOT, "node_modules", "file-uri-to-path"),
    path.join(REPOSITORY_ROOT, "node_modules", "node-addon-api"),
  ];
  for (const input of inputs.sort())
    await hashEntry(hash, input, path.relative(REPOSITORY_ROOT, input));
  return hash.digest("hex");
}

async function skeletonFingerprint(): Promise<string> {
  const electronPackage = await readFile(
    path.join(REPOSITORY_ROOT, "node_modules", "electron", "package.json"),
  );
  return createHash("sha256")
    .update(
      [
        "nightly-skeleton-v2",
        packageTarget.architecture,
        signingIdentity,
        identity.productName,
        identity.appId,
      ].join("\0"),
    )
    .update(electronPackage)
    .digest("hex");
}

async function hashEntry(
  hash: ReturnType<typeof createHash>,
  target: string,
  label: string,
): Promise<void> {
  const metadata = await lstat(target);
  if (metadata.isSymbolicLink()) {
    hash.update(`link\0${label}\0${await readlink(target)}\0`);
    return;
  }
  if (metadata.isDirectory()) {
    hash.update(`directory\0${label}\0`);
    const entries = await readdir(target);
    for (const entry of entries.sort()) {
      await hashEntry(hash, path.join(target, entry), path.join(label, entry));
    }
    return;
  }
  hash.update(`file\0${label}\0`);
  hash.update(await readFile(target));
}

async function cloneBundle(from: string, to: string): Promise<void> {
  await rm(to, { recursive: true, force: true });
  if (await run("cp", ["-cR", from, to], undefined, true)) return;
  await run("ditto", [from, to]);
}

async function extractPackagedContent(bundle: string, destination: string): Promise<void> {
  const resources = path.join(bundle, "Contents", "Resources");
  const archive = path.join(cacheDirectory, `source-${process.pid}.asar`);
  const unpacked = `${archive}.unpacked`;
  const oppositeArchitecture = packageTarget.architecture === "arm64" ? "x64" : "arm64";
  const oppositePrebuilds = ["electron-liquid-glass", "objc-js"].map((packageName) =>
    path.join("node_modules", packageName, "prebuilds", `darwin-${oppositeArchitecture}`),
  );

  await rm(archive, { force: true });
  await rm(unpacked, { recursive: true, force: true });
  await rm(destination, { recursive: true, force: true });
  try {
    await copyFile(path.join(resources, "app.asar"), archive);
    await cp(path.join(resources, "app.asar.unpacked"), unpacked, { recursive: true });
    for (const oppositePrebuild of oppositePrebuilds) {
      await cp(
        path.join(REPOSITORY_ROOT, oppositePrebuild),
        path.join(unpacked, oppositePrebuild),
        { recursive: true },
      );
    }
    await run(asarExecutable, ["extract", archive, destination]);
    for (const oppositePrebuild of oppositePrebuilds) {
      await rm(path.join(destination, oppositePrebuild), { recursive: true, force: true });
    }
  } finally {
    await rm(archive, { force: true });
    await rm(unpacked, { recursive: true, force: true });
  }
}

async function updateAsarIntegrity(bundle: string): Promise<void> {
  const contents = path.join(bundle, "Contents");
  const archive = path.join(contents, "Resources", "app.asar");
  const hash = createHash("sha256").update(getRawHeader(archive).headerString).digest("hex");
  await run("/usr/libexec/PlistBuddy", [
    "-c",
    `Set :ElectronAsarIntegrity:Resources/app.asar:hash ${hash}`,
    path.join(contents, "Info.plist"),
  ]);
}

async function signBundle(
  bundle: string,
  deep: boolean,
  certificate = signingIdentity,
): Promise<void> {
  await run("codesign", [
    "--force",
    ...(deep ? ["--deep"] : []),
    "--timestamp=none",
    "--sign",
    certificate,
    bundle,
  ]);
}

async function verifySignature(bundle: string): Promise<void> {
  await run("codesign", ["--verify", "--deep", "--strict", "--verbose=2", bundle]);
  const { stderr } = await execFileAsync("codesign", ["-d", "-r-", bundle]);
  if (stderr.includes("designated => cdhash")) {
    throw new Error("Nightly still has an ad-hoc, build-specific signing identity.");
  }
}

async function timed<T>(label: string, operation: () => Promise<T>): Promise<T> {
  const startedAt = performance.now();
  try {
    return await operation();
  } finally {
    console.log(`[nightly] ${label}: ${((performance.now() - startedAt) / 1_000).toFixed(2)}s`);
  }
}

function run(
  command: string,
  args: string[],
  env = process.env,
  allowFailure = false,
): Promise<boolean> {
  installationSignal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: APP_ROOT, env, stdio: "inherit" });
    child.once("error", allowFailure ? () => resolve(false) : reject);
    child.once("close", (code, signal) => {
      if (installationSignal?.aborted) reject(installationSignal.reason);
      else if (code === 0) resolve(true);
      else if (allowFailure) resolve(false);
      else reject(new Error(`${command} exited with ${signal ?? code ?? "unknown"}`));
    });
  });
}
