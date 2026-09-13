// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { discoverSelectedOpenCodeBinary } from "./opencode-runtime-selection";

const mocks = vi.hoisted(() => ({
  installed: vi.fn(),
  prepared: vi.fn(),
  policy: vi.fn(),
  bundled: vi.fn(),
}));
vi.mock("./opencode-local-installations", () => ({
  getOpenCodeInstallations: () => ({ discoverPreferredBinary: mocks.installed }),
}));
vi.mock("./opencode-release-manager", () => ({
  getOpenCodeReleaseManager: () => ({ discoverPreparedBinary: mocks.prepared }),
}));
vi.mock("./opencode-runtime-release", () => ({
  readExternalOpenCodeRuntimePolicy: mocks.policy,
  verifyBundledOpenCodeBinary: mocks.bundled,
}));
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("process", { ...process, resourcesPath: "/palot/resources" });
  mocks.installed.mockResolvedValue(null);
  mocks.prepared.mockResolvedValue(null);
  mocks.policy.mockReturnValue({ schemaVersion: 1, bundled: false });
});
afterEach(() => vi.unstubAllGlobals());

describe("OpenCode runtime source selection", () => {
  it("prefers the user's installed CLI over a prepared download", async () => {
    const installed = { path: "/user/opencode", version: "2.0.2" };
    mocks.installed.mockResolvedValue(installed);
    expect(await discoverSelectedOpenCodeBinary()).toEqual(installed);
    expect(mocks.prepared).not.toHaveBeenCalled();
    expect(mocks.bundled).not.toHaveBeenCalled();
  });
  it("uses an explicitly prepared verified runtime when installed selection returns none", async () => {
    const prepared = { path: "/cache/verified-opencode", version: "2.0.2" };
    mocks.prepared.mockResolvedValue(prepared);
    expect(await discoverSelectedOpenCodeBinary({ exactVersion: "2.0.2" })).toEqual(prepared);
    expect(mocks.installed).toHaveBeenCalledWith({ exactVersion: "2.0.2" });
    expect(mocks.bundled).not.toHaveBeenCalled();
  });
  it("returns no runtime for intentional absence without invoking bundle verification", async () => {
    expect(await discoverSelectedOpenCodeBinary()).toBeNull();
    expect(mocks.bundled).not.toHaveBeenCalled();
  });
  it("still fails bundle verification when policy is missing", async () => {
    mocks.policy.mockReturnValue(null);
    mocks.bundled.mockRejectedValue(new Error("missing manifest"));
    await expect(discoverSelectedOpenCodeBinary()).rejects.toThrow("verification failed");
  });
  it("does not silently bypass an invalid explicit installed selection", async () => {
    mocks.installed.mockRejectedValue(new Error("Invalid OPENCODE_BIN override"));
    await expect(discoverSelectedOpenCodeBinary()).rejects.toThrow("OPENCODE_BIN");
    expect(mocks.prepared).not.toHaveBeenCalled();
  });
  it("refuses a nonmatching prepared SSH runtime without falling back or acquiring another", async () => {
    mocks.prepared.mockResolvedValue({ path: "/cache/verified-opencode", version: "2.1.0" });
    await expect(discoverSelectedOpenCodeBinary({ exactVersion: "2.0.2" })).rejects.toThrow(
      "SSH authentication requires OpenCode 2.0.2",
    );
    expect(mocks.bundled).not.toHaveBeenCalled();
  });
});
