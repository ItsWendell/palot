import { afterEach, describe, expect, it, vi } from "vitest";
import type { OpenCodeEvent } from "@opencode/client";
import type { PalotEventBatch, PalotEventInput } from "../shared/opencode-contract";
import { OpenCodeEventBatcher } from "./event-batcher";

const context = {
  connectionID: "connection-1",
  contractVersion: "0.0.0-beta-19507",
  streamEpoch: 1,
};

function event(
  type: OpenCodeEvent["type"],
  data: Record<string, unknown>,
  id: string = type,
  createdAt = 1,
): PalotEventInput {
  return { id, type, data, created: createdAt, createdAt } as PalotEventInput;
}

describe("OpenCodeEventBatcher", () => {
  afterEach(() => vi.useRealTimers());

  it("keeps each server's delivery contiguous when monitored servers interleave", () => {
    const batches: PalotEventBatch[] = [];
    const batcher = new OpenCodeEventBatcher((batch) => batches.push(batch));
    for (let index = 0; index < 3; index++) {
      for (const connectionID of ["local", "remote"]) {
        batcher.push(event("session.status", {}, `${connectionID}-${index}`), {
          ...context,
          connectionID,
        });
      }
      batcher.flush();
    }
    for (const connectionID of ["local", "remote"]) {
      const delivered = batches.filter((batch) => batch.connectionID === connectionID);
      expect(delivered.map((batch) => batch.batchSequence)).toEqual([1, 2, 3]);
      expect(
        delivered.flatMap((batch) => batch.events.map((event) => event.receiveSequence)),
      ).toEqual([1, 2, 3]);
    }
    batcher.dispose();
  });

  it("preserves every event in source order, including A B A", () => {
    vi.useFakeTimers();
    const batches: PalotEventBatch[] = [];
    const batcher = new OpenCodeEventBatcher((batch) => batches.push(batch));

    batcher.push(event("session.text.delta", { delta: "A" }, "a1", 10), context);
    batcher.push(event("session.text.delta", { delta: "B" }, "b", 20), context);
    batcher.push(event("session.text.delta", { delta: "A2" }, "a2", 30), context);
    vi.advanceTimersByTime(8);

    expect(batches[0]).toMatchObject({
      ...context,
      batchSequence: 1,
      events: [
        { id: "a1", receiveSequence: 1 },
        { id: "b", receiveSequence: 2 },
        { id: "a2", receiveSequence: 3 },
      ],
    });
  });

  it("batches structural events with pending deltas while preserving order", () => {
    vi.useFakeTimers();
    const batches: PalotEventBatch[] = [];
    const batcher = new OpenCodeEventBatcher((batch) => batches.push(batch));

    batcher.push(event("session.text.delta", { delta: "A" }, "delta"), context);
    batcher.push(event("session.tool.called", {}, "tool"), context);
    vi.advanceTimersByTime(8);

    expect(batches.map((batch) => batch.events.map((item) => item.id))).toEqual([
      ["delta", "tool"],
    ]);
  });

  it("does not replace status events across lifecycle boundaries", () => {
    vi.useFakeTimers();
    const batches: PalotEventBatch[] = [];
    const batcher = new OpenCodeEventBatcher((batch) => batches.push(batch));

    batcher.push(event("session.status", { status: "busy" }, "busy"), context);
    batcher.push(event("session.execution.succeeded", {}, "finished"), context);
    batcher.push(event("session.status", { status: "idle" }, "idle"), context);
    vi.advanceTimersByTime(8);
    expect(batches.map((batch) => batch.events.map((item) => item.id))).toEqual([
      ["busy", "finished", "idle"],
    ]);
  });

  it("flushes before switching stream epochs", () => {
    const batches: PalotEventBatch[] = [];
    const batcher = new OpenCodeEventBatcher((batch) => batches.push(batch));

    batcher.push(event("session.text.delta", {}, "first"), context);
    batcher.push(event("session.text.delta", {}, "second"), { ...context, streamEpoch: 2 });
    batcher.flush();

    expect(batches.map((batch) => batch.streamEpoch)).toEqual([1, 2]);
    expect(batches.map((batch) => batch.batchSequence)).toEqual([1, 2]);
  });

  it("reports batched renderer transport work", () => {
    vi.useFakeTimers();
    const batcher = new OpenCodeEventBatcher(() => undefined);

    batcher.push(event("session.text.delta", { delta: "A" }, "delta"), context);
    batcher.push(event("session.tool.called", {}, "tool"), context);
    vi.advanceTimersByTime(8);

    expect(batcher.snapshotMetrics()).toMatchObject({
      receivedEvents: 2,
      bufferedEvents: 2,
      immediateEvents: 0,
      flushes: 1,
      timedFlushes: 1,
      immediateFlushes: 0,
      sentEvents: 2,
    });
  });
});
