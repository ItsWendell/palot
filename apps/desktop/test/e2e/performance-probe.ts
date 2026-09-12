export interface BrowserLongTask {
  startTime: number;
  duration: number;
}

export interface BrowserInputTiming extends BrowserLongTask {
  name: string;
  interactionID: number;
  inputDelayMs: number;
  processingDurationMs: number;
  presentationDelayMs: number;
}

export interface BrowserLongAnimationFrame extends BrowserLongTask {
  blockingDuration: number;
  renderStart: number;
  styleAndLayoutStart: number;
  scripts: Array<{
    duration: number;
    forcedStyleAndLayoutDuration: number;
    invoker: string;
    sourceURL: string;
    sourceFunctionName: string;
  }>;
}

export type ProbeCollectorStatus = "observing" | "unsupported" | "failed" | "disabled";

export interface BrowserProbeResult {
  timeOrigin: number;
  startedAt: number;
  endedAt: number;
  durationMs: number;
  frameIntervalsMs: number[];
  longTasks: BrowserLongTask[];
  inputTimings: BrowserInputTiming[];
  longAnimationFrames: BrowserLongAnimationFrame[];
  collectors: Record<"longTasks" | "inputTimings" | "longAnimationFrames", ProbeCollectorStatus>;
  droppedEntries: Record<"frames" | "longTasks" | "inputTimings" | "longAnimationFrames", number>;
  eventDurationThresholdMs: number;
}

/** Self-contained: Playwright serializes this function into the native renderer. */
export function installBrowserPerformanceProbe(options: {
  label: string;
  captureLongAnimationFrames: boolean;
  maxEntries?: number;
}): void {
  const browser = globalThis as typeof globalThis & {
    __palotPerformanceProbe?: { stop(): BrowserProbeResult };
  };
  browser.__palotPerformanceProbe?.stop();
  const startedAt = performance.now();
  const maxEntries = options.maxEntries ?? 36_000;
  const eventDurationThresholdMs = 16;
  const frameIntervalsMs: number[] = [];
  const longTasks: BrowserLongTask[] = [];
  const inputTimings: BrowserInputTiming[] = [];
  const longAnimationFrames: BrowserLongAnimationFrame[] = [];
  const collectors: BrowserProbeResult["collectors"] = {
    longTasks: "unsupported",
    inputTimings: "unsupported",
    longAnimationFrames: options.captureLongAnimationFrames ? "unsupported" : "disabled",
  };
  const droppedEntries: BrowserProbeResult["droppedEntries"] = {
    frames: 0,
    longTasks: 0,
    inputTimings: 0,
    longAnimationFrames: 0,
  };
  const observers: Array<{
    observer: PerformanceObserver;
    record(entries: PerformanceEntry[]): void;
  }> = [];
  let previousFrame: number | null = null;
  let frameHandle = 0;
  let stopped: BrowserProbeResult | null = null;
  const retain = <T>(key: keyof typeof droppedEntries, entries: T[], entry: T) => {
    if (entries.length < maxEntries) entries.push(entry);
    else droppedEntries[key] += 1;
  };
  const observe = (
    key: keyof typeof collectors,
    type: string,
    record: (entries: PerformanceEntry[]) => void,
  ) => {
    if (
      typeof PerformanceObserver === "undefined" ||
      !PerformanceObserver.supportedEntryTypes?.includes(type)
    )
      return;
    let observer: PerformanceObserver | undefined;
    try {
      observer = new PerformanceObserver((list) => record(list.getEntries()));
      observer.observe({
        type,
        ...(type === "event" ? { durationThreshold: eventDurationThresholdMs } : {}),
      });
      observers.push({ observer, record });
      collectors[key] = "observing";
    } catch {
      observer?.disconnect();
      collectors[key] = "failed";
    }
  };
  observe("longTasks", "longtask", (entries) => {
    for (const entry of entries) {
      if (entry.startTime < startedAt) continue;
      retain("longTasks", longTasks, { startTime: entry.startTime, duration: entry.duration });
    }
  });
  observe("inputTimings", "event", (entries) => {
    for (const entry of entries) {
      const value = entry as PerformanceEventTiming;
      if (entry.startTime < startedAt || !value.interactionId) continue;
      retain("inputTimings", inputTimings, {
        name: value.name,
        interactionID: value.interactionId,
        startTime: value.startTime,
        duration: value.duration,
        inputDelayMs: Math.max(0, value.processingStart - value.startTime),
        processingDurationMs: Math.max(0, value.processingEnd - value.processingStart),
        // Event durations are quantized; this is an estimate, not a paint timestamp.
        presentationDelayMs: Math.max(0, value.startTime + value.duration - value.processingEnd),
      });
    }
  });
  if (options.captureLongAnimationFrames) {
    observe("longAnimationFrames", "long-animation-frame", (entries) => {
      for (const entry of entries) {
        if (entry.startTime < startedAt) continue;
        const value = entry as PerformanceEntry &
          Omit<BrowserLongAnimationFrame, "startTime" | "duration">;
        retain("longAnimationFrames", longAnimationFrames, {
          startTime: entry.startTime,
          duration: entry.duration,
          blockingDuration: value.blockingDuration,
          renderStart: value.renderStart,
          styleAndLayoutStart: value.styleAndLayoutStart,
          scripts: Array.from(value.scripts ?? [])
            .toSorted((left, right) => right.duration - left.duration)
            .slice(0, 5)
            .map((script) => ({
              duration: script.duration,
              forcedStyleAndLayoutDuration: script.forcedStyleAndLayoutDuration,
              invoker: script.invoker,
              sourceURL: script.sourceURL,
              sourceFunctionName: script.sourceFunctionName,
            })),
        });
      }
    });
  }
  performance.clearMarks("palot:measurement:start");
  performance.clearMarks("palot:measurement:end");
  performance.mark("palot:measurement:start", { detail: { label: options.label } });
  const frame = (timestamp: number) => {
    if (stopped) return;
    if (previousFrame !== null) retain("frames", frameIntervalsMs, timestamp - previousFrame);
    previousFrame = timestamp;
    frameHandle = requestAnimationFrame(frame);
  };
  frameHandle = requestAnimationFrame(frame);
  browser.__palotPerformanceProbe = {
    stop() {
      if (stopped) return stopped;
      cancelAnimationFrame(frameHandle);
      for (const { observer, record } of observers) {
        record(observer.takeRecords());
        observer.disconnect();
      }
      const endedAt = performance.now();
      performance.mark("palot:measurement:end", { detail: { label: options.label } });
      stopped = {
        timeOrigin: performance.timeOrigin,
        startedAt,
        endedAt,
        durationMs: endedAt - startedAt,
        frameIntervalsMs,
        longTasks,
        inputTimings,
        longAnimationFrames,
        collectors,
        droppedEntries,
        eventDurationThresholdMs,
      };
      return stopped;
    },
  };
}
