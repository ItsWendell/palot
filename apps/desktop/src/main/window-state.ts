import type { BrowserWindow, Rectangle } from "electron";
import Store from "electron-store";
import { fitWindowBounds } from "./window-bounds";
import { usesWayland } from "./linux-desktop";

interface PersistedWindowState {
  bounds?: Rectangle;
  maximized?: boolean;
}

let store: Store<{ main?: PersistedWindowState }> | null = null;

export function restoreWindowState(
  workAreas: Rectangle[],
  primaryWorkArea: Rectangle,
): PersistedWindowState {
  const state = windowStateStore().get("main");
  // The compositor owns placement and tiled/maximized state on Wayland.
  if (process.platform === "linux" && usesWayland()) {
    return { maximized: false };
  }
  if (!state || !isRectangle(state.bounds)) return { maximized: state?.maximized === true };
  return {
    bounds: fitWindowBounds(state.bounds, workAreas, primaryWorkArea),
    maximized: state.maximized === true,
  };
}

export function trackWindowState(window: BrowserWindow): void {
  let pending: ReturnType<typeof setTimeout> | null = null;
  const schedule = () => {
    if (pending) clearTimeout(pending);
    pending = setTimeout(() => {
      pending = null;
      saveWindowState(window);
    }, 250);
  };

  window.on("move", schedule);
  window.on("resize", schedule);
  window.on("maximize", schedule);
  window.on("unmaximize", schedule);
  window.on("close", () => {
    if (pending) clearTimeout(pending);
    pending = null;
    saveWindowState(window);
  });
}

export function saveWindowState(window: BrowserWindow): void {
  if (window.isDestroyed()) return;
  windowStateStore().set("main", {
    bounds: window.getNormalBounds(),
    maximized: window.isMaximized(),
  });
}

function windowStateStore(): Store<{ main?: PersistedWindowState }> {
  return (store ??= new Store({ name: "window-state" }));
}

function isRectangle(value: unknown): value is Rectangle {
  if (!value || typeof value !== "object") return false;
  const bounds = value as Partial<Rectangle>;
  return (
    Number.isFinite(bounds.x) &&
    Number.isFinite(bounds.y) &&
    Number.isFinite(bounds.width) &&
    Number.isFinite(bounds.height) &&
    (bounds.width ?? 0) > 0 &&
    (bounds.height ?? 0) > 0
  );
}
