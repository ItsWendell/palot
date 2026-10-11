import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { unzipSync, zipSync } from "fflate";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseOfficePreview } from "./office-preview-parser";

function fixture(name: string): Uint8Array {
  return new Uint8Array(
    readFileSync(join(dirname(fileURLToPath(import.meta.url)), "__fixtures__/office", name)),
  );
}

function modified(name: string, modify: (parts: Record<string, Uint8Array>) => void): Uint8Array {
  const parts = unzipSync(fixture(name));
  modify(parts);
  return zipSync(parts);
}

const text = (value: string) => new TextEncoder().encode(value);
const xml = (data: Uint8Array) => new TextDecoder().decode(data);

afterEach(() => vi.unstubAllGlobals());

describe("local Office parsing", () => {
  it("extracts real DOCX headings, basic emphasis and table content without following links", async () => {
    const fetch = vi.fn(() => {
      throw new Error("Unexpected network request");
    });
    vi.stubGlobal("fetch", fetch);
    const doc = await parseOfficePreview(fixture("word.docx"), "docx");
    expect(doc.truncated).toBe(false);
    expect(doc.sections[0]?.blocks).toContainEqual({
      kind: "heading",
      level: 1,
      runs: [{ text: "Quarterly report", bold: undefined, italic: undefined }],
    });
    expect(doc.sections[0]?.blocks).toContainEqual({
      kind: "paragraph",
      level: 1,
      runs: [
        { text: "Strong", bold: true, italic: undefined },
        { text: " emphasis", bold: undefined, italic: true },
      ],
    });
    expect(doc.sections[0]?.blocks).toContainEqual({
      kind: "table",
      rows: [
        [
          { text: "Revenue", rowSpan: 1, colSpan: 1 },
          { text: "42", rowSpan: 1, colSpan: 1 },
        ],
      ],
    });
    expect(JSON.stringify(doc)).toContain("<script>alert(1)</script>");
    expect(JSON.stringify(doc)).not.toContain("https://example.invalid");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("preserves DOCX table coordinates, horizontal/vertical spans and paragraph boundaries", async () => {
    const data = modified("word.docx", (parts) => {
      parts["word/document.xml"] = text(
        `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:tbl><w:tblGrid><w:gridCol/><w:gridCol/><w:gridCol/></w:tblGrid><w:tr><w:tc><w:tcPr><w:vMerge w:val="restart"/></w:tcPr><w:p><w:r><w:t>First</w:t></w:r><w:r><w:t xml:space="preserve"> paragraph</w:t></w:r></w:p><w:p><w:r><w:t>Second paragraph</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr><w:p><w:r><w:t>Wide header</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:tcPr><w:vMerge/></w:tcPr><w:p/></w:tc><w:tc><w:p><w:r><w:t>Left value</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Right value</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>`,
      );
    });
    const doc = await parseOfficePreview(data, "docx");
    expect(doc.truncated).toBe(false);
    expect(doc.sections[0]?.blocks).toEqual([
      {
        kind: "table",
        rows: [
          [
            { text: "First paragraph\nSecond paragraph", rowSpan: 2, colSpan: 1 },
            { text: "Wide header", rowSpan: 1, colSpan: 2 },
            null,
          ],
          [
            null,
            { text: "Left value", rowSpan: 1, colSpan: 1 },
            { text: "Right value", rowSpan: 1, colSpan: 1 },
          ],
        ],
      },
    ]);
  });

  it("clips table spans and coordinates to the preview window and charges expanded grid slots", async () => {
    const wrap = (tables: string) =>
      `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${tables}</w:body></w:document>`;
    const wide =
      '<w:tbl><w:tr><w:tc><w:tcPr><w:gridSpan w:val="1000"/></w:tcPr><w:p><w:r><w:t>Wide</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Outside preview</w:t></w:r></w:p></w:tc></w:tr></w:tbl>';
    const parseTables = async (tables: string) =>
      parseOfficePreview(
        modified("word.docx", (parts) => {
          parts["word/document.xml"] = text(wrap(tables));
        }),
        "docx",
      );
    const doc = await parseTables(wide);
    expect(doc.truncated).toBe(true);
    const table = doc.sections[0]?.blocks[0];
    expect(table?.kind).toBe("table");
    if (table?.kind !== "table") throw new Error("Expected a table");
    expect(table.rows[0]).toHaveLength(50);
    expect(table.rows[0]?.[0]).toEqual({ text: "Wide", rowSpan: 1, colSpan: 50 });
    expect(table.rows[0]?.slice(1).every((cell) => cell === null)).toBe(true);
    expect(JSON.stringify(table)).not.toContain("Outside preview");

    const tall = await parseTables(
      '<w:tbl><w:tr><w:tc><w:tcPr><w:vMerge w:val="restart"/></w:tcPr><w:p><w:r><w:t>Tall</w:t></w:r></w:p></w:tc></w:tr>' +
        "<w:tr><w:tc><w:tcPr><w:vMerge/></w:tcPr><w:p/></w:tc></w:tr>".repeat(200) +
        "</w:tbl>",
    );
    const tallTable = tall.sections[0]?.blocks[0];
    expect(tall.truncated).toBe(true);
    if (tallTable?.kind !== "table") throw new Error("Expected a table");
    expect(tallTable.rows).toHaveLength(200);
    expect(tallTable.rows[0]?.[0]).toEqual({ text: "Tall", rowSpan: 200, colSpan: 1 });
    expect(tallTable.rows.at(-1)).toEqual([null]);

    const repeated = await parseTables(wide.repeat(500));
    expect(repeated.truncated).toBe(true);
    const slots = repeated.sections[0]?.blocks.reduce(
      (count, block) =>
        count +
        (block.kind === "table" ? block.rows.reduce((total, row) => total + row.length, 0) : 0),
      0,
    );
    expect(slots).toBeGreaterThan(50);
    expect(slots).toBeLessThanOrEqual(10_000);
  });

  it("reads real XLSX sheets and sparse coordinates, displaying cached values without evaluating formulas", async () => {
    const fetch = vi.fn(() => {
      throw new Error("Formula was evaluated");
    });
    vi.stubGlobal("fetch", fetch);
    const doc = await parseOfficePreview(fixture("workbook.xlsx"), "xlsx");
    expect(doc.sheets.map((sheet) => sheet.name)).toEqual(["Budget", "Notes"]);
    expect(doc.sheets[0]?.columns).toBe(4);
    expect(doc.sheets[0]?.rows.map((row) => row.number)).toEqual([1, 3]);
    expect(doc.sheets[0]?.rows[0]?.cells[0]).toBe("Revenue");
    expect(doc.sheets[0]?.rows[0]?.cells[1]).toBe("12.5");
    expect(doc.sheets[0]?.rows[0]?.cells[2]).toBeUndefined();
    expect(doc.sheets[0]?.rows[0]?.cells[3]).toBe("99");
    expect(doc.sheets[0]?.rows[1]?.cells).toEqual(["TRUE"]);
    expect(doc.sheets[1]?.rows[0]).toMatchObject({
      number: 2,
      cells: [undefined, undefined, "<img src=x onerror=alert(1)>"],
    });
    expect(JSON.stringify(doc)).not.toContain("WEBSERVICE");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("reads real PPTX slide content in presentation order rather than filename order", async () => {
    const doc = await parseOfficePreview(fixture("slides.pptx"), "pptx");
    expect(doc.sections).toHaveLength(2);
    expect(JSON.stringify(doc.sections[0])).toContain("Overview");
    expect(JSON.stringify(doc.sections[0])).toContain("First slide");
    expect(JSON.stringify(doc.sections[1])).toContain("Results");
    expect(JSON.stringify(doc.sections[1])).toContain("Second slide");
  });

  it("keeps separate paragraphs in PPTX table cells without separating their inline runs", async () => {
    const data = modified("slides.pptx", (parts) => {
      const table =
        '<p:graphicFrame><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblGrid><a:gridCol w="1000"/><a:gridCol w="1000"/></a:tblGrid><a:tr h="1000"><a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:t>First</a:t></a:r><a:r><a:t xml:space="preserve"> paragraph</a:t></a:r></a:p><a:p><a:r><a:t>Second paragraph</a:t></a:r></a:p></a:txBody></a:tc><a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:t>Right value</a:t></a:r></a:p></a:txBody></a:tc></a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame>';
      parts["ppt/slides/slide2.xml"] = text(
        xml(parts["ppt/slides/slide2.xml"]!).replace("</p:spTree>", table + "</p:spTree>"),
      );
    });
    const doc = await parseOfficePreview(data, "pptx");
    expect(doc.truncated).toBe(false);
    expect(doc.sections[0]?.blocks).toContainEqual({
      kind: "table",
      rows: [
        [
          { text: "First paragraph\nSecond paragraph", rowSpan: 1, colSpan: 1 },
          { text: "Right value", rowSpan: 1, colSpan: 1 },
        ],
      ],
    });
  });

  it.each(["docx", "xlsx", "pptx"] as const)(
    "rejects malformed %s archives and wrong packages",
    async (format) => {
      await expect(
        parseOfficePreview(text("PK\u0003\u0004broken archive"), format),
      ).rejects.toMatchObject({ code: "invalid" });
      await expect(
        parseOfficePreview(zipSync({ "not-office.txt": text("hello") }), format),
      ).rejects.toMatchObject({ code: "invalid" });
    },
  );

  it("rejects truncated packages, invalid document XML and encrypted Office containers", async () => {
    const data = fixture("word.docx");
    await expect(
      parseOfficePreview(data.subarray(0, data.length - 30), "docx"),
    ).rejects.toMatchObject({ code: "invalid" });
    await expect(
      parseOfficePreview(
        modified("word.docx", (parts) => {
          parts["word/document.xml"] = text("<w:document><w:body>");
        }),
        "docx",
      ),
    ).rejects.toMatchObject({ code: "invalid" });
    await expect(
      parseOfficePreview(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), "xlsx"),
    ).rejects.toMatchObject({ code: "encrypted" });
  });

  it("rejects malformed worksheet and slide XML instead of silently showing partial content", async () => {
    await expect(
      parseOfficePreview(
        modified("workbook.xlsx", (parts) => {
          parts["xl/worksheets/sheet1.xml"] = text("<worksheet><sheetData><row>");
        }),
        "xlsx",
      ),
    ).rejects.toMatchObject({ code: "invalid" });
    await expect(
      parseOfficePreview(
        modified("slides.pptx", (parts) => {
          parts["ppt/slides/slide1.xml"] = text("<p:sld><p:cSld>");
        }),
        "pptx",
      ),
    ).rejects.toMatchObject({ code: "invalid" });
  });

  it.each(["word/vbaProject.bin", "word/activeX/control.xml", "word/embeddings/document.docx"])(
    "rejects executable or nested package part %s",
    async (part) => {
      await expect(
        parseOfficePreview(
          modified("word.docx", (parts) => {
            parts[part] = text("payload");
          }),
          "docx",
        ),
      ).rejects.toMatchObject({ code: "unsupported" });
    },
  );

  it("rejects DTDs, embedded alternative formats, path traversal and macro types even when renamed", async () => {
    for (const content of [
      '<!DOCTYPE document [<!ENTITY x SYSTEM "https://example.invalid/entity">]><w:document/>',
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:altChunk/></w:body></w:document>',
    ]) {
      await expect(
        parseOfficePreview(
          modified("word.docx", (parts) => {
            parts["word/document.xml"] = text(content);
          }),
          "docx",
        ),
      ).rejects.toMatchObject({ code: "unsupported" });
    }
    await expect(
      parseOfficePreview(
        modified("word.docx", (parts) => {
          parts["../document.xml"] = text("payload");
        }),
        "docx",
      ),
    ).rejects.toMatchObject({ code: "invalid" });
    await expect(
      parseOfficePreview(
        modified("word.docx", (parts) => {
          parts["[Content_Types].xml"] = text(
            xml(parts["[Content_Types].xml"]!).replace(
              "wordprocessingml.document",
              "wordprocessingml.document.macroEnabled",
            ),
          );
        }),
        "docx",
      ),
    ).rejects.toMatchObject({ code: "unsupported" });
  });

  it("bounds compressed bytes, archive entry count and actual decompression despite false ZIP sizes", async () => {
    await expect(
      parseOfficePreview(new Uint8Array(16 * 1024 * 1024 + 1), "docx"),
    ).rejects.toMatchObject({ code: "limit" });
    const many = modified("word.docx", (parts) => {
      for (let i = 0; i < 2_048; i++) parts[`parts/${i}.bin`] = new Uint8Array();
    });
    await expect(parseOfficePreview(many, "docx")).rejects.toMatchObject({ code: "limit" });
    const bomb = modified("word.docx", (parts) => {
      parts["junk.bin"] = new Uint8Array(33 * 1024 * 1024);
    });
    // Lie in the local ZIP header. The compressed stream still expands past the actual-byte budget.
    const header = new DataView(bomb.buffer);
    for (let i = 0; i + 30 < bomb.length; i++) {
      if (
        header.getUint32(i, true) === 0x04034b50 &&
        xml(bomb.subarray(i + 30, i + 38)) === "junk.bin"
      ) {
        header.setUint32(i + 22, 1, true);
        break;
      }
    }
    await expect(parseOfficePreview(bomb, "docx")).rejects.toMatchObject({ code: "limit" });
    const markupBomb = modified("word.docx", (parts) => {
      parts["word/document.xml"] = text(`<document>${"<node/>".repeat(100_001)}</document>`);
    });
    await expect(parseOfficePreview(markupBomb, "docx")).rejects.toMatchObject({ code: "limit" });
  });

  it("truncates output text and rows/columns without allocating a spreadsheet's claimed dimensions", async () => {
    const largeWord = modified("word.docx", (parts) => {
      const paragraph = `<w:p><w:r><w:t>${"x".repeat(10_000)}</w:t></w:r></w:p>`;
      parts["word/document.xml"] = text(
        `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraph.repeat(60)}</w:body></w:document>`,
      );
    });
    const word = await parseOfficePreview(largeWord, "docx");
    expect(word.truncated).toBe(true);
    expect(word.sections[0]?.blocks).toHaveLength(50);
    const wideSheet = modified("workbook.xlsx", (parts) => {
      parts["xl/worksheets/sheet1.xml"] = text(
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:XFD1048576"/><sheetData><row r="1"><c r="A1"><v>1</v></c><c r="AY1"><v>2</v></c></row><row r="201"><c r="A201"><v>3</v></c></row></sheetData></worksheet>',
      );
    });
    const book = await parseOfficePreview(wideSheet, "xlsx");
    expect(book.truncated).toBe(true);
    expect(book.sheets[0]).toEqual({
      name: "Budget",
      columns: 1,
      rows: [{ number: 1, cells: ["1"] }],
    });
  });
});
