import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { updateDiagnosticsPreferences } from "./diagnostics-preferences";
import { initializeOptionalReactScan } from "./diagnostics-bootstrap";

describe("diagnostics bootstrap", () => {
  afterEach(() => vi.unstubAllGlobals());

  beforeEach(() => {
    window.localStorage.clear();
    delete window.palotReactScan;
  });

  it("does not import React Scan while it is disabled", async () => {
    const load = vi.fn();

    await expect(initializeOptionalReactScan({ load, defaultEnabled: false })).resolves.toEqual({
      reactScanRequested: false,
      reactScanActive: false,
      reactScanStatus: "off",
    });
    expect(load).not.toHaveBeenCalled();
  });

  it("starts React Scan before app bootstrap when requested", async () => {
    updateDiagnosticsPreferences({ reactScanEnabled: true });
    const scan = vi.fn();
    const instrument = vi.fn();
    let emitPerformanceEntries: ((entries: PerformanceEntry[]) => void) | undefined;
    class TestPerformanceObserver {
      static supportedEntryTypes = ["long-animation-frame"];
      constructor(callback: PerformanceObserverCallback) {
        emitPerformanceEntries = (entries) =>
          callback({ getEntries: () => entries } as PerformanceObserverEntryList, this as never);
      }
      observe() {}
    }
    vi.stubGlobal("PerformanceObserver", TestPerformanceObserver);

    await expect(
      initializeOptionalReactScan({
        load: async () => ({ scan }),
        loadLite: async () => ({ instrument }),
        defaultEnabled: false,
      }),
    ).resolves.toEqual({
      reactScanRequested: true,
      reactScanActive: true,
      reactScanStatus: "active",
    });
    expect(scan).toHaveBeenCalledWith(
      expect.objectContaining({
        enabled: true,
        showToolbar: false,
        showFPS: false,
        dangerouslyForceRunInProduction: true,
      }),
    );
    expect(instrument).toHaveBeenCalledWith(
      expect.objectContaining({
        includeFiberTree: true,
        includeProfilingHooks: true,
        recordChangeDescriptions: true,
        maxFibersPerCommit: 3_000,
        minFiberActualDurationMs: 0.01,
      }),
    );

    const options = scan.mock.calls[0]?.[0] as
      | {
          onRender(
            fiber: unknown,
            renders: Array<{
              phase: number;
              componentName: string | null;
              count: number;
              time: number | null;
              unnecessary: boolean | null;
              changes: Array<{ type: number; name: string; count?: number }>;
              fps: number;
            }>,
          ): void;
          onCommitFinish(): void;
        }
      | undefined;
    if (!options) throw new Error("React Scan options were not captured");
    const liteOptions = instrument.mock.calls[0]?.[0] as
      | {
          onEvent(event: {
            kind: string;
            timestamp: number;
            priorityName?: string;
            available?: boolean;
            reason?: string;
            tree?: Array<{
              name: string;
              actualDuration: number;
              changeDescription?: {
                isFirstMount: boolean;
                props: string[] | null;
                state: boolean;
                context: boolean;
                hooks: number[];
                parent: boolean;
              } | null;
            }>;
          }): void;
        }
      | undefined;
    if (!liteOptions) throw new Error("React Scan Lite options were not captured");
    liteOptions.onEvent({
      kind: "profiling-hooks-status",
      timestamp: 0,
      available: true,
    });
    liteOptions.onEvent({
      kind: "commit",
      timestamp: 10,
      priorityName: "Normal",
      tree: [
        {
          name: "Transcript",
          actualDuration: 3.5,
          changeDescription: {
            isFirstMount: false,
            props: ["messages"],
            state: false,
            context: false,
            hooks: [0],
            parent: true,
          },
        },
      ],
    });
    options.onRender(null, [
      {
        phase: 2,
        componentName: "Transcript",
        count: 1,
        time: 3.5,
        unnecessary: false,
        changes: [],
        fps: 58,
      },
      {
        phase: 2,
        componentName: "Composer",
        count: 1,
        time: null,
        unnecessary: true,
        changes: [],
        fps: 57,
      },
    ]);
    options.onCommitFinish();
    emitPerformanceEntries?.([
      {
        name: "long-animation-frame",
        entryType: "long-animation-frame",
        startTime: 5,
        duration: 60,
        blockingDuration: 12,
        renderStart: 30,
        styleAndLayoutStart: 40,
        toJSON: () => ({}),
      } as PerformanceEntry & {
        blockingDuration: number;
        renderStart: number;
        styleAndLayoutStart: number;
      },
    ]);
    expect(window.palotReactScan?.readAndReset()).toEqual({
      renderCount: 2,
      commitCount: 1,
      totalRenderTimeMs: 3.5,
      slowestRenderMs: 3.5,
      fps: 57,
      liteProfilingHooks: { available: true, reason: null },
      longAnimationFrames: [
        {
          startTime: 5,
          durationMs: 60,
          blockingDurationMs: 12,
          renderStart: 30,
          styleAndLayoutStart: 40,
          commitCount: 1,
          priorities: ["Normal"],
          components: [
            {
              name: "Transcript",
              fiberRenderCount: 1,
              totalActualDurationMs: 3.5,
              slowestActualDurationMs: 3.5,
            },
          ],
        },
      ],
      components: [
        {
          name: "Transcript",
          renderCount: 1,
          mountCount: 0,
          updateCount: 1,
          unnecessaryRenderCount: 0,
          parentRenderCount: 1,
          totalRenderTimeMs: 3.5,
          slowestRenderMs: 3.5,
          changedProps: { messages: 1 },
          changedState: { "hook 0": 1 },
          changedContext: {},
        },
        {
          name: "Composer",
          renderCount: 1,
          mountCount: 0,
          updateCount: 1,
          unnecessaryRenderCount: 1,
          parentRenderCount: 0,
          totalRenderTimeMs: 0,
          slowestRenderMs: null,
          changedProps: {},
          changedState: {},
          changedContext: {},
        },
      ],
    });
    expect(window.palotReactScan?.readAndReset()).toEqual({
      renderCount: 0,
      commitCount: 0,
      totalRenderTimeMs: 0,
      slowestRenderMs: null,
      fps: null,
      liteProfilingHooks: { available: true, reason: null },
      longAnimationFrames: [],
      components: [],
    });
  });

  it("keeps Palot bootable when the optional chunk fails", async () => {
    updateDiagnosticsPreferences({ reactScanEnabled: true });

    await expect(
      initializeOptionalReactScan({
        load: async () => {
          throw new Error("chunk unavailable");
        },
        loadLite: async () => ({ instrument: vi.fn() }),
      }),
    ).resolves.toEqual({
      reactScanRequested: true,
      reactScanActive: false,
      reactScanStatus: "failed",
    });
  });
});
