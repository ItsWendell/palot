import type { Configuration } from "electron-builder";
import { readFileSync } from "node:fs";
import { parse } from "yaml";
import type { PalotReleaseBuildInfo } from "../src/shared/release-build-info";

/** JSON configuration preserves numeric-looking string fields that CLI parsing coerces. */
export function packageBuildConfig(
  baseConfig: string,
  build: PalotReleaseBuildInfo,
  packageName?: string,
): Configuration {
  const base = parse(readFileSync(baseConfig, "utf8")) as Configuration;
  const files = base.files == null ? [] : Array.isArray(base.files) ? base.files : [base.files];
  return {
    extends: baseConfig,
    // Platform-specific file matchers are additive and can re-include excluded maps.
    ...(packageName
      ? {
          files: [
            ...files,
            "!node_modules/electron-liquid-glass/**/*",
            "!node_modules/objc-js/**/*",
          ],
        }
      : {}),
    extraMetadata: {
      version: build.version,
      palotBuild: build,
      ...(packageName ? { name: packageName } : {}),
    },
  };
}
