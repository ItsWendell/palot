// @vitest-environment node
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { PERFORMANCE_BUILD_FLAGS } from "../test/e2e/performance-identity";
import {
  compareReports,
  parseCompareArguments,
  runCompareCli,
  summarizeRuns,
} from "./perf-compare";

function report(index: number, value = index) {
  return {
    interaction: {
      label: "input-under-streaming",
      capturedAt: new Date(1_000 * index).toISOString(),
      runIdentity: {
        schemaVersion: 1,
        scenario: "input-performance",
        source: { revision: index < 3 ? "before" : "after", dirty: false },
        host: {
          platform: "linux",
          release: "test",
          architecture: "x64",
          cpuModel: "test cpu",
          logicalCores: 8,
          totalMemoryBytes: 1_000,
        },
        runner: { node: "24", bun: "1.3" },
        declaredVersions: Object.fromEntries(
          [
            "react",
            "react-dom",
            "@opencode/client",
            "@opencode/protocol",
            "@playwright/test",
            "electron",
          ].map((name) => [name, "test"]),
        ),
        build: {
          mode: "production",
          flags: Object.fromEntries(PERFORMANCE_BUILD_FLAGS.map((flag) => [flag, "0"])),
        },
      },
      measurementWindow: { timeOrigin: 1_000 * index, startedAt: 10, endedAt: 100 },
      durationMs: value * 10,
      page: {
        visibilityState: "visible",
        documentHasFocus: false,
        devicePixelRatio: 1,
        viewport: { width: 1440, height: 920 },
      },
      collectors: {
        longTasks: "observing",
        inputTimings: "observing",
        longAnimationFrames: "disabled",
      },
      droppedEntries: { frames: 0, longTasks: 0, inputTimings: 0, longAnimationFrames: 0 },
      frames: { p95: value },
      inputTimings: {
        durationThresholdMs: 16,
        inputDelayMs: { p95: value },
        interactionDurationMs: { p95: value * 2 },
      },
      longTasks: { totalDurationMs: 0, count: 0 },
      browserMetrics: { delta: { TaskDuration: value / 1000 } },
      appMetrics: {
        before: {
          versions: { electron: "44", chromium: "test" },
          hardwareAcceleration: true,
          window: { focused: false, visible: true, minimized: false },
        },
        processCpu: { intervalMs: 500, byType: [{ type: "Tab", cpuCoreMs: value }] },
        intervalCpuPercent: value,
        workingSetKiB: { after: value, delta: 0 },
      },
      streamingLatency: {
        available: true,
        startCursor: 100,
        endCursor: 101,
        droppedSamples: 0,
        samples: [{ oldestPendingToCommitMs: value, totalToCommitMs: value + 1 }],
      },
    },
    streamingLatency: [{ oldestPendingToCommitMs: 99_999 }],
  };
}

describe("performance report comparison", () => {
  it("aggregates run-level p95s, converts CDP seconds, and only uses scoped freshness", () => {
    const result = compareReports([report(1, 2), report(2, 4)], [report(3, 10), report(4, 20)]);
    expect(result.comparable).toBe(true);
    expect(result.metrics.frameP95Ms).toEqual({
      baseline: { count: 2, missing: 0, median: 3, min: 2, max: 4 },
      candidate: { count: 2, missing: 0, median: 15, min: 10, max: 20 },
      medianDelta: 12,
      medianDeltaPercent: 400,
    });
    expect(result.metrics.TaskDurationMs?.baseline.median).toBe(3);
    expect(result.metrics["scopedStreaming.oldestPendingToCommitMs.p95"]?.baseline.median).toBe(3);
    expect(result.warnings.join(" ")).toContain("5 independent runs");
  });

  it("preserves nulls rather than inventing zeros or deltas for incomplete groups", () => {
    const missing = report(1);
    Object.assign(missing.interaction.frames, { p95: null });
    const result = compareReports([missing, report(2)], [report(3), report(4)]);
    expect(result.metrics.frameP95Ms?.baseline).toEqual({
      count: 1,
      missing: 1,
      median: 2,
      min: 2,
      max: 2,
    });
    expect(result.metrics.frameP95Ms?.medianDelta).toBeNull();
    expect(result.metrics["sessionSwitch.targetVisibleAtMs"]?.baseline.median).toBeNull();
    expect(summarizeRuns([null, null])).toEqual({
      count: 0,
      missing: 2,
      median: null,
      min: null,
      max: null,
    });
  });

  it("compares named streaming action milestones without pooling or accepting failed probes", () => {
    const withAction = (index: number, duration: number, failure: string | null = null) => ({
      ...report(index),
      workload: {
        settings: { actions: ["stop-alpha"] },
        actions: [
          {
            name: "stop-alpha",
            eventToUsefulDOMMs: duration,
            response: { failure, untrustedEvents: 0 },
          },
        ],
      },
    });
    const result = compareReports(
      [withAction(1, 10), withAction(2, 30)],
      [withAction(3, 12), withAction(4, 14)],
    );
    expect(result.metrics["streamingActions.stop-alpha.eventToUsefulDOMMs"]?.baseline.median).toBe(
      20,
    );
    expect(result.metrics["streamingActions.stop-alpha.eventToUsefulDOMMs"]?.candidate.median).toBe(
      13,
    );
    const incomplete = compareReports(
      [withAction(1, 10, "timeout"), withAction(2, 30)],
      [withAction(3, 12), withAction(4, 14)],
    );
    expect(
      incomplete.metrics["streamingActions.stop-alpha.eventToUsefulDOMMs"]?.medianDelta,
    ).toBeNull();
    expect(incomplete.metrics["streamingActions.wheel-up.eventToUsefulDOMMs"]?.baseline.count).toBe(
      0,
    );
    const duplicate = withAction(1, 10);
    duplicate.workload.actions.push(duplicate.workload.actions[0]!);
    expect(() =>
      compareReports([duplicate, withAction(2, 30)], [withAction(3, 12), withAction(4, 14)]),
    ).toThrow("Duplicate workload action");
  });

  it.each([
    [
      "viewport",
      (run: ReturnType<typeof report>) => {
        run.interaction.page.viewport.width = 100;
      },
    ],
    [
      "hardware",
      (run: ReturnType<typeof report>) => {
        run.interaction.runIdentity.host.cpuModel = "other";
      },
    ],
    [
      "scenario",
      (run: ReturnType<typeof report>) => {
        run.interaction.runIdentity.scenario = "other";
      },
    ],
    [
      "build",
      (run: ReturnType<typeof report>) => {
        run.interaction.runIdentity.build.flags.PALOT_REACT_PROFILING = "1";
      },
    ],
    [
      "collector",
      (run: ReturnType<typeof report>) => {
        run.interaction.collectors.inputTimings = "unsupported";
      },
    ],
    [
      "video capture",
      (run: ReturnType<typeof report>) => {
        run.interaction.runIdentity.build.flags.PALOT_E2E_VIDEO = "1";
      },
    ],
  ])("rejects mismatched %s", (_name, change) => {
    const candidate = report(3);
    change(candidate);
    expect(() => compareReports([report(1), report(2)], [candidate, report(4)])).toThrow(
      "incompatible",
    );
  });

  it("rejects missing metadata, failed collectors, invalid metrics and duplicate captures", () => {
    const missing = report(1);
    Object.assign(missing.interaction, { runIdentity: undefined });
    expect(() => compareReports([missing, report(2)], [report(3), report(4)])).toThrow("metadata");
    const failed = report(1);
    failed.interaction.collectors.longTasks = "failed";
    expect(() => compareReports([failed, report(2)], [report(3), report(4)])).toThrow("collector");
    const invalid = report(1);
    Object.assign(invalid.interaction.frames, { p95: "12" });
    expect(() => compareReports([invalid, report(2)], [report(3), report(4)])).toThrow(
      "finite number",
    );
    expect(() => compareReports([report(1), report(1)], [report(3), report(4)])).toThrow(
      "duplicate",
    );
  });

  it("rejects mixed revisions within a group and memory cycles", () => {
    expect(() => compareReports([report(1), report(3)], [report(4), report(5)])).toThrow(
      "mixed source",
    );
    expect(() => compareReports([{ cycles: [] }, report(2)], [report(3), report(4)])).toThrow(
      "memory-cycle",
    );
    expect(() => compareReports([null, report(2)], [report(3), report(4)])).toThrow("object");
    expect(() => compareReports([report(1)], [report(3), report(4)])).toThrow("2–100");
  });

  it("warns about dropped samples and dirty sources without pretending they are controlled", () => {
    const groups = [1, 2, 3, 4].map((index) => report(index));
    for (const run of groups) run.interaction.runIdentity.source.dirty = true;
    groups[0]!.interaction.streamingLatency.droppedSamples = 1;
    groups[0]!.interaction.droppedEntries.inputTimings = 1;
    const result = compareReports(groups.slice(0, 2), groups.slice(2));
    expect(result.warnings.join(" ")).toContain("Dirty worktree");
    expect(result.warnings.join(" ")).toContain("samples were dropped");
    expect(result.metrics.inputDelayP95Ms?.medianDelta).toBeNull();
    expect(result.metrics["scopedStreaming.oldestPendingToCommitMs.p95"]?.medianDelta).toBeNull();
  });

  it("rejects changed fixture cadence under the same scenario label", () => {
    const baseline = [report(1), report(2)].map((run) => ({
      ...run,
      workload: { settings: { chunkDelayMs: 30 } },
    }));
    const candidate = [report(3), report(4)].map((run) => ({
      ...run,
      workload: { settings: { chunkDelayMs: 60 } },
    }));
    expect(() => compareReports(baseline, candidate)).toThrow("incompatible workloadSettings");
  });

  it("separates batch callback percentiles from complete aggregates and rejects collector mismatches", () => {
    const withBatch = (index: number) => ({
      ...report(index),
      interaction: {
        ...report(index).interaction,
        batchProcessing: {
          available: true,
          status: "collected",
          scope: "useOpenCodeQueryEvents:sync-subscriber",
          capacity: 2048,
          observedBatches: 2,
          observedEvents: 20,
          droppedSamples: 0,
          totalDurationMs: 5,
          maxDurationMs: 3,
          samples: [
            { durationMs: 2, eventCount: 4, textDeltaCharacters: 400 },
            { durationMs: 3, eventCount: 16, textDeltaCharacters: 1600 },
          ],
        },
      },
    });
    const runs = [1, 2, 3, 4].map(withBatch);
    const comparison = () => compareReports(runs.slice(0, 2), runs.slice(2));
    expect(comparison().metrics["batchProcessing.durationP95Ms"]?.baseline.median).toBe(3);
    expect(comparison().metrics["batchProcessing.eventsPerBatchP95"]?.baseline.median).toBe(16);
    runs[0]!.interaction.batchProcessing.samples.pop();
    runs[0]!.interaction.batchProcessing.droppedSamples = 1;
    expect(comparison().metrics["batchProcessing.durationP95Ms"]?.medianDelta).toBeNull();
    expect(comparison().metrics["batchProcessing.totalDurationMs"]?.medianDelta).toBe(0);
    expect(comparison().warnings.join(" ")).toContain("batch-processing samples were dropped");
    runs[0]!.interaction.batchProcessing.samples[0]!.durationMs = -1;
    expect(comparison).toThrow("batch-processing sample");
    expect(() => compareReports([report(1), report(2)], [withBatch(3), withBatch(4)])).toThrow(
      "incompatible batchProcessing",
    );
  });
});

describe("comparison CLI", () => {
  it("loads files, reports large metric changes without failure, and rejects invalid JSON", () => {
    const directory = mkdtempSync(join(tmpdir(), "palot-perf-compare-"));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const files = [1, 2, 3, 4].map((index) => {
        const path = join(directory, `${index}.json`);
        writeFileSync(path, JSON.stringify(report(index, index < 3 ? 1 : 100)), { mode: 0o600 });
        return path;
      });
      const args = [...files.slice(0, 2), "--", ...files.slice(2)];
      expect(runCompareCli(args)).toBe(0);
      expect(JSON.parse(log.mock.calls[0]![0] as string).metrics.frameP95Ms.medianDelta).toBe(99);
      writeFileSync(files[0]!, '{"private-secret-invalid-json', { mode: 0o600 });
      expect(runCompareCli(args)).toBe(1);
      expect(log.mock.calls.at(-1)![0]).not.toContain("private-secret");
      expect(runCompareCli([files[1]!, files[1]!, "--", ...files.slice(2)])).toBe(1);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("parses help and explicit groups, rejecting ambiguous options", () => {
    expect(parseCompareArguments(["--help"])).toEqual({ help: true });
    expect(parseCompareArguments(["a", "b", "--", "c", "d"])).toEqual({
      baseline: ["a", "b"],
      candidate: ["c", "d"],
    });
    for (const args of [[], ["a", "--", "b"], ["a", "b", "--", "--", "c", "d"], ["--wat"]]) {
      expect(() => parseCompareArguments(args)).toThrow();
    }
  });

  it("prints JSON and returns nonzero for invalid input, and help succeeds", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(runCompareCli([])).toBe(1);
    expect(JSON.parse(log.mock.calls[0]![0] as string).comparable).toBe(false);
    expect(runCompareCli(["--help"])).toBe(0);
  });
});
