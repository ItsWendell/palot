import type { Database, SqlJsStatic } from "sql.js";
import {
  MAX_BINARY_BYTES,
  SQLITE_PAGE_SIZE,
  type SqlitePage,
  type SqliteTable,
} from "./binary-preview-model";

const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
export function openSqlitePreview(sql: SqlJsStatic, data: Uint8Array) {
  if (data.length > MAX_BINARY_BYTES) throw new Error("SQLite preview limit: 64 MiB.");
  if (new TextDecoder().decode(data.subarray(0, 16)) !== "SQLite format 3\0")
    throw new Error("Not a SQLite database.");
  const database = new sql.Database(data);
  try {
    database.run("PRAGMA query_only = ON; PRAGMA trusted_schema = OFF;");
    const names =
      database.exec(
        "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name LIMIT 201",
      )[0]?.values ?? [];
    if (names.length > 200) throw new Error("SQLite preview limit: 200 tables.");
    const tables: SqliteTable[] = names.map(([name]) => ({
      name: String(name),
      count: Number(
        database.exec(`SELECT count(*) FROM ${quote(String(name))}`)[0]?.values[0]?.[0] ?? 0,
      ),
    }));
    return { database, tables };
  } catch (error) {
    database.close();
    throw error;
  }
}

export function readSqlitePage(
  database: Database,
  tables: SqliteTable[],
  table: string,
  page: number,
): SqlitePage {
  const info = tables.find((item) => item.name === table);
  if (
    !info ||
    !Number.isSafeInteger(page) ||
    page < 0 ||
    page > Math.max(0, Math.ceil(info.count / SQLITE_PAGE_SIZE) - 1)
  )
    throw new Error("Invalid database page.");
  const statement = database.prepare(
    `SELECT * FROM ${quote(table)} LIMIT ${SQLITE_PAGE_SIZE} OFFSET ${page * SQLITE_PAGE_SIZE}`,
  );
  try {
    const columns = statement.getColumnNames();
    if (columns.length > 200) throw new Error("SQLite preview limit: 200 columns.");
    const rows: string[][] = [];
    while (statement.step())
      rows.push(
        statement
          .get()
          .map((value) =>
            value === null
              ? "NULL"
              : value instanceof Uint8Array
                ? `[BLOB: ${value.length} bytes]`
                : String(value).slice(0, 4096),
          ),
      );
    return { columns, rows };
  } finally {
    statement.free();
  }
}
