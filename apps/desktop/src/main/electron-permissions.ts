import type { Session } from "electron";

export function installDenyAllPermissionPolicy(target: Session): void {
  target.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  target.setPermissionCheckHandler(() => false);
  target.setDevicePermissionHandler(() => false);
}
