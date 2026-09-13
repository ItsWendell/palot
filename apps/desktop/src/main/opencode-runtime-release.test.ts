// @vitest-environment node

import { chmod, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  bundledOpenCodeRuntime,
  readExternalOpenCodeRuntimePolicy,
  verifyBundledOpenCodeBinary,
} from "./opencode-runtime-release";
import { SUPPORTED_OPENCODE_VERSION } from "./opencode-version";

describe("bundled OpenCode runtime release", () => {
  it("distinguishes intentional bundle absence from missing or malformed policy", async () => {
    const directory = await mkdtemp("/tmp/opencode/runtime-policy-");
    const file = path.join(directory, "policy.json");
    try {
      expect(readExternalOpenCodeRuntimePolicy(directory)).toBeNull();
      for (const content of [
        "{",
        "null",
        "[]",
        '{"schemaVersion":1}',
        '{"schemaVersion":2,"bundled":false}',
        '{"schemaVersion":1,"bundled":true}',
        '{"schemaVersion":1,"bundled":false,"extra":true}',
      ]) {
        await writeFile(file, content);
        expect(() => readExternalOpenCodeRuntimePolicy(directory)).toThrow();
      }
      await writeFile(file, '{"schemaVersion":1,"bundled":false}');
      expect(readExternalOpenCodeRuntimePolicy(directory)).toEqual({
        schemaVersion: 1,
        bundled: false,
      });
      for (const resource of ["manifest.json", "opencode2", "opencode"]) {
        await writeFile(path.join(directory, resource), "stale runtime");
        expect(() => readExternalOpenCodeRuntimePolicy(directory)).toThrow("must not ship");
        await rm(path.join(directory, resource));
      }
      await rm(file);
      await symlink(path.join(directory, "missing"), file);
      expect(() => readExternalOpenCodeRuntimePolicy(directory)).toThrow("policy file");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
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
