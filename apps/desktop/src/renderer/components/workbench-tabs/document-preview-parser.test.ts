import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import { extractRtf, parseDocumentPreview } from "./document-preview-parser";

const odf = (body: string) =>
  zipSync({
    "content.xml": strToU8(
      `<o:document-content xmlns:o="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:t="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:s="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:d="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0"><o:body>${body}</o:body></o:document-content>`,
    ),
  });
describe("structured document previews", () => {
  it("extracts ODT and ODP with namespace aliases, without script content", () => {
    expect(
      parseDocumentPreview(
        odf(
          "<o:text><t:h>Title</t:h><t:p>Hello &lt;script&gt;</t:p><script>evil()</script></o:text>",
        ),
        "odt",
      ).sections[0]?.blocks,
    ).toEqual([
      { kind: "heading", text: "Title" },
      { kind: "text", text: "Hello <script>" },
    ]);
    const slides = parseDocumentPreview(
      odf(
        '<o:presentation><d:page d:name="One"><t:p>First</t:p></d:page><d:page d:name="Two"><t:p>Second</t:p></d:page></o:presentation>',
      ),
      "odp",
    );
    expect(slides.sections.map((section) => section.name)).toEqual(["One", "Two"]);
  });
  it("bounds ODS repeated rows and columns and preserves saved values", () => {
    const doc = parseDocumentPreview(
      odf(
        '<o:spreadsheet><s:table s:name="Data"><s:table-row s:number-rows-repeated="10000000"><s:table-cell s:number-columns-repeated="10000000" o:value="42"/></s:table-row></s:table></o:spreadsheet>',
      ),
      "ods",
    );
    const block = doc.sections[0]?.blocks[0];
    expect(block?.kind).toBe("table");
    if (block?.kind !== "table") throw new Error("missing table");
    expect(block.rows).toHaveLength(200);
    expect(block.rows[0]).toHaveLength(50);
    expect(block.rows[0]?.[49]).toBe("42");
    expect(doc.truncated).toBe(true);
  });
  it("follows EPUB spine order and embeds only archive raster images", () => {
    const epub = zipSync({
      "META-INF/container.xml": strToU8(
        '<container><rootfiles><rootfile full-path="book/package.opf"/></rootfiles></container>',
      ),
      "book/package.opf": strToU8(
        '<package><manifest><item id="a" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="a"/></spine></package>',
      ),
      "book/chapter.xhtml": strToU8(
        '<!DOCTYPE html><html><head><title>Chapter one</title><script>bad()</script></head><body><h1>Hello</h1><p>Safe<img src="../cover.png" alt="Cover"/></p><img src="https://example.invalid/tracker.png"/><iframe src="file:///etc/passwd"/><script>bad()</script></body></html>',
      ),
      "cover.png": new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    });
    const doc = parseDocumentPreview(epub, "epub");
    expect(doc.sections[0]?.name).toBe("Chapter one");
    expect(doc.sections[0]?.blocks).toMatchObject([
      { kind: "heading", text: "Hello" },
      { kind: "text", text: "Safe" },
      { kind: "image", mime: "image/png", alt: "Cover" },
    ]);
    expect(doc.sections[0]?.blocks).toHaveLength(3);
  });
  it("rejects entities and extracts RTF Unicode while ignoring objects and instructions", () => {
    expect(() =>
      parseDocumentPreview(
        zipSync({ "content.xml": strToU8('<!DOCTYPE x [<!ENTITY x "evil">]><x/>') }),
        "odt",
      ),
    ).toThrow(/entities/);
    expect(
      extractRtf(
        "{\\rtf1\\ansi Hello \\u233?\\par {\\pict deadbeef}{\\*\\fldinst INCLUDEPICTURE http://bad}world}",
      ),
    ).toBe("Hello é\nworld");
  });
});
