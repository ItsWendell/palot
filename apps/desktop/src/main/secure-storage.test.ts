// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { configureSecureStorage } from "./secure-storage";

describe("configureSecureStorage", () => {
  it.each(["Hyprland", "hyprland", "Hyprland:wlroots"])(
    "selects Secret Service on %s before keyring initialization",
    (desktop) => {
      const commandLine = { hasSwitch: vi.fn(() => false), appendSwitch: vi.fn() };
      configureSecureStorage(commandLine, "linux", desktop);
      expect(commandLine.appendSwitch).toHaveBeenCalledWith("password-store", "gnome-libsecret");
    },
  );

  it("preserves an explicitly selected password store", () => {
    const commandLine = {
      hasSwitch: vi.fn((name) => name === "password-store"),
      appendSwitch: vi.fn(),
    };
    configureSecureStorage(commandLine, "linux", "Hyprland");
    expect(commandLine.appendSwitch).not.toHaveBeenCalled();
  });

  it.each(["GNOME", "KDE", "XFCE", "", "NotHyprland"])(
    "leaves native backend selection intact for %s",
    (desktop) => {
      const commandLine = { hasSwitch: vi.fn(() => false), appendSwitch: vi.fn() };
      configureSecureStorage(commandLine, "linux", desktop);
      expect(commandLine.appendSwitch).not.toHaveBeenCalled();
    },
  );

  it.each(["darwin", "win32"] as const)("does not change %s storage", (platform) => {
    const commandLine = { hasSwitch: vi.fn(() => false), appendSwitch: vi.fn() };
    configureSecureStorage(commandLine, platform, "Hyprland");
    expect(commandLine.appendSwitch).not.toHaveBeenCalled();
  });
});
