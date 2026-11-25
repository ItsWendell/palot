import { parseFileReference, type FileReference } from "./file-reference";

export interface TerminalFileLink {
  /** First column of the link (0-based). */
  start: number;
  /** Last column of the link, inclusive. */
  end: number;
  text: string;
  reference: FileReference;
}

/**
 * Path-like tokens in terminal output: rooted paths (`/`, `~/`, `./`, `../`, `C:\`) and relative
 * paths with at least one separator, with an optional `:line[:column]` suffix or a TypeScript
 * `(line,column)` location. Segments may hold route groups and params (`app/(auth)/[id]/page.tsx`)
 * and pnpm store names (`pkg@1.0+x`). A bare `name.ext` without a separator is a link only when a
 * compiler location follows it, `:line:column` or TypeScript's `(line,column): error TS…:`, so
 * prose, versions, times and `host:port` stay text. Adapted from T3 Code's terminal links (#30603,
 * #37071).
 */
const SEGMENT = String.raw`(?:[\p{L}\p{M}\p{N}._$+@-]|\[{1,2}[\p{L}\p{M}\p{N}._-]+\]{1,2}|\([\p{L}\p{M}\p{N}._-]+\)(?=[\\/]))+`;
const TS_LOCATION = String.raw`\(\d+,\d+\)(?=:\s+(?:error|warning) TS\d+:)`;
const POSITION = String.raw`(?:${TS_LOCATION}|(?::\d+){0,2})`;
const PATH = new RegExp(
  String.raw`(?:~[\\/]|\.{1,2}[\\/]|\/|[A-Za-z]:[\\/])(?:${SEGMENT}[\\/]?)+${POSITION}` +
    String.raw`|(?<![\p{L}\p{M}\p{N}._/-])[\p{L}\p{M}\p{N}._-]+(?:[\\/]${SEGMENT})+${POSITION}` +
    String.raw`|(?<![\p{L}\p{M}\p{N}._$+@/\\-])[\p{L}\p{M}\p{N}._$+@-]+\.\p{L}[\p{L}\p{M}\p{N}_-]*(?::\d+:\d+|${TS_LOCATION})`,
  "gu",
);
const TRAILING = /[.,;:!?'")\]]+$/;
/** A location the text ends with, kept when sentence punctuation is trimmed. */
const ENDS_WITH_LOCATION = /(?::\d+|\(\d+,\d+\))$/;
/** `scheme://…` up to whitespace; nothing inside one is a file link of its own. */
const URL_TOKEN = /(?<![A-Za-z\d+.-])[A-Za-z][A-Za-z\d+.-]+:\/\/[^\s"'`<>]+/g;

/** Detects openable file paths in one line of terminal text. Columns assume one cell per char. */
export function findTerminalFileLinks(
  line: string,
  options: { allowHome?: boolean } = {},
): TerminalFileLink[] {
  const links: TerminalFileLink[] = [];
  const urls = line.includes("://")
    ? [...line.matchAll(URL_TOKEN)].map((match) => ({
        start: match.index,
        end: match.index + match[0].length,
      }))
    : [];
  for (const match of line.matchAll(PATH)) {
    if (urls.some((url) => match.index >= url.start && match.index < url.end)) continue;
    let text = match[0];
    const trimmed = text.replace(TRAILING, "");
    // Keep a `:12` or `(12,5)` location; only strip punctuation that ends the sentence.
    text = ENDS_WITH_LOCATION.test(text) ? text : trimmed;
    if (text.length < 3 || text === "//" || /^\/+$/.test(text)) continue;
    // URLs are linked by the terminal's own URL provider.
    const before = line.slice(Math.max(0, match.index - 3), match.index);
    if (before.endsWith(":/") || before.endsWith("://") || before.endsWith(":")) continue;
    // `a.ts(12,5)` is `a.ts:12:5`.
    const reference = parseFileReference(text.replace(/\((\d+),(\d+)\)$/, ":$1:$2"), {
      source: "code",
      ...(options.allowHome ? { allowHome: true } : {}),
    });
    if (!reference) continue;
    links.push({ start: match.index, end: match.index + text.length - 1, text, reference });
  }
  return links;
}
