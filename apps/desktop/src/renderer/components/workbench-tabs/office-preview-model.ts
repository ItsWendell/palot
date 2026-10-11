export type OfficeFormat = "docx" | "xlsx" | "pptx";

export const MAX_OFFICE_BYTES = 16 * 1024 * 1024;

export type OfficeRun = { text: string; bold?: boolean; italic?: boolean };
export type OfficeTableCell = { text: string; rowSpan: number; colSpan: number };
export type OfficeBlock =
  | { kind: "paragraph" | "heading" | "list"; runs: OfficeRun[]; level: number }
  // Grid indices preserve the parser's zero-based coordinates; null is covered by a merged cell.
  | { kind: "table"; rows: (OfficeTableCell | null)[][] };
export type OfficeSheet = {
  name: string;
  rows: { number: number; cells: string[] }[];
  columns: number;
};
export type OfficeDocument = {
  format: OfficeFormat;
  truncated: boolean;
  sections: { name: string; blocks: OfficeBlock[] }[];
  sheets: OfficeSheet[];
};

export type OfficePreviewErrorCode = "invalid" | "encrypted" | "limit" | "unsupported";
export class OfficePreviewError extends Error {
  constructor(readonly code: OfficePreviewErrorCode) {
    super(officeErrorMessage(code));
  }
}

export function officeErrorMessage(code: OfficePreviewErrorCode): string {
  switch (code) {
    case "encrypted":
      return "Encrypted or password-protected Office files cannot be previewed.";
    case "limit":
      return "This document exceeds the safe preview limits (16 MiB file, 32 MiB expanded, 8 MiB XML part, 2,048 parts or 15 seconds).";
    case "unsupported":
      return "This Office package contains unsupported content, such as macros, ActiveX, or embedded documents.";
    case "invalid":
      return "Could not read this Office file. It may be malformed or use unsupported encryption.";
  }
}
