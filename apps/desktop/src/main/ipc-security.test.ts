import { describe, expect, it } from "vitest";
import { isTrustedIpcSender, sameRendererDocument } from "./ipc-security";

describe("isTrustedIpcSender", () => {
  const trusted = {
    expectedWindowExists: true,
    expectedWindowAlive: true,
    windowMatches: true,
    roleMatches: true,
    mainFrame: true,
    documentMatches: true,
  };

  it("requires every window, role, frame, and document condition", () => {
    expect(isTrustedIpcSender(trusted)).toBe(true);
    for (const key of Object.keys(trusted) as Array<keyof typeof trusted>) {
      expect(isTrustedIpcSender({ ...trusted, [key]: false })).toBe(false);
    }
  });
});

describe("sameRendererDocument", () => {
  it("accepts route hashes and query changes within the configured renderer document", () => {
    expect(
      sameRendererDocument(
        "http://127.0.0.1:1420/?profile=local#/settings",
        "http://127.0.0.1:1420/",
      ),
    ).toBe(true);
    expect(
      sameRendererDocument(
        "file:///Applications/Palot.app/Contents/Resources/app.asar/out/renderer/index.html#/task",
        "file:///Applications/Palot.app/Contents/Resources/app.asar/out/renderer/index.html",
      ),
    ).toBe(true);
  });

  it("rejects a different origin or renderer document", () => {
    expect(sameRendererDocument("https://attacker.invalid/", "http://127.0.0.1:1420/")).toBe(false);
    expect(
      sameRendererDocument(
        "file:///Applications/Palot.app/Contents/Resources/other.html",
        "file:///Applications/Palot.app/Contents/Resources/index.html",
      ),
    ).toBe(false);
  });
});
