import path from "node:path";
import { app, dialog, type OpenDialogOptions } from "electron";
import Store from "electron-store";

let directories: Store<Record<string, string>> | null = null;

/** Electron 43 no longer delegates the initial directory to the desktop dialog. */
export async function openDesktopDialog(
  kind: "project" | "attachment" | "import",
  options: OpenDialogOptions,
) {
  const store = (directories ??= new Store<Record<string, string>>({ name: "dialog-directories" }));
  const result = await dialog.showOpenDialog({
    ...options,
    defaultPath: store.get(kind) || app.getPath("home"),
  });
  const selected = result.filePaths[0];
  if (!result.canceled && selected)
    store.set(kind, kind === "project" ? selected : path.dirname(selected));
  return result;
}
