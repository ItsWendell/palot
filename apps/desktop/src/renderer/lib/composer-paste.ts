/**
 * The composer's paste rules, in one place. The editor and the attachment hook each act on the
 * kinds that belong to them; both ask this function, so a paste is classified once and the same
 * way everywhere.
 */

/** The composer's own copy format: text with its chips, for pasting back into a composer. */
export const COMPOSER_FRAGMENT_TYPE = "application/x-palot-composer-fragment";
/** Pasted text this large (UTF-8 bytes) becomes an attachment. */
export const LONG_PASTE_BYTES = 32 * 1024;
/** Pasted text with more lines than this becomes an attachment. */
export const LONG_PASTE_LINES = 400;

export interface ComposerPasteInput {
  /** `text/plain`. */
  text: string;
  /** Files on the clipboard: images from screenshots and browsers, files from a file manager. */
  files: File[];
  /** The composer's own copy format, if present. */
  fragment: string;
  /** `text/html`, which word processors and browsers add next to the plain text. */
  html: string;
}

export interface ComposerPasteContext {
  /** Mod+Shift+V: paste the text inline, whatever it is. */
  plain: boolean;
  /** Prompt mode; shell commands take text only. */
  attachments: boolean;
  /** Text of a nonempty selection without chips, or null. */
  selectedText: string | null;
}

export type ComposerPasteAction =
  | { kind: "attach-files"; files: File[] }
  | { kind: "attach-text"; text: string; lines: number }
  | { kind: "fragment"; value: string }
  | { kind: "link"; text: string }
  | { kind: "text"; text: string }
  | { kind: "none" };

/** Clipboard fragments beyond this are ignored and pasted as their text. */
const MAX_FRAGMENT_LENGTH = 200_000;
const URL_PATTERN = /^https?:\/\/[^\s<>()[\]]+$/i;

export function lineCount(text: string): number {
  let lines = 1;
  for (let index = text.indexOf("\n"); index >= 0; index = text.indexOf("\n", index + 1))
    lines += 1;
  return text.endsWith("\n") ? lines - 1 : lines;
}

function isLongText(text: string): boolean {
  // Cheap bounds first: UTF-8 is at least one byte per UTF-16 unit and at most three.
  if (text.length >= LONG_PASTE_BYTES) return true;
  if (
    text.length * 3 >= LONG_PASTE_BYTES &&
    new TextEncoder().encode(text).byteLength >= LONG_PASTE_BYTES
  )
    return true;
  return lineCount(text) > LONG_PASTE_LINES;
}

/** A Markdown link label must not end the link early or start a new line. */
function linkLabel(text: string): string | null {
  return text.trim() && !/[\n\]]/.test(text) ? text : null;
}

/** Whether HTML has visible text, so it is more than an `<img>` and its wrapper. */
function htmlHasText(html: string): boolean {
  const text = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(style|script|head|title)\b[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;|&#160;|&#xa0;/gi, "");
  return text.trim().length > 0;
}

/**
 * Word, Pages and similar editors put the text, its HTML and a picture of it on the clipboard.
 * That paste means the text. A file manager copy has no HTML, and a copied image has HTML that is
 * just an `<img>`, so both still attach.
 */
function isRichTextWithPicture(input: ComposerPasteInput): boolean {
  if (!input.text.trim() || !input.html) return false;
  if (!input.files.every((file) => file.type.startsWith("image/"))) return false;
  return htmlHasText(input.html);
}

export function composerPasteAction(
  input: ComposerPasteInput,
  context: ComposerPasteContext,
): ComposerPasteAction {
  const { text } = input;
  if (context.plain || !context.attachments)
    return text ? { kind: "text", text } : { kind: "none" };
  if (input.files.length > 0 && !isRichTextWithPicture(input))
    return { kind: "attach-files", files: input.files };
  if (input.fragment && input.fragment.length <= MAX_FRAGMENT_LENGTH)
    return { kind: "fragment", value: input.fragment };
  if (!text) return { kind: "none" };
  if (isLongText(text)) return { kind: "attach-text", text, lines: lineCount(text) };
  const url = text.trim();
  const label = context.selectedText === null ? null : linkLabel(context.selectedText);
  if (label && URL_PATTERN.test(url)) return { kind: "link", text: `[${label}](${url})` };
  return { kind: "text", text };
}

export interface ComposerFileSources {
  /** Files on disk, attached by path as if picked, up to the attachment limit. */
  byPath: File[];
  /** Files on disk beyond the limit, which are reported, not attached. */
  overLimit: File[];
  /** Images without a path, such as pasted screenshots, staged from their bytes. */
  images: File[];
  /** Other files without a path, which cannot be attached. */
  unsupported: File[];
}

/**
 * How pasted or dropped files attach. A file with a path attaches by path, so it keeps its name
 * and needs no copy; only the bytes of path-less images can be staged.
 */
export function composerFileSources(
  files: File[],
  pathFor: (file: File) => string,
  limit: number,
): ComposerFileSources {
  const sources: ComposerFileSources = { byPath: [], overLimit: [], images: [], unsupported: [] };
  for (const file of files) {
    if (pathFor(file)) {
      (sources.byPath.length < limit ? sources.byPath : sources.overLimit).push(file);
    } else if (file.type.startsWith("image/")) {
      sources.images.push(file);
    } else {
      sources.unsupported.push(file);
    }
  }
  return sources;
}

/** Reads what the rules need from a paste event's clipboard data. */
export function composerPasteInput(data: DataTransfer): ComposerPasteInput {
  const files: File[] = [];
  for (const item of Array.from(data.items ?? [])) {
    if (item.kind !== "file") continue;
    const file = item.getAsFile();
    if (file) files.push(file);
  }
  return {
    text: data.getData("text/plain"),
    files,
    fragment: data.getData(COMPOSER_FRAGMENT_TYPE),
    html: files.length > 0 ? data.getData("text/html") : "",
  };
}
