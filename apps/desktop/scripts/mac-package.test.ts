import { describe, expect, it } from "vitest";
import { resolveMacPackageTarget } from "./mac-package";

describe("resolveMacPackageTarget", () => {
  it("selects the Apple Silicon package output", () => {
    expect(resolveMacPackageTarget("arm64")).toEqual({
      architecture: "arm64",
      machoArchitecture: "arm64",
      builderArgument: "--arm64",
      releaseDirectory: "mac-arm64",
    });
  });

  it("selects the Intel package output", () => {
    expect(resolveMacPackageTarget("x64")).toEqual({
      architecture: "x64",
      machoArchitecture: "x86_64",
      builderArgument: "--x64",
      releaseDirectory: "mac",
    });
  });

  it("rejects unsupported host architectures", () => {
    expect(() => resolveMacPackageTarget("ia32")).toThrow("Unsupported macOS architecture");
  });
});
