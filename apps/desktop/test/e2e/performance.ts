import type { CDPSession, Page } from "@playwright/test";
import type { PalotPerformanceSnapshot } from "../../src/shared/performance-contract";
import type { StreamingLatencySample } from "../../src/shared/performance-contract";
import type {
  BatchProcessingControl,
  BatchProcessingReport,
} from "../../src/shared/performance-contract";
import {
  installBrowserPerformanceProbe,
  type BrowserProbeResult,
  type BrowserLongTask,
} from "./performance-probe.ts";
import { capturePerformanceIdentity, type PerformanceRunIdentity } from "./performance-identity.ts";

const CDP_METRICS = new Set([
  "Documents",
  "Frames",
  "JSEventListeners",
  "JSHeapTotalSize",
  "JSHeapUsedSize",
  "LayoutCount",
  "LayoutDuration",
  "Nodes",
  "RecalcStyleCount",
  "RecalcStyleDuration",
  "ScriptDuration",
  "TaskDuration",
]);

interface NumberSummary {
  count: number;
  p50: number | null;
  p95: number | null;
  max: number | null;
}

interface ProcessCpuSample {
  atMs: number;
  pid: number;
  type: string;
  name: string | null;
  serviceName: string | null;
  percentCPUUsage: number;
  cumulativeCPUUsage: number | null;
  workingSetKiB: number;
}

interface ProcessCpuSummary {
  type: string;
  name: string | null;
  serviceName: string | null;
  sampleCount: number;
  cpuCoreMs: number;
  averageCpuPercent: number;
  peakCpuPercent: number;
  workingSetKiB: { first: number; last: number; delta: number; peak: number };
}

interface ReactProfilerSample {
  id: string;
  phase: "mount" | "update" | "nested-update";
  actualDuration: number;
  baseDuration: number;
  startTime: number;
  commitTime: number;
}

interface CssSelectorTiming {
  elapsedMs: number;
  fastRejectCount: number;
  invalidationCount: number;
  matchAttempts: number;
  matchCount: number;
  selector: string;
  styleSheetId: string;
  styleSheetUrl: string | null;
  slowPathNonMatchPercentage: number | null;
}

interface CssSelectorStatsReport {
  eventCount: number;
  elapsedMs: number;
  fastRejectCount: number;
  invalidationCount: number;
  matchAttempts: number;
  matchCount: number;
  slowPathNonMatchPercentage: number | null;
  selectors: CssSelectorTiming[];
}

interface CssSelectorStatsCapture {
  stop(): Promise<CssSelectorStatsReport>;
}

export interface InteractionPerformanceReport {
  runIdentity: PerformanceRunIdentity;
  label: string;
  capturedAt: string;
  durationMs: number;
  measurementWindow: Pick<BrowserProbeResult, "timeOrigin" | "startedAt" | "endedAt">;
  collectors: BrowserProbeResult["collectors"];
  droppedEntries: BrowserProbeResult["droppedEntries"];
  batchProcessing: BatchProcessingReport;
  streamingLatency: {
    available: boolean;
    startCursor: number | null;
    endCursor: number | null;
    droppedSamples: number;
    samples: StreamingLatencySample[];
  };
  inputTimings: {
    /** Event Timing excludes events below this threshold; this is not page-level INP. */
    durationThresholdMs: number;
    inputDelayMs: NumberSummary;
    processingDurationMs: NumberSummary;
    presentationDelayMs: NumberSummary;
    interactionDurationMs: NumberSummary;
    entries: BrowserProbeResult["inputTimings"];
  };
  longAnimationFrames: NumberSummary & { entries: BrowserProbeResult["longAnimationFrames"] };
  page: {
    visibilityState: string;
    documentHasFocus: boolean;
    devicePixelRatio: number;
    viewport: { width: number; height: number };
  };
  frames: NumberSummary & {
    over25Ms: number;
    over50Ms: number;
    over100Ms: number;
  };
  longTasks: NumberSummary & {
    totalDurationMs: number;
    entries: BrowserLongTask[];
  };
  reactCommits: NumberSummary & {
    totalActualDurationMs: number;
    samples: ReactProfilerSample[];
  };
  browserMetrics: {
    before: Record<string, number>;
    after: Record<string, number>;
    delta: Record<string, number>;
  };
  cssSelectorStats: CssSelectorStatsReport | null;
  appMetrics: {
    before: PalotPerformanceSnapshot;
    after: PalotPerformanceSnapshot;
    intervalCpuPercent: number;
    workingSetKiB: {
      before: number;
      after: number;
      delta: number;
    };
    processCpu: {
      intervalMs: number;
      samples: ProcessCpuSample[];
      processes: ProcessCpuSummary[];
      byType: Array<{
        type: string;
        cpuCoreMs: number;
        averageCpuPercent: number;
        peakCpuPercent: number;
      }>;
    };
    openCodeTransportDelta: PalotPerformanceSnapshot["openCodeTransport"];
  };
}

export async function measureInteraction<T>(
  page: Page,
  label: string,
  action: () => Promise<T>,
  options: {
    captureCssSelectorStats?: boolean;
    collectGarbage?: boolean;
    processSampleIntervalMs?: number;
    captureLongAnimationFrames?: boolean;
    /** Bounded synchronous event-subscriber attribution; adds diagnostic observer overhead. */
    captureBatchProcessing?: boolean;
  } = {},
): Promise<{ result: T; report: InteractionPerformanceReport }> {
  const runIdentity = capturePerformanceIdentity();
  const diagnostics = await page.evaluate(() => {
    const browser = globalThis as unknown as {
      palotDiagnostics?: {
        snapshot(): {
          phase: string;
          preferences: { overlayVisible: boolean; reactScanActive: boolean };
        };
      };
    };
    return browser.palotDiagnostics?.snapshot() ?? null;
  });
  if (
    diagnostics &&
    (diagnostics.phase !== "idle" ||
      diagnostics.preferences.overlayVisible ||
      diagnostics.preferences.reactScanActive)
  ) {
    throw new Error("Performance measurement requires in-app diagnostics to be disabled");
  }
  const pageState = await page.evaluate(() => {
    const browser = globalThis as unknown as {
      document: { visibilityState: string; hasFocus(): boolean };
      devicePixelRatio: number;
      innerWidth: number;
      innerHeight: number;
    };
    return {
      visibilityState: browser.document.visibilityState,
      documentHasFocus: browser.document.hasFocus(),
      devicePixelRatio: browser.devicePixelRatio,
      viewport: { width: browser.innerWidth, height: browser.innerHeight },
    };
  });
  if (pageState.visibilityState !== "visible") {
    throw new Error("Performance measurement requires a document-visible Electron window");
  }
  const session = await page.context().newCDPSession(page);
  await session.send("Performance.enable", { timeDomain: "threadTicks" });
  let cssSelectorStatsCapture: CssSelectorStatsCapture | null = null;
  let browserProbeActive = false;
  let batchProcessingOwner: number | null = null;
  let processSampler: ReturnType<typeof startProcessCpuSampler> | null = null;

  try {
    if (options.collectGarbage) await session.send("HeapProfiler.collectGarbage");
    if (options.captureCssSelectorStats) {
      cssSelectorStatsCapture = await startCssSelectorStatsCapture(session);
    }
    const beforeBrowser = await readCdpMetrics(session);
    const beforeApp = await readAppMetrics(page);
    processSampler = startProcessCpuSampler(page, beforeApp, options.processSampleIntervalMs ?? 0);
    await clearReactProfiler(page);
    const streamingStartCursor = await page.evaluate(() => {
      const browser = globalThis as unknown as {
        palotStreamingLatencyWindow?: { cursor(): number };
      };
      return browser.palotStreamingLatencyWindow?.cursor() ?? null;
    });
    await page.evaluate(installBrowserPerformanceProbe, {
      label,
      captureLongAnimationFrames: options.captureLongAnimationFrames ?? false,
    });
    browserProbeActive = true;
    if (options.captureBatchProcessing) {
      batchProcessingOwner = await page.evaluate(() => {
        const browser = globalThis as unknown as { palotBatchProcessing?: BatchProcessingControl };
        return browser.palotBatchProcessing?.start() ?? null;
      });
    }

    // Cleanup in finally must not replace the action's original thrown value.
    const result = await action();
    await waitForPaint(page);
    if (options.collectGarbage) {
      await session.send("HeapProfiler.collectGarbage");
      await waitForPaint(page);
    }

    const batchProcessing =
      batchProcessingOwner === null ? null : await stopBatchProcessing(page, batchProcessingOwner);
    batchProcessingOwner = null;
    const browserProbe = await stopBrowserProbe(page);
    browserProbeActive = false;
    const streamingWindow = await page.evaluate((cursor) => {
      const browser = globalThis as unknown as {
        palotStreamingLatencyWindow?: {
          samplesSince(cursor: number): { cursor: number; samples: StreamingLatencySample[] };
        };
      };
      return cursor === null
        ? null
        : (browser.palotStreamingLatencyWindow?.samplesSince(cursor) ?? null);
    }, streamingStartCursor);
    const reactProfilerSamples = await readReactProfiler(page);
    const afterBrowser = await readCdpMetrics(session);
    const { finalSnapshot: afterApp, report: processCpu } = await processSampler.stop();
    processSampler = null;
    const cssSelectorStats = await cssSelectorStatsCapture?.stop();
    cssSelectorStatsCapture = null;

    const frameSummary = summarize(browserProbe.frameIntervalsMs);
    const longTaskDurations = browserProbe.longTasks.map((entry) => entry.duration);
    const longTaskSummary = summarize(longTaskDurations);
    const reactDurations = reactProfilerSamples.map((entry) => entry.actualDuration);
    const reactSummary = summarize(reactDurations);
    const workingSetBefore = sumWorkingSet(beforeApp);
    const workingSetAfter = sumWorkingSet(afterApp);

    return {
      result,
      report: {
        runIdentity,
        label,
        capturedAt: new Date().toISOString(),
        durationMs: round(browserProbe.durationMs),
        measurementWindow: {
          timeOrigin: browserProbe.timeOrigin,
          startedAt: browserProbe.startedAt,
          endedAt: browserProbe.endedAt,
        },
        collectors: browserProbe.collectors,
        droppedEntries: browserProbe.droppedEntries,
        batchProcessing: batchProcessing ?? {
          available: false,
          status: options.captureBatchProcessing ? "unavailable" : "disabled",
          scope: "useOpenCodeQueryEvents:sync-subscriber",
          capacity: 0,
          measurementID: null,
          timeOrigin: null,
          startedAt: null,
          endedAt: null,
          observedBatches: 0,
          observedEvents: 0,
          droppedSamples: 0,
          totalDurationMs: 0,
          maxDurationMs: 0,
          samples: [],
        },
        streamingLatency: {
          available: streamingWindow !== null,
          startCursor: streamingStartCursor,
          endCursor: streamingWindow?.cursor ?? null,
          droppedSamples:
            streamingWindow && streamingStartCursor !== null
              ? Math.max(
                  0,
                  streamingWindow.cursor - streamingStartCursor - streamingWindow.samples.length,
                )
              : 0,
          samples: streamingWindow?.samples ?? [],
        },
        inputTimings: {
          durationThresholdMs: browserProbe.eventDurationThresholdMs,
          inputDelayMs: summarize(browserProbe.inputTimings.map((entry) => entry.inputDelayMs)),
          processingDurationMs: summarize(
            browserProbe.inputTimings.map((entry) => entry.processingDurationMs),
          ),
          presentationDelayMs: summarize(
            browserProbe.inputTimings.map((entry) => entry.presentationDelayMs),
          ),
          interactionDurationMs: summarize(
            [
              ...Map.groupBy(browserProbe.inputTimings, (entry) => entry.interactionID).values(),
            ].map((entries) => Math.max(...entries.map((entry) => entry.duration))),
          ),
          entries: browserProbe.inputTimings,
        },
        longAnimationFrames: {
          ...summarize(browserProbe.longAnimationFrames.map((entry) => entry.duration)),
          entries: browserProbe.longAnimationFrames,
        },
        page: pageState,
        frames: {
          ...frameSummary,
          over25Ms: browserProbe.frameIntervalsMs.filter((value) => value > 25).length,
          over50Ms: browserProbe.frameIntervalsMs.filter((value) => value > 50).length,
          over100Ms: browserProbe.frameIntervalsMs.filter((value) => value > 100).length,
        },
        longTasks: {
          ...longTaskSummary,
          totalDurationMs: round(longTaskDurations.reduce((total, value) => total + value, 0)),
          entries: browserProbe.longTasks
            .toSorted((left, right) => right.duration - left.duration)
            .slice(0, 20)
            .map((entry) => ({
              startTime: round(entry.startTime),
              duration: round(entry.duration),
            })),
        },
        reactCommits: {
          ...reactSummary,
          totalActualDurationMs: round(reactDurations.reduce((total, value) => total + value, 0)),
          samples: reactProfilerSamples.map((sample) => ({
            ...sample,
            actualDuration: round(sample.actualDuration),
            baseDuration: round(sample.baseDuration),
            startTime: round(sample.startTime),
            commitTime: round(sample.commitTime),
          })),
        },
        browserMetrics: {
          before: beforeBrowser,
          after: afterBrowser,
          delta: metricDelta(beforeBrowser, afterBrowser),
        },
        cssSelectorStats: cssSelectorStats ?? null,
        appMetrics: {
          before: beforeApp,
          after: afterApp,
          intervalCpuPercent: round(
            processCpu.byType.reduce((total, metric) => total + metric.averageCpuPercent, 0),
          ),
          workingSetKiB: {
            before: workingSetBefore,
            after: workingSetAfter,
            delta: workingSetAfter - workingSetBefore,
          },
          processCpu,
          openCodeTransportDelta: transportMetricDelta(
            beforeApp.openCodeTransport,
            afterApp.openCodeTransport,
          ),
        },
      },
    };
  } finally {
    if (batchProcessingOwner !== null) {
      await stopBatchProcessing(page, batchProcessingOwner).catch(() => undefined);
    }
    if (browserProbeActive) await stopBrowserProbe(page).catch(() => undefined);
    await processSampler?.stop().catch(() => undefined);
    await cssSelectorStatsCapture?.stop().catch(() => undefined);
    await session.send("Performance.disable").catch(() => undefined);
    await session.detach().catch(() => undefined);
  }
}

async function stopBatchProcessing(
  page: Page,
  measurementID: number,
): Promise<BatchProcessingReport | null> {
  return page.evaluate((owner) => {
    const browser = globalThis as unknown as { palotBatchProcessing?: BatchProcessingControl };
    return browser.palotBatchProcessing?.stop(owner) ?? null;
  }, measurementID);
}

function startProcessCpuSampler(
  page: Page,
  initial: PalotPerformanceSnapshot,
  intervalMs: number,
): {
  stop(): Promise<{
    finalSnapshot: PalotPerformanceSnapshot;
    report: InteractionPerformanceReport["appMetrics"]["processCpu"];
  }>;
} {
  const snapshots = [initial];
  let stopped = false;
  let running: Promise<void> | null = null;
  const timer =
    intervalMs > 0
      ? setInterval(() => {
          if (stopped || running) return;
          running = readAppMetrics(page)
            .then((snapshot) => {
              snapshots.push(snapshot);
            })
            .finally(() => {
              running = null;
            });
        }, intervalMs)
      : null;

  return {
    async stop() {
      stopped = true;
      if (timer) clearInterval(timer);
      await running;
      const finalSnapshot = await readAppMetrics(page);
      snapshots.push(finalSnapshot);
      return { finalSnapshot, report: summarizeProcessCpu(snapshots, intervalMs) };
    },
  };
}

function summarizeProcessCpu(
  snapshots: PalotPerformanceSnapshot[],
  intervalMs: number,
): InteractionPerformanceReport["appMetrics"]["processCpu"] {
  const samples: ProcessCpuSample[] = [];
  const firstAt = snapshots[0]?.capturedAt ?? 0;
  for (let index = 1; index < snapshots.length; index += 1) {
    const snapshot = snapshots[index]!;
    for (const metric of snapshot.processes) {
      samples.push({
        atMs: snapshot.capturedAt - firstAt,
        pid: metric.pid,
        type: metric.type,
        name: metric.name,
        serviceName: metric.serviceName,
        percentCPUUsage: round(metric.cpu.percentCPUUsage),
        cumulativeCPUUsage: metric.cpu.cumulativeCPUUsage,
        workingSetKiB: metric.memory.workingSetSize,
      });
    }
  }
  const processRows = new Map<number, ProcessCpuSample[]>();
  for (const sample of samples) {
    const rows = processRows.get(sample.pid) ?? [];
    rows.push(sample);
    processRows.set(sample.pid, rows);
  }
  const processes = [...processRows.values()]
    .map((rows) => {
      const integratedCpuCoreMs = rows.reduce((total, row, index) => {
        const previousAt = index === 0 ? 0 : rows[index - 1]!.atMs;
        return total + ((row.atMs - previousAt) * row.percentCPUUsage) / 100;
      }, 0);
      const first = rows[0]!;
      const last = rows.at(-1)!;
      const initialMetric = snapshots[0]?.processes.find((metric) => metric.pid === first.pid);
      const finalMetric = snapshots.at(-1)?.processes.find((metric) => metric.pid === first.pid);
      const cumulativeCpuCoreMs =
        initialMetric?.cpu.cumulativeCPUUsage !== null &&
        initialMetric?.cpu.cumulativeCPUUsage !== undefined &&
        finalMetric?.cpu.cumulativeCPUUsage !== null &&
        finalMetric?.cpu.cumulativeCPUUsage !== undefined
          ? (finalMetric.cpu.cumulativeCPUUsage - initialMetric.cpu.cumulativeCPUUsage) * 1_000
          : null;
      const cpuCoreMs = cumulativeCpuCoreMs ?? integratedCpuCoreMs;
      const firstWorkingSet = initialMetric?.memory.workingSetSize ?? first.workingSetKiB;
      const lastWorkingSet = finalMetric?.memory.workingSetSize ?? last.workingSetKiB;
      return {
        type: first.type,
        name: first.name,
        serviceName: first.serviceName,
        sampleCount: rows.length,
        cpuCoreMs: round(cpuCoreMs),
        averageCpuPercent: last.atMs > 0 ? round((cpuCoreMs / last.atMs) * 100) : 0,
        peakCpuPercent: round(Math.max(...rows.map((row) => row.percentCPUUsage))),
        workingSetKiB: {
          first: firstWorkingSet,
          last: lastWorkingSet,
          delta: lastWorkingSet - firstWorkingSet,
          peak: Math.max(firstWorkingSet, lastWorkingSet, ...rows.map((row) => row.workingSetKiB)),
        },
      };
    })
    .toSorted((left, right) => right.cpuCoreMs - left.cpuCoreMs);
  const typeRows = new Map<string, { cpuCoreMs: number; peakCpuPercent: number }>();
  for (const process of processes) {
    const current = typeRows.get(process.type) ?? { cpuCoreMs: 0, peakCpuPercent: 0 };
    current.cpuCoreMs += process.cpuCoreMs;
    current.peakCpuPercent = Math.max(current.peakCpuPercent, process.peakCpuPercent);
    typeRows.set(process.type, current);
  }
  const durationMs = (snapshots.at(-1)?.capturedAt ?? firstAt) - firstAt;
  return {
    intervalMs,
    samples,
    processes,
    byType: [...typeRows.entries()]
      .map(([type, value]) => ({
        type,
        cpuCoreMs: round(value.cpuCoreMs),
        averageCpuPercent: durationMs > 0 ? round((value.cpuCoreMs / durationMs) * 100) : 0,
        peakCpuPercent: round(value.peakCpuPercent),
      }))
      .toSorted((left, right) => right.cpuCoreMs - left.cpuCoreMs),
  };
}

async function startCssSelectorStatsCapture(session: CDPSession): Promise<CssSelectorStatsCapture> {
  interface SelectorTimingEvent {
    "elapsed (us)"?: number;
    fast_reject_count?: number;
    invalidation_count?: number;
    match_attempts?: number;
    match_count?: number;
    selector?: string;
    style_sheet_id?: string;
  }
  interface TraceEvent {
    name?: string;
    args?: { selector_stats?: { selector_timings?: SelectorTimingEvent[] } };
  }

  const events: TraceEvent[] = [];
  const styleSheetUrls = new Map<string, string>();
  const onDataCollected = (event: { value?: TraceEvent[] }) => {
    if (event.value) events.push(...event.value);
  };
  const onStyleSheetAdded = (event: { header?: { styleSheetId?: string; sourceURL?: string } }) => {
    const id = event.header?.styleSheetId;
    if (id) styleSheetUrls.set(id, event.header?.sourceURL ?? "");
  };

  session.on("Tracing.dataCollected", onDataCollected);
  session.on("CSS.styleSheetAdded", onStyleSheetAdded);
  await session.send("DOM.enable");
  await session.send("CSS.enable");
  await session.send("Tracing.start", {
    transferMode: "ReportEvents",
    traceConfig: {
      recordMode: "recordUntilFull",
      includedCategories: [
        "disabled-by-default-blink.debug",
        "disabled-by-default-devtools.timeline.invalidationTracking",
      ],
    },
  });

  let stopped = false;
  return {
    async stop() {
      if (stopped) return emptyCssSelectorStatsReport();
      stopped = true;
      const completed = new Promise<void>((resolve) => {
        session.once("Tracing.tracingComplete", () => resolve());
      });
      try {
        await session.send("Tracing.end");
        await completed;
        return aggregateCssSelectorStats(events, styleSheetUrls);
      } finally {
        session.off("Tracing.dataCollected", onDataCollected);
        session.off("CSS.styleSheetAdded", onStyleSheetAdded);
        await session.send("CSS.disable").catch(() => undefined);
        await session.send("DOM.disable").catch(() => undefined);
      }
    },
  };
}

function aggregateCssSelectorStats(
  events: Array<{
    name?: string;
    args?: {
      selector_stats?: {
        selector_timings?: Array<{
          "elapsed (us)"?: number;
          fast_reject_count?: number;
          invalidation_count?: number;
          match_attempts?: number;
          match_count?: number;
          selector?: string;
          style_sheet_id?: string;
        }>;
      };
    };
  }>,
  styleSheetUrls: Map<string, string>,
): CssSelectorStatsReport {
  const selectors = new Map<string, Omit<CssSelectorTiming, "slowPathNonMatchPercentage">>();
  let eventCount = 0;

  for (const event of events) {
    if (event.name !== "SelectorStats") continue;
    const timings = event.args?.selector_stats?.selector_timings;
    if (!timings) continue;
    eventCount += 1;
    for (const timing of timings) {
      const selector = timing.selector ?? "";
      const styleSheetId = timing.style_sheet_id ?? "";
      const key = `${styleSheetId}\u0000${selector}`;
      const current = selectors.get(key) ?? {
        elapsedMs: 0,
        fastRejectCount: 0,
        invalidationCount: 0,
        matchAttempts: 0,
        matchCount: 0,
        selector,
        styleSheetId,
        styleSheetUrl: styleSheetUrls.get(styleSheetId) || null,
      };
      current.elapsedMs += (timing["elapsed (us)"] ?? 0) / 1_000;
      current.fastRejectCount += timing.fast_reject_count ?? 0;
      current.invalidationCount += timing.invalidation_count ?? 0;
      current.matchAttempts += timing.match_attempts ?? 0;
      current.matchCount += timing.match_count ?? 0;
      selectors.set(key, current);
    }
  }

  const rows = [...selectors.values()]
    .map((timing) => ({
      ...timing,
      elapsedMs: round(timing.elapsedMs),
      slowPathNonMatchPercentage: slowPathNonMatchPercentage(timing),
    }))
    .toSorted((left, right) => right.elapsedMs - left.elapsedMs);
  const totals = rows.reduce(
    (total, timing) => ({
      elapsedMs: total.elapsedMs + timing.elapsedMs,
      fastRejectCount: total.fastRejectCount + timing.fastRejectCount,
      invalidationCount: total.invalidationCount + timing.invalidationCount,
      matchAttempts: total.matchAttempts + timing.matchAttempts,
      matchCount: total.matchCount + timing.matchCount,
    }),
    { elapsedMs: 0, fastRejectCount: 0, invalidationCount: 0, matchAttempts: 0, matchCount: 0 },
  );

  return {
    eventCount,
    elapsedMs: round(totals.elapsedMs),
    fastRejectCount: totals.fastRejectCount,
    invalidationCount: totals.invalidationCount,
    matchAttempts: totals.matchAttempts,
    matchCount: totals.matchCount,
    slowPathNonMatchPercentage: slowPathNonMatchPercentage(totals),
    selectors: rows.slice(0, 100),
  };
}

function emptyCssSelectorStatsReport(): CssSelectorStatsReport {
  return {
    eventCount: 0,
    elapsedMs: 0,
    fastRejectCount: 0,
    invalidationCount: 0,
    matchAttempts: 0,
    matchCount: 0,
    slowPathNonMatchPercentage: null,
    selectors: [],
  };
}

function slowPathNonMatchPercentage(timing: {
  fastRejectCount: number;
  matchAttempts: number;
  matchCount: number;
}): number | null {
  const nonMatches = timing.matchAttempts - timing.matchCount;
  if (nonMatches <= 0) return null;
  return round(((nonMatches - timing.fastRejectCount) / nonMatches) * 100);
}

async function readCdpMetrics(session: CDPSession): Promise<Record<string, number>> {
  const response = await session.send("Performance.getMetrics");
  return Object.fromEntries(
    response.metrics
      .filter((metric) => CDP_METRICS.has(metric.name))
      .map((metric) => [metric.name, metric.value]),
  );
}

async function readAppMetrics(page: Page): Promise<PalotPerformanceSnapshot> {
  return page.evaluate(() => {
    const browser = globalThis as unknown as {
      palot: { performanceSnapshot(): Promise<PalotPerformanceSnapshot> };
    };
    return browser.palot.performanceSnapshot();
  });
}

async function clearReactProfiler(page: Page): Promise<void> {
  await page.evaluate(() => {
    const browser = globalThis as unknown as {
      palotReactProfiler?: { clear(): void };
    };
    browser.palotReactProfiler?.clear();
  });
}

async function readReactProfiler(page: Page): Promise<ReactProfilerSample[]> {
  return page.evaluate(() => {
    const browser = globalThis as unknown as {
      palotReactProfiler?: { samples(): ReactProfilerSample[] };
    };
    return browser.palotReactProfiler?.samples() ?? [];
  });
}

async function stopBrowserProbe(page: Page): Promise<BrowserProbeResult> {
  return page.evaluate(() => {
    const browser = globalThis as unknown as {
      __palotPerformanceProbe?: { stop(): BrowserProbeResult };
    };
    const probe = browser.__palotPerformanceProbe;
    delete browser.__palotPerformanceProbe;
    if (!probe) throw new Error("Palot browser performance probe is not active");
    return probe.stop();
  });
}

async function waitForPaint(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const browser = globalThis as unknown as {
          requestAnimationFrame(callback: () => void): number;
        };
        browser.requestAnimationFrame(() => browser.requestAnimationFrame(resolve));
      }),
  );
}

function metricDelta(
  before: Record<string, number>,
  after: Record<string, number>,
): Record<string, number> {
  return Object.fromEntries(
    Object.entries(after).map(([name, value]) => [name, value - (before[name] ?? 0)]),
  );
}

function transportMetricDelta(
  before: PalotPerformanceSnapshot["openCodeTransport"],
  after: PalotPerformanceSnapshot["openCodeTransport"],
): PalotPerformanceSnapshot["openCodeTransport"] {
  return Object.fromEntries(
    Object.entries(after).map(([name, value]) => [
      name,
      round(value - before[name as keyof typeof before]),
    ]),
  ) as unknown as PalotPerformanceSnapshot["openCodeTransport"];
}

function sumWorkingSet(snapshot: PalotPerformanceSnapshot): number {
  return snapshot.processes.reduce((total, metric) => total + metric.memory.workingSetSize, 0);
}

function summarize(values: number[]): NumberSummary {
  if (values.length === 0) return { count: 0, p50: null, p95: null, max: null };
  const sorted = values.toSorted((left, right) => left - right);
  return {
    count: sorted.length,
    p50: round(percentile(sorted, 0.5)),
    p95: round(percentile(sorted, 0.95)),
    max: round(sorted.at(-1) ?? 0),
  };
}

function percentile(sorted: number[], percentileValue: number): number {
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * percentileValue) - 1);
  return sorted[index] ?? 0;
}

function round(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}
