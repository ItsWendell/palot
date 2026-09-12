// @vitest-environment node

import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { bundledOpenCodeRuntime, verifyBundledOpenCodeBinary } from "./opencode-runtime-release";
import { SUPPORTED_OPENCODE_VERSION } from "./opencode-version";

describe("bundled OpenCode runtime release", () => {
  it.each([
    ["darwin", "arm64"],
    ["darwin", "x64"],
    ["linux", "arm64"],
    ["linux", "x64"],
  ] as const)(
    "selects the reviewed %s %s runtime for the declared contract",
    (platform, architecture) => {
      const manifest = bundledOpenCodeRuntime(architecture, platform);
      expect(manifest.version).toBe(SUPPORTED_OPENCODE_VERSION);
      expect(manifest.architecture).toBe(architecture);
      expect(manifest.packageName).toBe(
        `@opencode/cli-${platform}-${architecture}${architecture === "x64" ? "-baseline" : ""}`,
      );
      if (platform === "linux") expect(manifest.binarySha256).toBe(manifest.sourceSha256);
      else expect(manifest.binarySha256).not.toBe(manifest.sourceSha256);
    },
  );

  it("rejects architectures without a staged release", () => {
    expect(() => bundledOpenCodeRuntime("ia32")).toThrow(
      "Unsupported bundled OpenCode architecture",
    );
  });

  it("rejects missing, incompatible, and corrupt staged resources before execution", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "palot-runtime-test-"));
    const expected = bundledOpenCodeRuntime("arm64", "linux");
    try {
      await expect(
        verifyBundledOpenCodeBinary({ directory, architecture: "arm64", expected }),
      ).rejects.toThrow();

      await writeFile(
        path.join(directory, "manifest.json"),
        JSON.stringify({ ...expected, version: "0.0.0-beta-1" }),
      );
      await expect(
        verifyBundledOpenCodeBinary({ directory, architecture: "arm64", expected }),
      ).rejects.toThrow("manifest does not match");

      await writeFile(path.join(directory, "manifest.json"), JSON.stringify(expected));
      await writeFile(path.join(directory, "opencode2"), "corrupt runtime");
      await chmod(path.join(directory, "opencode2"), 0o755);
      await expect(
        verifyBundledOpenCodeBinary({ directory, architecture: "arm64", expected }),
      ).rejects.toThrow("SHA-256");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
