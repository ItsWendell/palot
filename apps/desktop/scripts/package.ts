/** Builds a channel-specific Palot desktop package. */

import { spawn } from "node:child_process";
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
import { generateDependencyLicenses } from "./generate-dependency-licenses";
import { stageOpenCodeRuntime } from "./stage-opencode-runtime";

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
};

await run(process.execPath, ["run", "scripts/generate-icons.ts", "--check"], environment);
await generateDependencyLicenses();
const requestedPlatform = builderArguments.some((argument) =>
  ["--mac", "--win", "--linux"].some(
    (platform) => argument === platform || argument.startsWith(`${platform}=`),
  ),
);
const buildingMac =
  builderArguments.some((argument) => argument === "--mac" || argument.startsWith("--mac=")) ||
  (!requestedPlatform && process.platform === "darwin");
const buildingLinux =
  builderArguments.some((argument) => argument === "--linux" || argument.startsWith("--linux=")) ||
  (!requestedPlatform && process.platform === "linux");
if (buildingMac || buildingLinux) {
  const requestedArchitectures = (["arm64", "x64"] as const).filter((architecture) =>
    builderArguments.includes(`--${architecture}`),
  );
  const hostArchitecture = process.arch === "arm64" || process.arch === "x64" ? process.arch : null;
  const architectures =
    requestedArchitectures.length > 0
      ? requestedArchitectures
      : hostArchitecture
        ? [hostArchitecture]
        : [];
  if (architectures.length === 0) {
    throw new Error(`Unsupported macOS packaging architecture: ${process.arch}`);
  }
  for (const architecture of architectures) {
    await stageOpenCodeRuntime(architecture, buildingLinux ? "linux" : "darwin");
  }
}
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
await run(
  executable,
  [
    "--config",
    "electron-builder.yml",
    "--publish",
    "never",
    `--config.appId=${identity.appId}`,
    `--config.productName=${identity.productName}`,
    `--config.extraMetadata.version=${releaseBuildInfo.version}`,
    ...(buildingLinux
      ? [`--config.extraMetadata.name=${channel === "stable" ? "palot" : `palot-${channel}`}`]
      : []),
    `--config.artifactName=${artifactPrefix}-\${version}-${artifactSuffix}-\${os}-\${arch}.\${ext}`,
    ...Object.entries(releaseBuildInfo).map(
      ([key, value]) => `--config.extraMetadata.palotBuild.${key}=${String(value)}`,
    ),
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
