import { describe, expect, it } from "vitest";
import {
  formatMachinePath,
  isMachineName,
  machinesInPaths,
  parseMachinePath,
  stripLocalPrefix,
} from "./machine-path";

describe("machine paths", () => {
  it("reads absolute and home paths on a named machine", () => {
    expect(parseMachinePath("devbox:/srv/app/a.ts")).toEqual({
      machine: "devbox",
      path: "/srv/app/a.ts",
    });
    expect(parseMachinePath("gpu-2:~/notes.md")).toEqual({ machine: "gpu-2", path: "~/notes.md" });
    expect(parseMachinePath("gpu:~")).toEqual({ machine: "gpu", path: "~" });
    expect(formatMachinePath({ machine: "gpu", path: "/w" })).toBe("gpu:/w");
  });

  it("never reads Windows drives as machines", () => {
    expect(parseMachinePath("C:\\Users\\me\\a.ts")).toBeNull();
    expect(parseMachinePath("C:/Users/me/a.ts")).toBeNull();
    expect(parseMachinePath("c:/Users/me/a.ts")).toBeNull();
  });

  it("never reads URLs, unrooted text, workspaces or local as machines", () => {
    expect(parseMachinePath("https://example.com/a")).toBeNull();
    expect(parseMachinePath("skill://review/SKILL.md")).toBeNull();
    expect(parseMachinePath("mailto:me@example.com")).toBeNull();
    expect(parseMachinePath("gpu:work/a.ts")).toBeNull();
    expect(parseMachinePath("wrk_01abc:/workspace/a")).toBeNull();
    expect(parseMachinePath("local:/srv/a")).toBeNull();
    expect(parseMachinePath("Devbox:/a")).toBeNull();
    expect(parseMachinePath("/plain/path")).toBeNull();
    expect(parseMachinePath(":/a")).toBeNull();
  });

  it("strips local: from the server's own paths", () => {
    expect(stripLocalPrefix("local:/srv/a.ts")).toBe("/srv/a.ts");
    expect(stripLocalPrefix("local:~/a.ts")).toBe("~/a.ts");
    expect(stripLocalPrefix("local:C:\\repo\\a.ts")).toBe("C:\\repo\\a.ts");
    expect(stripLocalPrefix("local:relative")).toBe("local:relative");
    expect(stripLocalPrefix("devbox:/a")).toBe("devbox:/a");
  });

  it("follows OpenCode's machine name rule", () => {
    expect(isMachineName("devbox")).toBe(true);
    expect(isMachineName("a")).toBe(false);
    expect(isMachineName("local")).toBe(false);
    expect(isMachineName("9box")).toBe(false);
    expect(isMachineName("dev_box")).toBe(false);
    expect(isMachineName(`a${"b".repeat(63)}`)).toBe(false);
  });

  it("lists the machines a set of paths names once each", () => {
    expect(machinesInPaths(["gpu:/a", "/local", null, "devbox:~/b", "gpu:/c"])).toEqual([
      "gpu",
      "devbox",
    ]);
  });
});
