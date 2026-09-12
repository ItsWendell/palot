import path from "node:path";
import { describe, expect, it } from "vitest";
import { mergePath, parseShellEnvironment } from "./shell-environment";

describe("shell environment", () => {
  it("parses null-delimited values without splitting embedded equals signs", () => {
    expect(parseShellEnvironment(Buffer.from("PATH=/opt/homebrew/bin\0TOKEN=a=b\0\0"))).toEqual({
      PATH: "/opt/homebrew/bin",
      TOKEN: "a=b",
    });
  });

  it("prefers shell paths while preserving unique app paths", () => {
    expect(
      mergePath(
        ["/opt/homebrew/bin", "/usr/bin"].join(path.delimiter),
        ["/usr/bin", "/bin"].join(path.delimiter),
      ),
    ).toBe(["/opt/homebrew/bin", "/usr/bin", "/bin"].join(path.delimiter));
  });
});
