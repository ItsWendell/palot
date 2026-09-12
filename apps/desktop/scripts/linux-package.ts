/** Linux directory, Arch recipe, and user-local Nightly lifecycle. */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, cp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveBuildIdentity } from "../src/shared/build-identity";
import { verifyBundledOpenCodeBinary } from "../src/main/opencode-runtime-release";
import { launchLinuxInstallation, stopLinuxInstallation } from "./linux-install-lifecycle";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [action = "verify", channel = "nightly", ...flags] = process.argv.slice(2);
if (flags.some((flag) => flag !== "--skip-build")) throw new Error("Unknown packaging option");
if (process.platform !== "linux") throw new Error("This command requires Linux.");
if (channel !== "nightly" && channel !== "stable") throw new Error("Choose stable or nightly.");
if (!["build", "verify", "arch", "install"].includes(action))
  throw new Error("Usage: linux-package.ts <build|verify|arch|install> [nightly|stable]");
const identity = resolveBuildIdentity({ development: false, configuredChannel: channel });
const executable = channel === "stable" ? "palot" : "palot-nightly";
const output = path.join(
  root,
  "release",
  process.arch === "arm64" ? "linux-arm64-unpacked" : "linux-unpacked",
);

function run(command: string, args: string[], cwd = root): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}`)),
    );
  });
}

if (action !== "verify" && !flags.includes("--skip-build"))
  await run(process.execPath, [
    "run",
    "scripts/package.ts",
    channel,
    "--linux",
    "--dir",
    `--${process.arch}`,
  ]);
await verifyBundledOpenCodeBinary({ directory: path.join(output, "resources/opencode") });
await access(path.join(output, executable));
const desktopName = `${identity.appId}.desktop`;
const desktop = await readFile(path.join(output, "resources", desktopName), "utf8");
if (
  !desktop.includes(`Exec=${executable} --show`) ||
  !desktop.includes(`StartupWMClass=${identity.appId}`)
)
  throw new Error("Linux desktop identity does not match this channel.");
console.log(`Verified ${identity.displayName}: ${output}`);

if (action === "arch") {
  const directory = path.join(root, "release", `arch-${channel}`);
  await mkdir(directory, { recursive: true });
  const archive = `${executable}.tar.gz`;
  await run("tar", [
    "-czf",
    path.join(directory, archive),
    "--transform",
    `s,^\\.,${executable},`,
    "-C",
    output,
    ".",
  ]);
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path.join(directory, archive))) hash.update(chunk);
  const manifest = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  const version = `${manifest.version}.r${new Date().toISOString().replaceAll(/\D/g, "").slice(0, 14)}`;
  const recipe = `# Generated local binary package; run makepkg -si from this directory.\npkgname=${executable}\npkgver=${version}\npkgrel=1\npkgdesc='Palot OpenCode desktop client'\narch=('${process.arch === "arm64" ? "aarch64" : "x86_64"}')\nurl='https://github.com/ItsWendell/palot'\nlicense=('MIT')\ndepends=('glibc' 'gcc-libs' 'gtk3' 'nss' 'alsa-lib' 'libxss' 'libxtst' 'libnotify' 'xdg-utils' 'libdrm' 'libxkbcommon')\noptdepends=('xdg-desktop-portal: native desktop dialogs')\noptions=('!strip')\nsource=('${archive}')\nsha256sums=('${hash.digest("hex")}')\npackage() {\n  install -dm755 "$pkgdir/opt/$pkgname" "$pkgdir/usr/bin"\n  cp -a "$srcdir/$pkgname/." "$pkgdir/opt/$pkgname/"\n  ln -s "/opt/$pkgname/$pkgname" "$pkgdir/usr/bin/$pkgname"\n  install -Dm644 "$srcdir/$pkgname/resources/${desktopName}" "$pkgdir/usr/share/applications/${desktopName}"\n  install -Dm644 "$srcdir/$pkgname/resources/icons/${identity.iconVariant}/icon.png" "$pkgdir/usr/share/icons/hicolor/512x512/apps/${identity.appId}.png"\n  install -Dm644 "$srcdir/$pkgname/resources/licenses/LICENSE.palot.txt" "$pkgdir/usr/share/licenses/$pkgname/LICENSE"\n}\n`;
  await writeFile(path.join(directory, "PKGBUILD"), recipe);
  console.log(`Arch recipe and checksummed source: ${directory}`);
}

if (action === "install") {
  const data = process.env.XDG_DATA_HOME ?? path.join(homedir(), ".local/share");
  const destination = path.join(data, "palot", channel);
  const staged = `${destination}.pending-${process.pid}`;
  const previous = `${destination}.previous`;
  await mkdir(path.dirname(destination), { recursive: true });
  await cp(output, staged, { recursive: true });
  console.log(`Closing ${identity.displayName} before replacement...`);
  try {
    await stopLinuxInstallation([
      path.join(destination, executable),
      path.join(previous, executable),
    ]);
  } catch (error) {
    await rm(staged, { recursive: true, force: true });
    throw error;
  }
  await rm(previous, { recursive: true, force: true });
  try {
    await rename(destination, previous);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  try {
    await rename(staged, destination);
  } catch (error) {
    await rename(previous, destination).catch(() => {});
    throw error;
  }
  const applications = path.join(data, "applications");
  await mkdir(applications, { recursive: true });
  const command = path.join(destination, executable).replaceAll('"', '\\"');
  await writeFile(
    path.join(applications, desktopName),
    desktop
      .replaceAll(`Exec=${executable} `, `Exec="${command}" `)
      .replace(
        `Icon=${identity.appId}`,
        `Icon=${path.join(destination, "resources/icons", identity.iconVariant, "icon.png")}`,
      ),
  );
  const bin = path.join(homedir(), ".local/bin");
  await mkdir(bin, { recursive: true });
  const shellPath = path.join(destination, executable).replaceAll("'", "'\\''");
  await writeFile(
    path.join(bin, executable),
    `#!/bin/sh\nunset ELECTRON_RUN_AS_NODE\nexec '${shellPath}' "$@"\n`,
    { mode: 0o755 },
  );
  await launchLinuxInstallation(
    path.join(destination, executable),
    path.join(data, "palot", `${channel}-launch.log`),
  );
  console.log(`Installed ${identity.displayName} to ${destination}. Previous build: ${previous}`);
}
