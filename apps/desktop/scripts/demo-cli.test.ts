// @vitest-environment node

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseDemoArgs } from "./demo-cli";

describe("demo CLI", () => {
  it("opens the isolated demo for visible inspection by default", () => {
    expect(parseDemoArgs([])).toEqual({
      help: false,
      e2eArgs: ["demo-workspace", "--visible", "--inspect"],
    });
  });

  it("runs smoke hidden without inspection and optionally retains artifacts", () => {
    expect(parseDemoArgs(["--smoke"]).e2eArgs).toEqual(["demo-workspace"]);
    expect(parseDemoArgs(["--", "--smoke", "--keep"]).e2eArgs).toEqual([
      "demo-workspace",
      "--keep",
    ]);
    expect(parseDemoArgs(["--keep"]).e2eArgs).toEqual([
      "demo-workspace",
      "--visible",
      "--inspect",
      "--keep",
    ]);
  });

  it.each([
    ["--executable", "/tmp/app"],
    ["--visible"],
    ["--showcase"],
    ["other-scenario"],
    ["--smoke=false"],
    ["--help", "--invalid"],
    ["--", "--", "--keep"],
  ])("rejects unsupported arguments %j", (...args) => {
    expect(() => parseDemoArgs(args)).toThrow();
  });

  it("prints help or actionable errors from Node without loading the E2E runner", () => {
    const entrypoint = fileURLToPath(new URL("./demo.ts", import.meta.url));
    const run = (args: string[]) =>
      spawnSync("node", ["--experimental-strip-types", entrypoint, ...args], {
        encoding: "utf8",
        timeout: 10_000,
      });
    const help = run(["--help"]);
    expect(help.status).toBe(0);
    expect(help.stdout).toContain("Usage: bun run demo");
    expect(help.stdout).toContain("Examples:");
    const invalid = run(["--executable", "/tmp/app"]);
    expect(invalid.status).toBe(1);
    expect(invalid.stderr).toContain("Palot demo:");
    expect(invalid.stderr).toContain("Use --help for examples.");
  });
});
