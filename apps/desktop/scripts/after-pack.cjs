const { rm, writeFile } = require("node:fs/promises");
const path = require("node:path");
const { Arch } = require("builder-util");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

async function writeNotices(context, resources) {
  if (!process.env.PALOT_PACKAGE_RUNNER)
    throw new Error("Package through scripts/package.ts to record build inputs.");
  const { stdout, stderr } = await promisify(execFile)(
    process.env.PALOT_PACKAGE_RUNNER,
    [
      path.join(__dirname, "packaged-dependency-licenses.ts"),
      context.packager.projectDir,
      resources,
    ],
    { env: process.env, maxBuffer: 8 * 1024 * 1024 },
  );
  if (stdout) console.log(stdout);
  if (stderr) console.error(stderr);
}

/**
 * The desktop entry bundled in resources/, which the local install and the Arch recipe use.
 * (deb/rpm write their own from linux.desktop.) %U passes a palot:// link after --show, and
 * MimeType lets the desktop route the configured schemes to this channel.
 */
function linuxDesktopEntry({ productName, appId, executable, schemes }) {
  const mimeTypes = schemes.map((scheme) => `x-scheme-handler/${scheme};`).join("");
  return `[Desktop Entry]\nType=Application\nName=${productName}\nExec=${executable} --show %U\nIcon=${appId}\nTerminal=false\nCategories=Development;\nKeywords=AI;OpenCode;\nStartupWMClass=${appId}\n${mimeTypes ? `MimeType=${mimeTypes}\n` : ""}Actions=NewTask;\n\n[Desktop Action NewTask]\nName=New Task\nExec=${executable} --new-task\n`;
}

module.exports = async function afterPack(context) {
  if (context.electronPlatformName === "linux") {
    const info = context.packager.appInfo;
    const protocols = context.packager.config.protocols ?? [];
    const desktop = linuxDesktopEntry({
      productName: info.productName,
      appId: info.id,
      executable: context.packager.executableName,
      schemes: (Array.isArray(protocols) ? protocols : [protocols]).flatMap((protocol) =>
        Array.isArray(protocol.schemes) ? protocol.schemes : [protocol.schemes],
      ),
    });
    await writeFile(path.join(context.appOutDir, "resources", `${info.id}.desktop`), desktop);
    await writeNotices(context, path.join(context.appOutDir, "resources"));
    return;
  }
  if (context.electronPlatformName !== "darwin") return;
  const architecture = Arch[context.arch];
  if (architecture !== "arm64" && architecture !== "x64") {
    throw new Error(`Unsupported macOS package architecture: ${architecture}`);
  }
  const oppositeArchitecture = architecture === "arm64" ? "x64" : "arm64";
  const appName = `${context.packager.appInfo.productFilename}.app`;
  for (const moduleName of ["electron-liquid-glass", "objc-js"]) {
    const prebuild = path.join(
      context.appOutDir,
      appName,
      "Contents",
      "Resources",
      "app.asar.unpacked",
      "node_modules",
      moduleName,
      "prebuilds",
      `darwin-${oppositeArchitecture}`,
    );
    await rm(prebuild, { recursive: true, force: true });
  }
  await writeNotices(context, path.join(context.appOutDir, appName, "Contents", "Resources"));
};
module.exports.linuxDesktopEntry = linuxDesktopEntry;
