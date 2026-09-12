/** Verify trusted, locally built Linux artifacts without installing them.
 * `smoke-plan` prints (never runs) a co-install/remove test for a disposable VM.
 */
import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { extractFile, listPackage } from "@electron/asar";
import { verifyBundledOpenCodeBinary } from "../src/main/opencode-runtime-release";
import { resolveBuildIdentity } from "../src/shared/build-identity";
import { resolveReleaseBuildInfo } from "./release-build-info";
import { verifyPackagedBuildIdentity } from "./release-verification";

const exec = promisify(execFile);
type Channel = "stable" | "nightly";
type Format = "deb" | "rpm" | "tar.gz" | "AppImage";

export function linuxDistributionIdentity(channel: Channel) {
  const identity = resolveBuildIdentity({ development: false, configuredChannel: channel });
  const packageName = channel === "stable" ? "palot" : "palot-nightly";
  return {
    ...identity,
    packageName,
    executable: packageName,
    installDirectory: `/opt/${identity.productName}`,
    desktopName: `${identity.appId}.desktop`,
  };
}

export function linuxArtifactFormat(artifact: string): Format {
  for (const format of ["deb", "rpm", "tar.gz", "AppImage"] as const) {
    if (artifact.endsWith(`.${format}`)) return format;
  }
  throw new Error(`Unsupported Linux artifact: ${artifact}`);
}

export function verifyLinuxPackageMetadata(
  metadata: { name?: string; palotBuild?: { channel?: string } },
  channel: Channel,
) {
  const expected = linuxDistributionIdentity(channel);
  if (metadata.name !== expected.packageName || metadata.palotBuild?.channel !== channel) {
    throw new Error(`Packaged identity must be ${expected.packageName} (${channel}).`);
  }
}

async function run(command: string, args: string[], cwd?: string) {
  const result = await exec(command, args, {
    cwd,
    timeout: 120_000,
    maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, LC_ALL: "C" },
  });
  return result.stdout.trim();
}

async function findAppDirectory(directory: string, executable: string): Promise<string> {
  // Electron archives may wrap the application in one top-level directory.
  const candidates = [directory];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) candidates.push(path.join(directory, entry.name));
  }
  for (const candidate of candidates) {
    try {
      await access(path.join(candidate, executable), constants.X_OK);
      await access(path.join(candidate, "resources/app.asar"));
      return candidate;
    } catch {
      // Try the next archive root.
    }
  }
  throw new Error(`Artifact does not contain an executable ${executable} and resources/app.asar.`);
}

/** Native-host verification: runtime --version is executed, not Electron or an install hook.
 * AppImage extraction executes its runtime, so only pass trusted build artifacts.
 * Debian requires dpkg-deb; RPM requires rpm + bsdtar; archives require tar.
 */
export async function verifyLinuxArtifact(artifact: string, channel: Channel, verifyBuild = false) {
  if (process.platform !== "linux") throw new Error("Artifact verification requires Linux.");
  const format = linuxArtifactFormat(artifact);
  const file = path.resolve(artifact);
  const identity = linuxDistributionIdentity(channel);
  const temporary = await mkdtemp(path.join(tmpdir(), "palot-distribution-"));
  try {
    let app: string;
    if (format === "deb" || format === "rpm") {
      const packageName = await run(
        format === "deb" ? "dpkg-deb" : "rpm",
        format === "deb" ? ["--field", file, "Package"] : ["-qp", "--queryformat", "%{NAME}", file],
      );
      if (packageName !== identity.packageName) {
        throw new Error(
          `Distribution package name is ${packageName}, expected ${identity.packageName}.`,
        );
      }
      await run(
        format === "deb" ? "dpkg-deb" : "bsdtar",
        format === "deb" ? ["--extract", file, temporary] : ["-xf", file, "-C", temporary],
      );
      app = path.join(temporary, identity.installDirectory);
      const profile = await readFile(path.join(app, "resources/apparmor-profile"), "utf8");
      if (
        !profile.includes(
          `profile "${identity.executable}" "${identity.installDirectory}/${identity.executable}"`,
        ) ||
        !profile.includes("userns,")
      )
        throw new Error("Missing channel-scoped AppArmor user-namespace policy.");
      const desktop = await readFile(
        path.join(temporary, "usr/share/applications", identity.desktopName),
        "utf8",
      );
      if (
        !desktop.includes(`StartupWMClass=${identity.appId}`) ||
        !desktop.includes(identity.executable)
      ) {
        throw new Error("Installed desktop entry has the wrong channel identity.");
      }
      if (desktop.includes("--no-sandbox") || desktop.includes("--disable-setuid-sandbox")) {
        throw new Error("Desktop entry disables Chromium sandboxing.");
      }
    } else {
      if (format === "AppImage") await run(file, ["--appimage-extract"], temporary);
      else await run("tar", ["-xzf", file, "-C", temporary]);
      app = await findAppDirectory(temporary, identity.executable);
    }
    await access(path.join(app, identity.executable), constants.X_OK);
    const sandbox = await stat(path.join(app, "chrome-sandbox"));
    if (!sandbox.isFile() || (sandbox.mode & 0o111) === 0)
      throw new Error("Missing executable chrome-sandbox.");
    const asar = path.join(app, "resources/app.asar");
    const entries = new Set(listPackage(asar, { isPack: false }));
    for (const entry of [
      "/package.json",
      "/out/main/index.js",
      "/out/preload/index.cjs",
      "/out/renderer/index.html",
    ]) {
      if (!entries.has(entry)) throw new Error(`Missing application entry: ${entry}`);
    }
    const metadata = JSON.parse(extractFile(asar, "package.json").toString());
    verifyLinuxPackageMetadata(metadata, channel);
    if (verifyBuild) verifyPackagedBuildIdentity(metadata, channel);
    // Same pinned binary/manifest/hash/version contract as linux-package.ts.
    await verifyBundledOpenCodeBinary({ directory: path.join(app, "resources/opencode") });
    const desktop = await readFile(path.join(app, "resources", identity.desktopName), "utf8");
    if (
      !desktop.includes(`Exec=${identity.executable} --show`) ||
      !desktop.includes(`StartupWMClass=${identity.appId}`)
    ) {
      throw new Error("Bundled desktop entry has the wrong channel identity.");
    }
    return { artifact: file, format, channel, packageName: identity.packageName };
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

function quote(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

/** Emit only; caller must provision a fresh VM. Containers cannot prove host AppArmor policy.
 * Launch/hydration belongs to the isolated desktop E2E harness, not a root package hook.
 */
export function linuxInstallSmokePlan(stableArtifact: string, nightlyArtifact: string): string {
  const format = linuxArtifactFormat(stableArtifact);
  if ((format !== "deb" && format !== "rpm") || linuxArtifactFormat(nightlyArtifact) !== format) {
    throw new Error("Smoke plan requires a stable/nightly pair of .deb or .rpm files.");
  }
  const stable = linuxDistributionIdentity("stable");
  const nightly = linuxDistributionIdentity("nightly");
  const install = format === "deb" ? "apt-get install -y" : "dnf install -y";
  const remove = format === "deb" ? "apt-get purge -y" : "dnf remove -y";
  const query = format === "deb" ? "dpkg-query -W -f='${db:Status-Status}'" : "rpm -q";
  const absent =
    format === "deb"
      ? 'test "$(dpkg-query -W -f=\'${db:Status-Status}\' "$1" 2>/dev/null || true)" != installed'
      : '! rpm -q "$1" >/dev/null 2>&1';
  return `#!/bin/bash
set -euo pipefail
# DESTRUCTIVE: run only in a newly provisioned disposable Linux VM, never a developer host.
test "\${PALOT_DISPOSABLE_LINUX_VM:-}" = 1
test "$(id -u)" = 0
absent() { ${absent}; }
absent palot
absent palot-nightly
test ! -e ${quote(stable.installDirectory)}
test ! -e ${quote(nightly.installDirectory)}
${install} ${quote(path.resolve(stableArtifact))} ${quote(path.resolve(nightlyArtifact))}
${[stable, nightly]
  .map(
    (identity) => `
${query} ${identity.packageName}
test -x ${quote(`${identity.installDirectory}/${identity.executable}`)}
test "$(readlink -f /usr/bin/${identity.executable})" = ${quote(`${identity.installDirectory}/${identity.executable}`)}
test -f /usr/share/applications/${identity.desktopName}
# A setuid sandbox is valid only when root owns it and it has mode 4755.
sandbox=${quote(`${identity.installDirectory}/chrome-sandbox`)}
test "$(stat -c %u "$sandbox")" = 0
mode=$(stat -c %a "$sandbox")
test "$mode" = 755 || test "$mode" = 4755
if command -v apparmor_status >/dev/null && apparmor_status --enabled; then
  profile=${quote(`${identity.installDirectory}/resources/apparmor-profile`)}
  if apparmor_parser --skip-kernel-load --debug "$profile" >/dev/null 2>&1; then
    test -f /etc/apparmor.d/${identity.executable}
    grep -F '${identity.executable} (' /sys/kernel/security/apparmor/profiles
  fi
fi`,
  )
  .join("\n")}
# Remove one channel while proving the other's integration survives.
${remove} palot-nightly
absent palot-nightly
test ! -e /usr/bin/palot-nightly
test ! -e /etc/apparmor.d/palot-nightly
test ! -e /usr/share/applications/${nightly.desktopName}
test ! -e ${quote(nightly.installDirectory)}
if test -r /sys/kernel/security/apparmor/profiles; then
  ! grep -F 'palot-nightly (' /sys/kernel/security/apparmor/profiles
fi
${query} palot
test -x /usr/bin/palot
test -f /usr/share/applications/${stable.desktopName}
${remove} palot
absent palot
test ! -e /usr/bin/palot
test ! -e /etc/apparmor.d/palot
test ! -e /usr/share/applications/${stable.desktopName}
test ! -e ${quote(stable.installDirectory)}
if test -r /sys/kernel/security/apparmor/profiles; then
  ! grep -F 'palot (' /sys/kernel/security/apparmor/profiles
fi
echo 'Package co-install and removal passed; GUI sandbox/hydration is a separate non-root smoke.'
`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [action, ...args] = process.argv.slice(2);
  if (action === "smoke-plan" && args.length === 2) {
    console.log(linuxInstallSmokePlan(args[0]!, args[1]!));
  } else if (
    action === "verify" &&
    (args[0] === "stable" || args[0] === "nightly") &&
    args.length >= 2
  ) {
    const channel = args[0];
    resolveReleaseBuildInfo({ ...process.env, PALOT_BUILD_CHANNEL: channel });
    for (const artifact of args.slice(1))
      console.log(JSON.stringify(await verifyLinuxArtifact(artifact, channel, true)));
  } else {
    throw new Error(
      "Usage: linux-distribution.ts verify <stable|nightly> <artifact...> | smoke-plan <stable.deb|rpm> <nightly.deb|rpm>",
    );
  }
}
