import path from "node:path";
import { nativeImage, nativeTheme, type Tray } from "electron";
import { appearanceService } from "./appearance-service";
import { desktopProbe } from "./linux-desktop";

/** Panel contrast follows the desktop, never the independently chosen app palette. */
export function followLinuxTrayAppearance(tray: Tray, iconPath: string): () => void {
  let disposed = false;
  let generation = 0;
  let currentPath: string | undefined;
  const appearance = appearanceService();
  const refresh = async () => {
    const request = ++generation;
    const omarchyMode = appearance.preferences().omarchyTheme?.mode;
    // nativeTheme.themeSource can be forced by the app. Read the desktop portal
    // instead on other Linux desktops; "no preference" retains the neutral mark.
    const portal = omarchyMode
      ? null
      : await desktopProbe("gdbus", [
          "call",
          "--session",
          "--dest",
          "org.freedesktop.portal.Desktop",
          "--object-path",
          "/org/freedesktop/portal/desktop",
          "--method",
          "org.freedesktop.portal.Settings.Read",
          "org.freedesktop.appearance",
          "color-scheme",
        ]);
    if (disposed || request !== generation) return;
    const light = omarchyMode ? omarchyMode === "light" : /uint32\s+2\b/.test(portal ?? "");
    const next = light ? path.join(path.dirname(iconPath), "trayLinuxLight.png") : iconPath;
    if (next === currentPath) return;
    const image = nativeImage.createFromPath(next);
    if (image.isEmpty()) return;
    tray.setImage(image);
    currentPath = next;
  };
  const update = () => {
    void refresh().catch((error) => console.warn("[tray] Theme refresh failed", error));
  };
  const unsubscribe = appearance.onDesktopThemeChanged(update);
  nativeTheme.on("updated", update);
  update();
  return () => {
    disposed = true;
    generation++;
    unsubscribe();
    nativeTheme.off("updated", update);
  };
}
