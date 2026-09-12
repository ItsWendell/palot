import { describe, expect, it } from "vitest";
import { configFormatters, configLanguageServers, optionalFiniteNumber } from "./opencode-config";

describe("OpenCode config projection", () => {
  it("maps non-finite form bounds to unbounded values", () => {
    expect(optionalFiniteNumber("Infinity")).toBeNull();
    expect(optionalFiniteNumber("-Infinity")).toBeNull();
    expect(optionalFiniteNumber("NaN")).toBeNull();
    expect(optionalFiniteNumber(12)).toBe(12);
  });

  it("exposes formatter and LSP inventory without secret-bearing values", () => {
    expect(
      configFormatters({
        prettier: {
          command: ["prettier", "--write", "$FILE"],
          environment: { FORMATTER_TOKEN: "secret" },
          extensions: [".ts", ".tsx"],
        },
      }),
    ).toEqual([
      {
        id: "prettier",
        disabled: false,
        executable: "prettier",
        argumentCount: 2,
        extensions: [".ts", ".tsx"],
        environmentVariables: ["FORMATTER_TOKEN"],
      },
    ]);
    expect(
      configLanguageServers({
        typescript: {
          command: ["typescript-language-server", "--stdio"],
          env: { LSP_TOKEN: "secret" },
          initialization: { preferences: { secret: true } },
        },
      }),
    ).toEqual([
      {
        id: "typescript",
        disabled: false,
        executable: "typescript-language-server",
        argumentCount: 1,
        extensions: [],
        environmentVariables: ["LSP_TOKEN"],
        initializationKeys: ["preferences"],
      },
    ]);
  });
});
