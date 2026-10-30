import { beforeAll, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import initSqlJs, { type SqlJsStatic } from "sql.js";
import { openSqlitePreview, readSqlitePage } from "./sqlite-preview-parser";

let sql: SqlJsStatic;
beforeAll(async () => {
  sql = await initSqlJs({
    wasmBinary: new Uint8Array(
      await readFile(createRequire(import.meta.url).resolve("sql.js/dist/sql-wasm.wasm")),
    ).buffer,
  });
});
it("lists tables/counts, pages 50 rows, quotes identifiers, and prevents writes", () => {
  const source = new sql.Database();
  source.run('CREATE TABLE "a""b" (id INTEGER, name TEXT, value BLOB)');
  for (let i = 0; i < 51; i++)
    source.run('INSERT INTO "a""b" VALUES (?, ?, ?)', [i, `Row ${i}`, new Uint8Array([1, 2])]);
  const { database, tables } = openSqlitePreview(sql, source.export());
  try {
    expect(tables).toEqual([{ name: 'a"b', count: 51 }]);
    expect(readSqlitePage(database, tables, 'a"b', 0)).toMatchObject({
      columns: ["id", "name", "value"],
      rows: expect.any(Array),
    });
    expect(readSqlitePage(database, tables, 'a"b', 0).rows).toHaveLength(50);
    expect(readSqlitePage(database, tables, 'a"b', 1).rows).toEqual([
      ["50", "Row 50", "[BLOB: 2 bytes]"],
    ]);
    expect(() => database.run('DELETE FROM "a""b"')).toThrow(/readonly/);
    expect(() => readSqlitePage(database, tables, "sqlite_schema", 0)).toThrow();
    expect(() => readSqlitePage(database, tables, 'a"b', -1)).toThrow();
    expect(() => readSqlitePage(database, tables, 'a"b', 2)).toThrow();
  } finally {
    database.close();
    source.close();
  }
});
it("rejects non-SQLite files and the 64 MiB limit", () => {
  expect(() => openSqlitePreview(sql, new Uint8Array())).toThrow(/Not a SQLite/);
  expect(() => openSqlitePreview(sql, new Uint8Array(64 * 1024 * 1024 + 1))).toThrow(/64 MiB/);
});
