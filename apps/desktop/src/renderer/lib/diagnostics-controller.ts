import type {
  OpenCodeRuntimeStatus,
  PalotPerformanceProcessMetric,
  PalotPerformanceSnapshot,
} from "../../shared";
import {
  browserDiagnosticsAvailability,
  createBrowserDiagnosticsProbe,
  type BrowserDiagnosticsProbe,
  type BrowserDiagnosticsRead,
} from "./browser-diagnostics-probe";
import { palotBuild } from "./build";
import { writeClipboardText } from "./clipboard";
import type { ReactScanDiagnosticsSample } from "./diagnostics-bootstrap";
import {
  reactScanRequested,
  readDiagnosticsPreferences,
  subscribeDiagnosticsPreferences,
  updateDiagnosticsPreferences,
} from "./diagnostics-preferences";
import {
  setStreamingLatencyCollectionSource,
  streamingLatencyCursor,
  streamingLatencySamplesSince,
  type StreamingLatencySample,
} from "./streaming-latency";
import { registerDiagnosticsSnapshot } from "./diagnostics-runtime";

export type DiagnosticsDemand = "dashboard" | "overlay";
export type DiagnosticsPhase = "idle" | "warming" | "live" | "degraded";

export interface DiagnosticsNumberSummary {
  count: number;
  p50: number | null;
  p95: number | null;
  max: number | null;
}

export interface DiagnosticsRendererSample {
  capturedAt: number;
  intervalMs: number;
  frames: DiagnosticsNumberSummary & {
    fps: number | null;
    over25Ms: number;
    over50Ms: number;
  };
  longTasks: DiagnosticsNumberSummary & {
    totalDurationMs: number;
  };
  streamingLatency: DiagnosticsNumberSummary;
  reactScan: ReactScanDiagnosticsSample | null;
  heap: BrowserDiagnosticsRead["heap"];
}

export interface DiagnosticsProcessGroup {
  type: PalotPerformanceProcessMetric["type"];
  count: number;
  cpuPercent: number | null;
  workingSetKiB: number;
  peakWorkingSetKiB: number;
}

export interface DiagnosticsHistoryPoint {
  capturedAt: number;
  cpuPercent: number | null;
  workingSetMiB: number | null;
  frameP95Ms: number | null;
  longestTaskMs: number | null;
  streamingP95Ms: number | null;
}

export interface DiagnosticsSnapshot {
  phase: DiagnosticsPhase;
  demands: readonly DiagnosticsDemand[];
  preferences: {
    overlayVisible: boolean;
    reactScanRequested: boolean;
    reactScanActive: boolean;
    reactScanStatus: "off" | "active" | "failed";
  };
  build: {
    reactProfiling: boolean;
    reactCompilerMode: "annotation" | "infer" | null;
    performanceHarness: boolean;
  };
  capabilities: {
    animationFrames: boolean;
    longTasks: boolean;
    rendererHeap: boolean;
    nativeMetrics: boolean;
  };
  collector: {
    startedAt: number | null;
    lastSampleAt: number | null;
    sampleIntervalMs: number;
    sampleCount: number;
    lastCollectionDurationMs: number | null;
    averageCollectionDurationMs: number | null;
    lastErrorCode: "native-unavailable" | "native-snapshot-failed" | null;
  };
  current: {
    app: PalotPerformanceSnapshot | null;
    renderer: DiagnosticsRendererSample | null;
    cpuReady: boolean;
    cpuPercent: number | null;
    workingSetKiB: number | null;
    processGroups: readonly DiagnosticsProcessGroup[];
  };
  history: readonly DiagnosticsHistoryPoint[];
}

export interface DiagnosticsRuntimeSummary {
  connected: boolean;
  phase: OpenCodeRuntimeStatus["phase"];
  version: string | null;
  managed: boolean;
}

export interface SafeDiagnosticsReport {
  schemaVersion: 1;
  generatedAt: string;
  build: {
    palotVersion: string;
    channel: string;
    commitSha: string;
    buildNumber: string;
    openCodeContractVersion: string;
    dirty: boolean;
    platform: string | null;
    architecture: string | null;
    electronVersion: string | null;
    chromiumVersion: string | null;
    nodeVersion: string | null;
    reactProfiling: boolean;
    reactCompilerMode: "annotation" | "infer" | null;
    reactScanRequested: boolean;
    reactScanActive: boolean;
  };
  runtime: DiagnosticsRuntimeSummary | null;
  collection: {
    active: boolean;
    sampleIntervalMs: number;
    sampleCount: number;
    coveredDurationMs: number | null;
    lastCollectionDurationMs: number | null;
    averageCollectionDurationMs: number | null;
    lastErrorCode: DiagnosticsSnapshot["collector"]["lastErrorCode"];
  };
  current: {
    cpuPercent: number | null;
    workingSetMiB: number | null;
    processCount: number;
    frameP95Ms: number | null;
    longTaskCount: number;
    longestTaskMs: number | null;
    streamingP95Ms: number | null;
    rendererHeapUsedMiB: number | null;
    hardwareAcceleration: boolean | null;
    window: PalotPerformanceSnapshot["window"];
    gpuFeatureStatus: Record<string, string>;
  };
  history: {
    cpuPercent: DiagnosticsNumberSummary;
    workingSetMiB: DiagnosticsNumberSummary;
    frameP95Ms: DiagnosticsNumberSummary;
    longestTaskMs: DiagnosticsNumberSummary;
    streamingP95Ms: DiagnosticsNumberSummary;
  };
  processGroups: readonly DiagnosticsProcessGroup[];
}

interface DiagnosticsControllerDependencies {
  captureAppSnapshot(): Promise<PalotPerformanceSnapshot>;
  createBrowserProbe(): BrowserDiagnosticsProbe;
  now(): number;
  performanceNow(): number;
  setTimer(callback: () => void, delay: number): ReturnType<typeof setTimeout>;
  clearTimer(timer: ReturnType<typeof setTimeout>): void;
  copyText(text: string): Promise<void>;
  reload(): void;
  sampleIntervalMs: number;
}

export interface DiagnosticsController {
  getSnapshot(): DiagnosticsSnapshot;
  subscribe(listener: () => void): () => void;
  acquire(demand: DiagnosticsDemand): () => void;
  captureNow(): Promise<DiagnosticsSnapshot>;
  clearHistory(): void;
  setOverlayVisible(visible: boolean): void;
  setReactScanEnabled(enabled: boolean): void;
  createSafeReport(runtime?: DiagnosticsRuntimeSummary | null): SafeDiagnosticsReport;
  copySafeReport(runtime?: DiagnosticsRuntimeSummary | null): Promise<SafeDiagnosticsReport>;
  dispose(): void;
}

const HISTORY_LIMIT = 120;
const SAFE_REPORT_LIMIT_BYTES = 64 * 1_024;
const SAFE_RUNTIME_PHASES = new Set<OpenCodeRuntimeStatus["phase"]>([
  "idle",
  "discovering",
  "starting",
  "connecting",
  "connected",
  "reconnecting",
  "error",
  "stopped",
]);
const SAFE_VERSION_PATTERN = /^[0-9A-Za-z][0-9A-Za-z.+-]{0,63}$/;
const SAFE_GPU_FEATURES = new Set([
  "2d_canvas",
  "gpu_compositing",
  "multiple_raster_threads",
  "rasterization",
  "video_decode",
  "video_encode",
  "vulkan",
  "webgl",
  "webgpu",
]);

export function createDiagnosticsController(
  overrides: Partial<DiagnosticsControllerDependencies> = {},
): DiagnosticsController {
  const dependencies: DiagnosticsControllerDependencies = {
    captureAppSnapshot: async () => {
      if (
        typeof window === "undefined" ||
        typeof window.palot?.performanceSnapshot !== "function"
      ) {
        throw new Error("Native diagnostics are unavailable");
      }
      return window.palot.performanceSnapshot();
    },
    createBrowserProbe: createBrowserDiagnosticsProbe,
    now: () => Date.now(),
    performanceNow: () => performance.now(),
    setTimer: (callback, delay) => setTimeout(callback, delay),
    clearTimer: (timer) => clearTimeout(timer),
    copyText: writeClipboardText,
    reload: () => window.location.reload(),
    sampleIntervalMs: 1_000,
    ...overrides,
  };
  const listeners = new Set<() => void>();
  const leases = new Map<symbol, DiagnosticsDemand>();
  let phase: DiagnosticsPhase = "idle";
  let browserProbe: BrowserDiagnosticsProbe | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let deferredStop: ReturnType<typeof setTimeout> | null = null;
  let inFlight: Promise<void> | null = null;
  let generation = 0;
  let nativeWarmed = false;
  let currentApp: PalotPerformanceSnapshot | null = null;
  let currentRenderer: DiagnosticsRendererSample | null = null;
  let currentCpuReady = false;
  let history: DiagnosticsHistoryPoint[] = [];
  let collectorStartedAt: number | null = null;
  let lastSampleAt: number | null = null;
  let collectorSampleCount = 0;
  let lastCollectionDurationMs: number | null = null;
  let totalCollectionDurationMs = 0;
  let lastErrorCode: DiagnosticsSnapshot["collector"]["lastErrorCode"] = null;
  let streamingCursor = streamingLatencyCursor();
  let snapshot = buildSnapshot();

  const unsubscribePreferences = subscribeDiagnosticsPreferences(() => emit());

  function active(): boolean {
    return leases.size > 0;
  }

  function buildSnapshot(): DiagnosticsSnapshot {
    const preferences = readDiagnosticsPreferences();
    const bootstrap =
      typeof window === "undefined" || !window.palotDiagnosticsBoot
        ? {
            reactScanRequested: reactScanRequested(preferences),
            reactScanActive: false,
            reactScanStatus: "off" as const,
          }
        : window.palotDiagnosticsBoot;
    const cpuPercent = currentApp && currentCpuReady ? totalCpuPercent(currentApp) : null;
    const workingSetKiB = currentApp ? totalWorkingSet(currentApp) : null;
    const availability = browserDiagnosticsAvailability();
    return {
      phase,
      demands: [...new Set(leases.values())].toSorted(),
      preferences: {
        overlayVisible: preferences.overlayVisible,
        reactScanRequested: reactScanRequested(preferences),
        reactScanActive: bootstrap.reactScanActive,
        reactScanStatus: bootstrap.reactScanStatus,
      },
      build: {
        reactProfiling: __PALOT_REACT_PROFILING__,
        reactCompilerMode: __PALOT_REACT_COMPILER_MODE__,
        performanceHarness: __PALOT_PERFORMANCE_HARNESS__,
      },
      capabilities: {
        ...availability,
        nativeMetrics:
          typeof window !== "undefined" && typeof window.palot?.performanceSnapshot === "function",
      },
      collector: {
        startedAt: collectorStartedAt,
        lastSampleAt,
        sampleIntervalMs: dependencies.sampleIntervalMs,
        sampleCount: collectorSampleCount,
        lastCollectionDurationMs,
        averageCollectionDurationMs:
          collectorSampleCount > 0 ? totalCollectionDurationMs / collectorSampleCount : null,
        lastErrorCode,
      },
      current: {
        app: currentApp,
        renderer: currentRenderer,
        cpuReady: currentCpuReady,
        cpuPercent,
        workingSetKiB,
        processGroups: currentApp ? groupProcesses(currentApp, currentCpuReady) : [],
      },
      history,
    };
  }

  function emit(): void {
    snapshot = buildSnapshot();
    for (const listener of listeners) listener();
  }

  function startCollection(): void {
    if (browserProbe || !active()) return;
    if (deferredStop) {
      dependencies.clearTimer(deferredStop);
      deferredStop = null;
    }
    generation += 1;
    nativeWarmed = false;
    currentCpuReady = false;
    collectorStartedAt = dependencies.now();
    lastErrorCode = null;
    phase = "warming";
    browserProbe = dependencies.createBrowserProbe();
    window.palotReactScan?.readAndReset();
    streamingCursor = streamingLatencyCursor();
    setStreamingLatencyCollectionSource("diagnostics", true);
    emit();
    void runScheduledSample(generation);
  }

  function scheduleNext(expectedGeneration: number): void {
    if (!active() || expectedGeneration !== generation) return;
    if (timer) dependencies.clearTimer(timer);
    timer = dependencies.setTimer(() => {
      timer = null;
      void runScheduledSample(expectedGeneration);
    }, dependencies.sampleIntervalMs);
  }

  async function runScheduledSample(expectedGeneration: number): Promise<void> {
    await collectActiveSample(expectedGeneration);
    scheduleNext(expectedGeneration);
  }

  async function collectActiveSample(expectedGeneration: number): Promise<void> {
    if (inFlight) return inFlight;
    const task = (async () => {
      const collectionStartedAt = dependencies.performanceNow();
      const browserRead = browserProbe?.readAndReset() ?? null;
      const reactScanRead = window.palotReactScan?.readAndReset() ?? null;
      const streamingRead = streamingLatencySamplesSince(streamingCursor);
      streamingCursor = streamingRead.cursor;
      let app: PalotPerformanceSnapshot | null = null;
      let errorCode: DiagnosticsSnapshot["collector"]["lastErrorCode"] = null;
      try {
        app = await dependencies.captureAppSnapshot();
      } catch (error) {
        errorCode = error instanceof Error ? "native-snapshot-failed" : "native-unavailable";
      }
      if (expectedGeneration !== generation || !active()) return;

      const capturedAt = dependencies.now();
      const collectionDurationMs = Math.max(0, dependencies.performanceNow() - collectionStartedAt);
      currentRenderer = browserRead
        ? rendererSample(capturedAt, browserRead, streamingRead.samples, reactScanRead)
        : null;
      if (app) {
        currentCpuReady = nativeWarmed;
        nativeWarmed = true;
        currentApp = app;
      }
      lastErrorCode = errorCode;
      lastSampleAt = capturedAt;
      lastCollectionDurationMs = collectionDurationMs;
      totalCollectionDurationMs += collectionDurationMs;
      collectorSampleCount += 1;
      phase = errorCode ? "degraded" : currentCpuReady ? "live" : "warming";
      history = retainHistory([
        ...history,
        historyPoint(capturedAt, app, currentCpuReady, currentRenderer),
      ]);
      emit();
    })();
    inFlight = task;
    try {
      await task;
    } finally {
      if (inFlight === task) inFlight = null;
    }
  }

  function stopCollection(): void {
    if (active()) return;
    generation += 1;
    if (timer) dependencies.clearTimer(timer);
    timer = null;
    browserProbe?.stop();
    browserProbe = null;
    setStreamingLatencyCollectionSource("diagnostics", false);
    collectorStartedAt = null;
    nativeWarmed = false;
    currentCpuReady = false;
    phase = "idle";
    emit();
  }

  function releaseLater(): void {
    if (active() || deferredStop) return;
    deferredStop = dependencies.setTimer(() => {
      deferredStop = null;
      stopCollection();
    }, 0);
  }

  async function captureNow(): Promise<DiagnosticsSnapshot> {
    if (active()) {
      if (timer) dependencies.clearTimer(timer);
      timer = null;
      await collectActiveSample(generation);
      if (!timer) scheduleNext(generation);
      return snapshot;
    }

    const collectionStartedAt = dependencies.performanceNow();
    try {
      currentApp = await dependencies.captureAppSnapshot();
      currentCpuReady = false;
      lastErrorCode = null;
    } catch {
      lastErrorCode = "native-snapshot-failed";
    }
    lastSampleAt = dependencies.now();
    lastCollectionDurationMs = Math.max(0, dependencies.performanceNow() - collectionStartedAt);
    emit();
    return snapshot;
  }

  function clearHistory(): void {
    history = [];
    currentRenderer = null;
    collectorSampleCount = 0;
    totalCollectionDurationMs = 0;
    lastCollectionDurationMs = null;
    streamingCursor = streamingLatencyCursor();
    browserProbe?.readAndReset();
    window.palotReactScan?.readAndReset();
    emit();
  }

  function createSafeReport(
    runtime: DiagnosticsRuntimeSummary | null = null,
  ): SafeDiagnosticsReport {
    const current = snapshot;
    const app = current.current.app;
    const renderer = current.current.renderer;
    const coveredDurationMs =
      current.history.length > 1
        ? current.history.at(-1)!.capturedAt - current.history[0]!.capturedAt
        : null;
    return {
      schemaVersion: 1,
      generatedAt: new Date(dependencies.now()).toISOString(),
      build: {
        palotVersion: palotBuild.version,
        channel: palotBuild.channel,
        commitSha: palotBuild.commitSha,
        buildNumber: palotBuild.buildNumber,
        openCodeContractVersion: palotBuild.openCodeContractVersion,
        dirty: palotBuild.dirty,
        platform: app?.versions.platform ?? null,
        architecture: app?.versions.architecture ?? null,
        electronVersion: app?.versions.electron ?? null,
        chromiumVersion: app?.versions.chromium ?? null,
        nodeVersion: app?.versions.node ?? null,
        reactProfiling: current.build.reactProfiling,
        reactCompilerMode: current.build.reactCompilerMode,
        reactScanRequested: current.preferences.reactScanRequested,
        reactScanActive: current.preferences.reactScanActive,
      },
      runtime: safeRuntimeSummary(runtime),
      collection: {
        active: current.phase !== "idle",
        sampleIntervalMs: current.collector.sampleIntervalMs,
        sampleCount: current.collector.sampleCount,
        coveredDurationMs,
        lastCollectionDurationMs: nullableRound(current.collector.lastCollectionDurationMs),
        averageCollectionDurationMs: nullableRound(current.collector.averageCollectionDurationMs),
        lastErrorCode: current.collector.lastErrorCode,
      },
      current: {
        cpuPercent: nullableRound(current.current.cpuPercent),
        workingSetMiB:
          current.current.workingSetKiB === null
            ? null
            : round(current.current.workingSetKiB / 1_024),
        processCount: app?.processes.length ?? 0,
        frameP95Ms: nullableRound(renderer?.frames.p95 ?? null),
        longTaskCount: renderer?.longTasks.count ?? 0,
        longestTaskMs: nullableRound(renderer?.longTasks.max ?? null),
        streamingP95Ms: nullableRound(renderer?.streamingLatency.p95 ?? null),
        rendererHeapUsedMiB:
          renderer?.heap === null || renderer?.heap === undefined
            ? null
            : round(renderer.heap.usedBytes / 1_048_576),
        hardwareAcceleration: app?.hardwareAcceleration ?? null,
        window: app?.window ?? null,
        gpuFeatureStatus: app ? safeGpuFeatureStatus(app.gpuFeatureStatus) : {},
      },
      history: {
        cpuPercent: summarizeDefined(current.history.map((point) => point.cpuPercent)),
        workingSetMiB: summarizeDefined(current.history.map((point) => point.workingSetMiB)),
        frameP95Ms: summarizeDefined(current.history.map((point) => point.frameP95Ms)),
        longestTaskMs: summarizeDefined(current.history.map((point) => point.longestTaskMs)),
        streamingP95Ms: summarizeDefined(current.history.map((point) => point.streamingP95Ms)),
      },
      processGroups: current.current.processGroups.map((group) => ({
        ...group,
        cpuPercent: nullableRound(group.cpuPercent),
      })),
    };
  }

  const controller: DiagnosticsController = {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    acquire(demand) {
      const lease = Symbol(demand);
      leases.set(lease, demand);
      if (deferredStop) {
        dependencies.clearTimer(deferredStop);
        deferredStop = null;
      }
      startCollection();
      emit();
      let released = false;
      return () => {
        if (released) return;
        released = true;
        leases.delete(lease);
        emit();
        releaseLater();
      };
    },
    captureNow,
    clearHistory,
    setOverlayVisible(visible) {
      updateDiagnosticsPreferences({ overlayVisible: visible });
    },
    setReactScanEnabled(enabled) {
      updateDiagnosticsPreferences({ reactScanEnabled: enabled });
      dependencies.reload();
    },
    createSafeReport,
    async copySafeReport(runtime = null) {
      if (!currentApp || dependencies.now() - currentApp.capturedAt > 5_000) await captureNow();
      const report = createSafeReport(runtime);
      const text = JSON.stringify(report, null, 2);
      if (new TextEncoder().encode(text).byteLength > SAFE_REPORT_LIMIT_BYTES) {
        throw new Error("The diagnostics report exceeded 64 KiB");
      }
      await dependencies.copyText(text);
      return report;
    },
    dispose() {
      leases.clear();
      if (deferredStop) dependencies.clearTimer(deferredStop);
      deferredStop = null;
      stopCollection();
      unsubscribePreferences();
      listeners.clear();
    },
  };

  return controller;
}

export const diagnostics = createDiagnosticsController();
registerDiagnosticsSnapshot(diagnostics.getSnapshot);

function rendererSample(
  capturedAt: number,
  browser: BrowserDiagnosticsRead,
  streaming: StreamingLatencySample[],
  reactScan: ReactScanDiagnosticsSample | null,
): DiagnosticsRendererSample {
  const frameSummary = summarize(browser.frameIntervalsMs);
  const longTaskDurations = browser.longTasks.map((entry) => entry.duration);
  return {
    capturedAt,
    intervalMs: round(browser.intervalMs),
    frames: {
      ...frameSummary,
      fps: framesPerSecond(browser.frameIntervalsMs),
      over25Ms: browser.frameIntervalsMs.filter((value) => value > 25).length,
      over50Ms: browser.frameIntervalsMs.filter((value) => value > 50).length,
    },
    longTasks: {
      ...summarize(longTaskDurations),
      totalDurationMs: round(longTaskDurations.reduce((total, value) => total + value, 0)),
    },
    streamingLatency: summarizeDefined(streaming.map((sample) => sample.totalToCommitMs)),
    reactScan,
    heap: browser.heap,
  };
}

function framesPerSecond(intervals: number[]): number | null {
  const elapsed = intervals.reduce((total, value) => total + value, 0);
  return intervals.length > 0 && elapsed > 0 ? round((intervals.length * 1_000) / elapsed) : null;
}

function historyPoint(
  capturedAt: number,
  app: PalotPerformanceSnapshot | null,
  cpuReady: boolean,
  renderer: DiagnosticsRendererSample | null,
): DiagnosticsHistoryPoint {
  return {
    capturedAt,
    cpuPercent: app && cpuReady ? round(totalCpuPercent(app)) : null,
    workingSetMiB: app ? round(totalWorkingSet(app) / 1_024) : null,
    frameP95Ms: renderer?.frames.p95 ?? null,
    longestTaskMs: renderer?.longTasks.max ?? null,
    streamingP95Ms: renderer?.streamingLatency.p95 ?? null,
  };
}

function retainHistory(values: DiagnosticsHistoryPoint[]): DiagnosticsHistoryPoint[] {
  return values.slice(-HISTORY_LIMIT);
}

function totalCpuPercent(snapshot: PalotPerformanceSnapshot): number {
  return snapshot.processes.reduce((total, process) => total + process.cpu.percentCPUUsage, 0);
}

function totalWorkingSet(snapshot: PalotPerformanceSnapshot): number {
  return snapshot.processes.reduce((total, process) => total + process.memory.workingSetSize, 0);
}

function groupProcesses(
  snapshot: PalotPerformanceSnapshot,
  cpuReady: boolean,
): DiagnosticsProcessGroup[] {
  const groups = new Map<PalotPerformanceProcessMetric["type"], DiagnosticsProcessGroup>();
  for (const process of snapshot.processes) {
    const current = groups.get(process.type) ?? {
      type: process.type,
      count: 0,
      cpuPercent: cpuReady ? 0 : null,
      workingSetKiB: 0,
      peakWorkingSetKiB: 0,
    };
    current.count += 1;
    if (current.cpuPercent !== null) current.cpuPercent += process.cpu.percentCPUUsage;
    current.workingSetKiB += process.memory.workingSetSize;
    current.peakWorkingSetKiB += process.memory.peakWorkingSetSize;
    groups.set(process.type, current);
  }
  return [...groups.values()].toSorted(
    (left, right) =>
      right.workingSetKiB - left.workingSetKiB || left.type.localeCompare(right.type),
  );
}

function safeGpuFeatureStatus(status: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(status)
      .filter(([name]) => SAFE_GPU_FEATURES.has(name))
      .toSorted(([left], [right]) => left.localeCompare(right)),
  );
}

function safeRuntimeSummary(
  runtime: DiagnosticsRuntimeSummary | null,
): DiagnosticsRuntimeSummary | null {
  if (
    !runtime ||
    typeof runtime.connected !== "boolean" ||
    !SAFE_RUNTIME_PHASES.has(runtime.phase) ||
    typeof runtime.managed !== "boolean"
  ) {
    return null;
  }
  return {
    connected: runtime.connected,
    phase: runtime.phase,
    version:
      typeof runtime.version === "string" && SAFE_VERSION_PATTERN.test(runtime.version)
        ? runtime.version
        : null,
    managed: runtime.managed,
  };
}

function summarizeDefined(values: Array<number | null>): DiagnosticsNumberSummary {
  return summarize(values.filter((value): value is number => value !== null));
}

function summarize(values: number[]): DiagnosticsNumberSummary {
  if (values.length === 0) return { count: 0, p50: null, p95: null, max: null };
  const sorted = values.toSorted((left, right) => left - right);
  return {
    count: sorted.length,
    p50: round(percentile(sorted, 0.5)),
    p95: round(percentile(sorted, 0.95)),
    max: round(sorted.at(-1) ?? 0),
  };
}

function percentile(sorted: number[], value: number): number {
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * value) - 1);
  return sorted[index] ?? 0;
}

function nullableRound(value: number | null): number | null {
  return value === null ? null : round(value);
}

function round(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}
