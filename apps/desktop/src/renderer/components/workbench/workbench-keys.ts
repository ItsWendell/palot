import { matchesShortcut, shortcutKeys, shortcutPlatform } from "../../lib/keyboard-shortcuts";

/**
 * What a key press inside a workbench pane does. `swallow` keeps the key from the window
 * (a held ⌘W must not close the window once the tab is gone) without acting on it; `null`
 * leaves it to the focused control and the app-wide shortcuts.
 */
export type WorkbenchKeyAction = "close" | "next" | "previous" | "reopen" | "swallow" | null;

export function workbenchKeyAction(
  event: KeyboardEvent,
  pane: { tabCount: number; canReopen: boolean },
  platform?: string,
): WorkbenchKeyAction {
  if (event.defaultPrevented || event.isComposing || event.keyCode === 229) return null;
  if (event.getModifierState?.("AltGraph")) return null;
  const mac = shortcutPlatform(platform) === "mac";
  // Shells read Ctrl keys (Ctrl+W deletes a word), matching the app-wide terminal exemption.
  const terminalControl =
    event.ctrlKey &&
    !event.metaKey &&
    event.target instanceof Element &&
    Boolean(event.target.closest("[data-workbench-terminal]"));

  if (isPlatformClose(event, mac)) {
    if (terminalControl) return null;
    // The window menu's Close never fires from the workbench, even with no tab left.
    return event.repeat || pane.tabCount === 0 ? "swallow" : "close";
  }
  if (
    !event.altKey &&
    event.shiftKey &&
    (event.metaKey || event.ctrlKey) &&
    event.key.toLowerCase() === "t"
  ) {
    if (event.repeat || !pane.canReopen) return null;
    return "reopen";
  }
  if (pane.tabCount < 2 || (terminalControl && !event.shiftKey)) return null;
  const direction = matchesShortcut(event, shortcutKeys("task.next"))
    ? "next"
    : matchesShortcut(event, shortcutKeys("task.previous"))
      ? "previous"
      : null;
  if (!direction) return null;
  return event.repeat ? "swallow" : direction;
}

/** ⌘W on macOS and Ctrl+W elsewhere: the key the window menu's Close item owns. */
function isPlatformClose(event: KeyboardEvent, mac: boolean): boolean {
  if (event.altKey || event.shiftKey) return false;
  if (mac ? !event.metaKey || event.ctrlKey : !event.ctrlKey || event.metaKey) return false;
  return /^[a-z]$/i.test(event.key) ? event.key.toLowerCase() === "w" : event.code === "KeyW";
}

/** The tab `direction` steps to from the active one, wrapping at either end. */
export function adjacentWorkbenchTab<T extends { id: string }>(
  tabs: readonly T[],
  activeTabID: string | null | undefined,
  direction: "next" | "previous",
): T | undefined {
  if (tabs.length < 2) return undefined;
  const index = tabs.findIndex((tab) => tab.id === activeTabID);
  const step = direction === "next" ? 1 : -1;
  const from = index === -1 ? (direction === "next" ? -1 : 0) : index;
  return tabs[(from + step + tabs.length) % tabs.length];
}
