import { BrowserWindow, type Session, type WebContents, type WebPreferences } from "electron";
import type { BrowserPageSurface } from "./surface";

/** A popup cannot inherit web preferences from its opener or a page's window features. */
export function popupWebPreferences(expectedSession: Session): WebPreferences {
  return {
    session: expectedSession,
    sandbox: true,
    nodeIntegration: false,
    nodeIntegrationInSubFrames: false,
    nodeIntegrationInWorker: false,
    contextIsolation: true,
    webSecurity: true,
    allowRunningInsecureContent: false,
    webviewTag: false,
    plugins: false,
    experimentalFeatures: false,
    devTools: false,
    backgroundThrottling: false,
    navigateOnDragDrop: false,
    focusOnNavigation: false,
    additionalArguments: [],
  };
}

function dimension(value: number | undefined, fallback: number, minimum: number, maximum: number) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(minimum, Math.min(maximum, Math.round(value)))
    : fallback;
}

/** Wrap Chromium's existing child without replacing its opener, navigation, or POST. */
export function createBrowserPopupSurface(
  owner: BrowserWindow,
  options: Electron.BrowserWindowConstructorOptions,
  expectedSession: Session,
): BrowserPageSurface {
  // Electron passes this runtime option to createWindow even though the event's
  // declared BrowserWindowConstructorOptions type does not include it.
  const contents = (
    options as Electron.BrowserWindowConstructorOptions & {
      webContents?: WebContents;
    }
  ).webContents;
  if (!contents || contents.isDestroyed())
    throw new Error("Popup child webContents is unavailable");
  if (owner.isDestroyed() || owner.webContents.isDestroyed())
    throw new Error("Popup owner is unavailable");
  if (contents.session !== expectedSession) throw new Error("Popup child session mismatch");
  if (BrowserWindow.fromWebContents(contents))
    throw new Error("Popup child already belongs to a window");

  const window = new BrowserWindow({
    webContents: contents,
    parent: owner,
    show: false,
    modal: false,
    autoHideMenuBar: true,
    width: dimension(options.width, 960, 480, 1600),
    height: dimension(options.height, 720, 320, 1200),
    minWidth: 480,
    minHeight: 320,
    webPreferences: popupWebPreferences(expectedSession),
  } as Electron.BrowserWindowConstructorOptions);
  let requested = false;
  let disposed = false;
  // A popup has no renderer-owned address bar. Keep its native title tied to
  // the committed origin, never the site's potentially misleading page title.
  const updateTitle = () => {
    if (disposed || window.isDestroyed() || contents.isDestroyed()) return;
    const url = URL.parse(contents.getURL());
    const origin =
      url && ["http:", "https:"].includes(url.protocol)
        ? url.origin
        : url?.protocol === "file:"
          ? "Local file"
          : "about:blank";
    window.setTitle(`Palot Browser · ${origin}`);
  };
  const preventPageTitle = (event: Electron.Event) => {
    event.preventDefault();
    updateTitle();
  };
  contents.on("page-title-updated", preventPageTitle);
  contents.on("did-navigate", updateTitle);
  updateTitle();
  const allowed = () => !owner.isDestroyed() && owner.isVisible() && !owner.isMinimized();
  const reconcile = () => {
    if (disposed || window.isDestroyed()) return;
    if (requested && allowed()) {
      if (!window.isVisible()) window.showInactive();
    } else if (window.isVisible()) window.hide();
  };
  owner.on("hide", reconcile);
  owner.on("minimize", reconcile);
  owner.on("show", reconcile);
  owner.on("restore", reconcile);

  return {
    contents,
    window,
    focus() {
      if (disposed || window.isDestroyed() || !allowed()) return;
      requested = true;
      if (process.env.PALOT_E2E_INACTIVE === "1") window.showInactive();
      else {
        window.show();
        window.focus();
      }
    },
    layout() {
      // A native popup owns its geometry; workbench placeholder bounds do not.
    },
    setVisible(value) {
      requested = value;
      reconcile();
    },
    getVisible() {
      return !disposed && !window.isDestroyed() && allowed() && window.isVisible();
    },
    getBounds() {
      if (window.isDestroyed()) return { x: 0, y: 0, width: 0, height: 0 };
      const { width, height } = window.getContentBounds();
      return { x: 0, y: 0, width, height };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      owner.off("hide", reconcile);
      owner.off("minimize", reconcile);
      owner.off("show", reconcile);
      owner.off("restore", reconcile);
      contents.off("page-title-updated", preventPageTitle);
      contents.off("did-navigate", updateTitle);
      if (!window.isDestroyed()) window.destroy();
    },
  };
}
