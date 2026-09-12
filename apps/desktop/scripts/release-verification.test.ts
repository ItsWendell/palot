import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { flipFuses, FuseV1Options, FuseVersion, getCurrentFuseWire } from "@electron/fuses";
import { describe, expect, it, vi } from "vitest";
import type { PalotReleaseBuildInfo } from "../src/shared/release-build-info";
import { PALOT_BASE_VERSION, resolveReleaseBuildInfo } from "./release-build-info";
import { generateUnsignedReleaseMetadata } from "./unsigned-release-metadata";
import {
  missingReleaseEntries,
  assertReleaseSmokeState,
  REQUIRED_ASAR_ENTRIES,
  unexpectedFuseEntries,
  verifyPackagedBuildIdentity,
  verifyUnsignedReleaseMetadata,
} from "./release-verification";

describe("release verification", () => {
  const environment = {
    PALOT_BUILD_CHANNEL: "nightly",
    PALOT_COMMIT_SHA: "abcdef1234567890",
    PALOT_BUILD_NUMBER: "7",
    PALOT_BUILD_DIRTY: "0",
  };

  it("reuses the validated packaged rolling identity for metadata verification at a later time", async () => {
    const releaseDirectory = await mkdtemp(path.join(tmpdir(), "palot-rolling-release-verify-"));
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-09-12T21:19:53Z"));
      const buildInfo = resolveReleaseBuildInfo(environment);
      await writeFile(
        path.join(
          releaseDirectory,
          `Palot-Nightly-${buildInfo.version}-nightly-abcdef123456-build-7-mac-arm64.zip`,
        ),
        "candidate",
      );
      await generateUnsignedReleaseMetadata({ releaseDirectory, buildInfo });

      vi.setSystemTime(new Date("2026-09-13T08:00:00Z"));
      expect(resolveReleaseBuildInfo(environment).version).not.toBe(buildInfo.version);
      const expectedBuild = verifyPackagedBuildIdentity(
        { version: buildInfo.version, palotBuild: buildInfo },
        "nightly",
        environment,
      );
      expect(expectedBuild).toEqual(buildInfo);
      await expect(
        verifyUnsignedReleaseMetadata(releaseDirectory, expectedBuild),
      ).resolves.toBeUndefined();
      await expect(
        verifyUnsignedReleaseMetadata(releaseDirectory, { ...expectedBuild, dirty: true }),
      ).rejects.toThrow("build identity");
    } finally {
      vi.useRealTimers();
      await rm(releaseDirectory, { recursive: true, force: true });
    }
  });

  it("still validates packaged channel, base version, explicit tags and build overrides", () => {
    const buildInfo = resolveReleaseBuildInfo(environment);
    const manifest = { version: buildInfo.version, palotBuild: buildInfo };
    expect(() => verifyPackagedBuildIdentity(manifest, "beta", environment)).toThrow("channel");
    expect(() =>
      verifyPackagedBuildIdentity(
        { ...manifest, version: "999.0.0-nightly.1" },
        "nightly",
        environment,
      ),
    ).toThrow("package version");
    expect(
      verifyPackagedBuildIdentity(manifest, "nightly", {
        ...environment,
        PALOT_RELEASE_TAG: `v${buildInfo.version}`,
      }),
    ).toEqual(buildInfo);
    for (const override of [
      { PALOT_RELEASE_TAG: `v${PALOT_BASE_VERSION}-nightly.1` },
      { GITHUB_REF_TYPE: "tag", GITHUB_REF_NAME: `v${PALOT_BASE_VERSION}-nightly.1` },
    ]) {
      expect(() =>
        verifyPackagedBuildIdentity(manifest, "nightly", { ...environment, ...override }),
      ).toThrow("does not match release version");
    }
    for (const override of [
      { PALOT_COMMIT_SHA: "different" },
      { PALOT_BUILD_NUMBER: "8" },
      { PALOT_BUILD_DIRTY: "1" },
    ]) {
      expect(() =>
        verifyPackagedBuildIdentity(manifest, "nightly", { ...environment, ...override }),
      ).toThrow("build identity");
    }
  });

  it("requires a useful renderer connected to the exact owned runtime", () => {
    const expected = { version: "2.0.2", pid: 12345 };
    const state = { preload: true, onboarding: true, runtime: { connected: true, ...expected } };
    expect(() => assertReleaseSmokeState(state, expected)).not.toThrow();
    expect(() => assertReleaseSmokeState({ ...state, preload: false }, expected)).toThrow(
      "preload",
    );
    expect(() => assertReleaseSmokeState({ ...state, loading: true }, expected)).toThrow(
      "useful state",
    );
    expect(() => assertReleaseSmokeState({ ...state, onboarding: false }, expected)).toThrow(
      "useful state",
    );
    for (const runtime of [
      { ...state.runtime, connected: false },
      { ...state.runtime, version: "0.0.0-beta-1" },
      { ...state.runtime, pid: 54321 },
    ]) {
      expect(() => assertReleaseSmokeState({ ...state, runtime }, expected)).toThrow(
        "owned smoke runtime",
      );
    }
  });
  it("reports deterministic missing package entries", () => {
    expect(
      missingReleaseEntries(["/out/main/index.js", "/package.json"], REQUIRED_ASAR_ENTRIES),
    ).toEqual(["/out/preload/index.cjs", "/out/renderer/index.html"]);
  });

  it("accepts a complete package manifest", () => {
    expect(missingReleaseEntries(REQUIRED_ASAR_ENTRIES, REQUIRED_ASAR_ENTRIES)).toEqual([]);
  });

  it("reports Electron fuse policy differences", () => {
    const wire = Object.fromEntries(Array.from({ length: 8 }, (_, index) => [index, 48]));
    expect(unexpectedFuseEntries(wire)).toEqual([
      "EnableCookieEncryption=false",
      "EnableEmbeddedAsarIntegrityValidation=false",
      "OnlyLoadAppFromAsar=false",
      "GrantFileProtocolExtraPrivileges=false",
    ]);
  });

  it("verifies fuse wires read and modified by the installed Electron fuses package", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "palot-fuses-"));
    const binary = path.join(directory, "electron");
    try {
      // Electron 44's wire includes WasmTrapHandlers, which Palot leaves unchanged.
      await writeFile(
        binary,
        Buffer.concat([
          Buffer.from("dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX"),
          Buffer.from([1, 9]),
          Buffer.from("000000001"),
        ]),
      );
      await flipFuses(binary, {
        version: FuseVersion.V1,
        [FuseV1Options.EnableCookieEncryption]: true,
        [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
        [FuseV1Options.OnlyLoadAppFromAsar]: true,
        [FuseV1Options.GrantFileProtocolExtraPrivileges]: true,
      });
      expect(unexpectedFuseEntries(await getCurrentFuseWire(binary))).toEqual([]);
      const missingFuse = await getCurrentFuseWire(binary);
      delete missingFuse[FuseV1Options.RunAsNode];
      expect(unexpectedFuseEntries(missingFuse)).toEqual(["RunAsNode=unavailable"]);

      await flipFuses(binary, {
        version: FuseVersion.V1,
        [FuseV1Options.RunAsNode]: true,
      });
      expect(unexpectedFuseEntries(await getCurrentFuseWire(binary))).toEqual(["RunAsNode=true"]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("verifies checksums, manifest, SBOM, and provenance together", async () => {
    const releaseDirectory = await mkdtemp(path.join(tmpdir(), "palot-release-verify-"));
    const buildInfo: PalotReleaseBuildInfo = {
      version: "1.2.3",
      commitSha: "abcdef1234567890",
      buildNumber: "7",
      channel: "stable",
      openCodeContractVersion: "0.0.0-beta-1",
      dirty: false,
    };
    const artifact = path.join(
      releaseDirectory,
      "Palot-1.2.3-stable-abcdef123456-build-7-mac-arm64.zip",
    );
    await writeFile(artifact, "candidate");
    await generateUnsignedReleaseMetadata({ releaseDirectory, buildInfo });

    await expect(
      verifyUnsignedReleaseMetadata(releaseDirectory, buildInfo),
    ).resolves.toBeUndefined();
    await writeFile(artifact, `${await readFile(artifact, "utf8")}tampered`);
    await expect(verifyUnsignedReleaseMetadata(releaseDirectory, buildInfo)).rejects.toThrow(
      "digest mismatch",
    );
  });
});
