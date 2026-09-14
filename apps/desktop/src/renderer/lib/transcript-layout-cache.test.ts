import type { VirtualItem } from "@tanstack/react-virtual";
import { describe, expect, it } from "vitest";
import { MAX_RETAINED_SESSION_VIEWS } from "./session-view-retention";
import { TranscriptLayoutCache, type TranscriptLayoutRow } from "./transcript-layout-cache";

const rows: TranscriptLayoutRow[] = ["a", "b", "c"].map((id) => ({ id, token: {} }));
const measurements: VirtualItem[] = rows.map(({ id }, index) => ({
  key: id,
  index,
  start: index * 100,
  end: (index + 1) * 100,
  size: 100,
  lane: 0,
}));
const snapshot = {
  layoutKey: "800:dark",
  rows,
  measurements,
  viewport: { width: 800, height: 600 },
  totalSize: 300,
  composerHeight: 60,
};

describe("transcript layout cache", () => {
  it("isolates owners even when row IDs match", () => {
    const cache = new TranscriptLayoutCache();
    cache.set("server-a:session", snapshot);
    cache.set("server-b:session", { ...snapshot, totalSize: 500 });
    expect(cache.get("server-a:session", snapshot.layoutKey, rows)?.totalSize).toBe(300);
    expect(cache.get("server-b:session", snapshot.layoutKey, rows)?.totalSize).toBe(500);
    expect(cache.get("unknown", snapshot.layoutKey, rows)).toBeNull();
  });

  it("treats unchanged data with a sparse measured snapshot as complete", () => {
    const cache = new TranscriptLayoutCache();
    cache.set("owner", { ...snapshot, measurements: measurements.slice(1, 2) });
    expect(cache.get("owner", snapshot.layoutKey, rows)).toEqual({
      measurements: measurements.slice(1, 2),
      viewport: snapshot.viewport,
      totalSize: 300,
      composerHeight: 60,
      complete: true,
    });
  });

  it("excludes only changed content using token identity", () => {
    const cache = new TranscriptLayoutCache();
    cache.set("owner", snapshot);
    const changed = rows.map((row) => (row.id === "b" ? { ...row, token: {} } : row));
    const restored = cache.get("owner", snapshot.layoutKey, changed);
    expect(restored?.complete).toBe(false);
    expect(restored?.measurements.map((item) => item.key)).toEqual(["a", "c"]);
  });

  it("retains keyed sizes after reorder but marks the layout incomplete", () => {
    const cache = new TranscriptLayoutCache();
    cache.set("owner", snapshot);
    const reordered = [rows[1]!, rows[0]!, rows[2]!];
    const restored = cache.get("owner", snapshot.layoutKey, reordered);
    expect(restored?.complete).toBe(false);
    expect(restored?.measurements.map(({ key, index, size }) => ({ key, index, size }))).toEqual([
      { key: "a", index: 1, size: 100 },
      { key: "b", index: 0, size: 100 },
      { key: "c", index: 2, size: 100 },
    ]);
  });

  it("discards sizes when a row gains or loses last-row padding", () => {
    const cache = new TranscriptLayoutCache();
    cache.set("owner", snapshot);
    expect(
      cache
        .get("owner", snapshot.layoutKey, [...rows, { id: "d", token: {} }])
        ?.measurements.map((item) => item.key),
    ).toEqual(["a", "b"]);
    expect(
      cache
        .get("owner", snapshot.layoutKey, rows.slice(0, 2))
        ?.measurements.map((item) => item.key),
    ).toEqual(["a"]);
  });

  it.each(["900:dark", "800:light"])("rejects changed layout %s", (layoutKey) => {
    const cache = new TranscriptLayoutCache();
    cache.set("owner", snapshot);
    expect(cache.get("owner", layoutKey, rows)).toBeNull();
  });

  it("evicts the least recently used owner", () => {
    const cache = new TranscriptLayoutCache();
    for (let index = 0; index < MAX_RETAINED_SESSION_VIEWS; index++) {
      cache.set(String(index), snapshot);
    }
    cache.get("0", snapshot.layoutKey, rows);
    cache.set("next", snapshot);
    expect(cache.get("1", snapshot.layoutKey, rows)).toBeNull();
    expect(cache.get("0", snapshot.layoutKey, rows)?.complete).toBe(true);
    expect(cache.get("next", snapshot.layoutKey, rows)?.complete).toBe(true);
  });

  it("drops oversized replacements instead of retaining stale data", () => {
    const cache = new TranscriptLayoutCache();
    cache.set("owner", snapshot);
    cache.set("owner", {
      ...snapshot,
      rows: Array.from({ length: 2_001 }, (_, index) => ({ id: String(index), token: null })),
    });
    expect(cache.get("owner", snapshot.layoutKey, rows)).toBeNull();
    cache.set("owner", {
      ...snapshot,
      measurements: Array.from({ length: 2_001 }, () => measurements[0]!),
    });
    expect(cache.get("owner", snapshot.layoutKey, rows)).toBeNull();
  });

  it("does not expose mutable snapshot containers", () => {
    const cache = new TranscriptLayoutCache();
    const input = {
      ...snapshot,
      rows: rows.map((row) => ({ ...row })),
      measurements: measurements.map((item) => ({ ...item })),
      viewport: { ...snapshot.viewport },
    };
    cache.set("owner", input);
    input.rows[0]!.id = "changed";
    input.measurements[0]!.size = 999;
    input.viewport.width = 1;
    const first = cache.get("owner", snapshot.layoutKey, rows)!;
    first.measurements[0]!.size = 888;
    first.viewport.width = 2;
    const second = cache.get("owner", snapshot.layoutKey, rows)!;
    expect(second.complete).toBe(true);
    expect(second.measurements[0]!.size).toBe(100);
    expect(second.viewport.width).toBe(800);
  });
});
