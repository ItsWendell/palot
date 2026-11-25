import type { PalotMessage } from "../../shared";

/**
 * The files a turn changed, in first-seen order, from the `snapshot.files` OpenCode records on
 * each assistant step. Steps without snapshot data (snapshots off, or a step still running)
 * contribute nothing.
 */
export function turnChangedFiles(
  messages: readonly Pick<PalotMessage, "type" | "data">[],
): string[] {
  const files = new Set<string>();
  for (const message of messages) {
    if (message.type !== "assistant") continue;
    for (const file of snapshotFiles(message.data)) files.add(file);
  }
  return [...files];
}

function snapshotFiles(data: PalotMessage["data"]): string[] {
  if (!isRecord(data) || !isRecord(data.snapshot)) return [];
  const files = data.snapshot.files;
  if (!Array.isArray(files)) return [];
  return files.filter((file): file is string => typeof file === "string" && file.length > 0);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
