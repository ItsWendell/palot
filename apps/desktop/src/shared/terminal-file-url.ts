/**
 * A `file:` URL a terminal opened: OSC 8 hyperlinks from `ls --hyperlink`, `rg --hyperlink-format`,
 * `delta` and the like, which the terminal (ghostty-web) opens with `window.open` on Ctrl/Cmd-click.
 */
export interface TerminalFileLink {
  /** Absolute path, decoded. */
  path: string;
  /**
   * The machine the URL names (`rg` writes `file://{host}/…`), lowercased; absent for an empty
   * host or `localhost`. Only the terminal knows which server it runs on, so it decides with
   * {@link terminalFileLinkHostAllowed}.
   */
  host?: string;
  line?: number;
  column?: number;
}

const MAX_FILE_URL_LENGTH = 8_192;

/**
 * Line positions file URLs carry: `#L12`, `#L12C3` and `#L12-L20` (editors, T3's parser), `#12`
 * (rg's `kitty` format, `file://{host}{path}#{line}`) and `#12:3`; or a `:12[:3]` suffix on the
 * path itself.
 */
const HASH_POSITION = /^#L?(\d+)(?:(?:C|:)(\d+))?(?:-L?\d+(?:C\d+)?)?$/i;
const PATH_POSITION = /:(\d+)(?::(\d+))?$/;

function positive(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const number = Number.parseInt(value, 10);
  return Number.isSafeInteger(number) && number > 0 ? number : undefined;
}

function normalHost(host: string): string {
  return host.toLowerCase().replace(/\.$/, "");
}

/**
 * Parses a terminal's `file:` URL. Credentials, relative paths, control characters and `..`
 * segments are refused; the host is kept for {@link terminalFileLinkHostAllowed}.
 */
export function parseTerminalFileUrl(input: string): TerminalFileLink | null {
  // `file:name` without `//` is a relative name, not a URL a terminal emits.
  if (input.length > MAX_FILE_URL_LENGTH || !/^file:\/\//i.test(input)) return null;
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  if (url.protocol !== "file:" || url.username || url.password) return null;
  const host = normalHost(url.hostname);
  let path: string;
  try {
    path = decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
  // `file:///C:/x` names a Windows drive path.
  if (/^\/[A-Za-z]:\//.test(path)) path = path.slice(1);
  if (!path.startsWith("/") && !/^[A-Za-z]:\//.test(path)) return null;
  if ([...path].some((character) => character.charCodeAt(0) < 32)) return null;
  if (path.split("/").includes("..")) return null;

  const hash = url.hash ? HASH_POSITION.exec(url.hash) : null;
  const suffix = hash ? null : PATH_POSITION.exec(path);
  if (suffix) path = path.slice(0, suffix.index);
  const match = hash ?? suffix;
  const line = positive(match?.[1]);
  const column = line ? positive(match?.[2]) : undefined;
  if (path.length > 1) path = path.replace(/\/+$/, "");
  if (path === "/" || /^[A-Za-z]:\/?$/.test(path)) return null;
  return {
    path,
    ...(host && host !== "localhost" ? { host } : {}),
    ...(line ? { line } : {}),
    ...(column ? { column } : {}),
  };
}

/**
 * Whether a link names the machine the terminal runs on: no host, or the hostname of the server
 * the terminal belongs to (OpenCode's `server.info`). Any other host is a share elsewhere.
 */
export function terminalFileLinkHostAllowed(
  link: Pick<TerminalFileLink, "host">,
  serverHostname: string | null | undefined,
): boolean {
  return !link.host || (Boolean(serverHostname) && normalHost(serverHostname!) === link.host);
}
