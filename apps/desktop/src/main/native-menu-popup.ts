import { screen, type BrowserWindow, type Menu, type PopupOptions } from "electron";

/** Keep the display lookup and popup adjacent: display geometry can change on hotplug. */
export function popupNativeContextMenu(
  menu: Menu,
  window: BrowserWindow,
  params: Pick<Electron.ContextMenuParams, "x" | "y" | "menuSourceType">,
): boolean {
  if (window.isDestroyed() || window.webContents.isDestroyed()) return false;
  const options: PopupOptions = {
    window,
    x: params.x,
    y: params.y,
    sourceType: params.menuSourceType,
  };

  if (process.platform === "linux") {
    // On Wayland the public screen cursor API returns (0, 0), but MenuViews uses
    // Chromium's internal cursor location for -1. We cannot preflight that anchor
    // safely through the public API. Require event coordinates instead.
    if (params.x === -1 || params.y === -1) {
      console.warn("[context-menu] Skipped native popup without an explicit anchor");
      return false;
    }
    // Match Electron MenuViews::PopupAt's explicit-coordinate anchor calculation.
    const origin = window.getContentBounds();
    const point = { x: origin.x + params.x, y: origin.y + params.y };
    const display = screen.getDisplayNearestPoint(point);
    // Electron 44 / Chromium 152's bubble menu clamps even an empty monitor area.
    // A 0x0 work area produced x_min > x_max and SIGILL in installed Nightly.
    // Do not enter native code with invalid geometry; try again on the next event.
    // Checking both rectangles is deliberately conservative about Chromium's fallback.
    if (![display.bounds, display.workArea].every((rect) => rect.width > 0 && rect.height > 0)) {
      console.warn("[context-menu] Skipped native popup with empty display geometry", {
        bounds: display.bounds,
        workArea: display.workArea,
      });
      return false;
    }
  }

  menu.popup(options);
  return true;
}
