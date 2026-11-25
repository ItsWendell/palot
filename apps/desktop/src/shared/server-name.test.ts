import { describe, expect, it } from "vitest";
import { normalizeServerName, serverNameFromHostname, uniqueServerName } from "./server-name";

describe("server names", () => {
  it("keeps plain short names and drops unusable ones", () => {
    expect(normalizeServerName("  Studio \n Mac ")).toBe("Studio Mac");
    expect(normalizeServerName("")).toBeNull();
    expect(normalizeServerName(7)).toBeNull();
    expect(normalizeServerName("a".repeat(81))).toBeNull();
    expect(normalizeServerName("bell\u0007")).toBeNull();
    expect(normalizeServerName("abc\u202Etxt.exe")).toBeNull();
  });

  it("turns a hostname into a friendly default", () => {
    expect(serverNameFromHostname("studio.local")).toBe("studio");
    expect(serverNameFromHostname(undefined)).toBeNull();
  });

  it("avoids names other connections already use", () => {
    expect(uniqueServerName("Box", ["box", "Box (2)"])).toBe("Box (3)");
    expect(uniqueServerName("Box", [])).toBe("Box");
  });
});
