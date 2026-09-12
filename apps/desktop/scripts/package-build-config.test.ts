// @vitest-environment node
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { getConfig } from "app-builder-lib/out/util/config/config";
import { expect, it } from "vitest";
import { packageBuildConfig } from "./package-build-config";
import { resolveReleaseBuildInfo } from "./release-build-info";

it("preserves numeric CI identity through electron-builder's configuration loader", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "palot-builder-config-"));
  try {
    const base = path.join(directory, "base.json");
    await writeFile(
      base,
      JSON.stringify({ productName: "Palot", asar: true, files: ["out/**/*", "!out/**/*.map"] }),
    );
    const build = resolveReleaseBuildInfo({
      PALOT_BUILD_NUMBER: "1",
      PALOT_COMMIT_SHA: "a".repeat(40),
      PALOT_BUILD_DIRTY: "0",
    });
    const config = path.join(directory, "build.json");
    await writeFile(config, JSON.stringify(packageBuildConfig(base, build, "palot-nightly")));
    const loaded = await getConfig(directory, config, {
      extraMetadata: { desktopName: "dev.palot.desktop.nightly.desktop" },
    });
    expect(loaded.extraMetadata?.palotBuild).toEqual(build);
    expect(loaded.extraMetadata?.name).toBe("palot-nightly");
    expect(loaded.asar).toBe(true);
    expect(loaded.files).toEqual([
      expect.objectContaining({
        filter: expect.arrayContaining([
          "!out/**/*.map",
          "!node_modules/electron-liquid-glass/**/*",
        ]),
      }),
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
