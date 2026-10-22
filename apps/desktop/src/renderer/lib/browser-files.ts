/**
 * Local HTML files in Palot Browser. Like OpenCode desktop, the browser loads `file://`
 * documents only inside the task's workspace on a same-machine server; the main process
 * enforces that, and these helpers only decide when to try.
 */

import { palot } from "../services/palot";
import { joinFilePath, workspaceRelativePath } from "./file-reference";
import { absoluteFileUri } from "./prompt-mentions";

export function isHtmlFilePath(path: string): boolean {
  return /\.html?$/i.test(path.trim());
}

export type WorkspaceFileTarget =
  | { kind: "workspace"; path: string; absolute: string }
  | { kind: "outside"; path: string };

/** Resolves a relative or absolute server path against the task's workspace directory. */
export function workspaceFileTarget(directory: string, path: string): WorkspaceFileTarget {
  const value = path.trim();
  if (!value || value.startsWith("~")) return { kind: "outside", path: value };
  const absolute = joinFilePath(directory, value);
  const relative = workspaceRelativePath(directory, absolute);
  return relative ? { kind: "workspace", path: relative, absolute } : { kind: "outside", path };
}

/** Opens an absolute workspace file as a new, focused Palot Browser tab. */
export async function openFileInBrowser(bindingID: string, absolutePath: string): Promise<void> {
  await palot.browserCommand(bindingID, {
    type: "tabs.open",
    url: absoluteFileUri(absolutePath),
    focus: true,
  });
}
