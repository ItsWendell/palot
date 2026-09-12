import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { builtinCodeThemes } from "./builtin-code-themes";
import { builtinSyntaxThemes } from "./syntax-data";

describe("built-in syntax data", () => {
  it("preserves every shipped scope, token, workbench color, and theme ID", () => {
    // Independent fingerprint captured before moving the data into this directory.
    // This compatibility-sensitive payload must not silently become a substitute
    // package theme with the same name.
    expect(createHash("sha256").update(JSON.stringify(builtinSyntaxThemes)).digest("hex")).toBe(
      "8295bd9a6eed712942063e3a5b0dc351fcebaa35cbe3b87523e568817c010771",
    );
  });

  it("makes every local syntax payload available through the built-in loader registry", async () => {
    for (const [name, expected] of Object.entries(builtinSyntaxThemes)) {
      const descriptor = builtinCodeThemes.find((theme) => theme.name === name);
      expect(descriptor, name).toBeDefined();
      expect(await descriptor!.load()).toEqual(expected);
    }
    expect(new Set(builtinCodeThemes.map((theme) => theme.name)).size).toBe(
      builtinCodeThemes.length,
    );
  });
});
