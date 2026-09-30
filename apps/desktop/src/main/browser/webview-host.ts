import { randomUUID } from "node:crypto";
import { session, type BrowserWindow, type WebContents, type WebPreferences } from "electron";
import type { PalotBrowserHost } from "../../shared/browser-contract";
import type { BrowserPageSurface } from "./surface";

type Lease = {
  host: PalotBrowserHost;
  partition: string;
  current: () => boolean;
  claimed: boolean;
  contents?: WebContents;
  resolve: (surface: BrowserPageSurface) => void;
  revoke: (reason: string) => void;
  remove: () => void;
};
const owners = new WeakMap<BrowserWindow, ReturnType<typeof createHostOwner>>();

/** Install before loading any app document. Unreserved guests are always denied. */
export function installBrowserWebviewHost(win: BrowserWindow) {
  if (owners.has(win)) return;
  owners.set(win, createHostOwner(win));
}

export function requestBrowserWebviewHost(
  win: BrowserWindow,
  options: {
    tabID: PalotBrowserHost["tabID"];
    partition: string;
    signal: AbortSignal;
    current: () => boolean;
    publish: (host: PalotBrowserHost | null) => void;
  },
) {
  const owner = owners.get(win);
  if (!owner) throw new Error("Browser webview host is unavailable");
  return owner.request(options);
}

function createHostOwner(win: BrowserWindow) {
  const leases = new Map<string, Lease>();
  win.webContents.on("will-attach-webview", (event, preferences, params) => {
    const lease = [...leases.values()].find((item) => item.host.partition === params.partition);
    if (
      !lease ||
      lease.claimed ||
      !lease.current() ||
      params.src !== "about:blank" ||
      params.preload ||
      params.webpreferences
    ) {
      event.preventDefault();
      return;
    }
    lease.claimed = true;
    // Correlate through an inert bootstrap document, not private guest/adoption APIs.
    params.src = `about:blank#palot-browser-host=${lease.host.leaseID}`;
    // Do not inherit the application's preload or renderer-selected capabilities.
    // Electron's internal guest identity is left untouched.
    delete preferences.preload;
    delete preferences.partition;
    delete preferences.enableBlinkFeatures;
    delete preferences.disableBlinkFeatures;
    Object.assign(preferences, {
      session: session.fromPartition(lease.partition),
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      nodeIntegrationInWorker: false,
      contextIsolation: true,
      sandbox: true,
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
    } satisfies WebPreferences);
  });
  win.webContents.on("did-attach-webview", (_event, contents) => {
    contents.setWindowOpenHandler(() => ({ action: "deny" }));
    contents.once("did-finish-load", () => {
      const marker = /^about:blank#palot-browser-host=([\da-f-]+)$/.exec(contents.getURL());
      const lease = marker ? leases.get(marker[1]!) : undefined;
      if (
        !lease ||
        !lease.claimed ||
        lease.contents ||
        !lease.current() ||
        contents.hostWebContents !== win.webContents ||
        contents.session !== session.fromPartition(lease.partition)
      ) {
        contents.close();
        return;
      }
      lease.contents = contents;
      contents.once("destroyed", () => lease.remove());
      let bounds = { x: 0, y: 0, width: 1000, height: 700 };
      let visible = false;
      lease.resolve({
        contents,
        layout: (value) => {
          bounds = value;
        },
        setVisible: (value) => {
          visible = value;
          if (!value && !contents.isDestroyed() && contents.isFocused() && !win.isDestroyed())
            win.webContents.focus();
        },
        getBounds: () => bounds,
        getVisible: () => visible,
        dispose: () => {
          // Let removal of the owning DOM node destroy a guest first. Closing it
          // from both processes races Electron's internal guest registry.
          const released = contents.isDestroyed()
            ? Promise.resolve()
            : new Promise<void>((resolve) => {
                const done = () => {
                  clearTimeout(timeout);
                  resolve();
                };
                const timeout = setTimeout(() => {
                  contents.off("destroyed", done);
                  resolve();
                }, 1000);
                contents.once("destroyed", done);
              });
          lease.remove();
          return released;
        },
      });
    });
  });
  const revokeAll = () => {
    for (const lease of leases.values()) lease.revoke("Browser host owner closed");
  };
  win.webContents.once("destroyed", revokeAll);
  win.webContents.on("did-start-navigation", (_event, _url, inPlace, mainFrame) => {
    if (mainFrame && !inPlace) revokeAll();
  });
  return {
    request(options: Parameters<typeof requestBrowserWebviewHost>[1]) {
      const leaseID = randomUUID();
      const host: PalotBrowserHost = {
        tabID: options.tabID,
        leaseID,
        partition: `palot-browser-host-${leaseID}`,
      };
      const ready = Promise.withResolvers<BrowserPageSurface>();
      const remove = () => {
        if (!leases.delete(leaseID)) return;
        clearTimeout(timeout);
        options.signal.removeEventListener("abort", abort);
        options.publish(null);
      };
      const revoke = (reason: string) => {
        remove();
        ready.reject(new Error(reason));
        if (lease.contents && !lease.contents.isDestroyed()) lease.contents.close();
      };
      const abort = () => revoke("Browser host attachment cancelled");
      const timeout = setTimeout(() => revoke("Browser webview did not attach in time"), 10_000);
      const lease: Lease = {
        host,
        partition: options.partition,
        current: () => !options.signal.aborted && options.current(),
        claimed: false,
        resolve: (surface) => {
          clearTimeout(timeout);
          ready.resolve(surface);
        },
        revoke,
        remove,
      };
      leases.set(leaseID, lease);
      options.signal.addEventListener("abort", abort, { once: true });
      if (options.signal.aborted) abort();
      else options.publish(host);
      return ready.promise;
    },
  };
}
