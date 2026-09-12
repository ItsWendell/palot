import { afterEach, describe, expect, it, vi } from "vitest";
import { createBrowserDiagnosticsProbe } from "./browser-diagnostics-probe";

class TestPerformanceObserver {
  static readonly supportedEntryTypes = ["longtask"];
  static instance: TestPerformanceObserver | null = null;

  readonly records: PerformanceEntry[] = [];
  readonly takeRecords = vi.fn(() => this.records.splice(0));
  readonly disconnect = vi.fn();

  constructor(_callback: PerformanceObserverCallback) {
    TestPerformanceObserver.instance = this;
  }

  observe(): void {}
}

describe("browser diagnostics probe", () => {
  afterEach(() => {
    TestPerformanceObserver.instance = null;
    vi.unstubAllGlobals();
  });

  it("drains queued long tasks before resetting a sample", () => {
    vi.stubGlobal("PerformanceObserver", TestPerformanceObserver);
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn(() => 1),
    );
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const probe = createBrowserDiagnosticsProbe();
    const observer = TestPerformanceObserver.instance;
    if (!observer) throw new Error("Performance observer was not created");
    observer.records.push({ startTime: 12, duration: 55 } as PerformanceEntry);

    expect(probe.readAndReset().longTasks).toEqual([{ startTime: 12, duration: 55 }]);
    expect(observer.takeRecords).toHaveBeenCalledTimes(1);
    probe.stop();
  });
});
