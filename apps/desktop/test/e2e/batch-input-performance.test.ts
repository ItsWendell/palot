// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { BatchProcessingReport } from "../../src/shared/performance-contract";
import { batchTypingOverlap } from "./batch-input-performance";

function report(): BatchProcessingReport {
  return {
    available: true,
    status: "collected",
    scope: "useOpenCodeQueryEvents:sync-subscriber",
    capacity: 2048,
    measurementID: 1,
    timeOrigin: 1000,
    startedAt: 0,
    endedAt: 200,
    observedBatches: 4,
    observedEvents: 70,
    droppedSamples: 0,
    totalDurationMs: 24,
    maxDurationMs: 10,
    samples: [
      { startTime: 10, durationMs: 2, eventCount: 30 },
      { startTime: 30, durationMs: 2, eventCount: 4 },
      { startTime: 50, durationMs: 10, eventCount: 16 },
      { startTime: 95, durationMs: 10, eventCount: 20 },
    ].map((sample, batchSequence) => ({
      ...sample,
      connectionID: "fixture",
      streamEpoch: 1,
      batchSequence,
      textDeltaCharacters: sample.eventCount === 16 ? 1_600 : 100,
      transportQueueAgeMs: 8,
      sentToRendererMs: 1,
    })),
  };
}

describe("batch work during keyboard input", () => {
  it("counts complete callbacks strictly inside input, not surrounding traffic or straddling work", () => {
    expect(batchTypingOverlap(report(), 10, 100, 1000)).toMatchObject({
      batchCount: 2,
      eventCount: 20,
      maxEventCount: 16,
      maxDurationMs: 10,
      clusteredBatchCount: 1,
      textBurstBatchCount: 1,
      maxTextDeltaCharacters: 1_600,
    });
  });

  it("does not manufacture contention when batches arrive outside typing", () => {
    expect(batchTypingOverlap(report(), 110, 150, 1000)).toMatchObject({
      batchCount: 0,
      eventCount: 0,
      maxEventCount: 0,
      clusteredBatchCount: 0,
    });
  });

  it("rejects truncated, disabled, unavailable, and mismatched-clock evidence", () => {
    for (const changes of [
      { droppedSamples: 1 },
      { available: false },
      { status: "disabled" },
      { timeOrigin: 2000 },
    ]) {
      expect(() =>
        batchTypingOverlap({ ...report(), ...changes } as BatchProcessingReport, 10, 100, 1000),
      ).toThrow("evidence");
    }
    expect(() => batchTypingOverlap(report(), 100, 10, 1000)).toThrow("evidence");
    expect(() => batchTypingOverlap(report(), Number.NaN, 100, 1000)).toThrow("evidence");
  });
});
