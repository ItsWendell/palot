import { parseDiffFromFile, parsePatchFiles, type FileDiffMetadata } from "@pierre/diffs";

export interface FileDiffSource {
  file: string;
  patch?: string;
  before?: string;
  after?: string;
}

export interface FileReadLine {
  number: number;
  text: string;
}

const MAX_CACHED_DIFFS = 256;
const resolvedDiffs = new Map<string, FileDiffMetadata | null>();

export function resolveFileDiff(source: FileDiffSource): FileDiffMetadata | null {
  const key = sourceCacheKey(source);
  const cached = resolvedDiffs.get(key);
  if (cached !== undefined || resolvedDiffs.has(key)) return reuseCachedDiff(key, cached ?? null);
  const resolved = resolveFileDiffUncached(source);
  cacheDiff(key, resolved);
  return resolved;
}

function resolveFileDiffUncached(source: FileDiffSource): FileDiffMetadata | null {
  if (source.patch) {
    const parsed = parsePatch(source.file, source.patch);
    if (parsed) return parsed;
  }

  if (source.before !== undefined || source.after !== undefined) {
    const before = source.before ?? "";
    const after = source.after ?? "";
    return parseDiffFromFile(
      { name: source.file, contents: before, cacheKey: contentCacheKey(source.file, before) },
      { name: source.file, contents: after, cacheKey: contentCacheKey(source.file, after) },
    );
  }

  return null;
}

export function resolveFileReadDiff(
  file: string,
  start: number,
  lines: FileReadLine[],
): FileDiffMetadata | null {
  return resolveFileSnippetDiff(
    file,
    lines.map((line, index) => ({
      number: Number.isInteger(line.number) && line.number > 0 ? line.number : start + index,
      text: line.text,
    })),
  );
}

export function resolveFileSnippetDiff(
  file: string,
  lines: FileReadLine[],
): FileDiffMetadata | null {
  if (lines.length === 0) return null;
  const safeFile = file.replace(/[\t\r\n]/g, " ");
  const latestLines = new Map<number, string>();
  for (const line of lines) {
    if (!Number.isInteger(line.number) || line.number <= 0) continue;
    latestLines.set(line.number, line.text);
  }
  const ordered = [...latestLines].toSorted(([left], [right]) => left - right);
  if (ordered.length === 0) return null;

  const groups: Array<Array<[number, string]>> = [];
  for (const line of ordered) {
    const previous = groups.at(-1);
    if (previous && line[0] === previous.at(-1)![0] + 1) previous.push(line);
    else groups.push([line]);
  }
  const hunks = groups.flatMap((group) => {
    const start = group[0]![0];
    return [
      `@@ -${start},${group.length} +${start},${group.length} @@`,
      ...group.map(([, text]) => ` ${text}`),
    ];
  });
  const patch = [
    `Index: ${safeFile}`,
    "===================================================================",
    `--- ${safeFile}\t`,
    `+++ ${safeFile}\t`,
    ...hunks,
  ].join("\n");
  const key = `snippet:${contentCacheKey(file, patch)}`;
  const cached = resolvedDiffs.get(key);
  if (cached !== undefined || resolvedDiffs.has(key)) return reuseCachedDiff(key, cached ?? null);
  const resolved = parsePatchFiles(patch, contentCacheKey(file, patch))[0]?.files[0] ?? null;
  cacheDiff(key, resolved);
  return resolved;
}

function sourceCacheKey(source: FileDiffSource): string {
  return [
    "diff",
    source.file,
    source.patch === undefined ? "" : contentCacheKey(source.file, source.patch),
    source.before === undefined ? "" : contentCacheKey(source.file, source.before),
    source.after === undefined ? "" : contentCacheKey(source.file, source.after),
  ].join("|");
}

function reuseCachedDiff(key: string, value: FileDiffMetadata | null): FileDiffMetadata | null {
  resolvedDiffs.delete(key);
  resolvedDiffs.set(key, value);
  return value;
}

function cacheDiff(key: string, value: FileDiffMetadata | null): void {
  resolvedDiffs.set(key, value);
  if (resolvedDiffs.size <= MAX_CACHED_DIFFS) return;
  const oldest = resolvedDiffs.keys().next().value;
  if (oldest !== undefined) resolvedDiffs.delete(oldest);
}

export function contentCacheKey(file: string, contents: string) {
  let hash = 2_166_136_261;
  for (let index = 0; index < contents.length; index += 1) {
    hash ^= contents.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return `${file}:${contents.length}:${hash >>> 0}`;
}

function parsePatch(file: string, patch: string): FileDiffMetadata | null {
  try {
    const normalized = patch.replace(/\r\n?/g, "\n");
    const cacheKey = contentCacheKey(file, normalized);
    const direct = parsePatchFiles(normalized, cacheKey).flatMap((value) => value.files)[0];
    if (direct) return direct;
    if (!/^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/m.test(normalized)) return null;

    const safeFile = file.replace(/[\t\r\n]/g, " ");
    const wrapped = [
      `Index: ${safeFile}`,
      "===================================================================",
      `--- ${safeFile}\t`,
      `+++ ${safeFile}\t`,
      normalized,
    ].join("\n");
    return parsePatchFiles(wrapped, cacheKey).flatMap((value) => value.files)[0] ?? null;
  } catch {
    return null;
  }
}
