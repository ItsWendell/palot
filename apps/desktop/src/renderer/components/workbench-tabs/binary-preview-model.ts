export const MAX_BINARY_BYTES = 64 * 1024 * 1024;
export const MAX_ARCHIVE_ENTRIES = 2048;
export const MAX_ARCHIVE_ENTRY_BYTES = 16 * 1024 * 1024;
export const MAX_ARCHIVE_RATIO = 200;
export const SQLITE_PAGE_SIZE = 50;

export type DocumentFormat = "odt" | "ods" | "odp" | "rtf" | "epub";
export interface ArchiveEntry {
  path: string;
  size: number;
  directory: boolean;
  modified: string | null;
}
export interface SqliteTable {
  name: string;
  count: number;
}
export interface SqlitePage {
  columns: string[];
  rows: string[][];
}
export type DocumentBlock =
  | { kind: "text" | "heading"; text: string }
  | { kind: "table"; rows: string[][] }
  | { kind: "image"; data: Uint8Array; mime: string; alt: string };
export interface StructuredDocument {
  sections: { name: string; blocks: DocumentBlock[] }[];
  truncated: boolean;
}
export type BinaryPreviewRequest =
  | { type: "open"; data: Uint8Array; path: string; kind: "sqlite" | "archive" }
  | { type: "document"; data: Uint8Array; format: DocumentFormat }
  | { type: "page"; table: string; page: number }
  | { type: "entry"; path: string };
export type BinaryPreviewResult =
  | { type: "sqlite"; tables: SqliteTable[] }
  | { type: "archive"; entries: ArchiveEntry[] }
  | { type: "page"; page: SqlitePage }
  | { type: "entry"; data: Uint8Array }
  | { type: "document"; document: StructuredDocument };
