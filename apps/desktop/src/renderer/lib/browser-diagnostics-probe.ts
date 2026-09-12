export interface BrowserDiagnosticsAvailability {
  animationFrames: boolean;
  longTasks: boolean;
  rendererHeap: boolean;
}

export interface BrowserDiagnosticsRead {
  intervalMs: number;
  frameIntervalsMs: number[];
  longTasks: Array<{ startTime: number; duration: number }>;
  heap: {
    usedBytes: number;
    totalBytes: number;
    limitBytes: number;
  } | null;
}

export interface BrowserDiagnosticsProbe {
  readAndReset(): BrowserDiagnosticsRead;
  stop(): void;
}

export function browserDiagnosticsAvailability(): BrowserDiagnosticsAvailability {
  const supportedEntries =
    typeof PerformanceObserver === "undefined"
      ? []
      : (PerformanceObserver.supportedEntryTypes ?? []);
  return {
    animationFrames: typeof requestAnimationFrame === "function",
    longTasks: supportedEntries.includes("longtask"),
    rendererHeap: rendererHeap() !== null,
  };
}

export function createBrowserDiagnosticsProbe(): BrowserDiagnosticsProbe {
  const availability = browserDiagnosticsAvailability();
  let startedAt = performance.now();
  let frameIntervalsMs: number[] = [];
  let longTasks: Array<{ startTime: number; duration: number }> = [];
  let previousFrame: number | null = null;
  let frameHandle: number | null = null;
  let stopped = false;
  let observer: PerformanceObserver | null = null;

  const frame = (timestamp: number) => {
    if (previousFrame !== null) frameIntervalsMs.push(timestamp - previousFrame);
    previousFrame = timestamp;
    if (!stopped && document.visibilityState === "visible") {
      frameHandle = requestAnimationFrame(frame);
    }
  };
  const startFrames = () => {
    if (!availability.animationFrames || stopped || document.visibilityState !== "visible") return;
    previousFrame = null;
    frameHandle = requestAnimationFrame(frame);
  };
  const visibilityChanged = () => {
    if (document.visibilityState === "visible") {
      startFrames();
      return;
    }
    if (frameHandle !== null) cancelAnimationFrame(frameHandle);
    frameHandle = null;
    previousFrame = null;
  };

  if (availability.longTasks) {
    observer = new PerformanceObserver((list) => {
      recordLongTasks(list.getEntries());
    });
    observer.observe({ type: "longtask" });
  }
  document.addEventListener("visibilitychange", visibilityChanged);
  startFrames();

  return {
    readAndReset() {
      drainLongTasks();
      const capturedAt = performance.now();
      const read: BrowserDiagnosticsRead = {
        intervalMs: Math.max(0, capturedAt - startedAt),
        frameIntervalsMs,
        longTasks,
        heap: rendererHeap(),
      };
      startedAt = capturedAt;
      frameIntervalsMs = [];
      longTasks = [];
      return read;
    },
    stop() {
      if (stopped) return;
      stopped = true;
      drainLongTasks();
      observer?.disconnect();
      document.removeEventListener("visibilitychange", visibilityChanged);
      if (frameHandle !== null) cancelAnimationFrame(frameHandle);
      frameHandle = null;
    },
  };

  function recordLongTasks(entries: Iterable<PerformanceEntry>): void {
    for (const entry of entries) {
      longTasks.push({ startTime: entry.startTime, duration: entry.duration });
    }
  }

  function drainLongTasks(): void {
    if (observer) recordLongTasks(observer.takeRecords());
  }
}

function rendererHeap(): BrowserDiagnosticsRead["heap"] {
  const memory = (
    performance as Performance & {
      memory?: {
        usedJSHeapSize: number;
        totalJSHeapSize: number;
        jsHeapSizeLimit: number;
      };
    }
  ).memory;
  if (!memory) return null;
  return {
    usedBytes: memory.usedJSHeapSize,
    totalBytes: memory.totalJSHeapSize,
    limitBytes: memory.jsHeapSizeLimit,
  };
}
