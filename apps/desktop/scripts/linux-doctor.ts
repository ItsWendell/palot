import { linuxDesktopDiagnostics } from "../src/main/linux-desktop";
import { readFile } from "node:fs/promises";

const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
console.log(
  JSON.stringify(
    {
      ...(await linuxDesktopDiagnostics()),
      declared: {
        palot: manifest.version,
        electron: manifest.devDependencies.electron,
        opencode: manifest.devDependencies["@opencode/client"],
      },
      runtime:
        "Run the packaged executable with --diagnostics for Electron GPU and display details.",
    },
    null,
    2,
  ),
);
