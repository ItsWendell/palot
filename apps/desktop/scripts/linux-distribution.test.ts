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
  verifyInstalledLinuxDesktopEntry,
  verifyLinuxArtifact,
  verifyLinuxPackageMetadata,
  verifyLinuxRpmDirectoryOwnership,
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

describe("installed desktop entry validation", () => {
  function desktop(channel: "stable" | "nightly") {
    const identity = linuxDistributionIdentity(channel);
    return `[Desktop Entry]
Name=${identity.productName}
Exec="${identity.installDirectory}/${identity.executable}" %U
StartupWMClass=${identity.appId}
Actions=NewTask;

[Desktop Action NewTask]
Name=New Task
Exec=${identity.executable} --new-task
`;
  }

  it.each(["stable", "nightly"] as const)("accepts the %s desktop action", (channel) => {
    expect(() => verifyInstalledLinuxDesktopEntry(desktop(channel), channel)).not.toThrow();
  });

  it("rejects the undeclared action shipped in the candidate RPM", () => {
    expect(() =>
      verifyInstalledLinuxDesktopEntry(
        desktop("nightly").replace("Actions=NewTask;\n", ""),
        "nightly",
      ),
    ).toThrow("must declare Actions=NewTask;");
  });

  it("does not accept an action declaration in the wrong group", () => {
    const entry = desktop("nightly").replace("Actions=NewTask;\n", "") + "Actions=NewTask;\n";
    expect(() => verifyInstalledLinuxDesktopEntry(entry, "nightly")).toThrow(
      "must declare Actions",
    );
  });

  it("rejects a declared action without its command", () => {
    const entry = desktop("nightly").replace("Exec=palot-nightly --new-task", "");
    expect(() => verifyInstalledLinuxDesktopEntry(entry, "nightly")).toThrow(
      "NewTask desktop action",
    );
  });

  it("rejects a cross-channel action even when the main entry is correct", () => {
    const entry = desktop("nightly").replace(
      "Exec=palot-nightly --new-task",
      "Exec=palot --new-task",
    );
    expect(() => verifyInstalledLinuxDesktopEntry(entry, "nightly")).toThrow(
      "NewTask desktop action",
    );
  });

  it("rejects a cross-channel main executable despite a correct action", () => {
    const entry = desktop("nightly").replace(
      'Exec="/opt/Palot Nightly/palot-nightly"',
      'Exec="/opt/Palot/palot"',
    );
    expect(() => verifyInstalledLinuxDesktopEntry(entry, "nightly")).toThrow(
      "wrong channel identity",
    );
  });

  it("rejects a sandbox bypass", () => {
    const entry = desktop("nightly").replace(" %U", " --no-sandbox %U");
    expect(() => verifyInstalledLinuxDesktopEntry(entry, "nightly")).toThrow(
      "disables Chromium sandboxing",
    );
  });
});

describe("RPM directory ownership", () => {
  function metadata(channel: "stable" | "nightly") {
    const { installDirectory, executable } = linuxDistributionIdentity(channel);
    return [
      `drwxr-xr-x\t${installDirectory}`,
      `-rwxr-xr-x\t${installDirectory}/${executable}`,
      `drwxr-xr-x\t${installDirectory}/resources`,
      `-rw-r--r--\t${installDirectory}/resources/app.asar`,
    ].join("\n");
  }

  it.each(["stable", "nightly"] as const)("accepts complete %s directory ownership", (channel) => {
    expect(() => verifyLinuxRpmDirectoryOwnership(metadata(channel), channel)).not.toThrow();
  });

  it("rejects a file-only RPM manifest that would leave directories behind", () => {
    const files = metadata("nightly")
      .split("\n")
      .filter((line) => !line.startsWith("d"))
      .join("\n");
    expect(() => verifyLinuxRpmDirectoryOwnership(files, "nightly")).toThrow(
      "RPM must own its application directory: /opt/Palot Nightly",
    );
  });

  it("requires intermediate directory ownership, not only the install root", () => {
    const files = metadata("nightly").replace("drwxr-xr-x\t/opt/Palot Nightly/resources\n", "");
    expect(() => verifyLinuxRpmDirectoryOwnership(files, "nightly")).toThrow(
      "RPM must own its application directory: /opt/Palot Nightly/resources",
    );
  });

  it("requires parent ownership for an empty nested directory too", () => {
    const files = `${metadata("nightly")}\ndrwxr-xr-x\t/opt/Palot Nightly/cache/empty`;
    expect(() => verifyLinuxRpmDirectoryOwnership(files, "nightly")).toThrow(
      "RPM must own its application directory: /opt/Palot Nightly/cache",
    );
  });

  it("does not accept a symlink in place of an owned directory", () => {
    const files = metadata("nightly").replace(
      "drwxr-xr-x\t/opt/Palot Nightly/resources",
      "lrwxrwxrwx\t/opt/Palot Nightly/resources",
    );
    expect(() => verifyLinuxRpmDirectoryOwnership(files, "nightly")).toThrow(
      "must own its application directory",
    );
  });

  it("rejects ownership of the other channel's app tree", () => {
    expect(() =>
      verifyLinuxRpmDirectoryOwnership(`${metadata("nightly")}\n${metadata("stable")}`, "nightly"),
    ).toThrow("must not own the other channel's installation");
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
