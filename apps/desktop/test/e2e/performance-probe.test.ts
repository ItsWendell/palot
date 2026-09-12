import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { installBrowserPerformanceProbe, type BrowserProbeResult } from "./performance-probe";

const observers = new Map<string, Observer>();
let failedType: string | null = null;
let now = 100;
let frame: FrameRequestCallback;
class Observer {
  static supportedEntryTypes = ["longtask", "event", "long-animation-frame"];
  records: PerformanceEntry[] = [];
  disconnected = false;
  options?: PerformanceObserverInit;
  constructor(readonly callback: (list: { getEntries(): PerformanceEntry[] }) => void) {}
  observe(options: PerformanceObserverInit) {
    this.options = options;
    if (options.type === failedType) throw new Error("Observer rejected");
    observers.set(options.type!, this);
  }
  takeRecords() {
    const records = this.records;
    this.records = [];
    return records;
  }
  disconnect() {
    this.disconnected = true;
  }
}

const browser = globalThis as typeof globalThis & {
  __palotPerformanceProbe?: { stop(): BrowserProbeResult };
};
function stop() {
  return browser.__palotPerformanceProbe!.stop();
}
function entry(value: object): PerformanceEntry {
  return value as PerformanceEntry;
}

beforeEach(() => {
  observers.clear();
  Observer.supportedEntryTypes = ["longtask", "event", "long-animation-frame"];
  failedType = null;
  now = 100;
  vi.stubGlobal("PerformanceObserver", Observer);
  vi.stubGlobal("performance", {
    now: () => now,
    timeOrigin: 1_000,
    mark: vi.fn(),
    clearMarks: vi.fn(),
  });
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn((callback: FrameRequestCallback) => {
      frame = callback;
      return 1;
    }),
  );
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
});
afterEach(() => {
  browser.__palotPerformanceProbe?.stop();
  delete browser.__palotPerformanceProbe;
  vi.unstubAllGlobals();
});

it("drains pending entries, scopes the window, and stops all collectors exactly once", () => {
  installBrowserPerformanceProbe({ label: "typing", captureLongAnimationFrames: true });
  const tasks = observers.get("longtask")!;
  tasks.callback({
    getEntries: () => [
      entry({ startTime: 90, duration: 70 }),
      entry({ startTime: 110, duration: 60 }),
    ],
  });
  tasks.records.push(entry({ startTime: 200, duration: 80 }));
  frame(116);
  frame(132);
  now = 300;
  const result = stop();
  expect(result).toMatchObject({
    timeOrigin: 1_000,
    startedAt: 100,
    endedAt: 300,
    durationMs: 200,
    frameIntervalsMs: [16],
  });
  expect(result.longTasks).toEqual([
    { startTime: 110, duration: 60 },
    { startTime: 200, duration: 80 },
  ]);
  expect([...observers.values()].every((observer) => observer.disconnected)).toBe(true);
  expect(stop()).toBe(result);
  expect(performance.mark).toHaveBeenCalledWith("palot:measurement:end", {
    detail: { label: "typing" },
  });
});

it("reports unsupported, failed, and disabled instrumentation separately from zero entries", () => {
  Observer.supportedEntryTypes = ["longtask"];
  failedType = "longtask";
  installBrowserPerformanceProbe({ label: "switch", captureLongAnimationFrames: false });
  expect(stop().collectors).toEqual({
    longTasks: "failed",
    inputTimings: "unsupported",
    longAnimationFrames: "disabled",
  });
});

it("records input stages without targets or non-interaction events, accounting for quantization", () => {
  installBrowserPerformanceProbe({ label: "typing", captureLongAnimationFrames: false });
  const events = observers.get("event")!;
  expect(events.options).toMatchObject({ type: "event", durationThreshold: 16 });
  events.records.push(
    entry({ name: "pointermove", startTime: 110, interactionId: 0, duration: 32 }),
    entry({
      name: "keydown",
      startTime: 120,
      interactionId: 7,
      duration: 32,
      processingStart: 130,
      processingEnd: 140,
      target: "private target",
    }),
    entry({
      name: "keyup",
      startTime: 150,
      interactionId: 7,
      duration: 16,
      processingStart: 160,
      processingEnd: 168,
    }),
  );
  expect(stop().inputTimings).toEqual([
    {
      name: "keydown",
      startTime: 120,
      interactionID: 7,
      duration: 32,
      inputDelayMs: 10,
      processingDurationMs: 10,
      presentationDelayMs: 12,
    },
    {
      name: "keyup",
      startTime: 150,
      interactionID: 7,
      duration: 16,
      inputDelayMs: 10,
      processingDurationMs: 8,
      presentationDelayMs: 0,
    },
  ]);
});

it("bounds capture and retains the five most expensive LoAF scripts for attribution", () => {
  installBrowserPerformanceProbe({
    label: "burst",
    captureLongAnimationFrames: true,
    maxEntries: 1,
  });
  observers
    .get("longtask")!
    .records.push(entry({ startTime: 110, duration: 60 }), entry({ startTime: 180, duration: 55 }));
  const scripts = Array.from({ length: 8 }, (_, index) => ({
    duration: index + 1,
    forcedStyleAndLayoutDuration: index,
    invoker: "callback",
    sourceURL: "app.js",
    sourceFunctionName: `script${index}`,
  }));
  observers.get("long-animation-frame")!.records.push(
    entry({
      startTime: 110,
      duration: 100,
      blockingDuration: 50,
      renderStart: 170,
      styleAndLayoutStart: 180,
      scripts,
    }),
  );
  const result = stop();
  expect(result.longTasks).toHaveLength(1);
  expect(result.droppedEntries.longTasks).toBe(1);
  expect(result.longAnimationFrames[0]?.scripts.map((script) => script.duration)).toEqual([
    8, 7, 6, 5, 4,
  ]);
});

it("starting another measurement releases the previous probe", () => {
  installBrowserPerformanceProbe({ label: "first", captureLongAnimationFrames: true });
  const firstObservers = [...observers.values()];
  now = 200;
  installBrowserPerformanceProbe({ label: "second", captureLongAnimationFrames: false });
  expect(firstObservers.every((observer) => observer.disconnected)).toBe(true);
  expect(stop().startedAt).toBe(200);
});
