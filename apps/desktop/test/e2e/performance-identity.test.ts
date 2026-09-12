// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", () => ({ execFileSync: vi.fn() }));
import { execFileSync } from "node:child_process";
import { capturePerformanceIdentity } from "./performance-identity";

describe("performance identity", () => {
  it("captures declared versions and safe host/source context without file names or unrelated env", () => {
    vi.stubEnv("PALOT_E2E_SCENARIO", "test-performance");
    vi.stubEnv("SECRET_TOKEN", "must-not-appear");
    vi.mocked(execFileSync).mockImplementation((_binary, args) => {
      if (args?.[0] === "status") return " M private-secret-file.txt\n";
      if (args?.[0] === "rev-parse") return "abc123\n";
      return "1.3.9\n";
    });
    try {
      const identity = capturePerformanceIdentity();
      expect(identity.source).toEqual({ revision: "abc123", dirty: true });
      expect(identity.scenario).toBe("test-performance");
      expect(identity.declaredVersions.react).toMatch(/^\d+\./);
      expect(identity.host.logicalCores).toBeGreaterThan(0);
      expect(JSON.stringify(identity)).not.toContain("private-secret-file");
      expect(JSON.stringify(identity)).not.toContain("must-not-appear");
      expect(vi.mocked(execFileSync).mock.calls[0]?.[2]).toMatchObject({
        timeout: 2_000,
        env: { GIT_OPTIONAL_LOCKS: "0" },
      });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("reports inaccessible git state explicitly, not as clean", () => {
    vi.mocked(execFileSync).mockImplementation(() => {
      throw new Error("unavailable");
    });
    const identity = capturePerformanceIdentity();
    expect(identity.source).toEqual({ revision: null, dirty: null });
  });
});
