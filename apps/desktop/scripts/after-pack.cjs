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

module.exports = async function afterPack(context) {
  if (context.electronPlatformName === "linux") {
    const info = context.packager.appInfo;
    const executable = context.packager.executableName;
    const desktop = `[Desktop Entry]\nType=Application\nName=${info.productName}\nExec=${executable} --show\nIcon=${info.id}\nTerminal=false\nCategories=Development;\nKeywords=AI;OpenCode;\nStartupWMClass=${info.id}\nActions=NewTask;\n\n[Desktop Action NewTask]\nName=New Task\nExec=${executable} --new-task\n`;
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
