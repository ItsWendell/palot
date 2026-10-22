/** The floating, always-on-top window that mirrors a voice call. */

import { BrowserWindow } from "electron";
import { registerWindowRole } from "../ipc-security";
import { VOICE_OVERLAY_SIZE } from "./voice-policy";

export interface VoiceOverlayWindowOptions {
  entryUrl: string;
  preload: string;
  position: { x: number; y: number };
}

export function createVoiceOverlayWindow(options: VoiceOverlayWindowOptions): BrowserWindow {
  const mac = process.platform === "darwin";
  const linux = process.platform === "linux";
  const window = new BrowserWindow({
    ...VOICE_OVERLAY_SIZE,
    ...options.position,
    title: "Palot voice",
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    hasShadow: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    // macOS panels float over full-screen apps without activating Palot.
    ...(mac ? { type: "panel" } : {}),
    // A non-focusable X11/Wayland window leaves the window manager and may stop
    // receiving clicks; Linux keeps it focusable and only ever shows it inactive.
    focusable: linux,
    // The overlay is never key, so the first click must reach the page.
    acceptFirstMouse: true,
    webPreferences: {
      preload: options.preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      webviewTag: false,
    },
  });
  registerWindowRole(window, "voice-overlay");
  window.setAlwaysOnTop(true, "floating");
  window.setVisibleOnAllWorkspaces(true, {
    visibleOnFullScreen: true,
    // The panel type already floats over full-screen spaces; transforming the process
    // type would briefly hide the Dock icon each time.
    skipTransformProcessType: mac,
  });
  window.setMenu(null);

  const contents = window.webContents;
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
  contents.on("will-navigate", (event) => event.preventDefault());
  contents.on("will-attach-webview", (event) => event.preventDefault());
  void window.loadURL(options.entryUrl).catch(() => {
    if (!window.isDestroyed()) window.destroy();
  });
  return window;
}
