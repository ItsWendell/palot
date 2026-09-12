import { reactScanRequested, readDiagnosticsPreferences } from "./diagnostics-preferences";

export type ReactScanBootstrapStatus = "off" | "active" | "failed";

export interface DiagnosticsBootstrapState {
  reactScanRequested: boolean;
  reactScanActive: boolean;
  reactScanStatus: ReactScanBootstrapStatus;
}

export interface ReactScanDiagnosticsSample {
  renderCount: number;
  commitCount: number;
  totalRenderTimeMs: number;
  slowestRenderMs: number | null;
  fps: number | null;
  liteProfilingHooks: { available: boolean; reason: string | null } | null;
  longAnimationFrames: ReactScanLongAnimationFrameSample[];
  components: ReactScanComponentSample[];
}

export interface ReactScanLongAnimationFrameSample {
  startTime: number;
  durationMs: number;
  blockingDurationMs: number;
  renderStart: number | null;
  styleAndLayoutStart: number | null;
  commitCount: number;
  priorities: string[];
  components: Array<{
    name: string;
    fiberRenderCount: number;
    totalActualDurationMs: number;
    slowestActualDurationMs: number;
  }>;
}

export interface ReactScanComponentSample {
  name: string;
  renderCount: number;
  mountCount: number;
  updateCount: number;
  unnecessaryRenderCount: number;
  parentRenderCount: number;
  totalRenderTimeMs: number;
  slowestRenderMs: number | null;
  changedProps: Record<string, number>;
  changedState: Record<string, number>;
  changedContext: Record<string, number>;
}

interface ReactScanRender {
  phase: number;
  componentName: string | null;
  count: number;
  time: number | null;
  unnecessary: boolean | null;
  changes: Array<{ type: number; name: string; count?: number }>;
  fps: number;
}

interface ReactScanFiber {
  type?: string | { displayName?: string; name?: string };
  elementType?: string | { displayName?: string; name?: string };
}

interface ReactScanModule {
  scan(options: {
    enabled: boolean;
    showToolbar: boolean;
    showFPS: boolean;
    dangerouslyForceRunInProduction: boolean;
    safeArea: { bottom: number; right: number };
    onRender(fiber: unknown, renders: ReactScanRender[]): void;
    onCommitFinish(): void;
  }): void;
}

interface ReactScanLiteModule {
  instrument(options: {
    includeFiberTree: boolean;
    includeProfilingHooks: boolean;
    recordChangeDescriptions: boolean;
    maxFibersPerCommit: number;
    minFiberActualDurationMs: number;
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
  }): unknown;
}

export async function initializeOptionalReactScan({
  defaultEnabled = __PALOT_REACT_SCAN_DEFAULT__,
  load = () => import("react-scan/all-environments"),
  loadLite = () => import("react-scan/lite"),
}: {
  defaultEnabled?: boolean;
  load?: () => Promise<ReactScanModule>;
  loadLite?: () => Promise<ReactScanLiteModule>;
} = {}): Promise<DiagnosticsBootstrapState> {
  const requested = reactScanRequested(readDiagnosticsPreferences(), defaultEnabled);
  if (!requested) {
    return { reactScanRequested: false, reactScanActive: false, reactScanStatus: "off" };
  }

  try {
    const [reactScan, reactScanLite] = await Promise.all([load(), loadLite()]);
    let renderCount = 0;
    let commitCount = 0;
    let totalRenderTimeMs = 0;
    let slowestRenderMs: number | null = null;
    let fps: number | null = null;
    let liteProfilingHooks: { available: boolean; reason: string | null } | null = null;
    let liteCommits: ReactScanLiteCommit[] = [];
    let longAnimationFrames: ReactScanLongAnimationFrame[] = [];
    const components = new Map<string, ReactScanComponentSample>();
    const reasonComponents = new Map<
      string,
      Pick<
        ReactScanComponentSample,
        "changedProps" | "changedState" | "changedContext" | "parentRenderCount"
      >
    >();
    window.palotReactScan = {
      readAndReset() {
        for (const [name, reasons] of reasonComponents) {
          const component = components.get(name);
          if (!component) continue;
          mergeReasonCounts(component.changedProps, reasons.changedProps);
          mergeReasonCounts(component.changedState, reasons.changedState);
          mergeReasonCounts(component.changedContext, reasons.changedContext);
          component.parentRenderCount += reasons.parentRenderCount;
          components.set(name, component);
        }
        const sample = {
          renderCount,
          commitCount,
          totalRenderTimeMs,
          slowestRenderMs,
          fps,
          liteProfilingHooks,
          longAnimationFrames: correlateLongAnimationFrames(longAnimationFrames, liteCommits),
          components: [...components.values()].toSorted(
            (left, right) =>
              right.totalRenderTimeMs - left.totalRenderTimeMs ||
              right.renderCount - left.renderCount ||
              left.name.localeCompare(right.name),
          ),
        };
        renderCount = 0;
        commitCount = 0;
        totalRenderTimeMs = 0;
        slowestRenderMs = null;
        fps = null;
        liteCommits = [];
        longAnimationFrames = [];
        components.clear();
        reasonComponents.clear();
        return sample;
      },
    };
    reactScanLite.instrument({
      includeFiberTree: true,
      includeProfilingHooks: true,
      recordChangeDescriptions: true,
      maxFibersPerCommit: 3_000,
      minFiberActualDurationMs: 0.01,
      onEvent(event) {
        if (event.kind === "profiling-hooks-status" && typeof event.available === "boolean") {
          liteProfilingHooks = { available: event.available, reason: event.reason ?? null };
          return;
        }
        if (event.kind !== "commit" || !event.tree) return;
        liteCommits.push({
          timestamp: event.timestamp,
          priority: event.priorityName ?? null,
          components: event.tree.flatMap((fiber) =>
            fiber.actualDuration > 0 && actionableFiberName(fiber.name)
              ? [{ name: fiber.name, actualDuration: fiber.actualDuration }]
              : [],
          ),
        });
        for (const fiber of event.tree) {
          const change = fiber.changeDescription;
          if (!change || change.isFirstMount) continue;
          const reasons = reasonComponents.get(fiber.name) ?? {
            changedProps: {},
            changedState: {},
            changedContext: {},
            parentRenderCount: 0,
          };
          for (const prop of change.props ?? []) incrementReason(reasons.changedProps, prop);
          if (change.state) incrementReason(reasons.changedState, "class state");
          for (const hook of change.hooks) incrementReason(reasons.changedState, `hook ${hook}`);
          if (change.context) incrementReason(reasons.changedContext, "context");
          if (change.parent) reasons.parentRenderCount += 1;
          reasonComponents.set(fiber.name, reasons);
        }
      },
    });
    if (
      typeof PerformanceObserver !== "undefined" &&
      PerformanceObserver.supportedEntryTypes?.includes("long-animation-frame")
    ) {
      const observer = new PerformanceObserver((list) => {
        longAnimationFrames.push(
          ...list.getEntries().map((entry) => {
            const value = entry as PerformanceEntry & {
              blockingDuration?: number;
              renderStart?: number;
              styleAndLayoutStart?: number;
            };
            return {
              startTime: value.startTime,
              durationMs: value.duration,
              blockingDurationMs: value.blockingDuration ?? 0,
              renderStart: value.renderStart ?? null,
              styleAndLayoutStart: value.styleAndLayoutStart ?? null,
            };
          }),
        );
      });
      observer.observe({ type: "long-animation-frame", buffered: true });
    }
    reactScan.scan({
      enabled: true,
      showToolbar: false,
      showFPS: false,
      dangerouslyForceRunInProduction: true,
      safeArea: { bottom: 20, right: 20 },
      onRender(fiber, renders) {
        for (const render of renders) {
          renderCount += render.count;
          if (render.time !== null) {
            totalRenderTimeMs += render.time;
            slowestRenderMs = Math.max(slowestRenderMs ?? 0, render.time);
          }
          if (Number.isFinite(render.fps)) fps = render.fps;
          const name = render.componentName ?? reactScanFiberName(fiber) ?? "Unknown";
          const component = components.get(name) ?? emptyReactScanComponent(name);
          component.renderCount += render.count;
          if (render.phase === 1) component.mountCount += render.count;
          if (render.phase === 2) component.updateCount += render.count;
          if (render.unnecessary) component.unnecessaryRenderCount += render.count;
          if (render.time !== null) {
            component.totalRenderTimeMs += render.time;
            component.slowestRenderMs = Math.max(component.slowestRenderMs ?? 0, render.time);
          }
          for (const change of render.changes) {
            const target =
              change.type === 1
                ? component.changedProps
                : change.type === 4
                  ? component.changedContext
                  : component.changedState;
            target[change.name] = (target[change.name] ?? 0) + (change.count ?? 1);
          }
          components.set(name, component);
        }
      },
      onCommitFinish() {
        commitCount += 1;
      },
    });
    return { reactScanRequested: true, reactScanActive: true, reactScanStatus: "active" };
  } catch {
    delete window.palotReactScan;
    return { reactScanRequested: true, reactScanActive: false, reactScanStatus: "failed" };
  }
}

interface ReactScanLiteCommit {
  timestamp: number;
  priority: string | null;
  components: Array<{ name: string; actualDuration: number }>;
}

interface ReactScanLongAnimationFrame {
  startTime: number;
  durationMs: number;
  blockingDurationMs: number;
  renderStart: number | null;
  styleAndLayoutStart: number | null;
}

function correlateLongAnimationFrames(
  frames: ReactScanLongAnimationFrame[],
  commits: ReactScanLiteCommit[],
): ReactScanLongAnimationFrameSample[] {
  return frames.map((frame) => {
    const end = frame.startTime + frame.durationMs;
    const matching = commits.filter(
      (commit) => commit.timestamp >= frame.startTime && commit.timestamp <= end,
    );
    const components = new Map<
      string,
      {
        name: string;
        fiberRenderCount: number;
        totalActualDurationMs: number;
        slowestActualDurationMs: number;
      }
    >();
    for (const commit of matching) {
      for (const component of commit.components) {
        const current = components.get(component.name) ?? {
          name: component.name,
          fiberRenderCount: 0,
          totalActualDurationMs: 0,
          slowestActualDurationMs: 0,
        };
        current.fiberRenderCount += 1;
        current.totalActualDurationMs += component.actualDuration;
        current.slowestActualDurationMs = Math.max(
          current.slowestActualDurationMs,
          component.actualDuration,
        );
        components.set(component.name, current);
      }
    }
    return {
      ...frame,
      commitCount: matching.length,
      priorities: [
        ...new Set(matching.flatMap((commit) => (commit.priority ? [commit.priority] : []))),
      ].toSorted(),
      components: [...components.values()]
        .toSorted(
          (left, right) =>
            right.totalActualDurationMs - left.totalActualDurationMs ||
            right.slowestActualDurationMs - left.slowestActualDurationMs,
        )
        .slice(0, 20),
    };
  });
}

function actionableFiberName(name: string): boolean {
  return /^[A-Z]/.test(name) && name !== "Anonymous" && name !== "Unknown";
}

function emptyReactScanComponent(name: string): ReactScanComponentSample {
  return {
    name,
    renderCount: 0,
    mountCount: 0,
    updateCount: 0,
    unnecessaryRenderCount: 0,
    parentRenderCount: 0,
    totalRenderTimeMs: 0,
    slowestRenderMs: null,
    changedProps: {},
    changedState: {},
    changedContext: {},
  };
}

function incrementReason(target: Record<string, number>, name: string): void {
  target[name] = (target[name] ?? 0) + 1;
}

function mergeReasonCounts(target: Record<string, number>, source: Record<string, number>): void {
  for (const [name, count] of Object.entries(source)) {
    target[name] = (target[name] ?? 0) + count;
  }
}

function reactScanFiberName(fiber: unknown): string | null {
  if (!fiber || typeof fiber !== "object") return null;
  const value = fiber as ReactScanFiber;
  for (const type of [value.type, value.elementType]) {
    if (typeof type === "string") return type;
    if (type?.displayName) return type.displayName;
    if (type?.name) return type.name;
  }
  return null;
}
