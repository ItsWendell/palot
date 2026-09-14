import type { VirtualItem } from "@tanstack/react-virtual";
import { MAX_RETAINED_SESSION_VIEWS } from "./session-view-retention";

const MAX_CACHED_ROWS = 2_000;

export interface TranscriptLayoutRow {
  id: string;
  token: unknown;
}

export interface TranscriptLayoutSnapshot {
  layoutKey: string;
  rows: readonly TranscriptLayoutRow[];
  /** Measured items from Virtualizer.takeSnapshot(), keyed by stable row ID. */
  measurements: VirtualItem[];
  viewport: { width: number; height: number };
  totalSize: number;
  composerHeight: number;
}

export interface RetainedTranscriptLayout {
  measurements: VirtualItem[];
  viewport: { width: number; height: number };
  totalSize: number;
  composerHeight: number;
  /** Same ordered data, even when takeSnapshot() measured only some rows. */
  complete: boolean;
}

export class TranscriptLayoutCache {
  private readonly entries = new Map<string, TranscriptLayoutSnapshot>();

  get(
    ownerKey: string,
    layoutKey: string,
    rows: readonly TranscriptLayoutRow[],
  ): RetainedTranscriptLayout | null {
    const saved = this.entries.get(ownerKey);
    if (!saved || saved.layoutKey !== layoutKey || rows.length > MAX_CACHED_ROWS) return null;

    this.entries.delete(ownerKey);
    this.entries.set(ownerKey, saved);
    const previous = new Map(saved.rows.map((row, index) => [row.id, { row, index }]));
    const current = new Map(rows.map((row, index) => [row.id, { row, index }]));
    const measurements = saved.measurements.flatMap((measurement) => {
      if (typeof measurement.key !== "string") return [];
      const before = previous.get(measurement.key);
      const after = current.get(measurement.key);
      if (
        !before ||
        !after ||
        before.row.token !== after.row.token ||
        (before.index === saved.rows.length - 1) !== (after.index === rows.length - 1)
      ) {
        return [];
      }
      // initialMeasurementsCache restores sizes by key, not historical offsets.
      return [{ ...measurement, index: after.index }];
    });
    return {
      measurements,
      viewport: { ...saved.viewport },
      totalSize: saved.totalSize,
      composerHeight: saved.composerHeight,
      complete:
        saved.rows.length === rows.length &&
        saved.rows.every(
          (row, index) => row.id === rows[index]?.id && row.token === rows[index]?.token,
        ),
    };
  }

  set(ownerKey: string, snapshot: TranscriptLayoutSnapshot): void {
    this.entries.delete(ownerKey);
    if (snapshot.rows.length > MAX_CACHED_ROWS || snapshot.measurements.length > MAX_CACHED_ROWS) {
      return;
    }
    this.entries.set(ownerKey, {
      ...snapshot,
      rows: snapshot.rows.map(({ id, token }) => ({ id, token })),
      measurements: snapshot.measurements.map((measurement) => ({ ...measurement })),
      viewport: { ...snapshot.viewport },
    });
    while (this.entries.size > MAX_RETAINED_SESSION_VIEWS) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
  }
}

export const retainedTranscriptLayouts = new TranscriptLayoutCache();
