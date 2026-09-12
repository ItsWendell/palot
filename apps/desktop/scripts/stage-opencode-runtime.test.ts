// @vitest-environment node

import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { stageOpenCodeRuntime } from "./stage-opencode-runtime";

const mocks = vi.hoisted(() => ({
  execFile: vi.fn(),
  readFile: vi.fn(),
  copyFile: vi.fn(),
  rename: vi.fn(),
  manifest: {
    architecture: "x64",
    binarySha256: "",
    sourceSha256: "",
    packageName: "@opencode/cli-linux-x64-baseline",
    version: "2.0.2",
  },
}));

vi.mock("node:child_process", () => ({ execFile: mocks.execFile }));
vi.mock("node:fs/promises", () => ({
  chmod: vi.fn(),
  copyFile: mocks.copyFile,
  mkdir: vi.fn(),
  mkdtemp: vi.fn().mockResolvedValue("/tmp/opencode/staging-test"),
  readFile: mocks.readFile,
  rename: mocks.rename,
  rm: vi.fn(),
  writeFile: vi.fn(),
}));
vi.mock("../src/main/opencode-runtime-release", () => ({
  bundledOpenCodeRuntime: () => mocks.manifest,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.execFile.mockImplementation((_command, _args, options, callback) => {
    const done = typeof options === "function" ? options : callback;
    done(null, { stdout: "runtime.tgz\n" });
  });
  const binary = Buffer.alloc(64);
  binary.write("\x7fELF");
  binary[4] = 2;
  binary[5] = 1;
  binary.writeUInt16LE(62, 18);
  mocks.manifest.sourceSha256 = createHash("sha256").update(binary).digest("hex");
  mocks.manifest.binarySha256 = mocks.manifest.sourceSha256;
  mocks.readFile.mockImplementation(async (file: string) => {
    if (file.endsWith("package.json")) {
      return JSON.stringify({ name: mocks.manifest.packageName, version: mocks.manifest.version });
    }
    if (file.endsWith("/package/bin/opencode")) return binary;
    throw new Error(`Unexpected source file: ${file}`);
  });
});

describe("OpenCode runtime staging", () => {
  it("verifies the renamed npm executable and retains Palot's opencode2 destination", async () => {
    const destination = await stageOpenCodeRuntime("x64", "linux");
    expect(mocks.copyFile).toHaveBeenCalledWith(
      "/tmp/opencode/staging-test/extracted/package/bin/opencode",
      `${destination}.pending-${process.pid}/opencode2`,
    );
    expect(mocks.rename).toHaveBeenCalledWith(`${destination}.pending-${process.pid}`, destination);
  });

  it("rejects a corrupt executable before replacing staged resources", async () => {
    mocks.manifest.sourceSha256 = "0".repeat(64);
    await expect(stageOpenCodeRuntime("x64", "linux")).rejects.toThrow("source SHA-256 mismatch");
    expect(mocks.copyFile).not.toHaveBeenCalled();
    expect(mocks.rename).not.toHaveBeenCalled();
  });

  it("rejects an executable for the wrong architecture", async () => {
    await expect(stageOpenCodeRuntime("arm64", "linux")).rejects.toThrow(
      "not a Linux arm64 ELF executable",
    );
    expect(mocks.rename).not.toHaveBeenCalled();
  });
});
