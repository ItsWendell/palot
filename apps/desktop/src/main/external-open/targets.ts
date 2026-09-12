import path from "node:path";

import type { ExternalOpenTargetID } from "../../shared/external-open-contract";

export interface ExternalOpenTargetDefinition {
  id: ExternalOpenTargetID;
  label: string;
  kind: "editor" | "file-manager";
  bundleIDs: readonly string[];
  knownAppPaths: readonly string[];
  commandNames: readonly string[];
}

const home = process.env.HOME ?? "";
const applications = (name: string) => [
  `/Applications/${name}.app`,
  ...(home ? [path.join(home, "Applications", `${name}.app`)] : []),
];

export const EXTERNAL_OPEN_TARGETS: readonly ExternalOpenTargetDefinition[] = [
  {
    id: "cursor",
    label: "Cursor",
    kind: "editor",
    bundleIDs: ["com.todesktop.230313mzl4w4u92"],
    knownAppPaths: applications("Cursor"),
    commandNames: ["cursor"],
  },
  {
    id: "vscode",
    label: "Visual Studio Code",
    kind: "editor",
    bundleIDs: ["com.microsoft.VSCode"],
    knownAppPaths: applications("Visual Studio Code"),
    commandNames: ["code"],
  },
  {
    id: "vscode-insiders",
    label: "Visual Studio Code Insiders",
    kind: "editor",
    bundleIDs: ["com.microsoft.VSCodeInsiders"],
    knownAppPaths: applications("Visual Studio Code - Insiders"),
    commandNames: ["code-insiders"],
  },
  {
    id: "vscodium",
    label: "VSCodium",
    kind: "editor",
    bundleIDs: ["com.vscodium"],
    knownAppPaths: applications("VSCodium"),
    commandNames: ["codium"],
  },
  {
    id: "zed",
    label: "Zed",
    kind: "editor",
    bundleIDs: ["dev.zed.Zed"],
    knownAppPaths: applications("Zed"),
    commandNames: ["zed"],
  },
  {
    id: "zed-preview",
    label: "Zed Preview",
    kind: "editor",
    bundleIDs: ["dev.zed.Zed-Preview"],
    knownAppPaths: applications("Zed Preview"),
    commandNames: ["zed-preview"],
  },
  {
    id: "windsurf",
    label: "Windsurf",
    kind: "editor",
    bundleIDs: ["com.exafunction.windsurf"],
    knownAppPaths: applications("Windsurf"),
    commandNames: ["windsurf"],
  },
  {
    id: "sublime-text",
    label: "Sublime Text",
    kind: "editor",
    bundleIDs: ["com.sublimetext.4", "com.sublimetext.3"],
    knownAppPaths: applications("Sublime Text"),
    commandNames: ["subl"],
  },
  {
    id: "intellij-idea",
    label: "IntelliJ IDEA",
    kind: "editor",
    bundleIDs: ["com.jetbrains.intellij", "com.jetbrains.intellij.ce"],
    knownAppPaths: [...applications("IntelliJ IDEA"), ...applications("IntelliJ IDEA CE")],
    commandNames: ["idea"],
  },
  {
    id: "webstorm",
    label: "WebStorm",
    kind: "editor",
    bundleIDs: ["com.jetbrains.WebStorm"],
    knownAppPaths: applications("WebStorm"),
    commandNames: ["webstorm"],
  },
  {
    id: "pycharm",
    label: "PyCharm",
    kind: "editor",
    bundleIDs: ["com.jetbrains.pycharm", "com.jetbrains.pycharm.ce"],
    knownAppPaths: [...applications("PyCharm"), ...applications("PyCharm CE")],
    commandNames: ["pycharm"],
  },
  {
    id: "goland",
    label: "GoLand",
    kind: "editor",
    bundleIDs: ["com.jetbrains.goland"],
    knownAppPaths: applications("GoLand"),
    commandNames: ["goland"],
  },
  {
    id: "clion",
    label: "CLion",
    kind: "editor",
    bundleIDs: ["com.jetbrains.CLion"],
    knownAppPaths: applications("CLion"),
    commandNames: ["clion"],
  },
  {
    id: "rider",
    label: "Rider",
    kind: "editor",
    bundleIDs: ["com.jetbrains.rider"],
    knownAppPaths: applications("Rider"),
    commandNames: ["rider"],
  },
  {
    id: "android-studio",
    label: "Android Studio",
    kind: "editor",
    bundleIDs: ["com.google.android.studio"],
    knownAppPaths: applications("Android Studio"),
    commandNames: ["studio"],
  },
  {
    id: "finder",
    label: "Reveal in Finder",
    kind: "file-manager",
    bundleIDs: ["com.apple.finder"],
    knownAppPaths: ["/System/Library/CoreServices/Finder.app"],
    commandNames: [],
  },
];
