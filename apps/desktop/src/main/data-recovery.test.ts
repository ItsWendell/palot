import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  backupDatabaseBeforeMigration,
  completePendingPalotReset,
  removePalotOwnedData,
  redactSupportText,
  resetPalotSettings,
  restoreLatestDatabaseBackup,
  type PalotDataLocations,
} from "./data-recovery";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Palot data recovery", () => {
  it("backs up SQLite and WAL state before migration and can restore the latest copy", async () => {
    const locations = fixture();
    writeFileSync(path.join(locations.database, "palot.sqlite"), "database-v1");
    writeFileSync(path.join(locations.database, "palot.sqlite-wal"), "wal-v1");
    backupDatabaseBeforeMigration(locations.database, new Date("2026-08-28T12:00:00Z"));
    writeFileSync(path.join(locations.database, "palot.sqlite"), "corrupt");

    await restoreLatestDatabaseBackup(locations);

    expect(readFileSync(path.join(locations.database, "palot.sqlite"), "utf8")).toBe("database-v1");
    expect(readFileSync(path.join(locations.database, "palot.sqlite-wal"), "utf8")).toBe("wal-v1");
  });

  it("resets Palot preferences while preserving server profiles and encrypted credentials", async () => {
    const locations = fixture();
    for (const name of [
      "appearance.json",
      "malformed.json",
      "opencode-connections.json",
      "opencode-credentials.json",
    ]) {
      writeFileSync(path.join(locations.data, name), name === "malformed.json" ? "{" : "{}");
    }
    let cleared = false;

    await resetPalotSettings(locations, async () => {
      cleared = true;
    });

    expect(cleared).toBe(true);
    expect(() => readFileSync(path.join(locations.data, "appearance.json"))).toThrow();
    expect(() => readFileSync(path.join(locations.data, "malformed.json"))).toThrow();
    expect(readFileSync(path.join(locations.data, "opencode-connections.json"), "utf8")).toBe("{}");
    expect(readFileSync(path.join(locations.data, "opencode-credentials.json"), "utf8")).toBe("{}");
  });

  it("removes only Palot-owned data, including encrypted credentials, logs, and attachment temp", async () => {
    const locations = fixture();
    const openCode = path.join(path.dirname(locations.data), "opencode-owned");
    mkdirSync(openCode);
    writeFileSync(path.join(openCode, "sessions"), "keep");
    writeFileSync(path.join(locations.data, "opencode-credentials.json"), "encrypted");
    writeFileSync(path.join(locations.logs, "main.log"), "log");
    writeFileSync(path.join(locations.temporaryAttachments, "image.png"), "image");

    await removePalotOwnedData(locations, async () => {});

    expect(() => readFileSync(path.join(locations.data, "opencode-credentials.json"))).toThrow();
    expect(() => readFileSync(path.join(locations.logs, "main.log"))).toThrow();
    expect(() => readFileSync(path.join(locations.temporaryAttachments, "image.png"))).toThrow();
    expect(readFileSync(path.join(openCode, "sessions"), "utf8")).toBe("keep");
  });

  it("redacts paths, URLs, email addresses, and credential-like values from support logs", () => {
    const locations = fixture();
    const redacted = redactSupportText(
      `data=${locations.data} project=/Users/person/private/repo url=https://example.com/task email=person@example.com token=secret`,
      locations,
    );

    expect(redacted).not.toContain("person");
    expect(redacted).not.toContain("example.com");
    expect(redacted).not.toContain("secret");
    expect(redacted).toContain("<PALOT_DATA>");
    expect(redacted).toContain("token=[REDACTED]");
  });

  it("reapplies a pending settings reset before stores initialize", async () => {
    const locations = fixture();
    writeFileSync(path.join(locations.data, "appearance.json"), "{}");
    writeFileSync(path.join(locations.data, "opencode-credentials.json"), "{}");
    await resetPalotSettings(locations, async () => {});
    writeFileSync(path.join(locations.data, "window-state.json"), "{}");

    completePendingPalotReset(locations.data);

    expect(() => readFileSync(path.join(locations.data, "window-state.json"))).toThrow();
    expect(readFileSync(path.join(locations.data, "opencode-credentials.json"), "utf8")).toBe("{}");
  });
});

function fixture(): PalotDataLocations {
  const root = mkdtempSync(path.join(os.tmpdir(), "palot-recovery-test-"));
  roots.push(root);
  const data = path.join(root, "Palot");
  const database = path.join(data, "database");
  const logs = path.join(root, "logs");
  const temporaryAttachments = path.join(root, "temp");
  for (const directory of [data, database, logs, temporaryAttachments]) {
    mkdirSync(directory, { recursive: true });
  }
  return { data, database, logs, temporaryAttachments, backups: path.join(database, "backups") };
}
