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

export class OpenCodeEventBatcher {
  private readonly pending: PalotEvent[] = [];
  private context: DeliveryContext | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  // Renderer gap detection tracks each connection independently, even though
  // this transport multiplexes all monitored runtimes.
  private readonly sequences = new Map<string, { batch: number; receive: number }>();
  private receivedAt = 0;
  private readonly metrics = emptyMetrics();

  constructor(private readonly onFlush: FlushHandler) {}

  push(event: PalotEventInput, context: DeliveryContext): void {
    if (
      this.context &&
      (this.context.connectionID !== context.connectionID ||
        this.context.contractVersion !== context.contractVersion ||
        this.context.streamEpoch !== context.streamEpoch)
    ) {
      this.flush("context");
    }
    this.context = context;
    if (this.pending.length === 0) this.receivedAt = Date.now();
    this.pending.push({ ...event, receiveSequence: ++this.sequence(context.connectionID).receive });
    this.metrics.receivedEvents += 1;
    if (this.pending.length >= MAX_PENDING_EVENTS) {
      this.flush("capacity");
      return;
    }
    this.metrics.bufferedEvents += 1;
    this.schedule();
  }

  flush(reason: FlushReason = "manual"): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.pending.length === 0) return;
    const context = this.context;
    if (!context) throw new Error("OpenCode event batch has no delivery context");
    const events = this.pending.splice(0);
    this.context = null;
    const batch = {
      ...context,
      batchSequence: ++this.sequence(context.connectionID).batch,
      receivedAt: this.receivedAt,
      sentAt: Date.now(),
      events,
    };
    this.metrics.flushes += 1;
    this.metrics.sentEvents += events.length;
    this.metrics.totalQueueDurationMs += batch.sentAt - batch.receivedAt;
    if (reason === "timer") this.metrics.timedFlushes += 1;
    else if (reason === "immediate") this.metrics.immediateFlushes += 1;
    else if (reason === "capacity") this.metrics.capacityFlushes += 1;
    else if (reason === "context") this.metrics.contextFlushes += 1;
    else this.metrics.manualFlushes += 1;
    this.onFlush(batch);
    this.receivedAt = 0;
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.pending.length = 0;
    this.context = null;
    this.receivedAt = 0;
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

  private schedule(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => this.flush("timer"), BATCH_INTERVAL_MS);
  }
}
