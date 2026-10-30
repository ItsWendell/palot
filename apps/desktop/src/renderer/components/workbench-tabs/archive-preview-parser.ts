import { Gunzip, Inflate } from "fflate";
import {
  MAX_ARCHIVE_ENTRIES,
  MAX_ARCHIVE_ENTRY_BYTES,
  MAX_ARCHIVE_RATIO,
  MAX_BINARY_BYTES,
  type ArchiveEntry,
} from "./binary-preview-model";

interface StoredEntry extends ArchiveEntry {
  read(): Uint8Array;
}
export interface PreviewArchive {
  entries: ArchiveEntry[];
  read(path: string): Uint8Array;
}
const decoder = new TextDecoder("utf-8", { fatal: true });
const invalid = () =>
  new Error("This archive is damaged, encrypted, or uses an unsupported format.");
const limit = () =>
  new Error(
    "Archive preview limit: 2,048 entries, 64 MiB expanded, 16 MiB per entry and 200:1 compression.",
  );

export function safeArchivePath(path: string): string {
  if (
    !path ||
    path.length > 1024 ||
    /[\\:]/.test(path) ||
    [...path].some((char) => char.charCodeAt(0) < 32) ||
    path.startsWith("/") ||
    path.split("/").includes("..")
  )
    throw invalid();
  return path;
}

/** Inflate incrementally so a forged size cannot trigger an unbounded allocation. */
function expand(data: Uint8Array, gzip: boolean, max: number): Uint8Array {
  const chunks: Uint8Array[] = [];
  let size = 0;
  const ondata = (chunk: Uint8Array) => {
    size += chunk.length;
    if (size > max || size > Math.max(1, data.length) * MAX_ARCHIVE_RATIO) throw limit();
    chunks.push(chunk);
  };
  const stream = gzip ? new Gunzip(ondata) : new Inflate(ondata);
  for (let offset = 0; offset < data.length; offset += 1024)
    stream.push(data.subarray(offset, offset + 1024), offset + 1024 >= data.length);
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

export function openPreviewArchive(data: Uint8Array, path: string): PreviewArchive {
  if (data.length > MAX_BINARY_BYTES) throw limit();
  let entries: StoredEntry[];
  if (/\.(?:tgz|gz)$/i.test(path)) {
    const unpacked = expand(data, true, MAX_BINARY_BYTES);
    entries = /\.(?:tgz|tar\.gz)$/i.test(path)
      ? readTar(unpacked)
      : [
          {
            path: safeArchivePath(path.split("/").at(-1)!.replace(/\.gz$/i, "") || "content"),
            size: unpacked.length,
            directory: false,
            modified: null,
            read: () => {
              if (unpacked.length > MAX_ARCHIVE_ENTRY_BYTES) throw limit();
              return unpacked;
            },
          },
        ];
  } else entries = /\.tar$/i.test(path) ? readTar(data) : readZip(data);
  const files = new Map<string, StoredEntry>();
  for (const entry of entries) {
    safeArchivePath(entry.path);
    if (files.has(entry.path)) throw invalid();
    files.set(entry.path, entry);
  }
  return {
    entries: entries.map(({ path, size, directory, modified }) => ({
      path,
      size,
      directory,
      modified,
    })),
    read(path) {
      const entry = files.get(path);
      if (!entry || entry.directory) throw invalid();
      return entry.read();
    },
  };
}

function readZip(data: Uint8Array): StoredEntry[] {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const u16 = (n: number) => view.getUint16(n, true);
  const u32 = (n: number) => view.getUint32(n, true);
  let end = data.length - 22;
  for (; end >= Math.max(0, data.length - 65557); end--)
    if (u32(end) === 0x06054b50 && end + 22 + u16(end + 20) === data.length) break;
  if (
    end < 0 ||
    end < data.length - 65557 ||
    u16(end + 4) ||
    u16(end + 6) ||
    u16(end + 8) !== u16(end + 10)
  )
    throw invalid();
  const count = u16(end + 10);
  if (count > MAX_ARCHIVE_ENTRIES) throw limit();
  let offset = u32(end + 16);
  if (offset + u32(end + 12) !== end) throw invalid();
  const entries: StoredEntry[] = [];
  let total = 0;
  for (let i = 0; i < count; i++) {
    if (offset + 46 > end || u32(offset) !== 0x02014b50) throw invalid();
    const flags = u16(offset + 8),
      method = u16(offset + 10);
    const compressed = u32(offset + 20),
      size = u32(offset + 24);
    const next = offset + 46 + u16(offset + 28) + u16(offset + 30) + u16(offset + 32);
    if (
      next > end ||
      flags & 1 ||
      ![0, 8].includes(method) ||
      u16(offset + 34) ||
      compressed === 0xffffffff ||
      size === 0xffffffff
    )
      throw invalid();
    const path = safeArchivePath(
      decoder.decode(data.subarray(offset + 46, offset + 46 + u16(offset + 28))),
    );
    total += size;
    if (
      total > MAX_BINARY_BYTES ||
      size > MAX_ARCHIVE_ENTRY_BYTES ||
      size > Math.max(1, compressed) * MAX_ARCHIVE_RATIO
    )
      throw limit();
    const local = u32(offset + 42);
    if (
      local + 30 > u32(end + 16) ||
      u32(local) !== 0x04034b50 ||
      u16(local + 8) !== method ||
      u16(local + 6) !== flags
    )
      throw invalid();
    const start = local + 30 + u16(local + 26) + u16(local + 28);
    if (
      start + compressed > u32(end + 16) ||
      decoder.decode(data.subarray(local + 30, local + 30 + u16(local + 26))) !== path
    )
      throw invalid();
    const time = u16(offset + 12),
      date = u16(offset + 14);
    const modified = date
      ? new Date(
          1980 + (date >> 9),
          ((date >> 5) & 15) - 1,
          date & 31,
          time >> 11,
          (time >> 5) & 63,
          (time & 31) * 2,
        ).toISOString()
      : null;
    const crc = u32(offset + 16);
    entries.push({
      path,
      size,
      directory: path.endsWith("/"),
      modified,
      read() {
        const packed = data.subarray(start, start + compressed);
        const result = method === 0 ? packed : expand(packed, false, size);
        if (result.length !== size || crc32(result) !== crc) throw invalid();
        return result;
      },
    });
    offset = next;
  }
  if (offset !== end) throw invalid();
  return entries;
}

function crc32(bytes: Uint8Array): number {
  let crc = -1;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ -1) >>> 0;
}

function readTar(data: Uint8Array): StoredEntry[] {
  const entries: StoredEntry[] = [];
  const text = (start: number, size: number) =>
    decoder.decode(data.subarray(start, start + size)).split("\0")[0]!;
  const octal = (start: number, size: number) => {
    const value = text(start, size).trim();
    if (!/^[0-7]*$/.test(value)) throw invalid();
    return parseInt(value || "0", 8);
  };
  for (let offset = 0; offset + 512 <= data.length;) {
    if (data.subarray(offset, offset + 512).every((byte) => byte === 0)) return entries;
    if (entries.length >= MAX_ARCHIVE_ENTRIES) throw limit();
    let sum = 0;
    for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 32 : data[offset + i]!;
    if (sum !== octal(offset + 148, 8)) throw invalid();
    const size = octal(offset + 124, 12),
      type = text(offset + 156, 1);
    // Never dereference links/devices. Extended TAR metadata is explicitly unsupported.
    if (!["", "0", "5"].includes(type))
      throw new Error(
        "This TAR uses links or extended metadata, which are not supported in previews.",
      );
    if (size > MAX_ARCHIVE_ENTRY_BYTES || offset + 512 + size > data.length) throw limit();
    const prefix = text(offset + 257, 5) === "ustar" ? text(offset + 345, 155) : "";
    const path = safeArchivePath([prefix, text(offset, 100)].filter(Boolean).join("/"));
    const start = offset + 512;
    const modified = new Date(octal(offset + 136, 12) * 1000);
    entries.push({
      path,
      size,
      directory: type === "5",
      modified: Number.isNaN(+modified) ? null : modified.toISOString(),
      read: () => data.subarray(start, start + size),
    });
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  throw invalid();
}
