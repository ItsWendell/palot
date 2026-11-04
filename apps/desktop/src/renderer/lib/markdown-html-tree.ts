/**
 * Element trees for raw HTML in Markdown, built through a GitHub-style allowlist.
 *
 * Raw HTML fragments (`html` blocks and `inlineHtml` nodes from markdown-html.ts) are tokenized
 * and assembled with the surrounding Markdown children into one tree, so an open tag in one
 * fragment wraps the Markdown that follows until its close tag. Tree construction is a small
 * subset of the HTML parser (implied end tags, scopes, void elements). Only allowlisted tags
 * written in lowercase become elements; every other tag stays literal text exactly as written,
 * so nothing is hidden. Attributes are filtered per tag. Nothing here produces HTML strings: the
 * renderer turns the tree into React elements and screens URLs with the document's Markdown URL
 * policy.
 */

import { decodeEntities, isAllowedHtmlTag } from "./markdown-html";

interface HtmlAttribute {
  name: string;
  value: string;
}

export type HtmlToken =
  | { type: "text"; value: string }
  | { type: "start"; tag: string; attributes: readonly HtmlAttribute[]; raw: string }
  | { type: "end"; tag: string; raw: string };

export interface HtmlTreeElement<Leaf> {
  kind: "element";
  tag: string;
  /** Allowed attributes only, in a null-prototype record. URL attributes (href, src, srcset) keep
   * their raw, entity-encoded value for the URL policy; every other value is decoded. */
  attributes: Readonly<Record<string, string>>;
  children: HtmlTreeNode<Leaf>[];
  key: string;
  /** Source positions (block indices for document trees) of the start tag and of the token that
   * closed the element, for memoizing settled subtrees while streaming. */
  first: number;
  last: number;
  /** Open ancestor tags when the element started; tree construction depends on them. */
  context: string;
}

export type HtmlTreeNode<Leaf> =
  | HtmlTreeElement<Leaf>
  | { kind: "text"; value: string }
  | {
      kind: "leaf";
      leaf: Leaf;
      key: string;
      position: number;
      /** Open HTML elements around the leaf, counting outer trees, for the nesting cap. */
      depth: number;
    };

/** Open raw HTML elements allowed at once, across nested Markdown containers. Deeper start tags
 * stay literal text, so `"<b>".repeat(10000)` cannot exhaust the stack. */
export const MAX_HTML_DEPTH = 64;

// Allowlist -----------------------------------------------------------------------------------

/** Elements whose contents the tokenizer keeps as literal text up to the matching end tag. */
const RAW_TEXT = new Set(["script", "style"]);

const VOID = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "keygen",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

const GLOBAL_ATTRIBUTES = new Set(["title", "lang", "dir"]);
const ALIGNED = ["align"];
// Maps and sets, never object literals: tag or attribute names such as `constructor` must not
// resolve to Object.prototype members.
const TAG_ATTRIBUTES = new Map<string, ReadonlySet<string>>(
  Object.entries({
    a: ["href"],
    img: ["src", "alt", "width", "height", "align"],
    source: ["srcset", "media"],
    td: ["align", "valign", "colspan", "rowspan"],
    th: ["align", "valign", "colspan", "rowspan", "scope"],
    tr: ["align", "valign"],
    thead: ALIGNED,
    tbody: ALIGNED,
    tfoot: ALIGNED,
    ol: ["start", "type", "reversed"],
    li: ["value"],
    details: ["open"],
    time: ["datetime"],
    p: ALIGNED,
    div: ALIGNED,
    h1: ALIGNED,
    h2: ALIGNED,
    h3: ALIGNED,
    h4: ALIGNED,
    h5: ALIGNED,
    h6: ALIGNED,
  }).map(([tag, names]) => [tag, new Set(names)]),
);
/** Longest kept value per URL attribute; longer values are dropped rather than truncated. Inline
 * `data:image` sources can be large, links and srcset candidates cannot. */
const URL_ATTRIBUTE_LIMITS = new Map([
  ["href", 8192],
  ["srcset", 8192],
  ["src", 1024 * 1024],
]);
const TEXT_ATTRIBUTE_LIMIT = 1000;
const MAX_ATTRIBUTES = 64;

function allowedAttributes(
  tag: string,
  attributes: readonly HtmlAttribute[],
): Record<string, string> {
  const result: Record<string, string> = Object.create(null);
  const names = TAG_ATTRIBUTES.get(tag);
  for (const { name, value } of attributes) {
    if (Object.hasOwn(result, name)) continue;
    if (!GLOBAL_ATTRIBUTES.has(name) && !names?.has(name)) continue;
    const urlLimit = URL_ATTRIBUTE_LIMITS.get(name);
    if (urlLimit !== undefined) {
      if (value.length <= urlLimit) result[name] = value;
      continue;
    }
    result[name] = decodeEntities(value.slice(0, TEXT_ATTRIBUTE_LIMIT));
  }
  return result;
}

// Tokenizer -----------------------------------------------------------------------------------

/** Cached fragments are budgeted by source size: a streaming HTML block is a new string on
 * every delta. */
const TOKEN_CACHE_BUDGET = 1024 * 1024;
const tokenCache = new Map<string, readonly HtmlToken[]>();
let tokenCacheSize = 0;

/** Tokenize a raw HTML fragment (HTML5-style, forgiving) in linear time. Results are immutable
 * and cached unless `cache` is false (the still-growing tail of a streaming document). */
export function tokenizeHtml(source: string, cache = true): readonly HtmlToken[] {
  const cached = tokenCache.get(source);
  if (cached) return cached;
  const tokens = Object.freeze(tokenize(source));
  if (!cache || source.length > TOKEN_CACHE_BUDGET / 4) return tokens;
  if (tokenCacheSize + source.length > TOKEN_CACHE_BUDGET) {
    tokenCache.clear();
    tokenCacheSize = 0;
  }
  tokenCache.set(source, tokens);
  tokenCacheSize += source.length;
  return tokens;
}

/** For tests: how much source text the token cache holds. */
export function htmlTokenCacheStats(): { entries: number; size: number } {
  return { entries: tokenCache.size, size: tokenCacheSize };
}

/**
 * Only allowlisted tags written in lowercase become start/end tokens. Every other tag-like
 * construct (`<Button>`, `<string>`, `<script>`, `<!DOCTYPE …>`, `<?php …?>`) stays literal
 * text exactly as written, closing tags included; `script`/`style` contents stay literal up to
 * their end tag. Comments render nothing. A tag cut off by the end of the fragment ends the
 * scan: the rest stays literal text, so no `<` is ever rescanned to the end.
 */
function tokenize(source: string): HtmlToken[] {
  const tokens: HtmlToken[] = [];
  let text = "";
  const flush = () => {
    if (text) tokens.push({ type: "text", value: decodeEntities(text) });
    text = "";
  };
  const literal = (value: string) => {
    flush();
    if (value) tokens.push({ type: "text", value });
  };
  let index = 0;
  while (index < source.length) {
    const lt = source.indexOf("<", index);
    if (lt === -1) {
      text += source.slice(index);
      break;
    }
    text += source.slice(index, lt);
    const next = source[lt + 1] ?? "";
    if (source.startsWith("<!--", lt)) {
      // `<!-->` and `<!--->` are complete empty comments, so search from the opener's dashes.
      flush();
      index = closeAfter(source, "-->", lt + 2);
      continue;
    }
    if (next === "!" || next === "?") {
      const end = source.startsWith("<![CDATA[", lt)
        ? closeAfter(source, "]]>", lt + 9)
        : closeAfter(source, next === "?" ? "?>" : ">", lt + 2);
      literal(source.slice(lt, end));
      index = end;
      continue;
    }
    if (next === "/") {
      const name = /^<\/([A-Za-z][^\s/>]*)/.exec(source.slice(lt, lt + 128));
      if (!name) {
        text += "<";
        index = lt + 1;
        continue;
      }
      // An end tag runs to the next `>`; without one, the rest of the fragment is text.
      index = closeAfter(source, ">", lt + name[0].length);
      const raw = source.slice(lt, index);
      if (raw.endsWith(">") && isAllowedHtmlTag(name[1]!)) {
        flush();
        tokens.push({ type: "end", tag: name[1]!, raw });
      } else {
        literal(raw);
      }
      continue;
    }
    const start = readStartTag(source, lt);
    if (start === null) {
      text += "<";
      index = lt + 1;
      continue;
    }
    if (start === "eof") {
      literal(source.slice(lt));
      break;
    }
    index = start.end;
    const raw = source.slice(lt, start.end);
    if (isAllowedHtmlTag(start.tag)) {
      flush();
      tokens.push({ type: "start", tag: start.tag, attributes: start.attributes, raw });
      continue;
    }
    literal(raw);
    if (RAW_TEXT.has(start.tag.toLowerCase())) {
      const match = new RegExp(`</${start.tag}(?=[\\s/>]|$)`, "i").exec(source.slice(index));
      const contentEnd = match ? index + match.index : source.length;
      const end = match ? closeAfter(source, ">", contentEnd + 2) : source.length;
      literal(source.slice(index, end));
      index = end;
    }
  }
  flush();
  return tokens;
}

function closeAfter(source: string, marker: string, from: number): number {
  const close = source.indexOf(marker, from);
  return close === -1 ? source.length : close + marker.length;
}

/** A start tag, null when `<` does not begin one, or "eof" when the fragment ends inside it. */
function readStartTag(
  source: string,
  lt: number,
): { tag: string; attributes: HtmlAttribute[]; end: number } | null | "eof" {
  const name = /^<([A-Za-z][^\s/>]*)/.exec(source.slice(lt, lt + 128));
  if (!name) return null;
  const attributes: HtmlAttribute[] = [];
  let index = lt + name[0].length;
  const length = source.length;
  while (index < length) {
    const code = source.charCodeAt(index);
    if (code === 0x3e /* > */) return { tag: name[1]!, attributes, end: index + 1 };
    if (code === 0x2f /* / */ || isSpace(code)) {
      index += 1;
      continue;
    }
    let nameEnd = index + 1;
    while (nameEnd < length && !endsAttributeName(source.charCodeAt(nameEnd))) nameEnd += 1;
    const attributeName = source.slice(index, nameEnd).toLowerCase();
    index = skipSpaces(source, nameEnd);
    let value = "";
    if (source.charCodeAt(index) === 0x3d /* = */) {
      index = skipSpaces(source, index + 1);
      const quote = source[index];
      if (quote === '"' || quote === "'") {
        const close = source.indexOf(quote, index + 1);
        if (close === -1) return "eof";
        value = source.slice(index + 1, close);
        index = close + 1;
      } else {
        let valueEnd = index;
        while (valueEnd < length) {
          const valueCode = source.charCodeAt(valueEnd);
          if (valueCode === 0x3e || isSpace(valueCode)) break;
          valueEnd += 1;
        }
        value = source.slice(index, valueEnd);
        index = valueEnd;
      }
    }
    if (attributes.length < MAX_ATTRIBUTES) attributes.push({ name: attributeName, value });
  }
  return "eof";
}

function isSpace(code: number): boolean {
  return code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0c || code === 0x0d;
}

function endsAttributeName(code: number): boolean {
  return isSpace(code) || code === 0x2f || code === 0x3e || code === 0x3d;
}

function skipSpaces(source: string, index: number): number {
  let cursor = index;
  while (cursor < source.length && isSpace(source.charCodeAt(cursor))) cursor += 1;
  return cursor;
}

// Tree construction ---------------------------------------------------------------------------

const BLOCK_LEVEL = new Set([
  "address",
  "article",
  "aside",
  "blockquote",
  "caption",
  "center",
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
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hgroup",
  "hr",
  "li",
  "main",
  "menu",
  "nav",
  "ol",
  "p",
  "pre",
  "section",
  "summary",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "tr",
  "ul",
]);
/** Start tags that close an open `p` (HTML "in body" insertion mode). */
const CLOSES_P = new Set(
  [...BLOCK_LEVEL].filter(
    (tag) => !["caption", "tbody", "td", "tfoot", "th", "thead", "tr"].includes(tag),
  ),
);
const HEADINGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);
const FORMATTING = new Set([
  "a",
  "b",
  "big",
  "code",
  "em",
  "font",
  "i",
  "nobr",
  "s",
  "small",
  "strike",
  "strong",
  "tt",
  "u",
]);
/** Elements whose end tags close everything inside them (HTML "has an element in scope"). */
const SCOPE_BOUNDARY = new Set(["caption", "table", "td", "th"]);
/** Special elements stop "any other end tag" (span, kbd, …) from closing across them. */
const SPECIAL = new Set([...BLOCK_LEVEL, "br", "img", "wbr"]);
const TABLE_CONTEXT = new Set(["table", "tbody", "tfoot", "thead", "tr"]);
const TABLE_SECTIONS = new Set(["tbody", "tfoot", "thead"]);
/** Containers where whitespace-only text is never content. */
const STRUCTURAL = new Set([...TABLE_CONTEXT, "dl", "ol", "picture", "ul"]);
const ROOT_TAG = "#root";

/**
 * Builds one element tree from raw HTML tokens and opaque Markdown leaves in source order.
 * Unclosed elements end at `finish()`; stray end tags are ignored.
 */
export class HtmlTreeBuilder<Leaf> {
  readonly root: HtmlTreeElement<Leaf>;
  readonly #block: boolean;
  readonly #baseDepth: number;
  readonly #stack: HtmlTreeElement<Leaf>[];
  /** Start tags kept as literal text at the depth cap, per tag, so their end tags match. */
  readonly #overflow = new Map<string, number>();
  #position = 0;

  /** `block`: leaves are Markdown blocks, which close an open `p`. `depth`: HTML elements
   * already open around this tree (a Markdown container inside an outer element). */
  constructor(options: { block: boolean; key: string; depth?: number }) {
    this.#block = options.block;
    this.#baseDepth = options.depth ?? 0;
    this.root = {
      kind: "element",
      tag: ROOT_TAG,
      attributes: Object.create(null),
      children: [],
      key: options.key,
      first: 0,
      last: 0,
      context: "",
    };
    this.#stack = [this.root];
  }

  token(token: HtmlToken, key: string, position: number): void {
    this.#position = position;
    if (token.type === "text") this.#text(token.value);
    else if (token.type === "start") this.#start(token, key);
    else this.#end(token.tag, token.raw);
  }

  leaf(leaf: Leaf, key: string, position: number): void {
    this.#position = position;
    if (this.#block) {
      this.#closeParagraph();
      // Markdown blocks cannot sit between table rows; end the table so order is preserved.
      if (TABLE_CONTEXT.has(this.#current.tag)) this.#popThrough(this.#find("table")!);
    }
    this.#current.children.push({ kind: "leaf", leaf, key, position, depth: this.#depth });
  }

  /** Apply end tags that a Markdown leaf (a paragraph's trailing `</details>`) left unmatched. */
  closeTags(tags: readonly string[], position: number): void {
    this.#position = position;
    for (const tag of tags) this.#end(tag);
  }

  finish(position: number): HtmlTreeElement<Leaf> {
    this.#position = position;
    while (this.#stack.length > 1) this.#pop();
    this.root.last = position;
    finalizeChildren(this.root, this.#block);
    return this.root;
  }

  get #current(): HtmlTreeElement<Leaf> {
    return this.#stack.at(-1)!;
  }

  get #depth(): number {
    return this.#baseDepth + this.#stack.length - 1;
  }

  #text(value: string): void {
    if (!value) return;
    const current = this.#current;
    if (TABLE_CONTEXT.has(current.tag) && value.trim()) {
      // Foster-parent stray table text before the table, as browsers do.
      const table = this.#find("table")!;
      const parent = this.#stack[this.#stack.indexOf(table) - 1]!;
      parent.children.splice(parent.children.indexOf(table), 0, { kind: "text", value });
      return;
    }
    const last = current.children.at(-1);
    if (last?.kind === "text")
      current.children[current.children.length - 1] = { kind: "text", value: last.value + value };
    else current.children.push({ kind: "text", value });
  }

  #start(token: Extract<HtmlToken, { type: "start" }>, key: string): void {
    const { tag } = token;
    if (!isAllowedHtmlTag(tag)) return;
    // At the cap (with room for an implied tbody and tr) the tag stays literal text.
    if (!VOID.has(tag) && this.#depth >= MAX_HTML_DEPTH - 2) {
      this.#overflow.set(tag, (this.#overflow.get(tag) ?? 0) + 1);
      this.#text(token.raw);
      return;
    }
    if (!this.#impliedStart(tag, key)) return;
    const element = this.#element(tag, allowedAttributes(tag, token.attributes), key);
    this.#current.children.push(element);
    if (!VOID.has(tag)) this.#stack.push(element);
  }

  /** Implied end tags and parents for a start tag; false when the tag is ignored. */
  #impliedStart(tag: string, key: string): boolean {
    if (CLOSES_P.has(tag)) this.#closeParagraph();
    if (HEADINGS.has(tag) && HEADINGS.has(this.#current.tag)) this.#pop();
    if (tag === "li") this.#closeListItem(["li"]);
    if (tag === "dt" || tag === "dd") this.#closeListItem(["dd", "dt"]);
    if (tag === "a") {
      const open = this.#inScope("a");
      if (open) this.#popThrough(open);
    }
    if (TABLE_SECTIONS.has(tag) || tag === "caption") {
      const table = this.#inScope("table");
      if (!table) return false;
      this.#popTo(table);
      return true;
    }
    if (tag === "tr") {
      const section = this.#tableSection(key);
      return section !== null;
    }
    if (tag === "td" || tag === "th") {
      const cell = this.#inScope("td", "table") ?? this.#inScope("th", "table");
      if (cell) this.#popThrough(cell);
      if (this.#current.tag === "tr") return true;
      const section = this.#tableSection(key);
      if (!section) return false;
      const row = this.#element("tr", Object.create(null), `${key}:tr`);
      section.children.push(row);
      this.#stack.push(row);
      return true;
    }
    return true;
  }

  /** The open table section for a new row, implying `tbody`; null outside tables. */
  #tableSection(key: string): HtmlTreeElement<Leaf> | null {
    const table = this.#inScope("table");
    if (!table) return null;
    const section = this.#stack
      .slice(this.#stack.indexOf(table) + 1)
      .findLast((element) => TABLE_SECTIONS.has(element.tag));
    if (section) {
      this.#popTo(section);
      return section;
    }
    this.#popTo(table);
    const body = this.#element("tbody", Object.create(null), `${key}:tbody`);
    table.children.push(body);
    this.#stack.push(body);
    return body;
  }

  #end(tag: string, raw?: string): void {
    const overflow = raw === undefined ? 0 : (this.#overflow.get(tag) ?? 0);
    if (overflow > 0) {
      this.#overflow.set(tag, overflow - 1);
      this.#text(raw!);
      return;
    }
    if (HEADINGS.has(tag)) {
      const heading = this.#stack.findLast((element) => HEADINGS.has(element.tag));
      if (heading && this.#withinScope(heading)) this.#popThrough(heading);
      return;
    }
    if (BLOCK_LEVEL.has(tag) || FORMATTING.has(tag)) {
      // Table parts close within their table; other block and formatting tags stop at cells.
      const open = TABLE_CONTEXT.has(tag)
        ? this.#inScope(tag, tag === "table" ? ROOT_TAG : "table")
        : this.#inScope(tag);
      if (open) this.#popThrough(open);
      return;
    }
    // Any other end tag closes only across non-special elements.
    for (let index = this.#stack.length - 1; index > 0; index -= 1) {
      const element = this.#stack[index]!;
      if (element.tag === tag) {
        this.#popThrough(element);
        return;
      }
      if (SPECIAL.has(element.tag)) return;
    }
  }

  #closeParagraph(): void {
    const paragraph = this.#inScope("p");
    if (paragraph) this.#popThrough(paragraph);
  }

  #closeListItem(tags: readonly string[]): void {
    for (let index = this.#stack.length - 1; index > 0; index -= 1) {
      const element = this.#stack[index]!;
      if (tags.includes(element.tag)) {
        this.#popThrough(element);
        break;
      }
      if (SPECIAL.has(element.tag) && !["address", "div", "p"].includes(element.tag)) break;
    }
    this.#closeParagraph();
  }

  /** Nearest open `tag` not hidden behind a scope boundary (table, cell, caption). */
  #inScope(tag: string, boundary?: string): HtmlTreeElement<Leaf> | undefined {
    for (let index = this.#stack.length - 1; index > 0; index -= 1) {
      const element = this.#stack[index]!;
      if (element.tag === tag) return element;
      if (boundary ? element.tag === boundary : SCOPE_BOUNDARY.has(element.tag)) return undefined;
    }
    return undefined;
  }

  #withinScope(target: HtmlTreeElement<Leaf>): boolean {
    for (let index = this.#stack.length - 1; index > 0; index -= 1) {
      const element = this.#stack[index]!;
      if (element === target) return true;
      if (SCOPE_BOUNDARY.has(element.tag)) return false;
    }
    return false;
  }

  #find(tag: string): HtmlTreeElement<Leaf> | undefined {
    return this.#stack.findLast((element) => element.tag === tag);
  }

  #element(tag: string, attributes: Record<string, string>, key: string): HtmlTreeElement<Leaf> {
    return {
      kind: "element",
      tag,
      attributes,
      children: [],
      key,
      first: this.#position,
      last: this.#position,
      context: this.#current.context ? `${this.#current.context}>${this.#current.tag}` : ROOT_TAG,
    };
  }

  #popTo(element: HtmlTreeElement<Leaf>): void {
    while (this.#current !== element && this.#stack.length > 1) this.#pop();
  }

  #popThrough(element: HtmlTreeElement<Leaf>): void {
    this.#popTo(element);
    if (this.#current === element) this.#pop();
  }

  #pop(): void {
    const element = this.#stack.pop()!;
    element.last = this.#position;
    finalizeChildren(element, this.#block);
  }
}

function finalizeChildren<Leaf>(element: HtmlTreeElement<Leaf>, block: boolean): void {
  const { children, tag } = element;
  if (tag === "pre") {
    // The HTML parser drops one newline right after <pre>.
    const first = children[0];
    if (first?.kind === "text" && first.value.startsWith("\n"))
      children[0] = { kind: "text", value: first.value.slice(1) };
    return;
  }
  const blockContainer = tag === ROOT_TAG ? block : BLOCK_LEVEL.has(tag);
  if (!blockContainer && !STRUCTURAL.has(tag)) return;
  const structural = STRUCTURAL.has(tag);
  const blockish = (node: HtmlTreeNode<Leaf> | undefined) =>
    node === undefined ||
    (node.kind === "leaf" ? block : node.kind === "element" && BLOCK_LEVEL.has(node.tag));
  element.children = children.filter(
    (node, index) =>
      node.kind !== "text" ||
      /\S/.test(node.value) ||
      !(structural || blockish(children[index - 1]) || blockish(children[index + 1])),
  );
}

// Markdown leaves -----------------------------------------------------------------------------

/** End tags at the top level of a Markdown paragraph that no tag inside it opened. */
export function unmatchedEndTags(values: readonly string[]): string[] {
  const open: string[] = [];
  const unmatched: string[] = [];
  for (const value of values) {
    for (const token of tokenizeHtml(value)) {
      if (token.type === "start" && !VOID.has(token.tag)) open.push(token.tag);
      if (token.type !== "end") continue;
      const index = open.lastIndexOf(token.tag);
      if (index === -1) unmatched.push(token.tag);
      else open.length = index;
    }
  }
  return unmatched;
}

export function isBlockLevelHtmlElement(tag: string): boolean {
  return BLOCK_LEVEL.has(tag);
}

/** The literal text a raw HTML fragment shows, such as `<Button>` (for copy formats). */
export function htmlText(value: string): string {
  return tokenizeHtml(value)
    .flatMap((token) => (token.type === "text" ? [token.value] : []))
    .join("");
}
