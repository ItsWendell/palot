import { mediaHashFromUri } from "@opencode/client";

export { mediaHashFromUri };

/** A `media:<hash>` reference from a message or inbox read, or undefined for anything else. */
export function mediaRef(value: unknown): string | undefined {
  return typeof value === "string" && mediaHashFromUri(value) ? value : undefined;
}

export const MEDIA_REFS_STORAGE_KEY = "palot.opencode.media-refs";

/**
 * Whether transcript and inbox reads ask for references at all: on unless this renderer's
 * `localStorage` sets the key to "0". With references requested, OpenCode 2.2.7 resolves the
 * session's location on every message read, so a task's location starts loading its plugins
 * earlier. The browser pane's attach waits that out: it retries `rpc.unavailable` until the
 * location reports its plugins or a backoff of about 8 s runs out (`main/browser-pane.ts`).
 */
export function mediaRefsEnabled(): boolean {
  try {
    return globalThis.localStorage?.getItem(MEDIA_REFS_STORAGE_KEY) !== "0";
  } catch {
    return true;
  }
}

/** OpenCode 2.2.0 added server-stored media. Unknown versions opt in: older servers ignore the header. */
export function supportsMediaRefs(version: string | null | undefined): boolean {
  const match = version?.match(/^v?(\d+)\.(\d+)\.(\d+)/);
  if (!match) return true;
  return Number(match[1]) > 2 || (Number(match[1]) === 2 && Number(match[2]) >= 2);
}

export interface MediaRefLease {
  /** The object URL for the bytes; rejects when they cannot be read. */
  url: Promise<string>;
  /** Lets the cache evict the URL again. Call once. */
  release(): void;
}

export interface MediaRefCache {
  /** The object URL already loaded for a reference, without loading it. */
  peek(connectionID: string, uri: string): string | undefined;
  /** Loads a reference once per connection and keeps its URL alive until every lease is released. */
  acquire(connectionID: string, uri: string, mime: string): MediaRefLease;
  /** Revokes and forgets every URL of a connection that will not be used again. */
  disposeConnection(connectionID: string): void;
}

interface Entry {
  connectionID: string;
  url?: string;
  bytes: number;
  leases: number;
  pending: Promise<string>;
}

export interface MediaRefCacheOptions {
  read(connectionID: string, hash: string): Promise<Uint8Array>;
  maxEntries?: number;
  maxBytes?: number;
  createObjectURL?(blob: Blob): string;
  revokeObjectURL?(url: string): void;
}

/**
 * Object URLs for server-stored media, cached by connection and hash. Least recently used
 * entries are revoked once the cache is over its entry or byte budget, except while a mounted
 * component still holds a lease on them: revoking a shown image would break it.
 */
export function createMediaRefCache({
  read,
  maxEntries = 200,
  maxBytes = 100 * 1024 * 1024,
  createObjectURL = (blob) => URL.createObjectURL(blob),
  revokeObjectURL = (url) => URL.revokeObjectURL(url),
}: MediaRefCacheOptions): MediaRefCache {
  // Map order is recency order: a use moves the entry to the end.
  const entries = new Map<string, Entry>();
  let bytes = 0;
  const keyOf = (connectionID: string, hash: string) => `${connectionID}\u0000${hash}`;

  function touch(key: string, entry: Entry) {
    entries.delete(key);
    entries.set(key, entry);
  }

  function remove(key: string, entry: Entry) {
    if (entries.get(key) !== entry) return;
    entries.delete(key);
    bytes -= entry.bytes;
    if (entry.url) revokeObjectURL(entry.url);
  }

  function evict() {
    for (const [key, entry] of entries) {
      if (entries.size <= maxEntries && bytes <= maxBytes) return;
      if (entry.leases > 0 || !entry.url) continue;
      remove(key, entry);
    }
  }

  return {
    peek(connectionID, uri) {
      const hash = mediaHashFromUri(uri);
      return hash ? entries.get(keyOf(connectionID, hash))?.url : undefined;
    },
    acquire(connectionID, uri, mime) {
      const hash = mediaHashFromUri(uri);
      if (!hash) return { url: Promise.reject(new Error("Not a media reference")), release() {} };
      const key = keyOf(connectionID, hash);
      let entry = entries.get(key);
      if (entry) touch(key, entry);
      else {
        const created: Entry = { connectionID, bytes: 0, leases: 0, pending: Promise.resolve("") };
        created.pending = read(connectionID, hash).then(
          (data) => {
            if (entries.get(key) !== created) throw new Error("The connection was closed");
            created.url = createObjectURL(
              new Blob([data as Uint8Array<ArrayBuffer>], {
                type: mime || "application/octet-stream",
              }),
            );
            created.bytes = data.byteLength;
            bytes += created.bytes;
            evict();
            return created.url;
          },
          (error: unknown) => {
            // A failed read is not cached, so the next mount tries again.
            if (entries.get(key) === created) entries.delete(key);
            throw error;
          },
        );
        entries.set(key, created);
        entry = created;
      }
      const leased = entry;
      leased.leases += 1;
      let released = false;
      return {
        url: leased.pending,
        release() {
          if (released) return;
          released = true;
          leased.leases -= 1;
          if (leased.leases === 0) evict();
        },
      };
    },
    disposeConnection(connectionID) {
      for (const [key, entry] of entries) {
        if (entry.connectionID === connectionID) remove(key, entry);
      }
    },
  };
}
