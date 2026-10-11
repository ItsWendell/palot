import { describe, expect, it } from "vitest";
import { windowManagerOwnsClose } from "./linux-desktop";

describe("windowManagerOwnsClose", () => {
  it.each([
    [{ HYPRLAND_INSTANCE_SIGNATURE: "abc" }, true],
    [{ SWAYSOCK: "/run/user/1000/sway.sock" }, true],
    [{ NIRI_SOCKET: "/run/user/1000/niri.sock" }, true],
    [{ I3SOCK: "/run/user/1000/i3/ipc" }, true],
    [{ XDG_CURRENT_DESKTOP: "Hyprland" }, true],
    [{ XDG_CURRENT_DESKTOP: "sway:wlroots" }, true],
    [{ XDG_CURRENT_DESKTOP: "GNOME" }, false],
    [{ XDG_CURRENT_DESKTOP: "KDE" }, false],
    [{ XDG_CURRENT_DESKTOP: "Swayland" }, false],
    [{}, false],
  ])("detects tiling compositors from %o", (environment, expected) => {
    expect(windowManagerOwnsClose(environment)).toBe(expected);
  });

  it("lets PALOT_WINDOW_CLOSE_BUTTON force the button either way", () => {
    expect(
      windowManagerOwnsClose({
        HYPRLAND_INSTANCE_SIGNATURE: "abc",
        PALOT_WINDOW_CLOSE_BUTTON: "1",
      }),
    ).toBe(false);
    expect(
      windowManagerOwnsClose({ XDG_CURRENT_DESKTOP: "GNOME", PALOT_WINDOW_CLOSE_BUTTON: "0" }),
    ).toBe(true);
  });
});
