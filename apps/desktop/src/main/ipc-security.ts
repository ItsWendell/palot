import { BrowserWindow, ipcMain, type IpcMainInvokeEvent, type WebContents } from "electron";

export type PalotWindowRole = "main" | "voice-overlay";

const windowRoles = new WeakMap<BrowserWindow, PalotWindowRole>();

export function registerWindowRole(window: BrowserWindow, role: PalotWindowRole): void {
  windowRoles.set(window, role);
}

export function windowRole(window: BrowserWindow): PalotWindowRole | undefined {
  return windowRoles.get(window);
}

/**
 * True when `contents` is the top-level document of a live window registered with `role`
 * and still showing the expected renderer entry. Webview guests and other frames fail.
 */
export function isTrustedWindowContents(
  contents: WebContents | null,
  expectedUrl: string,
  expectedRole: PalotWindowRole,
): boolean {
  if (!contents || contents.isDestroyed()) return false;
  const window = BrowserWindow.fromWebContents(contents);
  return Boolean(
    window &&
    !window.isDestroyed() &&
    window.webContents === contents &&
    windowRoles.get(window) === expectedRole &&
    sameRendererDocument(contents.getURL(), expectedUrl),
  );
}

export function sameRendererDocument(actual: string, expected: string): boolean {
  try {
    const actualUrl = new URL(actual);
    const expectedUrl = new URL(expected);
    return (
      actualUrl.protocol === expectedUrl.protocol &&
      actualUrl.host === expectedUrl.host &&
      actualUrl.pathname === expectedUrl.pathname
    );
  } catch {
    return false;
  }
}

export function isTrustedIpcSender(input: {
  expectedWindowExists: boolean;
  expectedWindowAlive: boolean;
  windowMatches: boolean;
  roleMatches: boolean;
  mainFrame: boolean;
  documentMatches: boolean;
}): boolean {
  return Object.values(input).every(Boolean);
}

export function assertTrustedIpcSender(
  event: IpcMainInvokeEvent,
  expectedWindow: BrowserWindow | null,
  expectedUrl: string,
  expectedRole: PalotWindowRole,
): WebContents {
  const hostWindow = BrowserWindow.fromWebContents(event.sender);
  const senderFrame = event.senderFrame;
  if (
    !isTrustedIpcSender({
      expectedWindowExists: Boolean(expectedWindow),
      expectedWindowAlive: Boolean(expectedWindow && !expectedWindow.isDestroyed()),
      windowMatches: hostWindow === expectedWindow,
      roleMatches: Boolean(hostWindow && windowRoles.get(hostWindow) === expectedRole),
      mainFrame: Boolean(senderFrame && senderFrame === event.sender.mainFrame),
      documentMatches: Boolean(senderFrame && sameRendererDocument(senderFrame.url, expectedUrl)),
    })
  ) {
    throw new Error(`IPC is only available to the trusted Palot ${expectedRole} window`);
  }
  return event.sender;
}

export function registerTrustedIpcHandler(
  channel: string,
  options: {
    expectedWindow: (event: IpcMainInvokeEvent) => BrowserWindow | null;
    expectedUrl: string;
    expectedRole: PalotWindowRole;
  },
  handler: Parameters<typeof ipcMain.handle>[1],
): void {
  ipcMain.removeHandler(channel);
  ipcMain.handle(channel, (event, ...args) => {
    assertTrustedIpcSender(
      event,
      options.expectedWindow(event),
      options.expectedUrl,
      options.expectedRole,
    );
    return handler(event, ...args);
  });
}
