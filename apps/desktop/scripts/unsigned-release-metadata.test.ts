import { mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { PalotReleaseBuildInfo } from "../src/shared/release-build-info";
import {
  componentFromLocator,
  removePreviousUnsignedReleaseArtifacts,
} from "./unsigned-release-metadata";

describe("unsigned release metadata", () => {
  it("creates CycloneDX components from npm lock locators", () => {
    expect(componentFromLocator("@electron/fuses@1.8.0")).toEqual({
      type: "library",
      name: "@electron/fuses",
      version: "1.8.0",
      "bom-ref": "@electron/fuses@1.8.0",
      purl: "pkg:npm/@electron%2Ffuses@1.8.0",
    });
  });

  it("keeps non-registry sources without an invalid purl", () => {
    expect(componentFromLocator("ghostty-web@git+https://example.test/repo.git#abc")).toEqual({
      type: "library",
      name: "ghostty-web",
      version: "git+https://example.test/repo.git#abc",
      "bom-ref": "ghostty-web@git+https://example.test/repo.git#abc",
    });
  });

  it("removes stale artifacts for the current build identity", async () => {
    const releaseDirectory = await mkdtemp(path.join(tmpdir(), "palot-release-metadata-"));
    const buildInfo: PalotReleaseBuildInfo = {
      version: "1.2.3",
      commitSha: "abcdef1234567890",
      buildNumber: "7",
      channel: "stable",
      openCodeContractVersion: "0.0.0-beta-1",
      dirty: false,
    };
    const stale = "Palot-1.2.3-stable-abcdef123456-build-7-mac-arm64.dmg";
    const unrelated = "Palot-1.2.2-stable-old-build-6-mac-arm64.dmg";
    await Promise.all([
      writeFile(path.join(releaseDirectory, stale), "stale"),
      writeFile(path.join(releaseDirectory, unrelated), "keep"),
      writeFile(path.join(releaseDirectory, "SHA256SUMS"), "stale"),
      writeFile(path.join(releaseDirectory, "release-manifest.json"), "stale"),
    ]);

    expect(await removePreviousUnsignedReleaseArtifacts({ releaseDirectory, buildInfo })).toEqual([
      stale,
      "SHA256SUMS",
      "release-manifest.json",
    ]);
    expect(await readdir(releaseDirectory)).toEqual([unrelated]);
  });
});
