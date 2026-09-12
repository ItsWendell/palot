import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PalotEvent, PalotEventBatch } from "../../shared";
import { OpenCodeReconciler } from "./open-code-reconciler";
import {
  recordReplicaApplied,
  recordStreamingCommit,
  setStreamingLatencyCollectionSource,
  streamingLatencyCursor,
  streamingLatencySamples,
  streamingLatencySamplesSince,
} from "./streaming-latency";

function batch(
  sequence: number,
  receivedAt: number,
  sessionIDs = ["session"],
  connectionID = "connection",
): PalotEventBatch {
  return {
    connectionID,
    contractVersion: "test",
    streamEpoch: 1,
    batchSequence: sequence,
    receivedAt,
    sentAt: receivedAt + 2,
    rendererReceivedAt: receivedAt + 5,
    events: sessionIDs.map(
      (sessionID, index) =>
        ({
          id: `${sequence}-${index}`,
          type: "session.status",
          createdAt: receivedAt,
          receiveSequence: sequence * 10 + index,
          data: { sessionID, status: { type: "busy" } },
        }) as PalotEvent,
    ),
  };
}

describe("streaming latency", () => {
  let cursor: number;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(100);
    cursor = streamingLatencyCursor();
    setStreamingLatencyCollectionSource("harness", true);
  });

  afterEach(() => {
    setStreamingLatencyCollectionSource("harness", false);
    setStreamingLatencyCollectionSource("diagnostics", false);
    vi.useRealTimers();
  });

  it("retains oldest pending wait while preserving latest-batch stage timings", () => {
    recordReplicaApplied(batch(1, 80, ["session", "session"]), ["session", "session"]);
    vi.setSystemTime(150);
    const latest = batch(2, 140, ["session", "session"]);
    recordReplicaApplied(latest, ["session"]);
    vi.setSystemTime(155);
    recordReplicaApplied(latest, ["session"]);
    vi.setSystemTime(180);
    recordStreamingCommit("session");
    expect(streamingLatencySamplesSince(cursor).samples).toEqual([
      {
        connectionID: "connection",
        sessionID: "session",
        batchSequence: 2,
        earliestBatchSequence: 1,
        appliedBatchCount: 2,
        oldestPendingReceivedAt: 80,
        oldestPendingToCommitMs: 100,
        eventTypes: ["session.status"],
        receivedToSentMs: 2,
        sentToRendererMs: 3,
        rendererToReplicaMs: 5,
        replicaToCommitMs: 30,
        totalToCommitMs: 40,
      },
    ]);

    recordStreamingCommit("session");
    expect(streamingLatencySamplesSince(cursor).samples).toHaveLength(1);
    recordReplicaApplied(batch(3, 170), ["session"]);
    vi.setSystemTime(200);
    recordStreamingCommit("session");
    expect(streamingLatencySamplesSince(cursor).samples[1]).toMatchObject({
      earliestBatchSequence: 3,
      appliedBatchCount: 1,
      oldestPendingReceivedAt: 170,
      oldestPendingToCommitMs: 30,
    });
  });

  it("keeps independent cohorts for changed sessions in the same batch", () => {
    recordReplicaApplied(batch(1, 80, ["alpha", "beta", "unchanged"]), ["alpha", "beta"]);
    recordReplicaApplied(batch(2, 90, ["alpha"]), ["alpha"]);
    recordStreamingCommit("alpha");
    vi.setSystemTime(120);
    recordStreamingCommit("beta");
    recordStreamingCommit("unchanged");
    expect(streamingLatencySamplesSince(cursor).samples).toMatchObject([
      { sessionID: "alpha", appliedBatchCount: 2, batchSequence: 2, oldestPendingToCommitMs: 20 },
      { sessionID: "beta", appliedBatchCount: 1, batchSequence: 1, oldestPendingToCommitMs: 40 },
    ]);
  });

  it("does not mix connections sharing a session ID or guess an ambiguous commit owner", () => {
    recordReplicaApplied(batch(1, 70, ["session"], "first"), ["session"]);
    recordReplicaApplied(batch(1, 80, ["session"], "second"), ["session"]);
    recordStreamingCommit("session");
    recordStreamingCommit("session", "missing");
    expect(streamingLatencySamplesSince(cursor).samples).toEqual([]);

    recordStreamingCommit("session", "second");
    recordStreamingCommit("session", "first");
    expect(streamingLatencySamplesSince(cursor).samples).toMatchObject([
      { connectionID: "second", appliedBatchCount: 1, oldestPendingReceivedAt: 80 },
      { connectionID: "first", appliedBatchCount: 1, oldestPendingReceivedAt: 70 },
    ]);
  });

  it("clears pending work when the final collector is disabled and ignores disabled work", () => {
    recordReplicaApplied(batch(1, 80), ["session"]);
    setStreamingLatencyCollectionSource("harness", false);
    const ignored = batch(2, 90);
    recordReplicaApplied(ignored, ["session"]);
    recordStreamingCommit("session");
    expect(ignored.replicaAppliedAt).toBeUndefined();
    setStreamingLatencyCollectionSource("harness", true);
    recordStreamingCommit("session");
    expect(streamingLatencySamplesSince(cursor).samples).toEqual([]);
    recordReplicaApplied(batch(3, 95), ["session"]);
    recordStreamingCommit("session");
    expect(streamingLatencySamplesSince(cursor).samples).toMatchObject([
      { earliestBatchSequence: 3, appliedBatchCount: 1, oldestPendingReceivedAt: 95 },
    ]);
  });

  it("does not clear pending work while another collector is active", () => {
    setStreamingLatencyCollectionSource("diagnostics", true);
    recordReplicaApplied(batch(1, 80), ["session"]);
    setStreamingLatencyCollectionSource("harness", false);
    recordStreamingCommit("session");
    expect(streamingLatencySamplesSince(cursor).samples).toHaveLength(1);
  });

  it("scopes samples by commit cursor without clearing diagnostics or pending wait", () => {
    recordReplicaApplied(batch(1, 80), ["session"]);
    recordStreamingCommit("session");
    recordReplicaApplied(batch(2, 90), ["session"]);
    const start = streamingLatencyCursor();
    expect(streamingLatencySamplesSince(start)).toEqual({ cursor: start, samples: [] });
    vi.setSystemTime(150);
    recordStreamingCommit("session");
    const window = streamingLatencySamplesSince(start);
    expect(window.cursor).toBe(start + 1);
    expect(window.samples).toMatchObject([
      { batchSequence: 2, oldestPendingReceivedAt: 90, oldestPendingToCommitMs: 60 },
    ]);
    expect(streamingLatencySamplesSince(cursor).samples).toHaveLength(2);
    expect(streamingLatencySamplesSince(window.cursor).samples).toEqual([]);
    window.samples[0]!.eventTypes.push("mutated");
    expect(streamingLatencySamplesSince(start).samples[0]!.eventTypes).toEqual(["session.status"]);
    expect(streamingLatencySamples().at(-1)!.eventTypes).toEqual(["session.status"]);
  });

  it("bounds retained samples while maintaining monotonic cursors", () => {
    for (let sequence = 1; sequence <= 205; sequence += 1) {
      recordReplicaApplied(batch(sequence, 80), ["session"]);
      recordStreamingCommit("session");
    }
    const window = streamingLatencySamplesSince(cursor);
    expect(window.cursor).toBe(cursor + 205);
    expect(window.samples).toHaveLength(200);
    expect(window.samples[0]!.batchSequence).toBe(6);
    expect(streamingLatencySamples()).toHaveLength(200);
  });

  it("excludes metadata-only and deep-equal message updates before a long idle from token latency", () => {
    const reconciler = new OpenCodeReconciler();
    const unsubscribe = reconciler.subscribe(({ batch: applied, result }) => {
      recordReplicaApplied(applied, result.changedTranscriptSessionIDs);
    });
    const textBatch = (sequence: number, receivedAt: number, text: string) => {
      const applied = batch(sequence, receivedAt);
      applied.events = [
        {
          ...applied.events[0],
          type: "session.text.ended",
          data: { sessionID: "session", assistantMessageID: "message", ordinal: 0, text },
        } as PalotEvent,
      ];
      return applied;
    };

    reconciler.applyBatch(textBatch(1, 80, "Hello"));
    recordStreamingCommit("session", "connection");
    const start = streamingLatencyCursor();

    vi.setSystemTime(200);
    const metadata = batch(2, 180);
    metadata.events.push({
      ...metadata.events[0],
      id: "viewed",
      receiveSequence: 21,
      type: "session.viewed",
      data: { sessionID: "session", idle: 100 },
    } as PalotEvent);
    expect(reconciler.applyBatch(metadata).changedTranscriptSessionIDs).toEqual([]);
    expect(reconciler.applyBatch(textBatch(3, 190, "Hello")).changedTranscriptSessionIDs).toEqual(
      [],
    );

    // Thread has no messages change to commit during the idle period.
    vi.setSystemTime(10_000);
    const changed = textBatch(4, 9_980, " world");
    // The first text part is finalized; new tokens belong to a new part, not
    // a late delta for the ended part (which the reducer correctly ignores).
    changed.events = changed.events.map((event) => ({
      ...event,
      type: "session.text.delta",
      data: { sessionID: "session", assistantMessageID: "message", ordinal: 1, delta: " world" },
    })) as PalotEvent[];
    expect(reconciler.applyBatch(changed).changedTranscriptSessionIDs).toEqual(["session"]);
    expect(reconciler.messages("connection", "session")[0]?.text).toBe("Hello world");
    vi.setSystemTime(10_010);
    recordStreamingCommit("session", "connection");
    expect(streamingLatencySamplesSince(start).samples).toMatchObject([
      {
        earliestBatchSequence: 4,
        batchSequence: 4,
        appliedBatchCount: 1,
        oldestPendingReceivedAt: 9_980,
        oldestPendingToCommitMs: 30,
      },
    ]);
    unsubscribe();
  });

  it("keeps missing renderer timings nullable and clamps clock skew", () => {
    const applied = batch(1, 110);
    delete applied.rendererReceivedAt;
    recordReplicaApplied(applied, ["session"]);
    vi.setSystemTime(90);
    recordStreamingCommit("session");
    expect(streamingLatencySamplesSince(cursor).samples).toMatchObject([
      {
        sentToRendererMs: null,
        rendererToReplicaMs: null,
        replicaToCommitMs: 0,
        totalToCommitMs: 0,
        oldestPendingToCommitMs: 0,
      },
    ]);
  });
});
