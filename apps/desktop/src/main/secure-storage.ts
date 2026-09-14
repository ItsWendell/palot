/** Select the system keyring before Electron initializes safeStorage. */
export function configureSecureStorage(
  commandLine: Pick<Electron.CommandLine, "hasSwitch" | "appendSwitch">,
  platform = process.platform,
  desktop = process.env.XDG_CURRENT_DESKTOP,
): void {
  if (platform !== "linux" || commandLine.hasSwitch("password-store")) return;
  // Chromium does not recognize Hyprland and otherwise selects basic_text,
  // even when a working Secret Service keyring is available on the session bus.
  if (desktop?.split(":").some((name) => name.trim().toLowerCase() === "hyprland")) {
    commandLine.appendSwitch("password-store", "gnome-libsecret");
  }
}
