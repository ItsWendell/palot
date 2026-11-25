import { parseTerminalFileUrl, type TerminalFileLink } from "../shared/terminal-file-url";

export interface WindowOpenRoute {
  openExternal(url: string): void;
  /** Hands a terminal's file link to the window that opened it. */
  openFileLink(link: TerminalFileLink): void;
}

/**
 * What a `window.open` from one of Palot's own windows does. The terminal (ghostty-web) opens
 * OSC 8 hyperlinks that way on Ctrl/Cmd-click: `file:` URLs go back to the window, whose
 * terminal opens them like a path clicked in it when the host is its server's; no `file:` URL
 * ever opens outside Palot. Everything else follows the external URL policy (http and https only).
 */
export function routeWindowOpen(url: string, route: WindowOpenRoute): void {
  if (!/^file:/i.test(url.trim())) {
    route.openExternal(url);
    return;
  }
  const link = parseTerminalFileUrl(url.trim());
  if (link) route.openFileLink(link);
}
