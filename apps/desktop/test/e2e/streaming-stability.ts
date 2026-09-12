import type { Page } from "@playwright/test";

/** Callback phases, not compositor/presented-frame timestamps. Geometry reads can force layout. */
export type StreamingStabilityPhase =
  | "start"
  | "raf"
  | "resize-observer"
  | "virtual-layout"
  | "stop";

export interface StreamingStabilitySample {
  time: number;
  frame: number;
  phase: StreamingStabilityPhase;
  /** Local numeric identities only; never session IDs, DOM text, or content. */
  rowId: number;
  continuityId: number;
  statusTop: number;
  statusBottom: number;
  dockTop: number;
  dockHeight: number;
  turnHeight: number;
  turnBottom: number;
  virtualHeight: number;
  virtualBottom: number;
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  bottomLocked: boolean;
  userScrolling: boolean;
  resized: Array<"turn" | "dock">;
}

export interface StreamingStabilityCapture {
  timeOrigin: number;
  startedAt: number;
  endedAt: number;
  maxSamples: number;
  droppedSamples: number;
  skippedSamples: { hidden: number; disconnected: number; inactive: number };
  resizeObserver: "observing" | "unsupported" | "failed";
  samples: StreamingStabilitySample[];
}

export interface StreamingStabilityExcursion {
  rowId: number;
  beforeIndex: number;
  peakIndex: number;
  recoveryIndex: number;
  downPx: number;
  postLayoutDownPx: number;
  durationMs: number;
  recoveryFrames: number;
}

export interface StreamingStabilitySummary {
  sampleCount: number;
  droppedSamples: number;
  complete: boolean;
  phaseCounts: Record<StreamingStabilityPhase, number>;
  excursionCount: number;
  maxDownPx: number;
  /** Post-spacer-update overlap beyond CSS-pixel rounding, not presented-frame proof. */
  postLayoutOverlapCount: number;
  maxPostLayoutOverlapPx: number;
  postLayoutExcursionCount: number;
  maxPostLayoutDownPx: number;
  settledTailSamples: number;
  tailClearanceViolationCount: number;
  maxTailClearanceErrorPx: number;
  excursions: StreamingStabilityExcursion[];
}

/**
 * Descriptive only: down-and-back gap changes within the same/next rAF tick.
 * Dock position/height, row, continuity and bottom lock must remain unchanged.
 * Sustained positions are not excursions. A one-CSS-pixel tolerance accounts for
 * integer virtualizer measurements vs fractional layout at non-integral DPR; it
 * is not a perceptual performance budget. Keep the raw geometry for attribution.
 * rAF/RO excursions can precede a same-broadcast correction; their frame counters
 * do not prove a missed paint. Separately report clearance after spacer style
 * delivery, when synchronous spacer/scroll updates have finished.
 */
export function summarizeStreamingStability(
  capture: StreamingStabilityCapture,
): StreamingStabilitySummary {
  const phaseCounts: StreamingStabilitySummary["phaseCounts"] = {
    start: 0,
    raf: 0,
    "resize-observer": 0,
    "virtual-layout": 0,
    stop: 0,
  };
  const excursions: StreamingStabilityExcursion[] = [];
  const samples = capture.samples;
  const roundingTolerance = 1;
  let postLayoutOverlapCount = 0;
  let maxPostLayoutOverlapPx = 0;
  let settledTailSamples = 0;
  let tailClearanceViolationCount = 0;
  let maxTailClearanceErrorPx = 0;
  let previousIndex = -1;
  let candidate: { beforeIndex: number; peakIndex: number; firstDownFrame: number } | null = null;
  const gap = (sample: StreamingStabilitySample) => sample.dockTop - sample.statusBottom;
  for (const [index, sample] of samples.entries()) {
    phaseCounts[sample.phase] += 1;
    const previous = samples[previousIndex];
    const stableContext =
      previous &&
      previous.bottomLocked &&
      sample.bottomLocked &&
      !previous.userScrolling &&
      !sample.userScrolling &&
      sample.rowId === previous.rowId &&
      sample.continuityId === previous.continuityId &&
      sample.dockTop === previous.dockTop &&
      sample.dockHeight === previous.dockHeight &&
      sample.time >= previous.time;
    const continuous =
      stableContext && sample.frame - previous.frame <= 1 && sample.frame >= previous.frame;
    // The live status owns no trailing inter-turn spacing. Once the actual tail
    // agrees with the measured spacer, its clearance is the 16px dock reserve.
    // This spans row replacements and catches sustained UPWARD shifts too.
    // Ignore initial estimates and short transcripts that cannot scroll yet.
    if (
      sample.phase === "virtual-layout" &&
      sample.bottomLocked &&
      !sample.userScrolling &&
      sample.scrollHeight > sample.clientHeight + roundingTolerance &&
      Math.abs(sample.virtualBottom - sample.turnBottom - sample.dockHeight - 16) <=
        roundingTolerance
    ) {
      settledTailSamples += 1;
      const error = Math.abs(gap(sample) - 16);
      if (error > roundingTolerance) {
        tailClearanceViolationCount += 1;
        maxTailClearanceErrorPx = Math.max(maxTailClearanceErrorPx, error);
      }
    }
    if (stableContext && sample.phase === "virtual-layout" && gap(sample) < -roundingTolerance) {
      postLayoutOverlapCount += 1;
      maxPostLayoutOverlapPx = Math.max(maxPostLayoutOverlapPx, -gap(sample));
    }
    if (!continuous) candidate = null;
    if (candidate && sample.frame - candidate.firstDownFrame > 1) candidate = null;
    if (continuous) {
      if (candidate) {
        const before = samples[candidate.beforeIndex]!;
        const peak = samples[candidate.peakIndex]!;
        if (Math.abs(gap(sample) - gap(before)) <= roundingTolerance) {
          let postLayoutDownPx = 0;
          for (let cursor = candidate.beforeIndex + 1; cursor < index; cursor += 1) {
            const intermediate = samples[cursor]!;
            if (intermediate.phase === "virtual-layout") {
              postLayoutDownPx = Math.max(postLayoutDownPx, gap(before) - gap(intermediate));
            }
          }
          excursions.push({
            rowId: sample.rowId,
            beforeIndex: candidate.beforeIndex,
            peakIndex: candidate.peakIndex,
            recoveryIndex: index,
            downPx: gap(before) - gap(peak),
            postLayoutDownPx,
            durationMs: sample.time - peak.time,
            recoveryFrames: sample.frame - peak.frame,
          });
          candidate = null;
        } else if (gap(sample) < gap(peak)) {
          candidate.peakIndex = index;
        } else if (gap(sample) > gap(before) + roundingTolerance) {
          candidate = null;
        }
      } else if (gap(sample) < gap(previous) - roundingTolerance) {
        candidate = { beforeIndex: previousIndex, peakIndex: index, firstDownFrame: sample.frame };
      }
    }
    previousIndex = index;
  }
  return {
    sampleCount: samples.length,
    droppedSamples: capture.droppedSamples,
    complete:
      capture.droppedSamples === 0 &&
      capture.skippedSamples.hidden === 0 &&
      capture.skippedSamples.disconnected === 0 &&
      capture.resizeObserver === "observing" &&
      samples.length > 0,
    phaseCounts,
    excursionCount: excursions.length,
    maxDownPx: excursions.reduce((max, excursion) => Math.max(max, excursion.downPx), 0),
    postLayoutOverlapCount,
    maxPostLayoutOverlapPx,
    postLayoutExcursionCount: excursions.filter(
      (entry) => entry.postLayoutDownPx > roundingTolerance,
    ).length,
    maxPostLayoutDownPx: excursions.reduce(
      (max, entry) => Math.max(max, entry.postLayoutDownPx),
      0,
    ),
    settledTailSamples,
    tailClearanceViolationCount,
    maxTailClearanceErrorPx,
    excursions,
  };
}

/** Self-contained: Playwright serializes this function into the native renderer. */
export function installStreamingStabilityProbe(options: { maxSamples?: number } = {}): void {
  const browser = globalThis as typeof globalThis & {
    __palotStreamingStabilityProbe?: {
      stop(): StreamingStabilityCapture;
      setUserScrolling(active: boolean): void;
    };
  };
  browser.__palotStreamingStabilityProbe?.stop();
  const startedAt = performance.now();
  const requestedLimit = options.maxSamples ?? 20_000;
  const maxSamples = Number.isFinite(requestedLimit)
    ? Math.min(20_000, Math.max(0, Math.floor(requestedLimit)))
    : 20_000;
  const samples: StreamingStabilitySample[] = [];
  const skippedSamples = { hidden: 0, disconnected: 0, inactive: 0 };
  let droppedSamples = 0;
  let row: Element | null = null;
  let turn: Element | null = null;
  let virtual: Element | null = null;
  let viewport: Element | null = null;
  let dock: Element | null = null;
  let rowId = 0;
  let turnIndex: string | null = null;
  let continuityId = 0;
  let frame = 0;
  let userScrolling = false;
  let frameHandle = 0;
  let stopped: StreamingStabilityCapture | null = null;
  let resizeObserver: ResizeObserver | undefined;
  let resizeObserverStatus: StreamingStabilityCapture["resizeObserver"] = "unsupported";

  const record = (
    phase: StreamingStabilityPhase,
    resized: StreamingStabilitySample["resized"] = [],
  ) => {
    if (stopped) return;
    if (document.visibilityState !== "visible") {
      skippedSamples.hidden += 1;
      continuityId += 1;
      return;
    }
    // No active status before the workload starts or after it completes is
    // expected, unlike losing a previously cached node before reacquisition.
    if (row === null) {
      skippedSamples.inactive += 1;
      continuityId += 1;
      return;
    }
    if (
      !row?.isConnected ||
      !row.hasAttribute("data-palot-active-turn-status") ||
      !turn?.isConnected ||
      !virtual?.isConnected ||
      !viewport?.isConnected ||
      !dock?.isConnected
    ) {
      skippedSamples.disconnected += 1;
      continuityId += 1;
      return;
    }
    if (samples.length >= maxSamples) {
      droppedSamples += 1;
      return;
    }
    const statusRect = row.getBoundingClientRect();
    const dockRect = dock.getBoundingClientRect();
    const turnRect = turn.getBoundingClientRect();
    const virtualRect = virtual.getBoundingClientRect();
    samples.push({
      time: performance.now(),
      frame,
      phase,
      rowId,
      continuityId,
      statusTop: statusRect.top,
      statusBottom: statusRect.bottom,
      dockTop: dockRect.top,
      dockHeight: dockRect.height,
      turnHeight: turnRect.height,
      turnBottom: turnRect.bottom,
      virtualHeight: virtualRect.height,
      virtualBottom: virtualRect.bottom,
      scrollTop: viewport.scrollTop,
      scrollHeight: viewport.scrollHeight,
      clientHeight: viewport.clientHeight,
      bottomLocked: viewport.getAttribute("data-bottom-locked") === "true",
      userScrolling,
      resized,
    });
  };
  if (typeof ResizeObserver !== "undefined") {
    try {
      resizeObserver = new ResizeObserver((entries) => {
        const resized: StreamingStabilitySample["resized"] = [];
        for (const entry of entries) {
          if (entry.target === turn) resized.push("turn");
          if (entry.target === dock) resized.push("dock");
        }
        if (resized.length) record("resize-observer", resized);
      });
      resizeObserverStatus = "observing";
    } catch {
      resizeObserverStatus = "failed";
    }
  }
  const resolve = () => {
    const previousRow = row;
    const previousTurn = turn;
    const previousVirtual = virtual;
    const previousViewport = viewport;
    const previousDock = dock;
    if (!row?.isConnected || !row.hasAttribute("data-palot-active-turn-status")) {
      row = document.querySelector("[data-palot-active-turn-status]");
    }
    if (row !== previousRow || !turn?.isConnected) turn = row?.closest("[data-index]") ?? null;
    if (row !== previousRow || !virtual?.isConnected) {
      virtual = row?.closest("[data-palot-virtual-transcript]") ?? null;
    }
    if (row !== previousRow || !viewport?.isConnected) {
      viewport = row?.closest("[data-bottom-locked]") ?? null;
    }
    if (!dock?.isConnected) dock = document.querySelector("[data-palot-composer-dock]");
    const nextTurnIndex = turn?.getAttribute("data-index") ?? null;
    const changedTurnIndex = turnIndex !== nextTurnIndex;
    turnIndex = nextTurnIndex;
    if (row !== previousRow || turn !== previousTurn || changedTurnIndex) rowId += 1;
    if (
      row !== previousRow ||
      turn !== previousTurn ||
      changedTurnIndex ||
      virtual !== previousVirtual ||
      viewport !== previousViewport ||
      dock !== previousDock
    ) {
      continuityId += 1;
      if (resizeObserver) {
        resizeObserver.disconnect();
        try {
          // Do not observe the virtual ancestor: turn RO callbacks can grow it
          // within this broadcast, producing undelivered-notification warnings.
          for (const element of [turn, dock]) {
            if (element) resizeObserver.observe(element);
          }
        } catch {
          resizeObserver.disconnect();
          resizeObserverStatus = "failed";
          resizeObserver = undefined;
        }
      }
    }
  };
  const handleMutations = (records: MutationRecord[]) => {
    if (stopped) return;
    resolve();
    if (
      records.some(
        (entry) =>
          entry.type === "attributes" &&
          entry.target === virtual &&
          entry.attributeName === "style",
      )
    ) {
      // Once per batch, after the synchronous spacer-style/scroll callback has
      // finished. This is a layout checkpoint, still not evidence of a paint.
      record("virtual-layout");
    }
  };
  const mutations = new MutationObserver(handleMutations);
  mutations.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["data-palot-active-turn-status", "data-index", "style"],
  });
  resolve();
  record("start");
  const tick = () => {
    if (stopped) return;
    frame += 1;
    record("raf");
    frameHandle = requestAnimationFrame(tick);
  };
  frameHandle = requestAnimationFrame(tick);
  browser.__palotStreamingStabilityProbe = {
    setUserScrolling(active) {
      userScrolling = active;
      continuityId += 1;
    },
    stop() {
      if (stopped) return stopped;
      cancelAnimationFrame(frameHandle);
      const pendingMutations = mutations.takeRecords();
      if (pendingMutations.length) handleMutations(pendingMutations);
      // ResizeObserver has no takeRecords(). A final geometry read captures the
      // current layout without pretending to drain an undelivered RO callback.
      record("stop");
      mutations.disconnect();
      resizeObserver?.disconnect();
      stopped = {
        timeOrigin: performance.timeOrigin,
        startedAt,
        endedAt: performance.now(),
        maxSamples,
        droppedSamples,
        skippedSamples,
        resizeObserver: resizeObserverStatus,
        samples,
      };
      row = turn = virtual = viewport = dock = null;
      delete browser.__palotStreamingStabilityProbe;
      return stopped;
    },
  };
}

export async function startStreamingStabilityProbe(page: Page): Promise<void> {
  await page.evaluate(installStreamingStabilityProbe, {});
}

/** Deliberate fixture gestures are not automatic-bottom-follow failures. The
 * rendered data-bottom-locked attribute can lag its ref during the first event. */
export async function setStreamingStabilityUserScroll(page: Page, active: boolean): Promise<void> {
  await page.evaluate((value) => {
    const probe = (
      globalThis as typeof globalThis & {
        __palotStreamingStabilityProbe?: { setUserScrolling(active: boolean): void };
      }
    ).__palotStreamingStabilityProbe;
    if (!probe) throw new Error("Streaming stability probe was not started");
    probe.setUserScrolling(value);
  }, active);
}

export async function stopStreamingStabilityProbe(
  page: Page,
): Promise<StreamingStabilityCapture & { summary: StreamingStabilitySummary }> {
  const capture = await page.evaluate(() => {
    const browser = globalThis as typeof globalThis & {
      __palotStreamingStabilityProbe?: { stop(): StreamingStabilityCapture };
    };
    if (!browser.__palotStreamingStabilityProbe) {
      throw new Error("Streaming stability probe was not started");
    }
    return browser.__palotStreamingStabilityProbe.stop();
  });
  return { ...capture, summary: summarizeStreamingStability(capture) };
}
