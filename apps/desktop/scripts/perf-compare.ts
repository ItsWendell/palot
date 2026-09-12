import { readFileSync, realpathSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PERFORMANCE_BUILD_FLAGS } from "../test/e2e/performance-identity.ts";

const HELP = `Compare repeated, independent Palot performance reports (JSON output).

Usage:
  bun apps/desktop/scripts/perf-compare.ts <baseline.json...> -- <candidate.json...>
  bun apps/desktop/scripts/perf-compare.ts --help

At least 2 files per group; 5 or more recommended. Each file must contain one
interaction with runIdentity and scoped probe metadata. Memory-cycle arrays and
legacy reports without identity are not supported. No benchmarks are launched.
Comparable hardware, runtime, build, scenario, viewport and collector status are
required. Source revision may differ between groups, not within a group.
Outputs run-level median/min/max, not pooled events, confidence estimates, INP,
budgets or a regression verdict. Exit 1 means invalid/incomparable input, not a
metric regression. Keep host power state/load and display conditions controlled.
Limits: 100 files per group, 32 MiB per file, 256 MiB total. No output files are written.`;

type Row = Record<string, unknown>;
type MetricValues = Record<string, number | null>;
export interface RunSummary {
  count: number;
  missing: number;
  median: number | null;
  min: number | null;
  max: number | null;
}

function object(value: unknown, label: string): Row {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Row;
}

function at(value: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((current, key) => {
    if (!current || typeof current !== "object" || Array.isArray(current)) return undefined;
    return (current as Row)[key];
  }, value);
}

function numberOrNull(value: unknown, label: string): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number or null`);
  }
  return value;
}

/** Each input number is already one run's metric (including that run's p95). */
export function summarizeRuns(values: Array<number | null>): RunSummary {
  const sorted = values.filter((value): value is number => value !== null).sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return {
    count: sorted.length,
    missing: values.length - sorted.length,
    median: sorted.length
      ? (sorted[middle]! + sorted[Math.floor((sorted.length - 1) / 2)]!) / 2
      : null,
    min: sorted[0] ?? null,
    max: sorted.at(-1) ?? null,
  };
}

function percentile95(values: number[]): number | null {
  return values.toSorted((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1] ?? null;
}

const METRICS = {
  durationMs: "durationMs",
  frameP95Ms: "frames.p95",
  inputDelayP95Ms: "inputTimings.inputDelayMs.p95",
  eventInteractionDurationP95Ms: "inputTimings.interactionDurationMs.p95",
  longTaskTotalMs: "longTasks.totalDurationMs",
  longTaskCount: "longTasks.count",
  intervalCpuPercent: "appMetrics.intervalCpuPercent",
  workingSetAfterKiB: "appMetrics.workingSetKiB.after",
  workingSetDeltaKiB: "appMetrics.workingSetKiB.delta",
} as const;

function extractMetrics(report: Row, interaction: Row): MetricValues {
  const metrics: MetricValues = Object.fromEntries(
    Object.entries(METRICS).map(([name, path]) => [
      name,
      numberOrNull(at(interaction, path), path),
    ]),
  );
  for (const name of ["TaskDuration", "ScriptDuration", "LayoutDuration", "RecalcStyleDuration"]) {
    const seconds = numberOrNull(at(interaction, `browserMetrics.delta.${name}`), name);
    metrics[`${name}Ms`] = seconds === null ? null : seconds * 1_000;
  }
  const cpu = at(interaction, "appMetrics.processCpu.byType");
  metrics.cpuCoreMs = Array.isArray(cpu)
    ? cpu.reduce<number>((total, row) => {
        const value = numberOrNull(at(row, "cpuCoreMs"), "cpuCoreMs");
        if (value === null) throw new Error("CPU byType entries need cpuCoreMs");
        return total + value;
      }, 0)
    : null;
  if (Array.isArray(cpu) && cpu.length === 0) metrics.cpuCoreMs = null;
  if (at(interaction, "droppedEntries.frames") !== 0) metrics.frameP95Ms = null;
  if (
    at(interaction, "collectors.inputTimings") !== "observing" ||
    at(interaction, "droppedEntries.inputTimings") !== 0
  ) {
    metrics.inputDelayP95Ms = null;
    metrics.eventInteractionDurationP95Ms = null;
  }
  if (
    at(interaction, "collectors.longTasks") !== "observing" ||
    at(interaction, "droppedEntries.longTasks") !== 0
  ) {
    metrics.longTaskTotalMs = null;
    metrics.longTaskCount = null;
  }
  // Never use the legacy, process-lifetime top-level streamingLatency buffer.
  const samples = at(interaction, "streamingLatency.samples");
  for (const name of ["oldestPendingToCommitMs", "totalToCommitMs"]) {
    metrics[`scopedStreaming.${name}.p95`] =
      at(interaction, "streamingLatency.available") === true &&
      at(interaction, "streamingLatency.droppedSamples") === 0 &&
      Array.isArray(samples)
        ? percentile95(
            samples.flatMap((sample) => {
              const value = numberOrNull(at(sample, name), `streamingLatency.${name}`);
              return value === null ? [] : [value];
            }),
          )
        : null;
  }
  for (const name of ["targetVisibleAtMs", "transcriptSettledAtMs", "transcriptFullyVisibleAtMs"]) {
    metrics[`sessionSwitch.${name}`] = numberOrNull(at(report, `sessionSwitch.${name}`), name);
  }
  const batches = at(interaction, "batchProcessing");
  const collected = at(batches, "status") === "collected" && at(batches, "available") === true;
  for (const name of ["observedBatches", "observedEvents", "totalDurationMs", "maxDurationMs"]) {
    metrics[`batchProcessing.${name}`] = collected
      ? numberOrNull(at(batches, name), `batchProcessing.${name}`)
      : null;
  }
  const batchSamples = at(batches, "samples");
  const complete = collected && at(batches, "droppedSamples") === 0 && Array.isArray(batchSamples);
  for (const [metric, field] of [
    ["durationP95Ms", "durationMs"],
    ["eventsPerBatchP95", "eventCount"],
    ["textDeltaCharactersP95", "textDeltaCharacters"],
  ] as const) {
    metrics[`batchProcessing.${metric}`] = complete
      ? percentile95(batchSamples.map((sample) => Number(at(sample, field))))
      : null;
  }
  const actions = at(report, "workload.actions");
  if (Array.isArray(actions) && actions.length > 100) throw new Error("Too many workload actions");
  for (const name of [
    "switch-to-beta",
    "switch-to-alpha",
    "wheel-up",
    "resume-live-edge",
    "stop-alpha",
  ]) {
    const matches = Array.isArray(actions)
      ? actions.filter((action) => at(action, "name") === name)
      : [];
    if (matches.length > 1) throw new Error(`Duplicate workload action: ${name}`);
    const action = matches[0];
    const valid =
      at(action, "response.failure") === null && at(action, "response.untrustedEvents") === 0;
    const duration = valid ? numberOrNull(at(action, "eventToUsefulDOMMs"), name) : null;
    if (duration !== null && duration < 0)
      throw new Error(`Negative workload action duration: ${name}`);
    metrics[`streamingActions.${name}.eventToUsefulDOMMs`] = duration;
  }
  return metrics;
}

const COMPARABLE_PATHS = [
  "runIdentity.schemaVersion",
  "runIdentity.scenario",
  "runIdentity.host.platform",
  "runIdentity.host.release",
  "runIdentity.host.architecture",
  "runIdentity.host.cpuModel",
  "runIdentity.host.logicalCores",
  "runIdentity.host.totalMemoryBytes",
  "runIdentity.runner.node",
  "runIdentity.runner.bun",
  "runIdentity.build.mode",
  "label",
  "page.visibilityState",
  "page.documentHasFocus",
  "page.devicePixelRatio",
  "page.viewport.width",
  "page.viewport.height",
  "collectors.longTasks",
  "collectors.inputTimings",
  "collectors.longAnimationFrames",
  "inputTimings.durationThresholdMs",
  "appMetrics.processCpu.intervalMs",
  "appMetrics.before.versions.electron",
  "appMetrics.before.versions.chromium",
  "appMetrics.before.hardwareAcceleration",
  "appMetrics.before.window.focused",
  "appMetrics.before.window.visible",
  "appMetrics.before.window.minimized",
  "streamingLatency.available",
  ...PERFORMANCE_BUILD_FLAGS.map((flag) => `runIdentity.build.flags.${flag}`),
];

function signature(interaction: Row, report: Row): Row {
  const result: Row = {};
  const batch = interaction.batchProcessing;
  result.batchProcessingStatus = batch === undefined ? "absent" : at(batch, "status");
  result.batchProcessingScope = batch === undefined ? "absent" : at(batch, "scope");
  result.batchProcessingCapacity = batch === undefined ? 0 : at(batch, "capacity");
  if (batch !== undefined) {
    const status = at(batch, "status");
    if (
      !["collected", "disabled", "unavailable"].includes(String(status)) ||
      at(batch, "available") !== (status === "collected") ||
      at(batch, "scope") !== "useOpenCodeQueryEvents:sync-subscriber"
    )
      throw new Error("Invalid batch-processing collector metadata");
    if (status === "collected") {
      const samples = at(batch, "samples");
      const observed = numberOrNull(at(batch, "observedBatches"), "observedBatches");
      const dropped = numberOrNull(at(batch, "droppedSamples"), "droppedSamples");
      const capacity = numberOrNull(at(batch, "capacity"), "capacity");
      if (
        !Array.isArray(samples) ||
        observed === null ||
        dropped === null ||
        capacity === null ||
        !Number.isSafeInteger(observed) ||
        !Number.isSafeInteger(dropped) ||
        !Number.isSafeInteger(capacity) ||
        capacity <= 0 ||
        capacity > 10_000 ||
        dropped < 0 ||
        observed !== samples.length + dropped ||
        samples.length > capacity
      )
        throw new Error("Invalid batch-processing retention metadata");
      for (const name of ["observedEvents", "totalDurationMs", "maxDurationMs"]) {
        const value = numberOrNull(at(batch, name), name);
        if (value === null || value < 0) throw new Error(`Invalid batch-processing ${name}`);
      }
      for (const sample of samples) {
        const duration = numberOrNull(at(sample, "durationMs"), "batch duration");
        const count = numberOrNull(at(sample, "eventCount"), "batch event count");
        const characters = numberOrNull(at(sample, "textDeltaCharacters"), "batch text size");
        if (
          duration === null ||
          duration < 0 ||
          count === null ||
          count < 0 ||
          !Number.isSafeInteger(count) ||
          characters === null ||
          characters < 0 ||
          !Number.isSafeInteger(characters)
        )
          throw new Error("Invalid batch-processing sample");
      }
    }
  }
  for (const path of COMPARABLE_PATHS) {
    const value = at(interaction, path);
    if (value === undefined || value === null || value === "unknown" || value === "") {
      throw new Error(`Missing comparable metadata: ${path}`);
    }
    if (
      !["string", "number", "boolean"].includes(typeof value) ||
      (typeof value === "number" && !Number.isFinite(value))
    ) {
      throw new Error(`Invalid comparable metadata: ${path}`);
    }
    result[path] = value;
  }
  if (at(interaction, "runIdentity.schemaVersion") !== 1)
    throw new Error("Unsupported identity schema");
  if (at(interaction, "page.visibilityState") !== "visible")
    throw new Error("Document is not visible");
  for (const path of [
    "page.devicePixelRatio",
    "page.viewport.width",
    "page.viewport.height",
    "runIdentity.host.logicalCores",
    "runIdentity.host.totalMemoryBytes",
  ]) {
    const value = numberOrNull(at(interaction, path), path);
    if (value === null || value <= 0) throw new Error(`Invalid comparable metadata: ${path}`);
  }
  for (const path of [
    "page.documentHasFocus",
    "appMetrics.before.hardwareAcceleration",
    "appMetrics.before.window.focused",
    "appMetrics.before.window.visible",
    "appMetrics.before.window.minimized",
    "streamingLatency.available",
  ]) {
    if (typeof at(interaction, path) !== "boolean")
      throw new Error(`Invalid comparable metadata: ${path}`);
  }
  const declared = object(at(interaction, "runIdentity.declaredVersions"), "declaredVersions");
  for (const name of [
    "react",
    "react-dom",
    "@opencode/client",
    "@opencode/protocol",
    "@playwright/test",
    "electron",
  ]) {
    if (typeof declared[name] !== "string" || !declared[name])
      throw new Error(`Missing declared version: ${name}`);
    result[`declaredVersions.${name}`] = declared[name];
  }
  for (const name of ["longTasks", "inputTimings", "longAnimationFrames"]) {
    if (
      !["observing", "unsupported", "disabled"].includes(
        String(at(interaction, `collectors.${name}`)),
      )
    ) {
      throw new Error(`Failed or invalid collector: ${name}`);
    }
  }
  // Fixture cadence and keyboard traffic must not change between otherwise
  // identical scenario labels. Omit rendered text from comparison output.
  result.workloadSettings = JSON.stringify(at(report, "workload.settings") ?? null);
  for (const path of ["characterCount", "keyDelayMs", "inputMethod", "scrollProbe"]) {
    result[`inputSettings.${path}`] = at(report, `workload.input.settings.${path}`) ?? null;
  }
  return result;
}

export function compareReports(baseline: unknown[], candidate: unknown[]) {
  if ([baseline, candidate].some((group) => group.length < 2 || group.length > 100)) {
    throw new Error("Each group needs 2–100 independent reports; at least 5 recommended");
  }
  const warnings = new Set<string>([
    "Descriptive run-level summaries only; no confidence estimate, INP, budget or regression verdict.",
    "Host load, power state, refresh rate and occlusion are not controlled by identity checks.",
    "Declared dependency versions do not establish the actual OpenCode service runtime version.",
  ]);
  if (baseline.length < 5 || candidate.length < 5)
    warnings.add("At least 5 independent runs per group are recommended.");
  let reference: Row | undefined;
  const seen = new Set<string>();
  const groups = [baseline, candidate].map((group, groupIndex) => {
    let sourceReference: string | undefined;
    return group.map((input, index) => {
      const label = `${groupIndex === 0 ? "baseline" : "candidate"}[${index}]`;
      const report = object(input, label);
      if (report.cycles) throw new Error(`${label}: memory-cycle reports are not independent runs`);
      const interaction = object(report.interaction, `${label}.interaction`);
      const current = signature(interaction, report);
      if (Number(at(interaction, "batchProcessing.droppedSamples")) > 0)
        warnings.add(
          `${label}: batch-processing samples were dropped; percentiles are incomplete, aggregate totals remain complete.`,
        );
      if (at(interaction, "runIdentity.build.flags.PALOT_E2E_VIDEO") === "1")
        warnings.add(
          "Video capture adds observer overhead; recorded runs are visual attribution, not clean benchmarks.",
        );
      reference ??= current;
      for (const [path, value] of Object.entries(current)) {
        if (reference[path] !== value) throw new Error(`${label}: incompatible ${path}`);
      }
      const revision = at(interaction, "runIdentity.source.revision");
      const dirty = at(interaction, "runIdentity.source.dirty");
      if (typeof revision !== "string" || !revision || typeof dirty !== "boolean")
        throw new Error(`${label}: missing source identity`);
      const sourceKey = JSON.stringify([revision, dirty]);
      sourceReference ??= sourceKey;
      if (sourceKey !== sourceReference)
        throw new Error(`${label}: mixed source identities within group`);
      if (dirty)
        warnings.add(
          "Dirty worktree recorded: uncommitted contents are not fingerprinted; verify each group's source manually.",
        );
      const capturedAt = interaction.capturedAt;
      const window = object(interaction.measurementWindow, "measurementWindow");
      const times = [window.timeOrigin, window.startedAt, window.endedAt];
      if (
        typeof capturedAt !== "string" ||
        !Number.isFinite(Date.parse(capturedAt)) ||
        times.some((value) => numberOrNull(value, "measurementWindow") === null) ||
        Number(window.endedAt) < Number(window.startedAt)
      ) {
        throw new Error(`${label}: invalid measurement window`);
      }
      const runKey = JSON.stringify([capturedAt, window.timeOrigin, window.startedAt]);
      if (seen.has(runKey))
        throw new Error(`${label}: duplicate measurement; provide independent runs`);
      seen.add(runKey);
      for (const name of ["frames", "longTasks", "inputTimings", "longAnimationFrames"]) {
        const dropped = numberOrNull(
          at(interaction, `droppedEntries.${name}`),
          `droppedEntries.${name}`,
        );
        if (dropped === null || dropped < 0)
          throw new Error(`${label}: missing/invalid dropped-entry metadata`);
        if (dropped > 0)
          warnings.add(`${label}: ${name} samples were dropped; summaries are incomplete.`);
      }
      const streaming = object(interaction.streamingLatency, "streamingLatency");
      if (!Array.isArray(streaming.samples))
        throw new Error(`${label}: missing scoped streaming samples`);
      if (streaming.available === true) {
        const start = numberOrNull(streaming.startCursor, "startCursor");
        const end = numberOrNull(streaming.endCursor, "endCursor");
        const dropped = numberOrNull(streaming.droppedSamples, "droppedSamples");
        if (start === null || end === null || end < start || dropped === null || dropped < 0)
          throw new Error(`${label}: invalid scoped streaming cursor metadata`);
        if (dropped > 0)
          warnings.add(
            `${label}: scoped streaming samples were dropped; freshness summary is incomplete.`,
          );
      }
      return { source: { revision, dirty }, metrics: extractMetrics(report, interaction) };
    });
  });
  const left = groups[0]!;
  const right = groups[1]!;
  const metrics = Object.fromEntries(
    Object.keys(left[0]!.metrics).map((name) => {
      const a = summarizeRuns(left.map((run) => run.metrics[name] ?? null));
      const b = summarizeRuns(right.map((run) => run.metrics[name] ?? null));
      if (a.missing || b.missing)
        warnings.add(`${name}: unavailable values are excluded, never treated as zero.`);
      const complete = a.missing === 0 && b.missing === 0;
      const delta = complete && a.median !== null && b.median !== null ? b.median - a.median : null;
      return [
        name,
        {
          baseline: a,
          candidate: b,
          medianDelta: delta,
          medianDeltaPercent: delta !== null && a.median !== 0 ? (delta / a.median!) * 100 : null,
        },
      ];
    }),
  );
  return {
    comparable: true,
    baseline: { runs: left.length, source: left[0]!.source },
    candidate: { runs: right.length, source: right[0]!.source },
    comparableIdentity: reference,
    metrics,
    warnings: [...warnings],
  };
}

export function parseCompareArguments(
  args: string[],
): { help: true } | { baseline: string[]; candidate: string[] } {
  if (args.length === 1 && ["--help", "-h"].includes(args[0]!)) return { help: true };
  const separator = args.indexOf("--");
  if (
    separator < 0 ||
    args.lastIndexOf("--") !== separator ||
    args.some((arg) => arg !== "--" && arg.startsWith("-"))
  ) {
    throw new Error("Use <baseline.json...> -- <candidate.json...>; see --help");
  }
  const baseline = args.slice(0, separator);
  const candidate = args.slice(separator + 1);
  if ([baseline, candidate].some((group) => group.length < 2 || group.length > 100))
    throw new Error("Each group needs 2–100 files; see --help");
  return { baseline, candidate };
}

export function runCompareCli(args: string[]): number {
  try {
    const options = parseCompareArguments(args);
    if ("help" in options) {
      console.log(HELP);
      return 0;
    }
    const seen = new Set<string>();
    let totalBytes = 0;
    const load = (filename: string): unknown => {
      const path = realpathSync(filename);
      if (seen.has(path)) throw new Error("Duplicate report path; provide independent runs");
      seen.add(path);
      const stat = statSync(path);
      if (!stat.isFile() || stat.size > 32 * 1024 * 1024)
        throw new Error("Report must be a file no larger than 32 MiB");
      totalBytes += stat.size;
      if (totalBytes > 256 * 1024 * 1024) throw new Error("Reports exceed the 256 MiB total limit");
      const contents = readFileSync(path, "utf8");
      try {
        return JSON.parse(contents);
      } catch {
        // JSON parser messages can echo private report contents.
        throw new Error("Invalid report JSON");
      }
    };
    console.log(
      JSON.stringify(
        compareReports(options.baseline.map(load), options.candidate.map(load)),
        null,
        2,
      ),
    );
    return 0;
  } catch (error) {
    console.log(
      JSON.stringify({
        comparable: false,
        error: error instanceof Error ? error.message : "Unknown comparison error",
      }),
    );
    return 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  process.exitCode = runCompareCli(process.argv.slice(2));
}
