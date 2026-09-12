import type { PalotEventBatch } from "../../shared/opencode-contract";
import type {
  BatchProcessingControl,
  BatchProcessingReport,
  BatchProcessingSample,
} from "../../shared/performance-contract";

const CAPACITY = 2_048;

interface Ticket {
  measurementID: number;
  sample: BatchProcessingSample;
}

/** Demand-driven and bounded. The clock is injectable for deterministic lifecycle tests. */
export function createBatchProcessingProbe(
  clock = { now: () => performance.now(), timeOrigin: () => performance.timeOrigin },
): BatchProcessingControl & {
  begin(batch: PalotEventBatch): Ticket | undefined;
  end(ticket: Ticket): void;
} {
  let sequence = 0;
  let active: BatchProcessingReport | null = null;
  // A ticket is consumed once, without retaining completed tickets or batch payloads.
  const pending = new WeakSet<Ticket>();
  return {
    start() {
      if (active) throw new Error("Batch processing measurement already active");
      const measurementID = ++sequence;
      active = {
        available: true,
        status: "collected",
        scope: "useOpenCodeQueryEvents:sync-subscriber",
        capacity: CAPACITY,
        measurementID,
        timeOrigin: clock.timeOrigin(),
        startedAt: clock.now(),
        endedAt: null,
        observedBatches: 0,
        observedEvents: 0,
        droppedSamples: 0,
        totalDurationMs: 0,
        maxDurationMs: 0,
        samples: [],
      };
      return measurementID;
    },
    stop(measurementID) {
      if (!active || active.measurementID !== measurementID) return null;
      active.endedAt = clock.now();
      const result = active;
      active = null;
      return result;
    },
    begin(batch) {
      // No clocks, metadata reads, or allocations outside an active measurement.
      if (!active) return undefined;
      // Coalesced text may be large even when the event count is one. Numeric
      // lengths only: no serialization, text copying, or payload retention.
      let textDeltaCharacters = 0;
      for (const event of batch.events) {
        if (event.type === "session.text.delta") textDeltaCharacters += event.data.delta.length;
      }
      const ticket: Ticket = {
        measurementID: active.measurementID!,
        sample: {
          connectionID: batch.connectionID,
          streamEpoch: batch.streamEpoch,
          batchSequence: batch.batchSequence,
          eventCount: batch.events.length,
          textDeltaCharacters,
          startTime: 0,
          durationMs: 0,
          transportQueueAgeMs: wallClockDifference(batch.sentAt, batch.receivedAt),
          sentToRendererMs: wallClockDifference(batch.rendererReceivedAt, batch.sentAt),
        },
      };
      pending.add(ticket);
      // Metadata copying is diagnostic overhead, not subscriber processing time.
      ticket.sample.startTime = clock.now();
      return ticket;
    },
    end(ticket) {
      if (!pending.delete(ticket) || !active || active.measurementID !== ticket.measurementID)
        return;
      const sample = ticket.sample;
      sample.durationMs = clock.now() - sample.startTime;
      active.observedBatches += 1;
      active.observedEvents += sample.eventCount;
      active.totalDurationMs += sample.durationMs;
      active.maxDurationMs = Math.max(active.maxDurationMs, sample.durationMs);
      if (active.samples.length < CAPACITY) active.samples.push(sample);
      else active.droppedSamples += 1;
    },
  };
}

function wallClockDifference(end: number | undefined, start: number): number | null {
  return end !== undefined && Number.isFinite(end) && Number.isFinite(start) ? end - start : null;
}

// Normal builds have neither an instantiated collector nor an exposed control surface.
export const batchProcessingProbe = __PALOT_PERFORMANCE_HARNESS__
  ? createBatchProcessingProbe()
  : null;
