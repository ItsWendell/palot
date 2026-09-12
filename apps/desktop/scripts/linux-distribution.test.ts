import { execFileSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createPackage } from "@electron/asar";
import { afterEach, describe, expect, it } from "vitest";
import {
  linuxArtifactFormat,
  linuxDistributionIdentity,
  linuxInstallSmokePlan,
  verifyLinuxArtifact,
  verifyLinuxPackageMetadata,
} from "./linux-distribution";

const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(
    temporary.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("Linux distribution identities", () => {
  it("keeps package manager, executable, install path and desktop ownership disjoint", () => {
    const stable = linuxDistributionIdentity("stable");
    const nightly = linuxDistributionIdentity("nightly");
    for (const key of [
      "packageName",
      "executable",
      "installDirectory",
      "desktopName",
      "appId",
    ] as const) {
      expect(stable[key]).not.toBe(nightly[key]);
    }
    expect(() =>
      verifyLinuxPackageMetadata(
        { name: "@palot/desktop", palotBuild: { channel: "nightly" } },
        "nightly",
      ),
    ).toThrow("Packaged identity");
    expect(() =>
      verifyLinuxPackageMetadata(
        { name: nightly.packageName, palotBuild: { channel: "stable" } },
        "nightly",
      ),
    ).toThrow("Packaged identity");
    expect(() =>
      verifyLinuxPackageMetadata(
        { name: nightly.packageName, palotBuild: { channel: "nightly" } },
        "nightly",
      ),
    ).not.toThrow();
  });

  it.each(["deb", "rpm", "tar.gz", "AppImage"])("recognizes %s actual artifacts", (format) => {
    expect(linuxArtifactFormat(`Palot Nightly.${format}`)).toBe(format);
  });

  it("rejects unpacked directories and evidence files as artifacts", () => {
    expect(() => linuxArtifactFormat("linux-unpacked")).toThrow("Unsupported");
    expect(() => linuxArtifactFormat("release-manifest.json")).toThrow("Unsupported");
  });
});

describe("disposable installation smoke plan", () => {
  it.each(["deb", "rpm"])(
    "generates a syntactically valid guarded %s plan without executing it",
    async (format) => {
      const directory = await mkdtemp(path.join(tmpdir(), "palot-smoke-plan-"));
      temporary.push(directory);
      const script = path.join(directory, "smoke.sh");
      const plan = linuxInstallSmokePlan(`stable's package.${format}`, `nightly.${format}`);
      await writeFile(script, plan);
      execFileSync("bash", ["-n", script]);
      // Without explicit disposable-VM consent it must fail before checking or installing packages.
      expect(() =>
        execFileSync("bash", [script], {
          env: { ...process.env, PALOT_DISPOSABLE_LINUX_VM: "" },
          stdio: "pipe",
        }),
      ).toThrow();
      expect(plan).not.toContain("--no-sandbox");
      expect(plan).not.toContain("--disable-setuid-sandbox");
    },
  );

  it("refuses mismatched formats and portable archives", () => {
    expect(() => linuxInstallSmokePlan("stable.deb", "nightly.rpm")).toThrow("pair");
    expect(() => linuxInstallSmokePlan("stable.tar.gz", "nightly.tar.gz")).toThrow("pair");
  });
});

describe.skipIf(process.platform !== "linux")("real archive verification", () => {
  it("extracts the actual tar artifact and detects a cross-channel payload", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "palot-artifact-test-"));
    temporary.push(directory);
    const source = path.join(directory, "source");
    const payload = path.join(directory, "payload/Palot Nightly");
    for (const entry of [
      "out/main/index.js",
      "out/preload/index.cjs",
      "out/renderer/index.html",
      "package.json",
    ]) {
      await mkdir(path.dirname(path.join(source, entry)), { recursive: true });
      await writeFile(
        path.join(source, entry),
        entry === "package.json"
          ? JSON.stringify({ name: "palot", palotBuild: { channel: "stable" } })
          : "fixture",
      );
    }
    await mkdir(path.join(payload, "resources"), { recursive: true });
    await createPackage(source, path.join(payload, "resources/app.asar"));
    for (const executable of ["palot-nightly", "chrome-sandbox"]) {
      await writeFile(path.join(payload, executable), "fixture");
      await chmod(path.join(payload, executable), 0o755);
    }
    const artifact = path.join(directory, "nightly.tar.gz");
    execFileSync("tar", ["-czf", artifact, "-C", path.dirname(payload), "."]);
    await expect(verifyLinuxArtifact(artifact, "nightly")).rejects.toThrow(
      "Packaged identity must be palot-nightly",
    );
  });
});
