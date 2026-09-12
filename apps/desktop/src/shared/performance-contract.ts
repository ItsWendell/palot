/** Synchronous useOpenCodeQueryEvents subscriber only; not requests, React render, or paint. */
export interface BatchProcessingSample {
  connectionID: string;
  streamEpoch: number;
  batchSequence: number;
  /** Delivered events, including events subsequently rejected by reconciliation. */
  eventCount: number;
  /** UTF-16 code units in delivered text deltas, not bytes or provider tokens. */
  textDeltaCharacters: number;
  /** Renderer performance.now() timestamps, comparable to the browser probe. */
  startTime: number;
  durationMs: number;
  /** Wall-clock transport differences; never subtract these from monotonic timestamps. */
  transportQueueAgeMs: number | null;
  sentToRendererMs: number | null;
}

export interface BatchProcessingReport {
  available: boolean;
  status: "collected" | "disabled" | "unavailable";
  scope: "useOpenCodeQueryEvents:sync-subscriber";
  capacity: number;
  measurementID: number | null;
  timeOrigin: number | null;
  startedAt: number | null;
  endedAt: number | null;
  observedBatches: number;
  observedEvents: number;
  droppedSamples: number;
  /** Totals include all completed callbacks, even when sample retention is full. */
  totalDurationMs: number;
  maxDurationMs: number;
  /** First capacity callbacks only; no event payloads or session contents retained. */
  samples: BatchProcessingSample[];
}

export interface BatchProcessingControl {
  /** Starts a fresh measurement; refuses overlapping owners. */
  start(): number;
  /** Stale owners cannot stop a newer measurement. */
  stop(measurementID: number): BatchProcessingReport | null;
}

export interface StreamingLatencySample {
  connectionID: string;
  sessionID: string;
  /** Latest applied batch; the existing stage timings below retain this meaning. */
  batchSequence: number;
  earliestBatchSequence: number;
  appliedBatchCount: number;
  oldestPendingReceivedAt: number;
  oldestPendingToCommitMs: number;
  eventTypes: string[];
  receivedToSentMs: number;
  sentToRendererMs: number | null;
  rendererToReplicaMs: number | null;
  replicaToCommitMs: number | null;
  totalToCommitMs: number | null;
}

export type PalotProcessType =
  | "Browser"
  | "Tab"
  | "Utility"
  | "Zygote"
  | "Sandbox helper"
  | "GPU"
  | "Pepper Plugin"
  | "Pepper Plugin Broker"
  | "Unknown";

export interface PalotPerformanceProcessMetric {
  pid: number;
  type: PalotProcessType;
  name: string | null;
  serviceName: string | null;
  creationTime: number;
  sandboxed: boolean | null;
  cpu: {
    /** CPU used since Electron's previous app.getAppMetrics() sample. The first sample is zero. */
    percentCPUUsage: number;
    cumulativeCPUUsage: number | null;
    idleWakeupsPerSecond: number;
  };
  /** Electron reports process memory values in KiB. */
  memory: {
    workingSetSize: number;
    peakWorkingSetSize: number;
    privateBytes: number | null;
  };
}

export interface PalotPerformanceSnapshot {
  capturedAt: number;
  versions: {
    platform: string;
    architecture: string;
    electron: string | null;
    chromium: string | null;
    node: string | null;
  };
  hardwareAcceleration: boolean;
  gpuFeatureStatus: Record<string, string>;
  window: {
    focused: boolean;
    visible: boolean;
    minimized: boolean;
  } | null;
  processes: PalotPerformanceProcessMetric[];
  openCodeTransport: {
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
  };
}
