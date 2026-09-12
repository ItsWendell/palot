import { describe, expect, it, vi } from "vitest";
import type { PalotEventBatch } from "../../shared/opencode-contract";
import { batchProcessingProbe, createBatchProcessingProbe } from "./batch-processing-probe";

function batch(overrides: Partial<PalotEventBatch> = {}): PalotEventBatch {
  return {
    connectionID: "connection-a",
    contractVersion: "test",
    streamEpoch: 1,
    batchSequence: 7,
    receivedAt: 1_000,
    sentAt: 1_008,
    rendererReceivedAt: 1_010,
    events: [{ type: "server.connected", data: {} } as PalotEventBatch["events"][number]],
    ...overrides,
  };
}

function fixture() {
  let time = 10;
  const clock = { now: vi.fn(() => time), timeOrigin: vi.fn(() => 1_000_000) };
  const probe = createBatchProcessingProbe(clock);
  return { probe, clock, advance: (ms: number) => (time += ms) };
}

describe("batch processing probe", () => {
  it("does not instantiate the harness collector in normal builds", () => {
    expect(batchProcessingProbe).toBeNull();
  });

  it("does not read the clock or batch metadata when inactive", () => {
    const { probe, clock } = fixture();
    const unreadable = new Proxy(batch(), {
      get() {
        throw new Error("inactive probe accessed the batch");
      },
    });
    expect(probe.begin(unreadable)).toBeUndefined();
    expect(probe.stop(1)).toBeNull();
    expect(clock.now).not.toHaveBeenCalled();
    expect(clock.timeOrigin).not.toHaveBeenCalled();
    const owner = probe.start();
    probe.stop(owner);
    clock.now.mockClear();
    clock.timeOrigin.mockClear();
    expect(probe.begin(unreadable)).toBeUndefined();
    expect(clock.now).not.toHaveBeenCalled();
    expect(clock.timeOrigin).not.toHaveBeenCalled();
  });

  it("records monotonic duration separately from wall-clock transport age without retaining payloads", () => {
    const { probe, advance } = fixture();
    const owner = probe.start();
    advance(3);
    const delivered = batch();
    const ticket = probe.begin(delivered)!;
    // The transport batch may subsequently be annotated or mutated by consumers.
    delivered.connectionID = "changed";
    delivered.events.length = 0;
    advance(4.25);
    probe.end(ticket);
    probe.end(ticket); // A completed callback cannot be counted twice.
    const report = probe.stop(owner)!;
    expect(report).toMatchObject({
      available: true,
      status: "collected",
      timeOrigin: 1_000_000,
      startedAt: 10,
      endedAt: 17.25,
      observedBatches: 1,
      observedEvents: 1,
      droppedSamples: 0,
      totalDurationMs: 4.25,
      maxDurationMs: 4.25,
    });
    expect(report.samples).toEqual([
      {
        connectionID: "connection-a",
        streamEpoch: 1,
        batchSequence: 7,
        eventCount: 1,
        textDeltaCharacters: 0,
        startTime: 13,
        durationMs: 4.25,
        transportQueueAgeMs: 8,
        sentToRendererMs: 2,
      },
    ]);
  });

  it("bounds retained samples while counting all completed callbacks, events, and duration", () => {
    const { probe, advance } = fixture();
    const owner = probe.start();
    for (let index = 0; index < 2_100; index += 1) {
      const ticket = probe.begin(batch({ batchSequence: index }))!;
      advance(index === 2_099 ? 20 : 1);
      probe.end(ticket);
    }
    const report = probe.stop(owner)!;
    expect(report.samples).toHaveLength(report.capacity);
    expect(report.samples.at(-1)?.batchSequence).toBe(2_047);
    expect(report).toMatchObject({
      observedBatches: 2_100,
      observedEvents: 2_100,
      droppedSamples: 52,
      totalDurationMs: 2_119,
      maxDurationMs: 20,
    });
  });

  it("distinguishes payload growth from event count without keeping text", () => {
    const { probe } = fixture();
    const owner = probe.start();
    const delivered = batch({
      events: [
        {
          type: "session.text.delta",
          data: { delta: "abc😀" },
        } as PalotEventBatch["events"][number],
        { type: "session.text.delta", data: { delta: "xyz" } } as PalotEventBatch["events"][number],
        ...batch().events,
      ],
    });
    const ticket = probe.begin(delivered)!;
    delivered.events.length = 0;
    probe.end(ticket);
    expect(probe.stop(owner)?.samples[0]).toMatchObject({ eventCount: 3, textDeltaCharacters: 8 });
  });

  it("refuses overlapping measurements and isolates stale owners and tickets after restart", () => {
    const { probe, clock } = fixture();
    const first = probe.start();
    const stale = probe.begin(batch())!;
    expect(() => probe.start()).toThrow("already active");
    expect(probe.stop(first + 1)).toBeNull();
    const previous = probe.stop(first)!;
    const second = probe.start();
    expect(second).not.toBe(first);
    clock.now.mockClear();
    probe.end(stale);
    expect(probe.stop(first)).toBeNull();
    expect(clock.now).not.toHaveBeenCalled();
    const current = probe.begin(batch({ connectionID: "connection-b", streamEpoch: 2 }))!;
    probe.end(current);
    const report = probe.stop(second)!;
    expect(report.observedBatches).toBe(1);
    expect(report.samples[0]).toMatchObject({ connectionID: "connection-b", streamEpoch: 2 });
    expect(previous.observedBatches).toBe(0);
    expect(previous.samples).toEqual([]);
    expect(probe.stop(second)).toBeNull();
    const third = probe.start();
    expect(probe.stop(third)).toMatchObject({
      observedBatches: 0,
      samples: [],
      totalDurationMs: 0,
    });
  });

  it("does not accept another collector's ticket with the same measurement ID", () => {
    const first = fixture().probe;
    const second = fixture().probe;
    const firstOwner = first.start();
    const secondOwner = second.start();
    const ticket = first.begin(batch())!;
    second.end(ticket);
    first.end(ticket);
    expect(second.stop(secondOwner)?.observedBatches).toBe(0);
    expect(first.stop(firstOwner)?.observedBatches).toBe(1);
  });

  it("keeps missing wall-clock stages unavailable and does not hide clock adjustments", () => {
    const { probe } = fixture();
    const owner = probe.start();
    const ticket = probe.begin(batch({ sentAt: 995, rendererReceivedAt: undefined }))!;
    probe.end(ticket);
    const invalid = probe.begin(batch({ receivedAt: Number.NaN }))!;
    probe.end(invalid);
    expect(probe.stop(owner)?.samples).toMatchObject([
      { transportQueueAgeMs: -5, sentToRendererMs: null },
      { transportQueueAgeMs: null, sentToRendererMs: 2 },
    ]);
  });
});
