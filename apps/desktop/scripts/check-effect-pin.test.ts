import { describe, expect, it } from "vitest";
import { effectPinProblems, lockedVersions } from "./check-effect-pin";

const aligned = {
  protocolEffect: "4.1.0",
  declared: {
    "apps/desktop/package.json: effect": "4.1.0",
    "apps/desktop/package.json: @effect/platform-node": "4.1.0",
    "packages/opencode-voice-coordinator/package.json: effect": "4.1.0",
  },
  lockedEffect: ["4.1.0"],
};

describe("effect pin", () => {
  it("accepts manifests and a lockfile that match the protocol's Effect version", () => {
    expect(effectPinProblems(aligned)).toEqual([]);
  });

  it("reports a manifest that drifts or stops declaring the package", () => {
    expect(
      effectPinProblems({
        ...aligned,
        declared: {
          ...aligned.declared,
          "apps/desktop/package.json: @effect/platform-node": "4.2.0",
          "packages/opencode-voice-coordinator/package.json: effect": undefined,
        },
      }),
    ).toEqual([
      "apps/desktop/package.json: @effect/platform-node is 4.2.0, expected 4.1.0",
      "packages/opencode-voice-coordinator/package.json: effect is missing, expected 4.1.0",
    ]);
  });

  it("reports a second or different locked effect copy", () => {
    expect(effectPinProblems({ ...aligned, lockedEffect: ["4.1.0", "4.2.0"] })).toEqual([
      "bun.lock resolves effect 4.1.0, 4.2.0, expected only 4.1.0",
    ]);
    expect(effectPinProblems({ ...aligned, lockedEffect: ["4.2.0"] })).toEqual([
      "bun.lock resolves effect 4.2.0, expected only 4.1.0",
    ]);
  });

  it("requires the protocol to declare an exact version", () => {
    expect(effectPinProblems({ ...aligned, protocolEffect: "^4.1.0" })).toEqual([
      "@opencode/protocol must depend on an exact effect version (found ^4.1.0)",
    ]);
  });
});

describe("lockedVersions", () => {
  it("finds top-level and nested copies but not dependency ranges or similar names", () => {
    const lockfile = [
      "{",
      '  "packages": {',
      '    "effect": ["effect@4.1.0", "", {}, "sha512-a"],',
      "",
      '    "@effect/platform-node": ["@effect/platform-node@4.1.0", "", { "dependencies": { "effect": "4.1.0" } }, "sha512-b"],',
      "",
      '    "some-tool/effect": ["effect@3.19.0", "", {}, "sha512-c"],',
      "",
      '    "effect-extra": ["effect-extra@1.0.0", "", {}, "sha512-d"],',
      "  }",
      "}",
    ].join("\n");
    expect(lockedVersions(lockfile, "effect")).toEqual(["4.1.0", "3.19.0"]);
  });
});
