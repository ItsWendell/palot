import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { PalotReleaseBuildInfo } from "../src/shared/release-build-info";
import { artifactIdentity, resolveReleaseBuildInfo } from "./release-build-info";
import {
  assembleRelease,
  assertArtifactSet,
  assertReleaseIdentity,
  stageRelease,
} from "./desktop-release";
import { releasePlan } from "./desktop-release-plan";

const build = resolveReleaseBuildInfo({
  PALOT_COMMIT_SHA: "a".repeat(40),
  PALOT_BUILD_NUMBER: "42",
  PALOT_BUILD_DIRTY: "0",
});
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
async function temporary() {
  const dir = await mkdtemp(path.join(tmpdir(), "palot-desktop-release-"));
  directories.push(dir);
  return dir;
}
function names(target: "linux-x64" | "mac-arm64", identity = build) {
  const prefix = identity.channel === "stable" ? "Palot" : "Palot-Nightly";
  const suffixes =
    target === "linux-x64"
      ? ["linux-x86_64.AppImage", "linux-amd64.deb", "linux-x86_64.rpm", "linux-x64.tar.gz"]
      : ["mac-arm64.dmg", "mac-arm64.zip"];
  return suffixes.map(
    (suffix) => `${prefix}-${identity.version}-${artifactIdentity(identity)}-${suffix}`,
  );
}
async function fixture(root: string, target: "linux-x64" | "mac-arm64", identity = build) {
  const directory = path.join(root, target);
  await mkdir(directory, { recursive: true });
  const artifacts = names(target, identity).map((name) => ({
    name,
    size: 7,
    sha256: createHash("sha256").update("fixture").digest("hex"),
  }));
  for (const artifact of artifacts) await writeFile(path.join(directory, artifact.name), "fixture");
  const files = {
    checksums: "SHA256SUMS",
    sbom: `${target}.cdx.json`,
    provenance: `${target}.intoto.jsonl`,
  };
  await writeFile(
    path.join(directory, files.checksums),
    artifacts.map((item) => `${item.sha256}  ${item.name}\n`).join(""),
  );
  await writeFile(
    path.join(directory, files.sbom),
    JSON.stringify({
      bomFormat: "CycloneDX",
      specVersion: "1.6",
      metadata: { component: { version: identity.version } },
    }),
  );
  await writeFile(
    path.join(directory, files.provenance),
    JSON.stringify({
      subject: artifacts.map((item) => ({ name: item.name, digest: { sha256: item.sha256 } })),
    }),
  );
  const manifest = { unsigned: true, publish: "never", build: identity, files, artifacts };
  await writeFile(path.join(directory, "release-manifest.json"), JSON.stringify(manifest));
  return { directory, manifest };
}

describe("release planning", () => {
  const environment = {
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_REF: "refs/heads/main",
    GITHUB_RUN_NUMBER: "42",
  };
  it("derives one Nightly version for all platforms without publishing by default", () => {
    expect(
      releasePlan({ ...environment, INPUT_CHANNEL: "nightly" }, new Date("2026-09-13T10:20:30Z")),
    ).toEqual({
      channel: "nightly",
      tag: `v${build.version}-nightly.20260913102030.42`,
      publish: false,
    });
  });
  it("requires stable tag and channel agreement", () => {
    expect(() => releasePlan({ ...environment, INPUT_CHANNEL: "stable" })).toThrow(
      "existing version tag",
    );
    expect(() =>
      releasePlan({
        ...environment,
        INPUT_CHANNEL: "stable",
        INPUT_TAG: `v${build.version}-nightly.1`,
      }),
    ).toThrow("requires the nightly channel");
    expect(
      releasePlan({
        ...environment,
        INPUT_CHANNEL: "stable",
        INPUT_TAG: `v${build.version}`,
        INPUT_PUBLISH: "true",
      }).publish,
    ).toBe(true);
  });
  it("rejects a branch dispatch and manually chosen Nightly tag", () => {
    expect(() =>
      releasePlan({ ...environment, GITHUB_REF: "refs/heads/other", INPUT_CHANNEL: "nightly" }),
    ).toThrow("from main");
    expect(() =>
      releasePlan({ ...environment, INPUT_CHANNEL: "nightly", INPUT_TAG: "v0.12.0" }),
    ).toThrow("generated once");
  });
});

describe("complete desktop release", () => {
  it("rejects incomplete sets, duplicate assets, old update feeds and wrong platform", () => {
    const files = names("linux-x64");
    expect(() => assertArtifactSet(files, "linux-x64", build)).not.toThrow();
    for (const invalid of [
      files.slice(1),
      [...files, files[0]!],
      [...files, "latest-linux.yml"],
      names("mac-arm64"),
    ]) {
      expect(() => assertArtifactSet(invalid, "linux-x64", build)).toThrow("artifact set");
    }
  });
  it("rejects local, dirty and mismatched contract builds", () => {
    for (const change of [
      { dirty: true },
      { commitSha: "unknown" },
      { buildNumber: "local" },
      { openCodeContractVersion: "2.0.0" },
    ]) {
      expect(() =>
        assertReleaseIdentity({ ...build, ...change } as PalotReleaseBuildInfo),
      ).toThrow();
    }
  });
  it("stages only verified files rather than leftover maps/debug outputs", async () => {
    const root = await temporary();
    const { directory } = await fixture(root, "linux-x64");
    await writeFile(path.join(directory, "builder-debug.yml"), "private build paths");
    const output = path.join(root, "staged");
    await stageRelease(directory, output, "linux-x64", build);
    expect(await readdir(output)).not.toContain("builder-debug.yml");
  });
  it("requires both targets before writing upload files", async () => {
    const root = await temporary();
    await fixture(root, "linux-x64");
    await expect(assembleRelease(root, path.join(root, "output"), build)).rejects.toThrow(
      "Both qualified",
    );
  });
  it("detects changed bytes and mixed build identities", async () => {
    const root = await temporary();
    const { directory } = await fixture(root, "linux-x64");
    await writeFile(path.join(directory, names("linux-x64")[0]!), "changed");
    await expect(
      stageRelease(directory, path.join(root, "out"), "linux-x64", build),
    ).rejects.toThrow("digest mismatch");
    const other = await fixture(root, "mac-arm64", { ...build, commitSha: "b".repeat(40) });
    await expect(
      stageRelease(other.directory, path.join(root, "out"), "mac-arm64", build),
    ).rejects.toThrow("identity mismatch");
  });
  it("rejects evidence paths escaping the candidate directory", async () => {
    const root = await temporary();
    const { directory, manifest } = await fixture(root, "linux-x64");
    manifest.files.sbom = "../outside.cdx.json";
    await writeFile(path.join(directory, "release-manifest.json"), JSON.stringify(manifest));
    await expect(
      stageRelease(directory, path.join(root, "out"), "linux-x64", build),
    ).rejects.toThrow("Unsafe release file");
  });
  it("assembles unique metadata and checksums every published file", async () => {
    const root = await temporary();
    const input = path.join(root, "input");
    await fixture(input, "linux-x64");
    await fixture(input, "mac-arm64");
    const output = path.join(root, "output");
    await assembleRelease(input, output, build);
    const entries = await readdir(output);
    const checksums = await readFile(path.join(output, "SHA256SUMS"), "utf8");
    for (const file of entries.filter((name) => name !== "SHA256SUMS")) {
      const sha = createHash("sha256")
        .update(await readFile(path.join(output, file)))
        .digest("hex");
      expect(checksums).toContain(`${sha}  ${file}\n`);
    }
    const manifest = JSON.parse(
      await readFile(path.join(output, "mac-arm64-release-manifest.json"), "utf8"),
    );
    expect(manifest.files.checksums).toBe("mac-arm64-SHA256SUMS");
    expect(entries).not.toContain("latest.yml");
  });
});
