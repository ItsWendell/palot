import { describe, expect, it } from "vitest";
import {
  buildAllowsOpenCodeVersionMismatch,
  canContinueOpenCodeVersionMismatch,
  isSupportedOpenCodeVersion,
  isTestedOpenCodeVersion,
  parseOpenCodeVersionOutput,
  shouldReuseOpenCodeService,
  supportedOpenCodeVersionLabel,
} from "./opencode-version";

describe("OpenCode service compatibility", () => {
  it("recognizes the actual stable native CLI banner and older preview output", () => {
    expect(parseOpenCodeVersionOutput("opencode v2.0.2\n")).toBe("2.0.2");
    expect(parseOpenCodeVersionOutput("0.0.0-beta-19507\n")).toBe("0.0.0-beta-19507");
    expect(parseOpenCodeVersionOutput("please install 2.0.2")).toBeNull();
    expect(parseOpenCodeVersionOutput("opencode v2.0.2\nerror")).toBeNull();
  });
  it("accepts the stable baseline and the contract-reviewed beta", () => {
    expect(isSupportedOpenCodeVersion("2.0.3")).toBe(true);
    expect(isSupportedOpenCodeVersion("0.0.0-beta-19507")).toBe(true);
  });

  it("accepts stable V2 additions without pretending every release was tested", () => {
    for (const version of ["2.0.0", "2.0.1", "2.0.2", "2.1.0", "2.99.123"]) {
      expect(isSupportedOpenCodeVersion(version)).toBe(true);
      expect(shouldReuseOpenCodeService(version)).toBe(true);
      expect(isTestedOpenCodeVersion(version)).toBe(false);
    }
    for (const version of ["2.1.0-beta.1", "3.0.0", "1.99.0", "2.01.0", "2.0.2\n"]) {
      expect(isSupportedOpenCodeVersion(version)).toBe(false);
    }
  });

  it("offers explicit compatibility mode for untested V2 stable and beta builds", () => {
    expect(canContinueOpenCodeVersionMismatch("2.0.1")).toBe(true);
    expect(canContinueOpenCodeVersionMismatch("2.1.0-beta.1")).toBe(true);
    expect(canContinueOpenCodeVersionMismatch("3.0.0")).toBe(false);
    expect(canContinueOpenCodeVersionMismatch("2.0.2-dev.1")).toBe(false);
    expect(canContinueOpenCodeVersionMismatch("v2.0.2")).toBe(false);
    expect(canContinueOpenCodeVersionMismatch("2.0.2\n")).toBe(false);
    expect(canContinueOpenCodeVersionMismatch("0.0.0-beta-17794")).toBe(true);
    expect(canContinueOpenCodeVersionMismatch("0.0.0-dev-17794")).toBe(false);
    expect(canContinueOpenCodeVersionMismatch("1.18.18")).toBe(false);
  });

  it("offers compatibility mode in nightly and beta builds", () => {
    expect(buildAllowsOpenCodeVersionMismatch("nightly", false)).toBe(true);
    expect(buildAllowsOpenCodeVersionMismatch("beta", false)).toBe(true);
    expect(buildAllowsOpenCodeVersionMismatch("stable", false)).toBe(true);
  });

  it("also offers version consent in development builds", () => {
    expect(buildAllowsOpenCodeVersionMismatch("dev", false)).toBe(true);
    expect(buildAllowsOpenCodeVersionMismatch("dev", true)).toBe(true);
  });

  it("rejects unreviewed previews and malformed versions without consent", () => {
    expect(isSupportedOpenCodeVersion("0.0.0-beta-19425")).toBe(false);
    expect(isSupportedOpenCodeVersion("0.0.0-beta-17638")).toBe(false);
    expect(isSupportedOpenCodeVersion("0.0.0-beta-17640")).toBe(false);
    expect(isSupportedOpenCodeVersion("0.0.0-beta-17595")).toBe(false);
    expect(isSupportedOpenCodeVersion("0.0.0-next-17444")).toBe(false);
    expect(isSupportedOpenCodeVersion("0.0.0")).toBe(false);
    expect(isSupportedOpenCodeVersion("v0.0.0-beta-19507")).toBe(false);
    expect(isSupportedOpenCodeVersion("beta-17728")).toBe(false);
  });

  it("describes the exact supported version", () => {
    expect(supportedOpenCodeVersionLabel()).toBe("2.0.3");
  });

  it("reuses stable and tested beta services without requiring consent", () => {
    expect(shouldReuseOpenCodeService("2.0.2")).toBe(true);
    expect(shouldReuseOpenCodeService("0.0.0-beta-19507")).toBe(true);
    expect(shouldReuseOpenCodeService("0.0.0-beta-19425")).toBe(false);
    expect(shouldReuseOpenCodeService("0.0.0-beta-17638")).toBe(false);
    expect(shouldReuseOpenCodeService("0.0.0-beta-17640")).toBe(false);
    expect(shouldReuseOpenCodeService("0.0.0-beta-17595")).toBe(false);
    expect(shouldReuseOpenCodeService("0.0.0-next-17444")).toBe(false);
    expect(shouldReuseOpenCodeService("0.0.0")).toBe(false);
  });
});
