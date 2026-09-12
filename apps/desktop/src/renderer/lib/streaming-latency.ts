import type { PalotEventBatch } from "../../shared";
import type { StreamingLatencySample } from "../../shared/performance-contract";
export type { StreamingLatencySample } from "../../shared/performance-contract";

const MAX_SAMPLES = 200;
type StreamingLatencySource = "diagnostics" | "harness";
type StoredStreamingLatencySample = StreamingLatencySample & { diagnosticSequence: number };
type AppliedBatch = Pick<
  PalotEventBatch,
  | "connectionID"
  | "streamEpoch"
  | "batchSequence"
  | "receivedAt"
  | "sentAt"
  | "rendererReceivedAt"
  | "replicaAppliedAt"
> & { eventTypes: string[] };
interface PendingCohort {
  latest: AppliedBatch;
  earliestBatchSequence: number;
  oldestPendingReceivedAt: number;
  appliedBatchCount: number;
}

const samples: StoredStreamingLatencySample[] = [];
// One fixed-size cohort per connection/session, not a retained queue of event payloads.
const pendingBySession = new Map<string, Map<string, PendingCohort>>();
const collectionSources = new Set<StreamingLatencySource>();
let nextDiagnosticSequence = 1;

export function recordReplicaApplied(
  batch: PalotEventBatch,
  changedTranscriptSessionIDs: string[],
): void {
  if (collectionSources.size === 0) return;
  batch.replicaAppliedAt = Date.now();
  // Admission comes from committed graph changes, not event names or event owners:
  // metadata-only batches cannot trigger the thread's messages-dependent commit.
  const affected = new Set(changedTranscriptSessionIDs);
  if (affected.size === 0) return;
  const latest: AppliedBatch = {
    connectionID: batch.connectionID,
    streamEpoch: batch.streamEpoch,
    batchSequence: batch.batchSequence,
    receivedAt: batch.receivedAt,
    sentAt: batch.sentAt,
    rendererReceivedAt: batch.rendererReceivedAt,
    replicaAppliedAt: batch.replicaAppliedAt,
    eventTypes: [...new Set(batch.events.map((event) => event.type))],
  };
  for (const sessionID of affected) {
    let owners = pendingBySession.get(sessionID);
    if (!owners) {
      owners = new Map();
      pendingBySession.set(sessionID, owners);
    }
    const pending = owners.get(batch.connectionID);
    if (pending) {
      // Applied batches are ordered by the reconciler. Repeated events (or a repeated
      // notification of the latest batch) must not inflate the cohort batch count.
      if (
        pending.latest.streamEpoch === batch.streamEpoch &&
        pending.latest.batchSequence === batch.batchSequence
      ) {
        continue;
      }
      pending.latest = latest;
      pending.oldestPendingReceivedAt = Math.min(pending.oldestPendingReceivedAt, batch.receivedAt);
      pending.appliedBatchCount += 1;
    } else {
      owners.set(batch.connectionID, {
        latest,
        earliestBatchSequence: batch.batchSequence,
        oldestPendingReceivedAt: batch.receivedAt,
        appliedBatchCount: 1,
      });
    }
  }
}

export function recordStreamingCommit(sessionID: string, connectionID?: string): void {
  if (collectionSources.size === 0) return;
  const owners = pendingBySession.get(sessionID);
  if (!owners) return;
  // Never attribute a session-only commit to another connection when ambiguous.
  // Native transcript callers supply their explicit owner.
  const pending = connectionID
    ? owners.get(connectionID)
    : owners.size === 1
      ? owners.values().next().value
      : undefined;
  if (!pending) return;
  const batch = pending.latest;
  owners.delete(batch.connectionID);
  if (owners.size === 0) pendingBySession.delete(sessionID);
  const committedAt = Date.now();
  const rendererReceivedAt = batch.rendererReceivedAt ?? null;
  const replicaAppliedAt = batch.replicaAppliedAt ?? null;
  samples.push({
    diagnosticSequence: nextDiagnosticSequence++,
    connectionID: batch.connectionID,
    sessionID,
    batchSequence: batch.batchSequence,
    earliestBatchSequence: pending.earliestBatchSequence,
    appliedBatchCount: pending.appliedBatchCount,
    oldestPendingReceivedAt: pending.oldestPendingReceivedAt,
    oldestPendingToCommitMs: Math.max(0, committedAt - pending.oldestPendingReceivedAt),
    eventTypes: batch.eventTypes,
    receivedToSentMs: Math.max(0, batch.sentAt - batch.receivedAt),
    sentToRendererMs:
      rendererReceivedAt === null ? null : Math.max(0, rendererReceivedAt - batch.sentAt),
    rendererToReplicaMs:
      rendererReceivedAt === null || replicaAppliedAt === null
        ? null
        : Math.max(0, replicaAppliedAt - rendererReceivedAt),
    replicaToCommitMs:
      replicaAppliedAt === null ? null : Math.max(0, committedAt - replicaAppliedAt),
    totalToCommitMs: Math.max(0, committedAt - batch.receivedAt),
  });
  if (samples.length > MAX_SAMPLES) samples.splice(0, samples.length - MAX_SAMPLES);
}

export function streamingLatencySamples(): StreamingLatencySample[] {
  return samples.map(({ diagnosticSequence: _diagnosticSequence, ...sample }) => ({
    ...sample,
    eventTypes: [...sample.eventTypes],
  }));
}

export function streamingLatencySamplesSince(cursor: number): {
  cursor: number;
  samples: StreamingLatencySample[];
} {
  const latestCursor = nextDiagnosticSequence - 1;
  return {
    cursor: latestCursor,
    samples: samples
      .filter((sample) => sample.diagnosticSequence > cursor)
      .map(({ diagnosticSequence: _diagnosticSequence, ...sample }) => ({
        ...sample,
        eventTypes: [...sample.eventTypes],
      })),
  };
}

export function streamingLatencyCursor(): number {
  return nextDiagnosticSequence - 1;
}

export function setStreamingLatencyCollectionSource(
  source: StreamingLatencySource,
  enabled: boolean,
): void {
  if (enabled) collectionSources.add(source);
  else collectionSources.delete(source);
  if (collectionSources.size === 0) pendingBySession.clear();
}
