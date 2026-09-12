import { describe, expect, it, vi } from "vitest";
import { installDenyAllPermissionPolicy } from "./electron-permissions";

describe("installDenyAllPermissionPolicy", () => {
  it("denies permission requests, checks, and device permissions", () => {
    const target = {
      setPermissionRequestHandler: vi.fn(),
      setPermissionCheckHandler: vi.fn(),
      setDevicePermissionHandler: vi.fn(),
    };
    installDenyAllPermissionPolicy(target as never);

    const request = target.setPermissionRequestHandler.mock.calls[0]![0];
    const check = target.setPermissionCheckHandler.mock.calls[0]![0];
    const device = target.setDevicePermissionHandler.mock.calls[0]![0];
    const callback = vi.fn();
    request(null, "media", callback);

    expect(callback).toHaveBeenCalledWith(false);
    expect(check()).toBe(false);
    expect(device()).toBe(false);
  });
});
