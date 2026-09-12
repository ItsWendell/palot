import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import desktopPackage from "../package.json" with { type: "json" };
import rootPackage from "../../../package.json" with { type: "json" };
import { PALOT_BUILD_CHANNELS, type PalotBuildChannel } from "../src/shared/build-identity";
import type { PalotReleaseBuildInfo } from "../src/shared/release-build-info";
import { SUPPORTED_OPENCODE_VERSION } from "../src/main/opencode-version";

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const REPOSITORY_ROOT = path.resolve(APP_ROOT, "../..");
/** The root manifest owns Palot's release train; OpenCode has an independent version. */
export const PALOT_BASE_VERSION = rootPackage.version;
const NUMBER = "(?:0|[1-9]\\d*)";
const BASE_VERSION = new RegExp(`^${NUMBER}\\.${NUMBER}\\.${NUMBER}$`);
const RELEASE_TAG = new RegExp(
  `^v(${NUMBER}\\.${NUMBER}\\.${NUMBER})(?:-(nightly|beta|rc|dev)\\.(${NUMBER}(?:\\.${NUMBER})*))?$`,
);

export function verifyReleaseVersions(): void {
  if (!BASE_VERSION.test(PALOT_BASE_VERSION)) {
    throw new Error(`Palot base version must be stable SemVer: ${PALOT_BASE_VERSION}.`);
  }
  if (rootPackage.version !== desktopPackage.version) {
    throw new Error(
      `Package version mismatch: root is ${rootPackage.version}, desktop is ${desktopPackage.version}.`,
    );
  }
  const clientVersion = desktopPackage.devDependencies["@opencode/client"];
  const protocolVersion = desktopPackage.devDependencies["@opencode/protocol"];
  if (clientVersion !== protocolVersion || clientVersion !== SUPPORTED_OPENCODE_VERSION) {
    throw new Error(
      `OpenCode contract mismatch: client=${clientVersion}, protocol=${protocolVersion}, supported=${SUPPORTED_OPENCODE_VERSION}.`,
    );
  }
}

export function verifyReleaseTag(
  environment: NodeJS.ProcessEnv = process.env,
  version = PALOT_BASE_VERSION,
): void {
  const tag = releaseTag(environment);
  if (!tag) return;
  const match = RELEASE_TAG.exec(tag);
  if (!match) {
    throw new Error(
      `Unsupported release tag: ${tag}. Expected v${version} or v${version}-{nightly,beta,rc,dev}.N.`,
    );
  }
  if (match[1] !== version) {
    throw new Error(`Release tag ${tag} does not match package version ${version}.`);
  }
}

/** Use the exact tag version, or derive a prerelease without changing source manifests. */
export function resolveReleaseVersion(
  channel: PalotBuildChannel,
  environment: NodeJS.ProcessEnv = process.env,
  baseVersion = PALOT_BASE_VERSION,
  now = new Date(),
): string {
  if (!BASE_VERSION.test(baseVersion)) {
    throw new Error(`Palot base version must be stable SemVer: ${baseVersion}.`);
  }
  verifyReleaseTag(environment, baseVersion);
  const tag = releaseTag(environment);
  if (tag) {
    const prerelease = RELEASE_TAG.exec(tag)![2];
    const expectedChannel = prerelease === "rc" ? "beta" : (prerelease ?? "stable");
    if (channel !== expectedChannel) {
      throw new Error(
        `Release tag ${tag} requires the ${expectedChannel} channel, not ${channel}.`,
      );
    }
    return tag.slice(1);
  }
  if (channel === "stable") return baseVersion;
  // UTC timestamp orders rolling builds; CI's run number disambiguates same-second builds.
  const timestamp = now.toISOString().replaceAll(/\D/g, "").slice(0, 14);
  const build = environment.PALOT_BUILD_NUMBER?.trim() || environment.GITHUB_RUN_NUMBER?.trim();
  const sequence = build && new RegExp(`^${NUMBER}$`).test(build) ? `.${build}` : "";
  return `${baseVersion}-${channel}.${timestamp}${sequence}`;
}

export function resolveReleaseBuildInfo(
  environment: NodeJS.ProcessEnv = process.env,
): PalotReleaseBuildInfo {
  verifyReleaseVersions();
  verifyReleaseTag(environment);
  const channel = parseChannel(environment.PALOT_BUILD_CHANNEL);
  return {
    version: resolveReleaseVersion(channel, environment),
    commitSha: environment.PALOT_COMMIT_SHA?.trim() || git(["rev-parse", "HEAD"]) || "unknown",
    buildNumber:
      environment.PALOT_BUILD_NUMBER?.trim() || environment.GITHUB_RUN_NUMBER?.trim() || "local",
    channel,
    openCodeContractVersion: SUPPORTED_OPENCODE_VERSION,
    dirty:
      environment.PALOT_BUILD_DIRTY === "1" ||
      (environment.PALOT_BUILD_DIRTY !== "0" && git(["status", "--porcelain"]).length > 0),
  };
}

/** Verification runs later than packaging: validate, rather than regenerate, rolling versions. */
export function verifyPackagedReleaseVersion(
  version: string,
  channel: PalotBuildChannel,
  environment: NodeJS.ProcessEnv = process.env,
  baseVersion = PALOT_BASE_VERSION,
): void {
  const expected = resolveReleaseVersion(
    channel,
    { ...environment, PALOT_RELEASE_TAG: releaseTag(environment) || `v${version}` },
    baseVersion,
  );
  if (version !== expected) {
    throw new Error(`Packaged version ${version} does not match release version ${expected}.`);
  }
}

export function buildInfoDefine(environment: NodeJS.ProcessEnv = process.env): string {
  const configured = environment.PALOT_BUILD_INFO_JSON?.trim();
  if (configured) return configured;
  return JSON.stringify(resolveReleaseBuildInfo(environment));
}

export function artifactIdentity(info: PalotReleaseBuildInfo): string {
  const commit = info.commitSha === "unknown" ? "unknown" : info.commitSha.slice(0, 12);
  return [
    info.channel,
    commit,
    `build-${safeSegment(info.buildNumber)}`,
    info.dirty ? "dirty" : null,
  ]
    .filter(Boolean)
    .join("-");
}

function parseChannel(value: string | undefined): PalotBuildChannel {
  if (value && PALOT_BUILD_CHANNELS.includes(value as PalotBuildChannel)) {
    return value as PalotBuildChannel;
  }
  if (value) throw new Error(`Unknown Palot build channel: ${value}`);
  return "stable";
}

function releaseTag(environment: NodeJS.ProcessEnv): string {
  return (
    environment.PALOT_RELEASE_TAG?.trim() ||
    (environment.GITHUB_REF_TYPE === "tag" ? environment.GITHUB_REF_NAME?.trim() : "") ||
    ""
  );
}

function safeSegment(value: string): string {
  return value.replaceAll(/[^A-Za-z0-9._-]+/g, "-").replaceAll(/^-+|-+$/g, "") || "unknown";
}

function git(arguments_: string[]): string {
  try {
    return execFileSync("git", arguments_, {
      cwd: REPOSITORY_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

if (import.meta.main) {
  verifyReleaseVersions();
  verifyReleaseTag();
  console.log(JSON.stringify(resolveReleaseBuildInfo(), null, 2));
}
