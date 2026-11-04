/**
 * GitHub-flavored raw HTML syntax for @tanstack/markdown (CommonMark 0.31.2 §4.6 HTML blocks,
 * §6.5 autolinks, §6.6 raw HTML, §2.5 entity references).
 *
 * The library's own `allowHtml` support only starts HTML blocks at a block boundary, ends every
 * block at a blank line and cannot interrupt paragraphs, so Palot keeps it off and parses HTML
 * here. Parsing only marks raw HTML as `html` / `inlineHtml` nodes; nothing here is trusted
 * output. `markdown-html-tree.ts` builds elements from those fragments through an allowlist and
 * keeps every other tag as literal text. HTML blocks of types 6 and 7 start only at allowlisted
 * lowercase tags, so component-like lines stay paragraphs.
 */

import type {
  BlockNode,
  BlockParseContext,
  InlineNode,
  InlineParseContext,
  InlineParseResult,
  MarkdownExtension,
  ParseOptions,
} from "@tanstack/markdown";

/** `scanRawHtml` result when the input is not raw HTML. */
export const RAW_HTML_INVALID = -1;
/** `scanRawHtml` result when the input ends inside something that could still become raw HTML. */
export const RAW_HTML_INCOMPLETE = -2;

const TYPE_1_START = /^ {0,3}<(pre|script|style|textarea)(?:[ \t>]|$)/i;
const TYPE_1_END = /<\/(?:pre|script|style|textarea)>/i;
const TYPE_6_START = new RegExp(
  `^ {0,3}</?(${[
    "address",
    "article",
    "aside",
    "base",
    "basefont",
    "blockquote",
    "body",
    "caption",
    "center",
    "col",
    "colgroup",
    "dd",
    "details",
    "dialog",
    "dir",
    "div",
    "dl",
    "dt",
    "fieldset",
    "figcaption",
    "figure",
    "footer",
    "form",
    "frame",
    "frameset",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "head",
    "header",
    "hr",
    "html",
    "iframe",
    "legend",
    "li",
    "link",
    "main",
    "menu",
    "menuitem",
    "nav",
    "noframes",
    "ol",
    "optgroup",
    "option",
    "p",
    "param",
    "search",
    "section",
    "summary",
    "table",
    "tbody",
    "td",
    "tfoot",
    "th",
    "thead",
    "title",
    "tr",
    "track",
    "ul",
  ].join("|")})(?:[ \t]|/?>|$)`,
  "i",
);

/**
 * Elements GitHub's sanitizer keeps (html-pipeline SanitizationFilter plus picture/source).
 * Palot deliberately interprets only these, and only written in lowercase: agents write type and
 * component names in prose (`<Button>`, `Array<string>`), which must stay readable text.
 */
const ALLOWED_TAGS = new Set([
  "a",
  "abbr",
  "b",
  "bdi",
  "bdo",
  "blockquote",
  "br",
  "caption",
  "cite",
  "code",
  "dd",
  "del",
  "details",
  "dfn",
  "div",
  "dl",
  "dt",
  "em",
  "figcaption",
  "figure",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "i",
  "img",
  "ins",
  "kbd",
  "li",
  "mark",
  "ol",
  "p",
  "picture",
  "pre",
  "q",
  "rp",
  "rt",
  "ruby",
  "s",
  "samp",
  "small",
  "source",
  "span",
  "strike",
  "strong",
  "sub",
  "summary",
  "sup",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "time",
  "tr",
  "tt",
  "ul",
  "var",
  "wbr",
]);

/** True only for an allowlisted tag name written in lowercase (`summary`, not `Summary`). */
export function isAllowedHtmlTag(name: string): boolean {
  return ALLOWED_TAGS.has(name);
}

type HtmlBlockKind = 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** CommonMark HTML block start conditions 1–7 for one line, or 0. */
export function htmlBlockStart(line: string): HtmlBlockKind | 0 {
  const offset = leadingSpaces(line);
  if (offset > 3 || line[offset] !== "<") return 0;
  // Type 1 keeps CommonMark's extent; script/style/textarea blocks then render as literal text.
  const type1 = TYPE_1_START.exec(line)?.[1];
  if (type1 && (type1 === "pre" || type1.toLowerCase() !== "pre")) return 1;
  if (line.startsWith("<!--", offset)) return 2;
  if (line.startsWith("<?", offset)) return 3;
  if (line.startsWith("<![CDATA[", offset)) return 5;
  if (line[offset + 1] === "!" && isAsciiLetter(line.charCodeAt(offset + 2))) return 4;
  // Types 6 and 7 need an allowlisted lowercase tag: `<Button variant="primary">` or
  // `<MyComponent />` alone on a line stays a paragraph with literal text.
  const type6 = TYPE_6_START.exec(line)?.[1];
  if (type6 && isAllowedHtmlTag(type6)) return 6;
  const end = scanRawHtml(line, offset);
  // Type 7: one complete open or closing tag (not a comment or declaration), then only whitespace.
  const tag = /^<\/?([A-Za-z][A-Za-z0-9-]*)/.exec(line.slice(offset))?.[1];
  if (end > 0 && tag && isAllowedHtmlTag(tag) && !line.slice(end).trim()) return 7;
  return 0;
}

function htmlBlockEnds(kind: HtmlBlockKind, line: string): boolean {
  switch (kind) {
    case 1:
      return TYPE_1_END.test(line);
    case 2:
      return line.includes("-->");
    case 3:
      return line.includes("?>");
    case 4:
      return line.includes(">");
    case 5:
      return line.includes("]]>");
    default:
      return false;
  }
}

/**
 * Scan one CommonMark raw HTML construct that starts at `source[start] === "<"`: an open tag,
 * closing tag, comment, processing instruction, declaration or CDATA section. Returns the end
 * offset, RAW_HTML_INVALID, or RAW_HTML_INCOMPLETE when the input ends inside a construct.
 * Linear time: a hand-written scanner instead of a backtracking attribute regex.
 */
export function scanRawHtml(source: string, start: number): number {
  const length = source.length;
  let index = start + 1;
  if (index >= length) return RAW_HTML_INCOMPLETE;
  const first = source.charCodeAt(index);
  if (first === 0x21 /* ! */) {
    if (source.startsWith("--", index + 1)) {
      if (source[index + 3] === ">") return index + 4;
      if (source.startsWith("->", index + 3)) return index + 5;
      const close = closerAfter(source, "-->", index + 3);
      return close === -1 ? RAW_HTML_INCOMPLETE : close + 3;
    }
    if (source.startsWith("[CDATA[", index + 1)) {
      const close = closerAfter(source, "]]>", index + 8);
      return close === -1 ? RAW_HTML_INCOMPLETE : close + 3;
    }
    if (isAsciiLetter(source.charCodeAt(index + 1))) {
      const close = closerAfter(source, ">", index + 2);
      return close === -1 ? RAW_HTML_INCOMPLETE : close + 1;
    }
    const rest = source.slice(index + 1);
    return rest.length < 7 && ("--".startsWith(rest) || "[CDATA[".startsWith(rest))
      ? RAW_HTML_INCOMPLETE
      : RAW_HTML_INVALID;
  }
  if (first === 0x3f /* ? */) {
    const close = closerAfter(source, "?>", index + 1);
    return close === -1 ? RAW_HTML_INCOMPLETE : close + 2;
  }
  if (first === 0x2f /* / */) {
    index += 1;
    if (index >= length) return RAW_HTML_INCOMPLETE;
    if (!isAsciiLetter(source.charCodeAt(index))) return RAW_HTML_INVALID;
    index = skipTagName(source, index);
    index = skipHtmlWhitespace(source, index);
    if (index >= length) return RAW_HTML_INCOMPLETE;
    return source[index] === ">" ? index + 1 : RAW_HTML_INVALID;
  }
  if (!isAsciiLetter(first)) return RAW_HTML_INVALID;
  index = skipTagName(source, index);
  for (;;) {
    const separator = index;
    index = skipHtmlWhitespace(source, index);
    if (index >= length) return RAW_HTML_INCOMPLETE;
    const char = source[index];
    if (char === ">") return index + 1;
    if (char === "/") {
      if (index + 1 >= length) return RAW_HTML_INCOMPLETE;
      return source[index + 1] === ">" ? index + 2 : RAW_HTML_INVALID;
    }
    // Every attribute needs leading whitespace and a valid name.
    if (index === separator || !isAttributeNameStart(source.charCodeAt(index)))
      return RAW_HTML_INVALID;
    index += 1;
    while (index < length && isAttributeNameChar(source.charCodeAt(index))) index += 1;
    const afterName = index;
    index = skipHtmlWhitespace(source, index);
    if (index >= length) return RAW_HTML_INCOMPLETE;
    if (source[index] !== "=") {
      index = afterName;
      continue;
    }
    index = skipHtmlWhitespace(source, index + 1);
    if (index >= length) return RAW_HTML_INCOMPLETE;
    const quote = source[index];
    if (quote === '"' || quote === "'") {
      const close = closerAfter(source, quote, index + 1);
      if (close === -1) return RAW_HTML_INCOMPLETE;
      index = close + 1;
      continue;
    }
    const valueStart = index;
    while (index < length && isUnquotedValueChar(source.charCodeAt(index))) index += 1;
    if (index === valueStart) return RAW_HTML_INVALID;
    if (index >= length) return RAW_HTML_INCOMPLETE;
  }
}

// The inline parser calls scanRawHtml at every `<` of one paragraph. Remembering where each
// closer last occurs makes unclosed constructs (`<?` ×30k, `<!--` ×15k) O(1) instead of a
// rescan to the end each time.
let closerSource = "";
const lastCloser = new Map<string, number>();

function closerAfter(source: string, marker: string, from: number): number {
  if (source !== closerSource) {
    closerSource = source;
    lastCloser.clear();
  }
  let last = lastCloser.get(marker);
  if (last === undefined) {
    last = source.lastIndexOf(marker);
    lastCloser.set(marker, last);
  }
  return last < from ? -1 : source.indexOf(marker, from);
}

function skipTagName(source: string, index: number): number {
  let cursor = index + 1;
  while (cursor < source.length) {
    const code = source.charCodeAt(cursor);
    if (!isAsciiLetter(code) && !isAsciiDigit(code) && code !== 0x2d /* - */) break;
    cursor += 1;
  }
  return cursor;
}

function skipHtmlWhitespace(source: string, index: number): number {
  let cursor = index;
  while (cursor < source.length) {
    const code = source.charCodeAt(cursor);
    if (code !== 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d && code !== 0x0c) break;
    cursor += 1;
  }
  return cursor;
}

function isAsciiLetter(code: number): boolean {
  return (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a);
}

function isAsciiDigit(code: number): boolean {
  return code >= 0x30 && code <= 0x39;
}

function isAttributeNameStart(code: number): boolean {
  return isAsciiLetter(code) || code === 0x5f /* _ */ || code === 0x3a; /* : */
}

function isAttributeNameChar(code: number): boolean {
  return isAttributeNameStart(code) || isAsciiDigit(code) || code === 0x2e || code === 0x2d;
}

function isUnquotedValueChar(code: number): boolean {
  // Not whitespace/control, ", ', =, <, >, or `.
  return (
    code > 0x20 &&
    code !== 0x22 &&
    code !== 0x27 &&
    code !== 0x3d &&
    code !== 0x3c &&
    code !== 0x3e &&
    code !== 0x60
  );
}

function leadingSpaces(line: string): number {
  let count = 0;
  while (line[count] === " ") count += 1;
  return count;
}

// ---------------------------------------------------------------------------------------------
// Entity and numeric character references (CommonMark §2.5)

const ENTITY = /&(?:#[xX]([0-9A-Fa-f]{1,6})|#([0-9]{1,7})|([A-Za-z][A-Za-z0-9]{1,31}));/y;
// A Map, never an object literal: names such as `constructor` must not reach the prototype.
const COMMON_ENTITIES = new Map<string, string>(
  Object.entries({
    amp: "&",
    apos: "'",
    bull: "•",
    copy: "©",
    deg: "°",
    emsp: "\u2003",
    ensp: "\u2002",
    euro: "€",
    gt: ">",
    hellip: "…",
    laquo: "«",
    larr: "←",
    ldquo: "“",
    lsquo: "‘",
    lt: "<",
    mdash: "—",
    middot: "·",
    nbsp: "\u00a0",
    ndash: "–",
    quot: '"',
    raquo: "»",
    rarr: "→",
    rdquo: "”",
    reg: "®",
    rsquo: "’",
    thinsp: "\u2009",
    times: "×",
    trade: "™",
    zwj: "\u200d",
    zwnj: "\u200c",
  }),
);
const NAMED_ENTITY_CACHE_LIMIT = 2048;
const namedEntityCache = new Map<string, string | null>();
let entityDecoder: HTMLElement | undefined;

/** Decode one entity reference at `index`; named references must exist in HTML5. */
function matchEntity(source: string, index: number): { value: string; length: number } | null {
  ENTITY.lastIndex = index;
  const match = ENTITY.exec(source);
  if (!match) return null;
  const [text, hex, decimal, name] = match;
  if (name !== undefined) {
    const value = decodeNamedEntity(name);
    return value === null ? null : { value, length: text.length };
  }
  return {
    value: codePointText(Number.parseInt(hex ?? decimal ?? "0", hex ? 16 : 10)),
    length: text.length,
  };
}

/** Decode every valid entity reference in raw HTML text or attribute values. */
export function decodeEntities(value: string): string {
  if (!value.includes("&")) return value;
  let result = "";
  let offset = 0;
  for (let index = value.indexOf("&"); index !== -1; index = value.indexOf("&", index + 1)) {
    const entity = matchEntity(value, index);
    if (!entity) continue;
    result += value.slice(offset, index) + entity.value;
    offset = index + entity.length;
    index = offset - 1;
  }
  return result + value.slice(offset);
}

function codePointText(code: number): string {
  // NUL, surrogates and out-of-range values become U+FFFD, as in CommonMark and HTML.
  if (code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return "\ufffd";
  return String.fromCodePoint(code);
}

function decodeNamedEntity(name: string): string | null {
  const common = COMMON_ENTITIES.get(name);
  if (common !== undefined) return common;
  const cached = namedEntityCache.get(name);
  if (cached !== undefined) return cached;
  let value: string | null = null;
  if (typeof document !== "undefined") {
    // The detached element only ever receives `&` + an alphanumeric name + `;`, so it cannot
    // create markup; this reuses the browser's complete HTML5 entity table without bundling it.
    entityDecoder ??= document.createElement("i");
    entityDecoder.innerHTML = `&${name};`;
    const decoded = entityDecoder.textContent ?? "";
    // A legacy prefix match such as `&notit;` decodes to "¬it;" and is not a reference.
    value =
      typeof decoded !== "string" ||
      decoded === `&${name};` ||
      (decoded.endsWith(";") && name !== "semi")
        ? null
        : decoded;
  }
  if (namedEntityCache.size >= NAMED_ENTITY_CACHE_LIMIT) namedEntityCache.clear();
  namedEntityCache.set(name, value);
  return value;
}

// ---------------------------------------------------------------------------------------------
// URL policy shared by Markdown destinations, autolinks and raw HTML attributes

/** The parser's default URL screen (@tanstack/markdown utils.sanitizeUrl): strips control and
 * whitespace characters, then rejects every scheme except http(s), mailto and tel. */
export function screenUrl(value: string): string {
  // oxlint-disable-next-line no-control-regex -- control characters can hide a scheme
  const trimmed = value.replace(/[\u0000-\u001F\u007F\s]+/g, "");
  return /^(?!https?:|mailto:|tel:)[a-z][a-z0-9+.-]*:/i.test(trimmed) ? "" : trimmed;
}

/** Apply the document's URL policy to an already entity-decoded URL; undefined when rejected. */
export function policyUrl(
  value: string | undefined,
  kind: "link" | "image",
  options: Pick<ParseOptions, "urlTransform">,
): string | undefined {
  if (value === undefined) return undefined;
  const screened = screenUrl(value);
  const url = options.urlTransform ? options.urlTransform(value, kind, screened) : screened;
  return url || undefined;
}

// ---------------------------------------------------------------------------------------------
// Extensions

// oxlint-disable-next-line no-control-regex -- CommonMark autolinks exclude control characters
const URI_AUTOLINK = /<([A-Za-z][A-Za-z0-9+.-]{1,31}:[^\s<>\u0000-\u001f]*)>/y;
const EMAIL_AUTOLINK =
  /<([a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*)>/y;

/** HTML blocks (start conditions 1–7), inline raw HTML, autolinks and entity references. */
export function htmlSyntaxExtension(): MarkdownExtension {
  return {
    name: "palot-html",
    parseBlock: parseHtmlBlock,
    inlineParser: { markers: "<&", parse: parseInlineHtml },
    transformInline: mergeAdjacentText,
  };
}

function parseHtmlBlock(context: BlockParseContext): BlockNode | undefined {
  const { lines, index } = context;
  const kind = htmlBlockStart(lines[index] ?? "");
  if (!kind) return undefined;
  let cursor = index;
  if (kind <= 5) {
    while (cursor < lines.length && !htmlBlockEnds(kind, lines[cursor] ?? "")) cursor += 1;
    cursor = Math.min(cursor + 1, lines.length);
  } else {
    while (cursor < lines.length && !isBlank(lines[cursor] ?? "")) cursor += 1;
  }
  context.consume(cursor - index);
  return { type: "html", value: lines.slice(index, cursor).join("\n") };
}

function parseInlineHtml(context: InlineParseContext): InlineParseResult | undefined {
  const { source, index } = context;
  if (source[index] === "&") {
    const entity = matchEntity(source, index);
    return entity
      ? { node: { type: "text", value: entity.value }, length: entity.length }
      : undefined;
  }
  if (!context.inLink) {
    const autolink = matchAutolink(source, index, context.options);
    if (autolink) return autolink;
  }
  const end = scanRawHtml(source, index);
  if (end <= 0) return undefined;
  return { node: { type: "inlineHtml", value: source.slice(index, end) }, length: end - index };
}

function matchAutolink(
  source: string,
  index: number,
  options: ParseOptions,
): InlineParseResult | undefined {
  URI_AUTOLINK.lastIndex = index;
  const uri = URI_AUTOLINK.exec(source);
  EMAIL_AUTOLINK.lastIndex = index;
  const email = uri ? null : EMAIL_AUTOLINK.exec(source);
  const match = uri ?? email;
  if (!match) return undefined;
  const label = match[1]!;
  const href = policyUrl(email ? `mailto:${label}` : label, "link", options);
  const text: InlineNode = { type: "text", value: label };
  return {
    node: href ? { type: "link", href, children: [text] } : text,
    length: match[0].length,
  };
}

/** Entity references parse as their own text nodes; rejoin them so later text transforms
 * (autolinks, session links) see the same runs the source had. */
function mergeAdjacentText(nodes: InlineNode[]): InlineNode[] {
  let merged: InlineNode[] | undefined;
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index]!;
    const previous = merged?.at(-1) ?? (index > 0 ? nodes[index - 1] : undefined);
    if (node.type === "text" && previous?.type === "text") {
      merged ??= nodes.slice(0, index);
      merged[merged.length - 1] = { type: "text", value: previous.value + node.value };
      continue;
    }
    const children = "children" in node ? mergeChildren(node) : node;
    if (children !== node) merged ??= nodes.slice(0, index);
    merged?.push(children);
  }
  return merged ?? nodes;
}

function mergeChildren(node: Extract<InlineNode, { children: InlineNode[] }>): InlineNode {
  const children = mergeAdjacentText(node.children);
  return children === node.children ? node : { ...node, children };
}

// Paragraphs ----------------------------------------------------------------------------------

const SETEXT_UNDERLINE = /^ {0,3}(=+|-+)[ \t]*$/;
const BLOCK_START = /^ {0,3}(?:`{3,}|~{3,}|#{1,6}(?:\s|$)|([-*_])(?:\s*\1){2,}\s*$|>)/;
const LIST_MARKER = /^(\s{0,8})([-+*]|\d{1,9}[.)])(?:([ \t]+)(.*))?$/;

/**
 * Paragraphs with CommonMark interruption rules: HTML blocks of types 1–6 (not 7) and non-empty
 * list items starting at 1 end a paragraph, setext underlines turn it into a heading, and two
 * trailing spaces make a hard line break. Must be the last block extension: it claims only lines
 * that the library would otherwise parse as a paragraph.
 */
export function paragraphExtension(): MarkdownExtension {
  return { name: "palot-paragraphs", parseBlock: parseParagraph };
}

function parseParagraph(context: BlockParseContext): BlockNode | undefined {
  const { lines, index } = context;
  const first = lines[index] ?? "";
  if (isBlank(first) || startsOtherBlock(first, lines[index + 1])) return undefined;
  const content = [first];
  let cursor = index + 1;
  for (; cursor < lines.length; cursor += 1) {
    const line = lines[cursor] ?? "";
    if (isBlank(line)) break;
    const underline = SETEXT_UNDERLINE.exec(line);
    if (underline) {
      context.consume(cursor - index + 1);
      return {
        type: "heading",
        depth: underline[1]!.startsWith("=") ? 1 : 2,
        children: context.parseInline(paragraphText(content).trim()),
      };
    }
    if (interruptsParagraph(line, lines[cursor + 1])) break;
    content.push(line);
  }
  context.consume(cursor - index);
  return { type: "paragraph", children: context.parseInline(paragraphText(content)) };
}

function paragraphText(lines: string[]): string {
  let text = "";
  let codeRun = 0;
  for (const [index, line] of lines.entries()) {
    const value = line.trim();
    if (index > 0) text += "\n";
    text += value;
    // Track code spans by backtick run length: a run opens one, the next equal run closes it.
    for (const run of value.includes("`") ? value.match(/`+/g)! : []) {
      if (codeRun === 0) codeRun = run.length;
      else if (run.length === codeRun) codeRun = 0;
    }
    // GFM hard break: two trailing spaces before a line ending, outside an open code span or tag.
    if (
      index < lines.length - 1 &&
      line.endsWith("  ") &&
      !value.endsWith("\\") &&
      codeRun === 0 &&
      value.lastIndexOf("<") <= value.lastIndexOf(">")
    )
      text += "\\";
  }
  return text;
}

/** Mirrors the library's block dispatch: only paragraph lines reach this extension. */
function startsOtherBlock(line: string, next: string | undefined): boolean {
  if (!/^[a-z]/i.test(line) && (BLOCK_START.test(line) || LIST_MARKER.test(line))) return true;
  return htmlBlockStart(line) !== 0 || (next !== undefined && looksLikeTableHeader(line, next));
}

function interruptsParagraph(line: string, next: string | undefined): boolean {
  if (BLOCK_START.test(line)) return true;
  const marker = LIST_MARKER.exec(line);
  if (
    marker &&
    marker[1]!.length <= 3 &&
    marker[4]?.trim() &&
    (!/\d/.test(marker[2]!) || Number.parseInt(marker[2]!, 10) === 1)
  )
    return true;
  const html = htmlBlockStart(line);
  if (html !== 0 && html !== 7) return true;
  return next !== undefined && looksLikeTableHeader(line, next);
}

function looksLikeTableHeader(header: string, delimiter: string): boolean {
  if (!header.includes("|")) return false;
  const cells = splitTableRow(delimiter);
  return (
    cells.length === splitTableRow(header).length &&
    cells.every((cell) => /^:?-+:?$/.test(cell.trim()))
  );
}

function splitTableRow(value: string): string[] {
  const row = value.trim();
  const cells: string[] = [];
  let current = "";
  for (let index = row.startsWith("|") ? 1 : 0; index < row.length; index += 1) {
    const char = row[index];
    if (char === "\\" && row[index + 1] === "|") {
      current += "|";
      index += 1;
      continue;
    }
    if (char === "|") {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  if (current || !row.endsWith("|") || !cells.length) cells.push(current.trim());
  return cells;
}

function isBlank(value: string): boolean {
  return /^\s*$/.test(value);
}

// ---------------------------------------------------------------------------------------------
// Streaming

const HOLD_BACK_WINDOW = 4096;
const TRAILING_ENTITY = /&#?[A-Za-z0-9]{0,32}$/;

/**
 * While streaming, hold back a trailing incomplete tag, comment or entity reference
 * (`<det`, `<a href="https://exa`, `&nbs`) so it never flashes as literal text. Fenced code
 * keeps every character because HTML is text there.
 */
export function holdBackPartialHtml(source: string): string {
  let cut = source.length;
  const entity = TRAILING_ENTITY.exec(source.slice(-34));
  if (entity) cut -= entity[0].length;

  // Check the last few `<` (a quoted value can contain one) within a bounded window.
  const floor = Math.max(0, source.length - HOLD_BACK_WINDOW);
  let lt = source.lastIndexOf("<");
  for (let candidates = 0; lt >= floor && candidates < 4; candidates += 1) {
    const end = scanRawHtml(source, lt);
    if (end > 0) break;
    // A tag cannot span a blank line; only comments and similar constructs can.
    if (
      end === RAW_HTML_INCOMPLETE &&
      (/^<[!?]/.test(source.slice(lt, lt + 2)) || !/\n[ \t]*\n/.test(source.slice(lt)))
    )
      cut = Math.min(cut, lt);
    if (lt === 0) break;
    lt = source.lastIndexOf("<", lt - 1);
  }
  if (cut === source.length || insideOpenFence(source, cut)) return source;
  return source.slice(0, cut);
}

function insideOpenFence(source: string, offset: number): boolean {
  let fence: string | null = null;
  for (const match of source.slice(0, offset).matchAll(/^ {0,3}(`{3,}|~{3,})(.*)$/gm)) {
    const marker = match[1]!;
    if (fence === null) fence = marker;
    else if (marker[0] === fence[0] && marker.length >= fence.length && !match[2]!.trim())
      fence = null;
  }
  return fence !== null;
}
