import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { app } from "electron";
import { drizzle } from "drizzle-orm/node-sqlite";
import { migrate } from "drizzle-orm/node-sqlite/migrator";
import { backupDatabaseBeforeMigration } from "../data-recovery";
import * as schema from "./schema";

let database: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function palotDatabase() {
  if (database) return database;
  const directory = path.join(app.getPath("userData"), "database");
  mkdirSync(directory, { recursive: true });
  backupDatabaseBeforeMigration(directory);
  database = openPalotDatabase(path.join(directory, "palot.sqlite"), migrationsDirectory());
  return database;
}

export function openPalotDatabase(databasePath: string, migrationsFolder: string) {
  const sqlite = new DatabaseSync(databasePath, { timeout: 5_000 });
  sqlite.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;");
  try {
    const next = drizzle({ client: sqlite, schema });
    migrate(next, { migrationsFolder });
    return next;
  } catch (error) {
    if (sqlite.isOpen) sqlite.close();
    throw error;
  }
}

export function closePalotDatabase(): void {
  const sqlite = database?.$client;
  database = null;
  if (sqlite?.isOpen) sqlite.close();
}

function migrationsDirectory(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, "drizzle")
    : path.join(app.getAppPath(), "drizzle");
}
