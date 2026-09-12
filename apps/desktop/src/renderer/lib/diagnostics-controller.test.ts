import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenCodeRuntimeStatus, PalotPerformanceSnapshot } from "../../shared";
import type { BrowserDiagnosticsProbe } from "./browser-diagnostics-probe";
import { createDiagnosticsController } from "./diagnostics-controller";

function appSnapshot(index: number): PalotPerformanceSnapshot {
  return {
    capturedAt: Date.now(),
    versions: {
      platform: "darwin",
      architecture: "arm64",
      electron: "43.4.1",
      chromium: "150.0.0.0",
      node: "24.0.0",
    },
    hardwareAcceleration: true,
    gpuFeatureStatus: {
      gpu_compositing: "enabled",
      webgl: "enabled",
      private_debug_value: "secret-gpu-detail",
    },
    window: { focused: false, visible: true, minimized: false },
    openCodeTransport: {
      receivedEvents: 0,
      bufferedEvents: 0,
      immediateEvents: 0,
      flushes: 0,
      timedFlushes: 0,
      immediateFlushes: 0,
      capacityFlushes: 0,
      contextFlushes: 0,
      manualFlushes: 0,
      sentEvents: 0,
      totalQueueDurationMs: 0,
    },
    processes: [
      {
        pid: 100 + index,
        type: "Tab",
        name: "/Users/private/task-secret",
        serviceName: "https://secret.example.com?token=value",
        creationTime: 1,
        sandboxed: true,
        cpu: {
          percentCPUUsage: index === 1 ? 0 : 12.5,
          cumulativeCPUUsage: null,
          idleWakeupsPerSecond: 0,
        },
        memory: {
          workingSetSize: 120_000 + index,
          peakWorkingSetSize: 140_000,
          privateBytes: null,
        },
      },
    ],
  };
}

function browserProbe(): BrowserDiagnosticsProbe {
  return {
    readAndReset: vi.fn(() => ({
      intervalMs: 1_000,
      frameIntervalsMs: [16, 17, 34],
      longTasks: [{ startTime: 10, duration: 58 }],
      heap: { usedBytes: 64 * 1_048_576, totalBytes: 80 * 1_048_576, limitBytes: 2e9 },
    })),
    stop: vi.fn(),
  };
}

describe("diagnostics controller", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    window.localStorage.clear();
    window.palotDiagnosticsBoot = {
      reactScanRequested: false,
      reactScanActive: false,
      reactScanStatus: "off",
    };
    delete window.palotReactScan;
  });

  afterEach(() => vi.useRealTimers());

  it("shares one sampling loop across consumers and stops after the final lease", async () => {
    const capture = vi
      .fn()
      .mockResolvedValueOnce(appSnapshot(1))
      .mockResolvedValueOnce(appSnapshot(2));
    const probe = browserProbe();
    window.palotReactScan = {
      readAndReset: vi
        .fn()
        .mockReturnValueOnce({
          renderCount: 0,
          commitCount: 0,
          totalRenderTimeMs: 0,
          slowestRenderMs: null,
          fps: null,
          components: [],
        })
        .mockReturnValue({
          renderCount: 7,
          commitCount: 2,
          totalRenderTimeMs: 11.5,
          slowestRenderMs: 4.25,
          fps: 58,
          components: [],
        }),
    };
    const controller = createDiagnosticsController({
      captureAppSnapshot: capture,
      createBrowserProbe: () => probe,
    });

    expect(capture).not.toHaveBeenCalled();
    const releaseOverlay = controller.acquire("overlay");
    await vi.advanceTimersByTimeAsync(0);
    expect(capture).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot().current.renderer?.frames.fps).toBe(44.776);
    expect(controller.getSnapshot().current.renderer?.reactScan).toEqual({
      renderCount: 7,
      commitCount: 2,
      totalRenderTimeMs: 11.5,
      slowestRenderMs: 4.25,
      fps: 58,
      components: [],
    });
    const releaseDashboard = controller.acquire("dashboard");
    expect(capture).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(capture).toHaveBeenCalledTimes(2);
    expect(controller.getSnapshot().current.cpuReady).toBe(true);
    expect(controller.getSnapshot().current.cpuPercent).toBe(12.5);

    releaseOverlay();
    await vi.advanceTimersByTimeAsync(0);
    expect(controller.getSnapshot().phase).not.toBe("idle");
    releaseDashboard();
    await vi.advanceTimersByTimeAsync(0);
    expect(controller.getSnapshot().phase).toBe("idle");
    expect(probe.stop).toHaveBeenCalledTimes(1);
    controller.dispose();
  });

  it("copies an allowlisted report without process names, paths, URLs, or PIDs", async () => {
    const copied: string[] = [];
    const controller = createDiagnosticsController({
      captureAppSnapshot: async () => appSnapshot(1),
      createBrowserProbe: browserProbe,
      copyText: async (text) => {
        copied.push(text);
      },
    });

    const runtime: OpenCodeRuntimeStatus = {
      connectionID: "private-connection",
      profileID: "private-profile",
      contractVersion: "private-contract",
      connected: true,
      phase: "connected",
      version: "https://secret.example.com?token=value",
      managed: true,
      binaryPath: "/Users/private/opencode2",
      pid: 42,
      lastConnectedAt: 1,
      error: "credential=secret",
      versionMismatch: null,
    };
    const report = await controller.copySafeReport(runtime);
    const serialized = copied[0] ?? "";

    expect(report.processGroups).toEqual([
      expect.objectContaining({ type: "Tab", count: 1, workingSetKiB: 120_001 }),
    ]);
    expect(serialized).not.toContain("task-secret");
    expect(serialized).not.toContain("secret.example.com");
    expect(serialized).not.toContain("secret-gpu-detail");
    expect(serialized).not.toContain("private-connection");
    expect(serialized).not.toContain("private-profile");
    expect(serialized).not.toContain("private-contract");
    expect(serialized).not.toContain("opencode2");
    expect(serialized).not.toContain("credential=secret");
    expect(serialized).not.toContain('"pid"');
    expect(serialized).toContain('"gpu_compositing": "enabled"');
    expect(report.runtime).toEqual({
      connected: true,
      phase: "connected",
      version: null,
      managed: true,
    });
    controller.dispose();
  });

  it("enforces the safe report limit using serialized UTF-8 bytes", async () => {
    const snapshot = appSnapshot(1);
    snapshot.gpuFeatureStatus.gpu_compositing = "lock".repeat(20_000);
    const copyText = vi.fn(async () => undefined);
    const controller = createDiagnosticsController({
      captureAppSnapshot: async () => snapshot,
      createBrowserProbe: browserProbe,
      copyText,
    });

    await expect(controller.copySafeReport()).rejects.toThrow(
      "The diagnostics report exceeded 64 KiB",
    );
    expect(copyText).not.toHaveBeenCalled();
    controller.dispose();
  });
});
