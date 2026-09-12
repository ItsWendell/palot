const { rm, writeFile } = require("node:fs/promises");
const path = require("node:path");
const { Arch } = require("builder-util");

module.exports = async function afterPack(context) {
  if (context.electronPlatformName === "linux") {
    const info = context.packager.appInfo;
    const executable = context.packager.executableName;
    const desktop = `[Desktop Entry]\nType=Application\nName=${info.productName}\nExec=${executable} --show\nIcon=${info.id}\nTerminal=false\nCategories=Development;\nKeywords=AI;OpenCode;\nStartupWMClass=${info.id}\nActions=NewTask;\n\n[Desktop Action NewTask]\nName=New Task\nExec=${executable} --new-task\n`;
    await writeFile(path.join(context.appOutDir, "resources", `${info.id}.desktop`), desktop);
    for (const moduleName of ["electron-liquid-glass", "objc-js"]) {
      await rm(
        path.join(context.appOutDir, "resources", "app.asar.unpacked", "node_modules", moduleName),
        { recursive: true, force: true },
      );
    }
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
};
