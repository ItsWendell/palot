import initSqlJs, { type Database } from "sql.js";
import wasmURL from "sql.js/dist/sql-wasm.wasm?url&no-inline";
import { openPreviewArchive, type PreviewArchive } from "./archive-preview-parser";
import {
  type BinaryPreviewRequest,
  type BinaryPreviewResult,
  type SqliteTable,
} from "./binary-preview-model";
import { parseDocumentPreview } from "./document-preview-parser";
import { openSqlitePreview, readSqlitePage } from "./sqlite-preview-parser";

let database: Database | undefined;
let tables: SqliteTable[] = [];
let archive: PreviewArchive | undefined;
// sql.js is the only fetch, for the app-owned WASM asset. Document references never fetch.
self.onmessage = async (event: MessageEvent<{ id: number; request: BinaryPreviewRequest }>) => {
  const { id, request } = event.data;
  try {
    let result: BinaryPreviewResult;
    if (request.type === "document")
      result = { type: "document", document: parseDocumentPreview(request.data, request.format) };
    else if (request.type === "open" && request.kind === "sqlite") {
      database?.close();
      ({ database, tables } = openSqlitePreview(
        await initSqlJs({ locateFile: () => wasmURL }),
        request.data,
      ));
      result = { type: "sqlite", tables };
    } else if (request.type === "open") {
      archive = openPreviewArchive(request.data, request.path);
      result = { type: "archive", entries: archive.entries };
    } else if (request.type === "page" && database)
      result = {
        type: "page",
        page: readSqlitePage(database, tables, request.table, request.page),
      };
    else if (request.type === "entry" && archive)
      result = { type: "entry", data: archive.read(request.path) };
    else throw new Error("Preview is not open.");
    self.postMessage({ id, result });
  } catch (error) {
    self.postMessage({
      id,
      error: error instanceof Error ? error.message.slice(0, 500) : "Could not read this file.",
    });
  }
};
