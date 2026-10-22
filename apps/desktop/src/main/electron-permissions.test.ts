import { describe, expect, it, vi } from "vitest";
import { installPermissionPolicy } from "./electron-permissions";

const trusted = { id: 1 };
const untrusted = { id: 2 };

function install() {
  const target = {
    setPermissionRequestHandler: vi.fn(),
    setPermissionCheckHandler: vi.fn(),
    setDevicePermissionHandler: vi.fn(),
  };
  installPermissionPolicy(target as never, {
    allowMicrophone: (contents) => contents === (trusted as never),
  });
  const requestHandler = target.setPermissionRequestHandler.mock.calls[0]![0];
  const checkHandler = target.setPermissionCheckHandler.mock.calls[0]![0];
  const device = target.setDevicePermissionHandler.mock.calls[0]![0];
  return {
    request(contents: unknown, permission: string, details: Record<string, unknown>) {
      const callback = vi.fn();
      requestHandler(contents, permission, callback, {
        isMainFrame: true,
        requestingUrl: "http://127.0.0.1:1420/",
        ...details,
      });
      return callback.mock.calls[0]![0] as boolean;
    },
    check(contents: unknown, permission: string, details: Record<string, unknown>) {
      return checkHandler(contents, permission, "http://127.0.0.1:1420", {
        isMainFrame: true,
        ...details,
      }) as boolean;
    },
    device: device as () => boolean,
  };
}

describe("installPermissionPolicy", () => {
  it("allows microphone capture for a trusted workspace document", () => {
    const policy = install();
    expect(policy.request(trusted, "media", { mediaTypes: ["audio"] })).toBe(true);
    expect(policy.check(trusted, "media", { mediaType: "audio" })).toBe(true);
  });

  it("denies camera access even when audio is requested with it", () => {
    const policy = install();
    expect(policy.request(trusted, "media", { mediaTypes: ["audio", "video"] })).toBe(false);
    expect(policy.request(trusted, "media", { mediaTypes: ["video"] })).toBe(false);
    expect(policy.request(trusted, "media", {})).toBe(false);
    expect(policy.check(trusted, "media", { mediaType: "video" })).toBe(false);
    expect(policy.check(trusted, "media", { mediaType: "unknown" })).toBe(false);
  });

  it("denies microphone capture to untrusted contents and subframes", () => {
    const policy = install();
    expect(policy.request(untrusted, "media", { mediaTypes: ["audio"] })).toBe(false);
    expect(policy.request(null, "media", { mediaTypes: ["audio"] })).toBe(false);
    expect(policy.check(null, "media", { mediaType: "audio" })).toBe(false);
    expect(policy.request(trusted, "media", { mediaTypes: ["audio"], isMainFrame: false })).toBe(
      false,
    );
    expect(policy.check(trusted, "media", { mediaType: "audio", isMainFrame: false })).toBe(false);
  });

  it("keeps every other permission and device access denied", () => {
    const policy = install();
    for (const permission of ["notifications", "geolocation", "display-capture", "openExternal"]) {
      expect(policy.request(trusted, permission, { mediaTypes: ["audio"] })).toBe(false);
      expect(policy.check(trusted, permission, { mediaType: "audio" })).toBe(false);
    }
    expect(policy.device()).toBe(false);
  });
});
