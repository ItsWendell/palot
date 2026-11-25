import { terminalFileLinkHostAllowed, type TerminalFileLink } from "../../shared/terminal-file-url";
import type { FileReference } from "./file-reference";

/**
 * Which terminal a `file:` link the main process hands back belongs to. The terminal opens OSC 8
 * links with `window.open` on Ctrl/Cmd-click, so the link carries no terminal; the terminal
 * that last saw a Ctrl/Cmd press claims it, once and only shortly after. A link with no such
 * press (any other `window.open` of a `file:` URL) opens nothing.
 */
const CLAIM_WINDOW_MS = 5_000;
let armed: { owner: string; at: number } | null = null;

/** A Ctrl/Cmd pointer press in the terminal `owner`, which may activate a link. */
export function armTerminalFileLink(owner: string, now = Date.now()): void {
  armed = { owner, at: now };
}

/** Whether `owner` may open the link that just arrived; a claim disarms. */
export function claimTerminalFileLink(owner: string, now = Date.now()): boolean {
  if (!armed || armed.owner !== owner || now - armed.at > CLAIM_WINDOW_MS || now < armed.at) {
    return false;
  }
  armed = null;
  return true;
}

export function terminalFileLinkReference(link: TerminalFileLink): FileReference {
  return {
    path: link.path,
    ...(link.line ? { line: link.line } : {}),
    ...(link.column ? { column: link.column } : {}),
  };
}

/** Server hostnames by connection, from OpenCode's `server.info`; a failed read is retried. */
const serverHostnames = new Map<string, Promise<string | null>>();

export function terminalServerHostname(
  connectionID: string,
  read: () => Promise<string | undefined>,
): Promise<string | null> {
  let hostname = serverHostnames.get(connectionID);
  if (!hostname) {
    hostname = read().then(
      (value) => value ?? null,
      () => {
        serverHostnames.delete(connectionID);
        return null;
      },
    );
    serverHostnames.set(connectionID, hostname);
  }
  return hostname;
}

/**
 * Where a claimed link opens, or null when it names another machine. A link with a host opens
 * only when that host is the server the terminal runs on (`rg` on a remote server writes the
 * server's name); without a connection only host-less links open.
 */
export async function resolveTerminalFileLink(
  link: TerminalFileLink,
  serverHostname: () => Promise<string | null>,
): Promise<FileReference | null> {
  if (link.host && !terminalFileLinkHostAllowed(link, await serverHostname())) return null;
  return terminalFileLinkReference(link);
}
