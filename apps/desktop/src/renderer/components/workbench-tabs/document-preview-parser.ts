import { DOMParser } from "@xmldom/xmldom";
import { openPreviewArchive, type PreviewArchive } from "./archive-preview-parser";
import type { DocumentBlock, DocumentFormat, StructuredDocument } from "./binary-preview-model";

type XmlElement = NonNullable<ReturnType<DOMParser["parseFromString"]>["documentElement"]>;
const localName = (node: XmlElement) => node.localName ?? node.tagName;
const textDecoder = new TextDecoder("utf-8", { fatal: true });
const OFFICE = "urn:oasis:names:tc:opendocument:xmlns:office:1.0";
const TABLE = "urn:oasis:names:tc:opendocument:xmlns:table:1.0";
const TEXT = "urn:oasis:names:tc:opendocument:xmlns:text:1.0";
const DRAW = "urn:oasis:names:tc:opendocument:xmlns:drawing:1.0";
const XLINK = "http://www.w3.org/1999/xlink";
const blocked = new Set([
  "script",
  "style",
  "head",
  "iframe",
  "object",
  "embed",
  "svg",
  "math",
  "form",
  "annotation",
]);

function xml(data: Uint8Array) {
  if (data.length > 8 * 1024 * 1024)
    throw new Error("Document XML exceeds the 8 MiB preview limit.");
  let source = textDecoder.decode(data);
  // EPUB often declares an external XHTML DTD. Discard it, never resolve it.
  source = source.replace(/<!DOCTYPE\s+[^<>[\]]*>/gi, "");
  if (/<!\s*(?:DOCTYPE|ENTITY)/i.test(source))
    throw new Error("Document entities are not supported.");
  const document = new DOMParser({
    onError: () => {
      throw new Error("Invalid document XML.");
    },
  }).parseFromString(source, "application/xml");
  if (!document.documentElement) throw new Error("Empty document XML.");
  let count = 0;
  const pending = [{ node: document.documentElement, depth: 0 }];
  while (pending.length) {
    const { node, depth } = pending.pop()!;
    if (++count > 100_000 || depth > 100)
      throw new Error("Document structure exceeds preview limits.");
    for (const child of children(node)) pending.push({ node: child, depth: depth + 1 });
  }
  return document;
}
function children(node: XmlElement): XmlElement[] {
  return Array.from(node.childNodes).filter((child) => child.nodeType === 1) as XmlElement[];
}
function descendants(node: XmlElement, namespace: string, name: string): XmlElement[] {
  return Array.from(node.getElementsByTagNameNS(namespace, name));
}
function content(node: XmlElement): string {
  if (blocked.has(localName(node).toLowerCase())) return "";
  if (node.namespaceURI === TEXT && node.localName === "s")
    return " ".repeat(Math.max(0, Math.min(100, Number(node.getAttributeNS(TEXT, "c")) || 1)));
  if (["br", "line-break"].includes(localName(node))) return "\n";
  if (node.localName === "tab") return "\t";
  return Array.from(node.childNodes)
    .map((child) =>
      child.nodeType === 1
        ? content(child as XmlElement)
        : child.nodeType === 3 || child.nodeType === 4
          ? (child.nodeValue ?? "")
          : "",
    )
    .join("");
}

/** Resolve archive-relative references only; no schemes, hosts, data URLs or root escapes. */
function relativePath(base: string, reference: string): string | null {
  if (!reference || /^[a-z][\w+.-]*:|^[/\\]/i.test(reference)) return null;
  try {
    const parts = base.split("/").slice(0, -1);
    for (const part of decodeURIComponent(reference.split(/[?#]/)[0]!).split("/")) {
      if (part === "..") {
        if (!parts.length) return null;
        parts.pop();
      } else if (part && part !== ".") {
        if (/[\\:]/.test(part) || [...part].some((char) => char.charCodeAt(0) < 32)) return null;
        parts.push(part);
      }
    }
    return parts.join("/");
  } catch {
    return null;
  }
}

class DocumentBuilder {
  document: StructuredDocument = { sections: [], truncated: false };
  characters = 0;
  items = 0;
  imageBytes = 0;
  text(text: string): string {
    const available = Math.max(0, 500_000 - this.characters);
    if (text.length > available) this.document.truncated = true;
    const value = text.slice(0, available);
    this.characters += value.length;
    return value;
  }
  add(blocks: DocumentBlock[], block: DocumentBlock) {
    if (++this.items > 10_000) {
      this.document.truncated = true;
      return;
    }
    blocks.push(block);
  }
  image(archive: PreviewArchive, base: string, src: string, alt: string): DocumentBlock | null {
    const path = relativePath(base, src);
    if (!path || !archive.entries.some((entry) => entry.path === path)) return null;
    const data = archive.read(path);
    if (this.imageBytes + data.length > 8 * 1024 * 1024) {
      this.document.truncated = true;
      return null;
    }
    const starts = (...signature: number[]) => signature.every((byte, i) => data[i] === byte);
    const mime = starts(0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10)
      ? "image/png"
      : starts(255, 216, 255)
        ? "image/jpeg"
        : starts(71, 73, 70, 56)
          ? "image/gif"
          : starts(82, 73, 70, 70) && new TextDecoder().decode(data.subarray(8, 12)) === "WEBP"
            ? "image/webp"
            : null;
    if (!mime) return null;
    this.imageBytes += data.length;
    return { kind: "image", data, mime, alt: this.text(alt || path) };
  }
  blocks(root: XmlElement, archive: PreviewArchive, base: string): DocumentBlock[] {
    const blocks: DocumentBlock[] = [];
    const walk = (node: XmlElement) => {
      const name = localName(node).toLowerCase();
      if (blocked.has(name) || this.items > 10_000 || this.characters >= 500_000) return;
      if (name === "img" || (node.namespaceURI === DRAW && name === "image")) {
        const image = this.image(
          archive,
          base,
          node.getAttribute("src") || node.getAttributeNS(XLINK, "href") || "",
          node.getAttribute("alt") || "",
        );
        if (image) this.add(blocks, image);
      } else if (name === "table") {
        const sourceRows =
          node.namespaceURI === TABLE
            ? descendants(node, TABLE, "table-row")
            : Array.from(node.getElementsByTagName("tr"));
        if (sourceRows.length > 200) this.document.truncated = true;
        const rows = sourceRows.slice(0, 200).map((row) =>
          children(row)
            .filter((cell) =>
              ["td", "th", "table-cell", "covered-table-cell"].includes(localName(cell)),
            )
            .slice(0, 50)
            .map((cell) => this.text(content(cell))),
        );
        if (rows.length) this.add(blocks, { kind: "table", rows });
        else for (const child of children(node)) walk(child);
      } else if (["p", "h", "h1", "h2", "h3", "h4", "h5", "h6", "li", "pre"].includes(name)) {
        const text = this.text(content(node));
        if (text.trim())
          this.add(blocks, { kind: name.startsWith("h") ? "heading" : "text", text });
        // Images remain in document order, but markup never becomes live DOM.
        for (const child of Array.from(node.getElementsByTagName("img"))) walk(child);
        for (const child of descendants(node, DRAW, "image")) walk(child);
      } else for (const child of children(node)) walk(child);
    };
    walk(root);
    return blocks;
  }
}

export function parseDocumentPreview(data: Uint8Array, format: DocumentFormat): StructuredDocument {
  if (data.length > 16 * 1024 * 1024) throw new Error("Document preview limit: 16 MiB.");
  const builder = new DocumentBuilder();
  if (format === "rtf") {
    const text = builder.text(extractRtf(new TextDecoder("windows-1252").decode(data)));
    builder.document.sections.push({ name: "Document", blocks: [{ kind: "text", text }] });
  } else {
    const archive = openPreviewArchive(data, "document.zip");
    if (format === "epub") {
      const container = xml(archive.read("META-INF/container.xml"));
      const rootfile = container
        .getElementsByTagNameNS("*", "rootfile")[0]
        ?.getAttribute("full-path");
      const packagePath = rootfile && relativePath("", rootfile);
      if (!packagePath) throw new Error("EPUB has no readable package.");
      const book = xml(archive.read(packagePath));
      const manifest = new Map(
        Array.from(book.getElementsByTagNameNS("*", "item")).map((item) => [
          item.getAttribute("id"),
          item,
        ]),
      );
      const spine = Array.from(book.getElementsByTagNameNS("*", "itemref"));
      if (spine.length > 100) builder.document.truncated = true;
      for (const item of spine.slice(0, 100)) {
        const resource = manifest.get(item.getAttribute("idref"));
        if (
          !resource ||
          !["application/xhtml+xml", "text/html"].includes(
            resource.getAttribute("media-type") ?? "",
          )
        )
          continue;
        const path = relativePath(packagePath, resource.getAttribute("href") || "");
        if (!path) continue;
        const chapter = xml(archive.read(path));
        const title =
          chapter.getElementsByTagNameNS("*", "title")[0]?.textContent ||
          `Chapter ${builder.document.sections.length + 1}`;
        builder.document.sections.push({
          name: builder.text(title),
          blocks: builder.blocks(chapter.documentElement!, archive, path),
        });
      }
    } else {
      const document = xml(archive.read("content.xml"));
      const body = document.getElementsByTagNameNS(OFFICE, "body")[0];
      if (!body) throw new Error("OpenDocument has no readable body.");
      if (format === "ods") {
        const sheets = descendants(body, TABLE, "table");
        if (sheets.length > 30) builder.document.truncated = true;
        for (const sheet of sheets.slice(0, 30)) {
          const rows: string[][] = [];
          for (const row of descendants(sheet, TABLE, "table-row")) {
            if (rows.length >= 200) {
              builder.document.truncated = true;
              break;
            }
            const cells: string[] = [];
            for (const cell of children(row).filter(
              (cell) =>
                cell.namespaceURI === TABLE &&
                ["table-cell", "covered-table-cell"].includes(localName(cell)),
            )) {
              const repeat = Math.max(
                1,
                Number(cell.getAttributeNS(TABLE, "number-columns-repeated")) || 1,
              );
              if (cells.length + repeat > 50) builder.document.truncated = true;
              const value =
                content(cell) ||
                cell.getAttributeNS(OFFICE, "string-value") ||
                cell.getAttributeNS(OFFICE, "value") ||
                cell.getAttributeNS(OFFICE, "date-value") ||
                cell.getAttributeNS(OFFICE, "boolean-value") ||
                "";
              const count = Math.min(repeat, 50 - cells.length);
              for (let i = 0; i < count; i++) cells.push(value);
              if (cells.length >= 50) break;
            }
            const repeat = Math.max(
              1,
              Number(row.getAttributeNS(TABLE, "number-rows-repeated")) || 1,
            );
            if (rows.length + repeat > 200) builder.document.truncated = true;
            const count = Math.min(repeat, 200 - rows.length);
            for (let i = 0; i < count; i++) rows.push(cells.map((value) => builder.text(value)));
          }
          builder.document.sections.push({
            name: builder.text(sheet.getAttributeNS(TABLE, "name") || "Sheet"),
            blocks: [{ kind: "table", rows }],
          });
        }
      } else if (format === "odp") {
        const slides = descendants(body, DRAW, "page");
        if (slides.length > 100) builder.document.truncated = true;
        for (const [i, slide] of slides.slice(0, 100).entries())
          builder.document.sections.push({
            name: builder.text(slide.getAttributeNS(DRAW, "name") || `Slide ${i + 1}`),
            blocks: builder.blocks(slide, archive, "content.xml"),
          });
      } else
        builder.document.sections.push({
          name: "Document",
          blocks: builder.blocks(body, archive, "content.xml"),
        });
    }
  }
  return builder.document;
}

/** Text only: ignore binary payloads, embedded objects, field instructions and metadata. */
export function extractRtf(source: string): string {
  if (!source.startsWith("{\\rtf")) throw new Error("Not an RTF document.");
  const stack: { skip: boolean; uc: number }[] = [];
  let state = { skip: false, uc: 1 },
    output = "",
    fallback = 0;
  const destinations = new Set([
    "fonttbl",
    "colortbl",
    "stylesheet",
    "info",
    "pict",
    "object",
    "fldinst",
    "header",
    "footer",
    "datastore",
    "themedata",
  ]);
  const append = (text: string) => {
    if (fallback) {
      fallback--;
      return;
    }
    if (!state.skip && output.length < 500_000) output += text;
  };
  for (let i = 0; i < source.length;) {
    const char = source[i++]!;
    if (char === "{") {
      if (stack.length > 100) throw new Error("RTF is nested too deeply.");
      stack.push(state);
      state = { skip: state.skip, uc: state.uc };
    } else if (char === "}") {
      state = stack.pop() ?? { skip: true, uc: 1 };
    } else if (char !== "\\") {
      if (char !== "\r" && char !== "\n") append(char);
    } else {
      const next = source[i++];
      if (next === "*") state.skip = true;
      else if (next === "'") {
        const hex = source.slice(i, i + 2);
        i += 2;
        if (/^[\da-f]{2}$/i.test(hex))
          append(new TextDecoder("windows-1252").decode(new Uint8Array([parseInt(hex, 16)])));
      } else if (next && /[a-z]/i.test(next)) {
        i--;
        const match = /^([a-z]+)(-?\d+)? ?/i.exec(source.slice(i));
        if (!match) continue;
        i += match[0].length;
        const word = match[1]!,
          number = Number(match[2]);
        if (destinations.has(word)) state.skip = true;
        else if (word === "bin") {
          if (!Number.isSafeInteger(number) || number < 0 || i + number > source.length)
            throw new Error("Invalid RTF binary content.");
          i += number;
        } else if (word === "uc") state.uc = Math.min(16, Math.max(0, number || 0));
        else if (word === "u" && Number.isInteger(number)) {
          fallback = 0;
          append(String.fromCharCode(number & 0xffff));
          fallback = state.uc;
        } else if (word === "par" || word === "line") append("\n");
        else if (word === "tab") append("\t");
      } else if (next && "\\{}".includes(next)) append(next);
      else if (next === "~") append("\u00a0");
    }
  }
  return output.trim();
}
