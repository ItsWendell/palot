import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { copyFile, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { app, dialog, session, shell } from "electron";
import log from "electron-log/main";
import { redactLogValue } from "./logging";

const DATABASE_FILES = ["palot.sqlite", "palot.sqlite-wal", "palot.sqlite-shm"] as const;
const RETAINED_DATABASE_BACKUPS = 5;
const SUPPORT_LOG_BYTES = 256 * 1024;
const RESET_PRESERVED_STORES = new Set(["opencode-connections.json", "opencode-credentials.json"]);
const RESET_MARKER = ".palot-reset";

export interface PalotDataLocations {
  data: string;
  logs: string;
  database: string;
  backups: string;
  temporaryAttachments: string;
}

export function palotDataLocations(userData = app.getPath("userData")): PalotDataLocations {
  const database = path.join(userData, "database");
  return {
    data: userData,
    logs: process.env.PALOT_LOG_DIR ?? path.dirname(log.transports.file.getFile().path),
    database,
    backups: path.join(database, "backups"),
    temporaryAttachments: path.join(os.tmpdir(), "palot-2"),
  };
}

export function backupDatabaseBeforeMigration(
  databaseDirectory: string,
  now = new Date(),
): string | null {
  const databasePath = path.join(databaseDirectory, DATABASE_FILES[0]);
  if (!existsSync(databasePath) || statSync(databasePath).size === 0) return null;
  const backupsDirectory = path.join(databaseDirectory, "backups");
  const backupDirectory = path.join(backupsDirectory, backupName(now));
  mkdirSync(backupDirectory, { recursive: true });
  for (const file of DATABASE_FILES) {
    const source = path.join(databaseDirectory, file);
    if (existsSync(source)) copyFileSync(source, path.join(backupDirectory, file));
  }
  pruneBackups(backupsDirectory);
  return backupDirectory;
}

export async function restoreLatestDatabaseBackup(
  locations = palotDataLocations(),
): Promise<string> {
  const backup = latestBackup(locations.backups);
  if (!backup) throw new Error("No Palot database backup is available.");
  await mkdir(locations.database, { recursive: true });
  for (const file of DATABASE_FILES) await rm(path.join(locations.database, file), { force: true });
  for (const file of DATABASE_FILES) {
    const source = path.join(backup, file);
    if (existsSync(source)) await copyFile(source, path.join(locations.database, file));
  }
  return backup;
}

export async function resetPalotSettings(
  locations = palotDataLocations(),
  clearRendererStorage = () =>
    session.defaultSession.clearStorageData({ storages: ["localstorage"] }),
): Promise<void> {
  await clearRendererStorage();
  for (const entry of await safeReadDirectory(locations.data)) {
    if (!entry.endsWith(".json") || RESET_PRESERVED_STORES.has(entry)) continue;
    await rm(path.join(locations.data, entry), { force: true });
  }
  markPendingReset(locations.data, "settings");
}

export async function removePalotOwnedData(
  locations = palotDataLocations(),
  clearRendererStorage = () => session.defaultSession.clearStorageData(),
): Promise<void> {
  await clearRendererStorage();
  log.transports.file.level = false;
  const dataEntries = (await safeReadDirectory(locations.data)).map((entry) =>
    rm(path.join(locations.data, entry), { recursive: true, force: true }),
  );
  await Promise.all([
    ...dataEntries,
    rm(locations.temporaryAttachments, { recursive: true, force: true }),
    locations.logs === locations.data || locations.logs.startsWith(`${locations.data}${path.sep}`)
      ? Promise.resolve()
      : rm(locations.logs, { recursive: true, force: true }),
  ]);
  markPendingReset(locations.data, "all");
}

export function completePendingPalotReset(userData: string): void {
  const marker = path.join(userData, RESET_MARKER);
  if (!existsSync(marker)) return;
  const scope = readFileSync(marker, "utf8").trim();
  if (scope !== "settings" && scope !== "all") {
    rmSync(marker, { force: true });
    return;
  }
  for (const entry of readdirSync(userData)) {
    if (entry === RESET_MARKER) continue;
    if (scope === "settings") {
      if (!entry.endsWith(".json") || RESET_PRESERVED_STORES.has(entry)) continue;
    }
    rmSync(path.join(userData, entry), { recursive: true, force: true });
  }
  rmSync(marker, { force: true });
}

export async function revealPalotDataFolder(locations = palotDataLocations()): Promise<void> {
  await mkdir(locations.data, { recursive: true });
  const error = await shell.openPath(locations.data);
  if (error) throw new Error(error);
}

export async function revealPalotLogsFolder(locations = palotDataLocations()): Promise<void> {
  await mkdir(locations.logs, { recursive: true });
  const error = await shell.openPath(locations.logs);
  if (error) throw new Error(error);
}

export async function exportSupportBundle(
  failure?: unknown,
  locations = palotDataLocations(),
): Promise<string | null> {
  const result = await dialog.showSaveDialog({
    title: "Export Palot support bundle",
    defaultPath: `palot-support-${new Date().toISOString().slice(0, 10)}.json`,
    filters: [{ name: "JSON", extensions: ["json"] }],
  });
  if (result.canceled || !result.filePath) return null;
  const logPath = log.transports.file.getFile().path;
  const contents = JSON.stringify(
    {
      format: 1,
      createdAt: new Date().toISOString(),
      application: {
        name: app.getName(),
        version: app.getVersion(),
        packaged: app.isPackaged,
        platform: process.platform,
        architecture: process.arch,
        electron: process.versions.electron,
        node: process.versions.node,
      },
      locations: {
        data: "<PALOT_DATA>",
        logs: "<PALOT_LOGS>",
        database: "<PALOT_DATA>/database",
        backups: "<PALOT_DATA>/database/backups",
      },
      latestDatabaseBackup: latestBackup(locations.backups) ? "available" : "unavailable",
      failure: failure ? redactSupportText(formatFailure(failure), locations) : null,
      logTail: redactSupportText(await readTail(logPath), locations),
    },
    null,
    2,
  );
  await writeFile(result.filePath, contents, { encoding: "utf8", mode: 0o600 });
  return result.filePath;
}

export function hasDatabaseBackup(locations = palotDataLocations()): boolean {
  return latestBackup(locations.backups) !== null;
}

function backupName(now: Date): string {
  return now.toISOString().replaceAll(":", "-").replace(".", "-");
}

function markPendingReset(userData: string, scope: "settings" | "all"): void {
  mkdirSync(userData, { recursive: true });
  writeFileSync(path.join(userData, RESET_MARKER), scope, { encoding: "utf8", mode: 0o600 });
}

function latestBackup(backupsDirectory: string): string | null {
  if (!existsSync(backupsDirectory)) return null;
  const entries = readdirSync(backupsDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .toSorted()
    .reverse();
  const latest = entries.find((entry) =>
    existsSync(path.join(backupsDirectory, entry, "palot.sqlite")),
  );
  return latest ? path.join(backupsDirectory, latest) : null;
}

function pruneBackups(backupsDirectory: string): void {
  const entries = readdirSync(backupsDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .toSorted()
    .reverse();
  for (const entry of entries.slice(RETAINED_DATABASE_BACKUPS)) {
    rmSync(path.join(backupsDirectory, entry), { recursive: true, force: true });
  }
}

async function safeReadDirectory(directory: string): Promise<string[]> {
  try {
    return await readdir(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function readTail(filePath: string): Promise<string> {
  try {
    const contents = await readFile(filePath);
    return contents.subarray(Math.max(0, contents.length - SUPPORT_LOG_BYTES)).toString("utf8");
  } catch (error) {
    return `Log unavailable: ${formatFailure(error)}`;
  }
}

function formatFailure(failure: unknown): string {
  const redacted = redactLogValue(failure);
  return typeof redacted === "string" ? redacted : JSON.stringify(redacted);
}

export function redactSupportText(value: string, locations: PalotDataLocations): string {
  return value
    .replaceAll(locations.data, "<PALOT_DATA>")
    .replaceAll(locations.logs, "<PALOT_LOGS>")
    .replaceAll(locations.temporaryAttachments, "<PALOT_TEMP>")
    .replaceAll(/https?:\/\/[^\s"')]+/g, "<URL>")
    .replaceAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "<EMAIL>")
    .replaceAll(
      /\b(authorization|cookie|credential|password|secret|token|api[-_]?key)\s*[:=]\s*[^\s,;}]+/gi,
      "$1=[REDACTED]",
    )
    .replaceAll(/(?:\/Users|\/home|\/private|\/var|\/tmp|[A-Za-z]:\\)[^\s"',)]+/g, "<PATH>");
}
