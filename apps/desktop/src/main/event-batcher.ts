/** Batches OpenCode events before they cross into the renderer. */

import type { PalotEvent, PalotEventBatch, PalotEventInput } from "../shared/opencode-contract";

const BATCH_INTERVAL_MS = 8;
const MAX_PENDING_EVENTS = 1_024;

type FlushHandler = (batch: PalotEventBatch) => void;
type FlushReason = "capacity" | "context" | "immediate" | "manual" | "timer";

export interface OpenCodeEventBatcherMetrics {
  receivedEvents: number;
  bufferedEvents: number;
  immediateEvents: number;
  flushes: number;
  timedFlushes: number;
  immediateFlushes: number;
  capacityFlushes: number;
  contextFlushes: number;
  manualFlushes: number;
  sentEvents: number;
  totalQueueDurationMs: number;
}

function emptyMetrics(): OpenCodeEventBatcherMetrics {
  return {
    receivedEvents: 0,
    bufferedEvents: 0,
    immediateEvents: 0,
    flushes: 0,
    timedFlushes: 0,
    immediateFlushes: 0,
    capacityFlushes: 0,
    contextFlushes: 0,
    manualFlushes: 0,
    sentEvents: 0,
    totalQueueDurationMs: 0,
  };
}

interface DeliveryContext {
  connectionID: string;
  contractVersion: string;
  streamEpoch: number;
}

interface PendingBatch {
  context: DeliveryContext;
  events: PalotEvent[];
  receivedAt: number;
  timer: ReturnType<typeof setTimeout> | null;
}

export class OpenCodeEventBatcher {
  // One queue per connection, so interleaved monitored servers keep batching independently.
  private readonly pending = new Map<string, PendingBatch>();
  // Renderer gap detection tracks each connection independently, even though
  // this transport multiplexes all monitored runtimes.
  private readonly sequences = new Map<string, { batch: number; receive: number }>();
  private readonly metrics = emptyMetrics();

  constructor(private readonly onFlush: FlushHandler) {}

  push(event: PalotEventInput, context: DeliveryContext): void {
    const current = this.pending.get(context.connectionID);
    if (
      current &&
      (current.context.contractVersion !== context.contractVersion ||
        current.context.streamEpoch !== context.streamEpoch)
    ) {
      this.flushConnection(context.connectionID, "context");
    }
    let batch = this.pending.get(context.connectionID);
    if (!batch) {
      batch = { context, events: [], receivedAt: Date.now(), timer: null };
      this.pending.set(context.connectionID, batch);
    }
    batch.events.push({
      ...event,
      receiveSequence: ++this.sequence(context.connectionID).receive,
    });
    this.metrics.receivedEvents += 1;
    if (batch.events.length >= MAX_PENDING_EVENTS) {
      this.flushConnection(context.connectionID, "capacity");
      return;
    }
    this.metrics.bufferedEvents += 1;
    batch.timer ??= setTimeout(
      () => this.flushConnection(context.connectionID, "timer"),
      BATCH_INTERVAL_MS,
    );
  }

  /** Flushes every connection's pending events. */
  flush(reason: FlushReason = "manual"): void {
    for (const connectionID of this.pending.keys()) this.flushConnection(connectionID, reason);
  }

  dispose(): void {
    for (const batch of this.pending.values()) if (batch.timer) clearTimeout(batch.timer);
    this.pending.clear();
  }

  snapshotMetrics(): OpenCodeEventBatcherMetrics {
    return { ...this.metrics };
  }

  private sequence(connectionID: string) {
    let sequence = this.sequences.get(connectionID);
    if (!sequence) {
      sequence = { batch: 0, receive: 0 };
      this.sequences.set(connectionID, sequence);
    }
    return sequence;
  }

  private flushConnection(connectionID: string, reason: FlushReason): void {
    const pending = this.pending.get(connectionID);
    if (!pending) return;
    if (pending.timer) clearTimeout(pending.timer);
    this.pending.delete(connectionID);
    if (pending.events.length === 0) return;
    const batch = {
      ...pending.context,
      batchSequence: ++this.sequence(connectionID).batch,
      receivedAt: pending.receivedAt,
      sentAt: Date.now(),
      events: pending.events,
    };
    this.metrics.flushes += 1;
    this.metrics.sentEvents += batch.events.length;
    this.metrics.totalQueueDurationMs += batch.sentAt - batch.receivedAt;
    if (reason === "timer") this.metrics.timedFlushes += 1;
    else if (reason === "immediate") this.metrics.immediateFlushes += 1;
    else if (reason === "capacity") this.metrics.capacityFlushes += 1;
    else if (reason === "context") this.metrics.contextFlushes += 1;
    else this.metrics.manualFlushes += 1;
    this.onFlush(batch);
  }
}
