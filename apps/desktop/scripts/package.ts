/** Builds a channel-specific Palot desktop package. */

import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  PALOT_BUILD_CHANNELS,
  type PalotBuildChannel,
  resolveBuildIdentity,
} from "../src/shared/build-identity";
import { artifactIdentity, resolveReleaseBuildInfo } from "./release-build-info";
import {
  generateUnsignedReleaseMetadata,
  removePreviousUnsignedReleaseArtifacts,
} from "./unsigned-release-metadata";
import { packageBuildConfig } from "./package-build-config";

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPOSITORY_ROOT = path.resolve(APP_ROOT, "../..");
const [channelArgument = "stable", ...rawBuilderArguments] = process.argv.slice(2);

if (!PALOT_BUILD_CHANNELS.includes(channelArgument as PalotBuildChannel)) {
  throw new Error(`Unknown Palot build channel: ${channelArgument}`);
}

const channel = channelArgument as PalotBuildChannel;
if (channel === "dev") throw new Error("Use bun run dev for the development channel.");
const skipBuild = rawBuilderArguments.includes("--skip-build");
const builderArguments = rawBuilderArguments.filter((argument) => argument !== "--skip-build");
const directoryOnly = builderArguments.includes("--dir");

const identity = resolveBuildIdentity({ development: false, configuredChannel: channel });
const releaseBuildInfo = resolveReleaseBuildInfo({ ...process.env, PALOT_BUILD_CHANNEL: channel });
const environment = {
  ...process.env,
  CSC_IDENTITY_AUTO_DISCOVERY: "false",
  PALOT_BUILD_CHANNEL: channel,
  PALOT_BUILD_INFO_JSON: JSON.stringify(releaseBuildInfo),
  PALOT_RELEASE_BUILD: "1",
  PALOT_PACKAGE_RUNNER: process.execPath,
};

await run(process.execPath, ["run", "scripts/generate-icons.ts", "--check"], environment);
const requestedPlatform = builderArguments.some((argument) =>
  ["--mac", "--win", "--linux"].some(
    (platform) => argument === platform || argument.startsWith(`${platform}=`),
  ),
);
const buildingLinux =
  builderArguments.some((argument) => argument === "--linux" || argument.startsWith("--linux=")) ||
  (!requestedPlatform && process.platform === "linux");
if (!skipBuild) await run(process.execPath, ["run", "scripts/build.ts"], environment);

if (!directoryOnly) {
  await removePreviousUnsignedReleaseArtifacts({
    releaseDirectory: path.join(APP_ROOT, "release"),
    buildInfo: releaseBuildInfo,
  });
}

const executable = path.join(
  REPOSITORY_ROOT,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "electron-builder.cmd" : "electron-builder",
);
const artifactPrefix = identity.productName.replaceAll(/[^A-Za-z0-9]+/g, "-");
const artifactSuffix = artifactIdentity(releaseBuildInfo);
const temporaryRoot = path.join(REPOSITORY_ROOT, ".local", "package-config");
await mkdir(temporaryRoot, { recursive: true });
const temporary = await mkdtemp(path.join(temporaryRoot, "build-"));
const builderConfig = path.join(temporary, "electron-builder.json");
await writeFile(
  builderConfig,
  JSON.stringify(
    packageBuildConfig(
      path.join(APP_ROOT, "electron-builder.yml"),
      releaseBuildInfo,
      buildingLinux ? (channel === "stable" ? "palot" : `palot-${channel}`) : undefined,
    ),
  ),
);
try {
  await run(
    executable,
    [
      "--config",
      builderConfig,
      "--publish",
      "never",
      `--config.appId=${identity.appId}`,
      `--config.productName=${identity.productName}`,
      `--config.artifactName=${artifactPrefix}-\${version}-${artifactSuffix}-\${os}-\${arch}.\${ext}`,
      `--config.mac.icon=resources/icons/${identity.iconVariant}/icon.icns`,
      `--config.win.icon=resources/icons/${identity.iconVariant}/icon.ico`,
      `--config.linux.icon=resources/icons/${identity.iconVariant}`,
      `--config.linux.executableName=${identity.channel === "stable" ? "palot" : `palot-${identity.channel}`}`,
      `--config.linux.desktop.entry.StartupWMClass=${identity.appId}`,
      `--config.extraMetadata.desktopName=${identity.appId}.desktop`,
      `--config.linux.desktop.desktopActions.NewTask.Exec=${identity.channel === "stable" ? "palot" : `palot-${identity.channel}`} --new-task`,
      ...builderArguments,
    ],
    environment,
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}
if (!directoryOnly) {
  await generateUnsignedReleaseMetadata({
    releaseDirectory: path.join(APP_ROOT, "release"),
    buildInfo: releaseBuildInfo,
  });
}

function run(command: string, args: string[], env: NodeJS.ProcessEnv): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: APP_ROOT, env, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else
        reject(new Error(`${path.basename(command)} exited with ${signal ?? code ?? "unknown"}`));
    });
  });
}
