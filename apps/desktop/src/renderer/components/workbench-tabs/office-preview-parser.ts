import { Unzip, UnzipInflate } from "fflate";
import { DOMParser } from "@xmldom/xmldom";
import { OfficeParser, type OfficeContentNode } from "officeparser/slim";
import {
  MAX_OFFICE_BYTES,
  OfficePreviewError,
  type OfficeBlock,
  type OfficeDocument,
  type OfficeFormat,
  type OfficeRun,
  type OfficeSheet,
  type OfficeTableCell,
} from "./office-preview-model";

const MAX_EXPANDED_BYTES = 32 * 1024 * 1024;
const MAX_PART_BYTES = 8 * 1024 * 1024;
const MAX_PARTS = 2_048;
const MAX_XML_MARKUP = 100_000;
const MAX_NODES = 10_000;
const MAX_TEXT = 500_000;
const MAX_ROWS = 200;
const MAX_COLUMNS = 50;

/** The maintained parser produces data only. Its HTML/Markdown generators are never used. */
export async function parseOfficePreview(
  data: Uint8Array,
  format: OfficeFormat,
): Promise<OfficeDocument> {
  validateOfficeArchive(data, format);
  let parserTruncated = false;
  try {
    const ast = await OfficeParser.parseOffice(data, {
      fileType: format,
      extractAttachments: false,
      ocr: false,
      includeRawContent: false,
      ignoreNotes: true,
      ignoreComments: true,
      ignoreHeadersAndFooters: true,
      ignoreSlideMasters: true,
      decompressionLimits: {
        maxUncompressedBytes: MAX_EXPANDED_BYTES,
        maxZipEntries: MAX_PARTS,
        maxXmlElements: MAX_XML_MARKUP,
        maxTableCells: MAX_NODES,
        maxRepeatedContent: MAX_TEXT,
      },
      onWarning(issue) {
        if (String(issue.code).includes("LIMIT_EXCEEDED")) parserTruncated = true;
      },
    });
    const budget = new RenderBudget();
    const sections: OfficeDocument["sections"] = [];
    const sheets: OfficeSheet[] = [];
    if (format === "xlsx") {
      for (const node of ast.content) {
        if (node.type !== "sheet") continue;
        if (sheets.length >= 30 || budget.exhausted) {
          budget.truncated = true;
          break;
        }
        sheets.push(readSheet(node, budget));
      }
    } else if (format === "pptx") {
      for (const node of ast.content) {
        if (node.type !== "slide") continue;
        if (sections.length >= 100 || budget.exhausted) {
          budget.truncated = true;
          break;
        }
        sections.push({
          name: `Slide ${sections.length + 1}`,
          blocks: readBlocks(node.children ?? [], budget),
        });
      }
    } else {
      sections.push({ name: "Document", blocks: readBlocks(ast.content, budget) });
    }
    return { format, sections, sheets, truncated: parserTruncated || budget.truncated };
  } catch (error) {
    if (error instanceof OfficePreviewError) throw error;
    throw new OfficePreviewError("invalid");
  }
}

/** Count actual inflated bytes, not attacker-controlled ZIP sizes, before handing anything to the parser. */
function validateOfficeArchive(data: Uint8Array, format: OfficeFormat) {
  if (data.length > MAX_OFFICE_BYTES) throw new OfficePreviewError("limit");
  if ([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1].every((value, i) => data[i] === value)) {
    throw new OfficePreviewError("encrypted");
  }
  if (data[0] !== 0x50 || data[1] !== 0x4b || data[2] !== 3 || data[3] !== 4) {
    throw new OfficePreviewError("invalid");
  }
  let failure: OfficePreviewError | null = null;
  let expanded = 0;
  let markup = 0;
  const names = new Set<string>();
  let contentTypes = "";
  const unzip = new Unzip((file) => {
    if (failure) return;
    if (names.size >= MAX_PARTS || (file.originalSize ?? 0) > MAX_EXPANDED_BYTES) {
      failure = new OfficePreviewError("limit");
      return;
    }
    if (
      names.has(file.name) ||
      file.name.includes("\\") ||
      file.name.startsWith("/") ||
      file.name.split("/").includes("..")
    ) {
      failure = new OfficePreviewError("invalid");
      return;
    }
    names.add(file.name);
    // Reject nested parsers, executable packages and controls, even when renamed to a modern extension.
    if (
      /(?:vbaProject|activeX|embeddings)\b/i.test(file.name) ||
      /\.(?:html?|mht|rtf|docx)$/i.test(file.name)
    ) {
      failure = new OfficePreviewError("unsupported");
      return;
    }
    const xml = /\.(?:xml|rels)$/i.test(file.name);
    let partSize = 0;
    const chunks: Uint8Array[] = [];
    file.ondata = (error, chunk, final) => {
      if (failure) return;
      if (error) {
        failure = new OfficePreviewError("invalid");
        return;
      }
      expanded += chunk.length;
      partSize += chunk.length;
      if (expanded > MAX_EXPANDED_BYTES || (xml && partSize > MAX_PART_BYTES)) {
        failure = new OfficePreviewError("limit");
        file.terminate();
        return;
      }
      if (xml) chunks.push(chunk);
      if (xml && final) {
        const bytes = new Uint8Array(partSize);
        let offset = 0;
        for (const piece of chunks) {
          bytes.set(piece, offset);
          offset += piece.length;
        }
        try {
          const value = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
          if (/<!DOCTYPE|<!ENTITY/i.test(value) || /<(?:\w+:)?altChunk\b/i.test(value)) {
            failure = new OfficePreviewError("unsupported");
            return;
          }
          // Bound DOM allocation before validation, including XLSX sheets that the Office parser reads as a stream.
          for (let at = value.indexOf("<"); at !== -1; at = value.indexOf("<", at + 1)) {
            if (++markup > MAX_XML_MARKUP) {
              failure = new OfficePreviewError("limit");
              return;
            }
          }
          new DOMParser({
            onError: () => {
              throw new OfficePreviewError("invalid");
            },
          }).parseFromString(value.trim(), "application/xml");
          if (file.name === "[Content_Types].xml") contentTypes = value;
        } catch {
          failure = new OfficePreviewError("invalid");
        }
      }
    };
    file.start();
  });
  unzip.register(UnzipInflate);
  try {
    // A small compressed chunk also bounds a bomb's overshoot before ondata can stop it.
    for (let offset = 0; offset < data.length && !failure; offset += 1_024) {
      unzip.push(data.subarray(offset, offset + 1_024), offset + 1_024 >= data.length);
    }
  } catch {
    throw failure ?? new OfficePreviewError("invalid");
  }
  if (failure) throw failure;
  const main = { docx: "word/document.xml", xlsx: "xl/workbook.xml", pptx: "ppt/presentation.xml" }[
    format
  ];
  const type = {
    docx: "wordprocessingml.document",
    xlsx: "spreadsheetml.sheet",
    pptx: "presentationml.presentation",
  }[format];
  if (/macroEnabled|vbaProject|activeX/i.test(contentTypes))
    throw new OfficePreviewError("unsupported");
  if (!names.has(main) || !contentTypes.includes(`${type}.main+xml`))
    throw new OfficePreviewError("invalid");
}

class RenderBudget {
  nodes = 0;
  characters = 0;
  truncated = false;
  get exhausted() {
    return this.nodes >= MAX_NODES || this.characters >= MAX_TEXT;
  }
  take(): boolean {
    if (this.exhausted) {
      this.truncated = true;
      return false;
    }
    this.nodes++;
    return true;
  }
  text(value: string): string {
    const remaining = Math.min(10_000, MAX_TEXT - this.characters);
    const result = value.slice(0, remaining);
    if (result.length < value.length) this.truncated = true;
    this.characters += result.length;
    return result;
  }
}

function readRuns(node: OfficeContentNode, budget: RenderBudget, depth = 0): OfficeRun[] {
  if (depth > 20 || !budget.take()) {
    budget.truncated = true;
    return [];
  }
  if (node.type === "break") return [{ text: "\n" }];
  if (node.children?.length) {
    const runs: OfficeRun[] = [];
    const separator =
      node.type === "cell" || node.type === "table" ? "\n" : node.type === "row" ? "\t" : "";
    for (const child of node.children) {
      if (budget.exhausted) {
        budget.truncated = true;
        break;
      }
      if (separator && runs.length) runs.push({ text: budget.text(separator) });
      runs.push(...readRuns(child, budget, depth + 1));
    }
    return runs;
  }
  return [
    {
      text: budget.text(node.text ?? ""),
      bold: node.formatting?.bold,
      italic: node.formatting?.italic,
    },
  ];
}

function readBlocks(nodes: OfficeContentNode[], budget: RenderBudget, depth = 0): OfficeBlock[] {
  if (depth > 20) {
    budget.truncated = true;
    return [];
  }
  const blocks: OfficeBlock[] = [];
  for (const node of nodes) {
    if (!budget.take()) break;
    if (node.type === "table") {
      blocks.push({ kind: "table", rows: readTable(node, budget) });
    } else if (
      node.type === "paragraph" ||
      node.type === "heading" ||
      node.type === "list" ||
      node.type === "text" ||
      node.type === "code"
    ) {
      blocks.push({
        kind: node.type === "heading" ? "heading" : node.type === "list" ? "list" : "paragraph",
        level: node.type === "heading" ? Math.min(6, Math.max(1, node.metadata?.level ?? 1)) : 1,
        runs: readRuns(node, budget),
      });
    } else if (node.type !== "image" && node.type !== "chart" && node.type !== "drawing") {
      if (!budget.take()) break;
      blocks.push(...readBlocks(node.children ?? [], budget, depth + 1));
    }
  }
  return blocks;
}

function readTable(node: OfficeContentNode, budget: RenderBudget): (OfficeTableCell | null)[][] {
  const sourceRows = (node.children ?? []).filter((child) => child.type === "row");
  const rowCount = Math.min(sourceRows.length, MAX_ROWS);
  if (rowCount < sourceRows.length) budget.truncated = true;
  const anchors = new Map<number, { node: OfficeContentNode; rowSpan: number; colSpan: number }>();
  let columns = 0;
  for (const row of sourceRows.slice(0, rowCount)) {
    for (const cell of row.children ?? []) {
      if (cell.type !== "cell") continue;
      const r = cell.metadata?.row ?? -1;
      const c = cell.metadata?.col ?? -1;
      if (
        !Number.isInteger(r) ||
        !Number.isInteger(c) ||
        r < 0 ||
        c < 0 ||
        r >= rowCount ||
        c >= MAX_COLUMNS
      ) {
        budget.truncated = true;
        continue;
      }
      const rowSpan = tableSpan(cell.metadata?.rowSpan, rowCount - r, budget);
      const colSpan = tableSpan(cell.metadata?.colSpan, MAX_COLUMNS - c, budget);
      anchors.set(r * MAX_COLUMNS + c, { node: cell, rowSpan, colSpan });
      columns = Math.max(columns, c + colSpan);
    }
  }
  const rows: (OfficeTableCell | null)[][] = [];
  const covered = new Set<number>();
  let stopped = false;
  for (let r = 0; r < rowCount && !stopped; r++) {
    if (!budget.take()) break;
    const cells: (OfficeTableCell | null)[] = [];
    for (let c = 0; c < columns; c++) {
      // Charge even empty and covered slots: a sparse or merged table cannot expand beyond the output budget.
      if (!budget.take()) {
        stopped = true;
        break;
      }
      const position = r * MAX_COLUMNS + c;
      if (covered.has(position)) {
        cells.push(null);
        continue;
      }
      const anchor = anchors.get(position);
      if (!anchor) {
        cells.push({ text: "", rowSpan: 1, colSpan: 1 });
        continue;
      }
      cells.push({
        text: readRuns(anchor.node, budget)
          .map((run) => run.text)
          .join(""),
        rowSpan: anchor.rowSpan,
        colSpan: anchor.colSpan,
      });
      for (let y = r; y < r + anchor.rowSpan; y++) {
        for (let x = c; x < c + anchor.colSpan; x++) covered.add(y * MAX_COLUMNS + x);
      }
    }
    rows.push(cells);
  }
  for (const [r, cells] of rows.entries()) {
    for (const cell of cells) {
      if (cell) cell.rowSpan = Math.min(cell.rowSpan, rows.length - r);
    }
  }
  return rows;
}

function tableSpan(value: number | undefined, available: number, budget: RenderBudget): number {
  if (value === undefined) return 1;
  if (!Number.isSafeInteger(value) || value < 1) {
    budget.truncated = true;
    return 1;
  }
  if (value > available) budget.truncated = true;
  return Math.min(value, available);
}

function readSheet(
  node: Extract<OfficeContentNode, { type: "sheet" }>,
  budget: RenderBudget,
): OfficeSheet {
  const sheet: OfficeSheet = {
    name: budget.text(node.metadata?.sheetName ?? "Sheet"),
    rows: [],
    columns: 0,
  };
  for (const row of node.children ?? []) {
    if (budget.exhausted) {
      budget.truncated = true;
      break;
    }
    if (row.type !== "row") continue;
    const cells: string[] = [];
    let number = 0;
    for (const cell of row.children ?? []) {
      if (cell.type !== "cell") continue;
      if (!budget.take()) break;
      const r = cell.metadata?.row ?? -1;
      const c = cell.metadata?.col ?? -1;
      if (!Number.isInteger(r) || !Number.isInteger(c) || r < 0 || c < 0) continue;
      if (r >= MAX_ROWS || c >= MAX_COLUMNS) {
        budget.truncated = true;
        continue;
      }
      number = r + 1;
      cells[c] = budget.text(cell.text ?? "");
      sheet.columns = Math.max(sheet.columns, c + 1);
    }
    if (number) sheet.rows.push({ number, cells });
    if (sheet.rows.length >= MAX_ROWS) {
      budget.truncated = true;
      break;
    }
  }
  return sheet;
}
