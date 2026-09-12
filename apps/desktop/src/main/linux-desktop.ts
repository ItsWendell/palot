/** Read-only desktop diagnostics; never starts desktop or OpenCode services. */
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir, release } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

export async function desktopProbe(command: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await run(command, args, { timeout: 3_000, maxBuffer: 512 * 1_024 });
    return stdout.trim();
  } catch {
    return null;
  }
}

export function usesWayland(environment = process.env): boolean {
  return environment.XDG_SESSION_TYPE === "wayland" || Boolean(environment.WAYLAND_DISPLAY);
}

export async function linuxDesktopDiagnostics() {
  const [omarchyVersion, theme, monitors, clients, busNames] = await Promise.all([
    readFile(path.join(process.env.OMARCHY_PATH ?? "/usr/share/omarchy", "version"), "utf8").catch(
      () => null,
    ),
    desktopProbe("omarchy", ["theme", "current"]),
    desktopProbe("hyprctl", ["monitors", "-j"]),
    desktopProbe("hyprctl", ["clients", "-j"]),
    desktopProbe("busctl", ["--user", "--no-pager", "--no-legend", "list"]),
  ]);
  const json = (value: string | null): Record<string, unknown>[] | null => {
    try {
      const parsed: unknown = JSON.parse(value ?? "null");
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  };
  return {
    platform: process.platform,
    architecture: process.arch,
    kernel: release(),
    session: process.env.XDG_SESSION_TYPE ?? null,
    desktop: process.env.XDG_CURRENT_DESKTOP ?? null,
    waylandExpected: usesWayland(),
    compositorInspectionAvailable: json(clients) !== null,
    displays:
      json(monitors)?.map(({ name, width, height, scale, refreshRate }) => ({
        name,
        width,
        height,
        scale,
        refreshRate,
      })) ?? null,
    windows:
      json(clients)
        ?.filter((client) => String(client.class).toLowerCase().includes("palot"))
        .map(({ class: appID, xwayland, size, floating }) => ({
          appID,
          backend: xwayland ? "xwayland" : "wayland",
          size,
          floating,
        })) ?? null,
    portals:
      busNames === null
        ? null
        : busNames
            .split("\n")
            .map((line) => line.split(/\s+/)[0])
            .filter((name) => name?.startsWith("org.freedesktop.portal.")),
    trayHost: busNames === null ? null : busNames.includes("org.kde.StatusNotifierWatcher"),
    notifications: busNames === null ? null : busNames.includes("org.freedesktop.Notifications"),
    omarchy: {
      version: omarchyVersion?.trim() ?? null,
      theme,
      themeDirectory: path.join(homedir(), ".local/state/omarchy/current/theme"),
    },
  };
}
