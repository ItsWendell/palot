import { writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { openPalotDatabase } from "./client";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Palot database startup", () => {
  it("runs the shipped migrations on a new database", async () => {
    const databasePath = await temporaryDatabasePath();
    const database = openPalotDatabase(databasePath, path.resolve("drizzle"));

    const tables = database.$client
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((row) => row.name);

    expect(tables).toContain("automations");
    expect(tables).toContain("session_triage");
    database.$client.close();
  });

  it("rejects a corrupt SQLite file without replacing it", async () => {
    const databasePath = await temporaryDatabasePath();
    writeFileSync(databasePath, "not a sqlite database");

    expect(() => openPalotDatabase(databasePath, path.resolve("drizzle"))).toThrow();
  });

  it("closes SQLite when migration loading fails", async () => {
    const databasePath = await temporaryDatabasePath();

    expect(() =>
      openPalotDatabase(databasePath, path.join(path.dirname(databasePath), "missing")),
    ).toThrow();
    const reopened = new DatabaseSync(databasePath);
    expect(reopened.isOpen).toBe(true);
    reopened.close();
  });
});

async function temporaryDatabasePath(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "palot-database-test-"));
  roots.push(root);
  return path.join(root, "palot.sqlite");
}
