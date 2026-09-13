import { defineChart, lineY, type ChartPoint, type ChartTooltipContent } from "@tanstack/charts";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import { scalePoint } from "@tanstack/charts/scales/point";
import { tooltip } from "@tanstack/charts/tooltip";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Copy,
  Cpu,
  Download,
  FolderOpen,
  Gauge,
  MemoryStick,
  Monitor,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { useAtomValue } from "jotai";
import { useEffect, useState, type ReactNode } from "react";
import type { PalotDataLocations } from "../../shared";
import { runtimeAtom } from "../atoms/workspace";
import { palotBuild } from "../lib/build";
import { palot } from "../services/palot";
import { useDiagnostics } from "../hooks/use-diagnostics";
import {
  diagnostics,
  type DiagnosticsPhase,
  type DiagnosticsRuntimeSummary,
  type DiagnosticsSnapshot,
} from "../lib/diagnostics-controller";
import { SettingsEmpty, SettingsGroup, SettingsRow, SettingsSection } from "./settings-layout";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "./ui/card";
import { Chart, chartTheme } from "./ui/chart";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import { Switch } from "./ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";
import { toast } from "./ui/toast";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./ui/alert-dialog";

const DIAGNOSTICS_TIME_FORMATTER = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
});

const RESOURCE_SERIES = [
  {
    label: "CPU",
    color: "var(--info)",
    read: (point: DiagnosticsHistoryPoint) => point.cpuPercent,
    format: (value: number) => `${value.toFixed(1)}%`,
  },
  {
    label: "Working set",
    color: "var(--success)",
    read: (point: DiagnosticsHistoryPoint) => point.workingSetMiB,
    format: (value: number) => `${value.toFixed(value >= 100 ? 0 : 1)} MiB`,
  },
] as const satisfies readonly HistorySeries[];

const RESPONSIVENESS_SERIES = [
  {
    label: "Frame p95",
    color: "var(--warning)",
    read: (point: DiagnosticsHistoryPoint) => point.frameP95Ms,
    format: formatMilliseconds,
  },
  {
    label: "Streaming p95",
    color: "var(--info)",
    read: (point: DiagnosticsHistoryPoint) => point.streamingP95Ms,
    format: formatMilliseconds,
  },
] as const satisfies readonly HistorySeries[];

type DiagnosticsHistoryPoint = DiagnosticsSnapshot["history"][number];

interface HistorySeries {
  label: string;
  color: string;
  read(point: DiagnosticsHistoryPoint): number | null;
  format(value: number): string;
}

interface HistoryChartRow {
  capturedAt: number;
  series: string;
  value: number;
  displayValue: string;
}

export function DiagnosticsSettings() {
  const snapshot = useDiagnostics("dashboard");
  const runtime = useAtomValue(runtimeAtom);
  const [pendingAction, setPendingAction] = useState<"capture" | "copy" | null>(null);
  const runtimeSummary: DiagnosticsRuntimeSummary | null = runtime
    ? {
        connected: runtime.connected,
        phase: runtime.phase,
        version: runtime.version,
        managed: runtime.managed,
      }
    : null;

  async function captureNow() {
    setPendingAction("capture");
    try {
      await diagnostics.captureNow();
      toast.add({ type: "success", title: "Diagnostics refreshed" });
    } catch (error) {
      showDiagnosticsError("Could not refresh diagnostics", error);
    } finally {
      setPendingAction(null);
    }
  }

  async function copyReport() {
    setPendingAction("copy");
    try {
      await diagnostics.copySafeReport(runtimeSummary);
      toast.add({
        type: "success",
        title: "Diagnostics copied",
        description: "The report excludes task content, paths, URLs, and credentials.",
      });
    } catch (error) {
      showDiagnosticsError("Could not copy diagnostics", error);
    } finally {
      setPendingAction(null);
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-8" data-diagnostics-status={snapshot.phase}>
      <SettingsSection
        title="Live signals"
        description="Bounded, in-memory measurements collected only while this page or the overlay is open."
        action={
          <>
            <PhaseBadge phase={snapshot.phase} />
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Refresh diagnostics"
              disabled={pendingAction !== null}
              onClick={() => void captureNow()}
            >
              <RefreshCw
                className={pendingAction === "capture" ? "animate-spin" : undefined}
                aria-hidden="true"
              />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={pendingAction !== null}
              onClick={() => void copyReport()}
            >
              <Copy data-icon="inline-start" aria-hidden="true" />
              Copy report
            </Button>
          </>
        }
      >
        <Card className="min-w-0 rounded-xl border border-border ring-0">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="size-4 text-muted-foreground" aria-hidden="true" />
              Diagnostic session
            </CardTitle>
            <CardDescription className="text-compact">
              Electron process counters, renderer responsiveness, and OpenCode streaming latency.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-2 divide-x divide-y divide-border border-y border-border p-0 @xl/settings:grid-cols-4 @5xl/settings:grid-cols-8">
            <SignalMetric
              icon={<Cpu aria-hidden="true" />}
              label="CPU"
              value={formatCpu(snapshot)}
              detail={snapshot.current.cpuReady ? "Electron interval" : "Warming interval"}
            />
            <SignalMetric
              icon={<MemoryStick aria-hidden="true" />}
              label="Memory"
              value={formatKiB(snapshot.current.workingSetKiB)}
              detail={`${snapshot.current.app?.processes.length ?? 0} processes`}
            />
            <SignalMetric
              icon={<Gauge aria-hidden="true" />}
              label="FPS"
              value={formatFps(snapshot.current.renderer?.frames.fps)}
              detail={`${snapshot.current.renderer?.frames.count ?? 0} frame intervals`}
            />
            <SignalMetric
              icon={<Gauge aria-hidden="true" />}
              label="Frame p95"
              value={formatMilliseconds(snapshot.current.renderer?.frames.p95)}
              detail={`${snapshot.current.renderer?.frames.over25Ms ?? 0} over 25 ms`}
            />
            <SignalMetric
              icon={<Clock3 aria-hidden="true" />}
              label="Long tasks"
              value={String(snapshot.current.renderer?.longTasks.count ?? 0)}
              detail={`${formatMilliseconds(snapshot.current.renderer?.longTasks.max)} longest`}
            />
            <SignalMetric
              icon={<Activity aria-hidden="true" />}
              label="React renders"
              value={
                snapshot.current.renderer?.reactScan
                  ? String(snapshot.current.renderer.reactScan.renderCount)
                  : "-"
              }
              detail={
                snapshot.current.renderer?.reactScan
                  ? `${snapshot.current.renderer.reactScan.commitCount} commits / ${formatMilliseconds(snapshot.current.renderer.reactScan.totalRenderTimeMs)}`
                  : "React Scan off"
              }
            />
            <SignalMetric
              icon={<Activity aria-hidden="true" />}
              label="Stream p95"
              value={formatMilliseconds(snapshot.current.renderer?.streamingLatency.p95)}
              detail={`${snapshot.current.renderer?.streamingLatency.count ?? 0} commits`}
            />
            <SignalMetric
              icon={<RefreshCw aria-hidden="true" />}
              label="Collector"
              value={formatMilliseconds(snapshot.collector.lastCollectionDurationMs)}
              detail={`Every ${formatDuration(snapshot.collector.sampleIntervalMs)}`}
            />
          </CardContent>
          <CardFooter className="flex-wrap justify-between gap-2 text-meta text-muted-foreground">
            <span>{lastSampleLabel(snapshot.collector.lastSampleAt)}</span>
            <span className="font-mono tabular-nums">
              {snapshot.collector.sampleCount} retained samples
            </span>
          </CardFooter>
        </Card>
      </SettingsSection>

      {snapshot.preferences.reactScanActive ? (
        <Alert>
          <AlertTriangle aria-hidden="true" />
          <AlertTitle>React Scan is instrumenting this renderer</AlertTitle>
          <AlertDescription>
            Render outlines and this dashboard add observer overhead. Disable them before comparing
            benchmark results.
          </AlertDescription>
        </Alert>
      ) : snapshot.preferences.reactScanStatus === "failed" ? (
        <Alert variant="destructive">
          <AlertTriangle aria-hidden="true" />
          <AlertTitle>React Scan could not start</AlertTitle>
          <AlertDescription>
            Palot continued without render instrumentation. Disable React Scan and reload before
            retrying.
          </AlertDescription>
        </Alert>
      ) : null}

      <SettingsSection
        title="Instrumentation"
        description="These controls are available in every Palot build and remain off by default."
      >
        <SettingsGroup>
          <p className="p-4 text-compact leading-relaxed text-muted-foreground">
            The overlay shares this page's collector. React Scan's render outlines load before React
            and therefore require a renderer reload.
          </p>
          <SettingsRow
            title="Diagnostic overlay"
            description="Show a compact always-on-top HUD with CPU, memory, frames, long tasks, and streaming latency."
            control={
              <Switch
                aria-label="Diagnostic overlay"
                checked={snapshot.preferences.overlayVisible}
                onCheckedChange={(checked) => diagnostics.setOverlayVisible(Boolean(checked))}
              />
            }
          />
          <SettingsRow
            title="React Scan"
            description="Highlight component renders. This changes runtime behavior and is not benchmark-neutral."
            control={
              <Switch
                aria-label="React Scan"
                checked={snapshot.preferences.reactScanRequested}
                onCheckedChange={(checked) => diagnostics.setReactScanEnabled(Boolean(checked))}
              />
            }
          />
          <div className="flex flex-wrap gap-2 p-4">
            <CapabilityBadge
              label="Browser probes"
              enabled={snapshot.capabilities.animationFrames && snapshot.capabilities.longTasks}
            />
            <CapabilityBadge
              label="Electron metrics"
              enabled={snapshot.capabilities.nativeMetrics}
            />
            <CapabilityBadge label="Renderer heap" enabled={snapshot.capabilities.rendererHeap} />
            <Badge variant={snapshot.build.reactProfiling ? "secondary" : "outline"}>
              React profiling {snapshot.build.reactProfiling ? "on" : "off"}
            </Badge>
            <Badge variant={snapshot.build.reactCompilerMode ? "secondary" : "outline"}>
              Compiler {snapshot.build.reactCompilerMode ?? "off"}
            </Badge>
          </div>
        </SettingsGroup>
      </SettingsSection>

      <SettingsSection
        title="Resource history"
        description="Two minutes of renderer-local history, discarded when Palot reloads."
        action={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              diagnostics.clearHistory();
              toast.add({ type: "success", title: "Diagnostic history cleared" });
            }}
          >
            <Trash2 data-icon="inline-start" aria-hidden="true" />
            Clear history
          </Button>
        }
      >
        <div className="grid min-w-0 gap-4 @3xl/settings:grid-cols-2">
          <HistoryCard
            title="Process footprint"
            description="Aggregate Electron CPU and working set, each shown on its own local range. CPU starts after one warm-up sample."
            empty={snapshot.history.length < 2}
          >
            <ResourceHistoryChart snapshot={snapshot} />
          </HistoryCard>
          <HistoryCard
            title="Renderer responsiveness"
            description="Frame intervals and receive-to-commit samples share a millisecond scale."
            empty={snapshot.history.length < 2}
          >
            <ResponsivenessHistoryChart snapshot={snapshot} />
          </HistoryCard>
        </div>
      </SettingsSection>

      <SettingsSection
        title="Electron processes"
        description="Live process metrics from Electron. CPU values are interval-based; memory values are KiB."
      >
        <Card className="min-w-0 rounded-xl border border-border ring-0">
          <CardHeader>
            <CardTitle>Process table</CardTitle>
            <CardDescription className="text-compact">
              Names are Electron service labels, not command lines or OpenCode task content.
            </CardDescription>
          </CardHeader>
          <CardContent className="-mb-(--card-spacing) p-0">
            <ProcessTable snapshot={snapshot} />
          </CardContent>
        </Card>
      </SettingsSection>

      <SettingsSection title="System and collector">
        <div className="grid min-w-0 gap-4 @3xl/settings:grid-cols-2">
          <SystemCard snapshot={snapshot} runtime={runtimeSummary} />
          <GpuCard snapshot={snapshot} />
        </div>
      </SettingsSection>

      <DataManagement />
    </div>
  );
}

function DataManagement() {
  const [locations, setLocations] = useState<PalotDataLocations | null>(null);
  const [confirmation, setConfirmation] = useState<"settings" | "all" | null>(null);
  const [pending, setPending] = useState<"support" | "settings" | "all" | null>(null);

  useEffect(() => {
    void palot
      .dataLocations()
      .then(setLocations)
      .catch(() => setLocations(null));
  }, []);

  async function exportBundle() {
    setPending("support");
    try {
      const file = await palot.exportSupportBundle();
      if (file) toast.add({ type: "success", title: "Support bundle exported" });
    } catch (error) {
      showDiagnosticsError("Could not export support bundle", error);
    } finally {
      setPending(null);
    }
  }

  async function reset(scope: "settings" | "all") {
    setPending(scope);
    try {
      await palot.resetPalotData(scope);
    } catch (error) {
      setPending(null);
      setConfirmation(null);
      showDiagnosticsError(
        scope === "settings" ? "Could not reset settings" : "Could not remove Palot data",
        error,
      );
    }
  }

  return (
    <SettingsSection
      title="Data and recovery"
      description="Palot keeps its desktop state separate from OpenCode's sessions, auth, configuration, projects, and service storage."
    >
      <Card className="@container/details min-w-0 rounded-xl border border-border ring-0">
        <CardHeader>
          <CardTitle>Palot-owned data</CardTitle>
          <CardDescription className="text-compact">
            Inspect local locations, export a redacted support file, or reset Palot without deleting
            OpenCode-owned data.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DetailRow label="Data" value={locations?.data ?? "Unavailable"} />
          <DetailRow label="Logs" value={locations?.logs ?? "Unavailable"} />
          <DetailRow label="Database backups" value={locations?.backups ?? "Unavailable"} />
        </CardContent>
        <CardFooter className="flex-wrap gap-2 border-t">
          <Button
            type="button"
            variant="outline"
            onClick={() => void palot.revealDataLocation("data")}
          >
            <FolderOpen data-icon="inline-start" aria-hidden="true" /> Reveal data
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => void palot.revealDataLocation("logs")}
          >
            <FolderOpen data-icon="inline-start" aria-hidden="true" /> Reveal logs
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={pending !== null}
            onClick={() => void exportBundle()}
          >
            <Download data-icon="inline-start" aria-hidden="true" />
            {pending === "support" ? "Exporting…" : "Export support bundle"}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={pending !== null}
            onClick={() => setConfirmation("settings")}
          >
            Reset settings
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={pending !== null}
            onClick={() => setConfirmation("all")}
          >
            Remove Palot data
          </Button>
        </CardFooter>
      </Card>
      <AlertDialog
        open={confirmation !== null}
        onOpenChange={(open) => !open && setConfirmation(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmation === "all" ? "Remove all Palot-owned data?" : "Reset Palot settings?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmation === "all"
                ? "This permanently removes Palot's database, preferences, local UI state, logs, temporary attachments, server profiles, and encrypted server credentials. OpenCode-owned data is not deleted."
                : "This clears Palot preferences and local UI state, then restarts. Saved OpenCode server profiles and encrypted server credentials are preserved."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending !== null}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant={confirmation === "all" ? "destructive" : "default"}
              disabled={pending !== null}
              onClick={() => confirmation && void reset(confirmation)}
            >
              {pending
                ? "Working…"
                : confirmation === "all"
                  ? "Remove Palot data"
                  : "Reset settings"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SettingsSection>
  );
}

function SignalMetric({
  icon,
  label,
  value,
  detail,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="min-w-0 p-4">
      <div className="flex items-center gap-1.5 text-meta text-muted-foreground [&_svg]:size-3 [&_svg]:shrink-0">
        {icon}
        <span>{label}</span>
      </div>
      <div className="mt-2 font-mono text-lg font-semibold tabular-nums wrap-anywhere">{value}</div>
      <div className="mt-1 text-meta text-muted-foreground wrap-anywhere">{detail}</div>
    </div>
  );
}

function HistoryCard({
  title,
  description,
  empty,
  children,
}: {
  title: string;
  description: string;
  empty: boolean;
  children: ReactNode;
}) {
  return (
    <Card className="min-w-0 rounded-xl border border-border ring-0">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription className="text-compact">{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {empty ? (
          <div className="flex min-h-48 items-center">
            <SettingsEmpty>
              <span className="mb-1 block text-sm font-medium text-foreground">
                Collecting the first interval
              </span>
              History appears after the warm-up and first timed sample.
            </SettingsEmpty>
          </div>
        ) : (
          children
        )}
      </CardContent>
    </Card>
  );
}

function ResourceHistoryChart({ snapshot }: { snapshot: DiagnosticsSnapshot }) {
  const rows = historyChartRows(snapshot.history, RESOURCE_SERIES, true);
  return <HistoryLineChart rows={rows} series={RESOURCE_SERIES} normalized />;
}

function ResponsivenessHistoryChart({ snapshot }: { snapshot: DiagnosticsSnapshot }) {
  const rows = historyChartRows(snapshot.history, RESPONSIVENESS_SERIES, false);
  return <HistoryLineChart rows={rows} series={RESPONSIVENESS_SERIES} />;
}

function HistoryLineChart({
  rows,
  series,
  normalized = false,
}: {
  rows: readonly HistoryChartRow[];
  series: readonly HistorySeries[];
  normalized?: boolean;
}) {
  const maximum = Math.max(1, ...rows.map((row) => row.value));
  const definition = defineChart({
    marks: [
      lineY(rows, {
        id: "diagnostic-history-lines",
        x: "capturedAt",
        y: "value",
        z: "series",
        color: "series",
        key: (row) => `${row.capturedAt}:${row.series}`,
        strokeWidth: 1.5,
      }),
    ],
    scales: {
      x: { scale: scalePoint, axis: false },
      y: {
        scale: scaleLinear().domain([0, normalized ? 1 : maximum]),
        grid: true,
        axis: false,
      },
    },
    color: {
      domain: series.map(({ label }) => label),
      range: series.map(({ color }) => color),
    },
    margin: { top: 8, right: 8, bottom: 8, left: 8 },
    theme: chartTheme,
    focus: "group-x",
    focusRing: false,
    svgAnimation: false,
    tooltip: {
      use: tooltip,
      className: "palot-chart-tooltip",
      anchor: "group-center",
      placement: "auto",
      sort: "color-domain",
      content: historyTooltipContent,
    },
  });

  return (
    <div className="flex flex-col gap-3">
      <Chart
        definition={definition}
        height={180}
        initialWidth={480}
        ariaLabel={`${series.map(({ label }) => label).join(" and ")} history`}
      />
      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-meta text-muted-foreground">
        {series.map(({ label, color }) => (
          <div key={label} className="flex items-center gap-1.5">
            <span
              className="size-2 rounded-[2px]"
              style={{ backgroundColor: color }}
              aria-hidden="true"
            />
            {label}
          </div>
        ))}
      </div>
    </div>
  );
}

function ProcessTable({ snapshot }: { snapshot: DiagnosticsSnapshot }) {
  const processes = (snapshot.current.app?.processes ?? []).toSorted(
    (left, right) =>
      right.memory.workingSetSize - left.memory.workingSetSize || left.pid - right.pid,
  );
  if (processes.length === 0) {
    return (
      <SettingsEmpty>
        <span className="mb-1 block text-sm font-medium text-foreground">
          Waiting for Electron metrics
        </span>
        The collector has not returned a process snapshot yet.
      </SettingsEmpty>
    );
  }

  return (
    <Table className="text-compact">
      <TableHeader>
        <TableRow>
          <TableHead>Process</TableHead>
          <TableHead>Service</TableHead>
          <TableHead className="text-right">CPU</TableHead>
          <TableHead className="text-right">Memory</TableHead>
          <TableHead className="text-right">Peak</TableHead>
          <TableHead className="text-right">PID</TableHead>
          <TableHead className="text-right">Sandbox</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {processes.map((process) => (
          <TableRow key={`${process.pid}:${process.creationTime}`}>
            <TableCell className="font-medium">{process.type}</TableCell>
            <TableCell className="max-w-60 whitespace-normal text-muted-foreground wrap-anywhere">
              {process.serviceName ?? process.name ?? "-"}
            </TableCell>
            <TableCell className="text-right font-mono tabular-nums">
              {snapshot.current.cpuReady ? `${process.cpu.percentCPUUsage.toFixed(1)}%` : "-"}
            </TableCell>
            <TableCell className="text-right font-mono tabular-nums">
              {formatKiB(process.memory.workingSetSize)}
            </TableCell>
            <TableCell className="text-right font-mono tabular-nums text-muted-foreground">
              {formatKiB(process.memory.peakWorkingSetSize)}
            </TableCell>
            <TableCell className="text-right font-mono tabular-nums text-muted-foreground">
              {process.pid}
            </TableCell>
            <TableCell className="text-right text-muted-foreground">
              {process.sandboxed === null ? "Unknown" : process.sandboxed ? "Yes" : "No"}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function SystemCard({
  snapshot,
  runtime,
}: {
  snapshot: DiagnosticsSnapshot;
  runtime: DiagnosticsRuntimeSummary | null;
}) {
  const versions = snapshot.current.app?.versions;
  return (
    <Card className="@container/details min-w-0 rounded-xl border border-border ring-0">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Monitor className="size-4" aria-hidden="true" />
          Runtime
        </CardTitle>
        <CardDescription className="text-compact">
          Build identity and connected service state.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <DetailRow label="Palot" value={`${palotBuild.version} / ${palotBuild.channel}`} />
        <DetailRow
          label="Build"
          value={`${palotBuild.commitSha.slice(0, 12)} / ${palotBuild.buildNumber}${palotBuild.dirty ? " / dirty" : ""}`}
        />
        <DetailRow label="OpenCode contract" value={palotBuild.openCodeContractVersion} />
        <DetailRow label="Electron" value={versions?.electron ?? "Unavailable"} />
        <DetailRow label="Chromium" value={versions?.chromium ?? "Unavailable"} />
        <DetailRow label="Node" value={versions?.node ?? "Unavailable"} />
        <DetailRow
          label="Platform"
          value={versions ? `${versions.platform} / ${versions.architecture}` : "Unavailable"}
        />
        <DetailRow
          label="OpenCode"
          value={runtime ? `${runtime.version ?? "unknown"} / ${runtime.phase}` : "Unavailable"}
        />
        <DetailRow label="Window" value={windowStateLabel(snapshot.current.app?.window ?? null)} />
      </CardContent>
    </Card>
  );
}

function GpuCard({ snapshot }: { snapshot: DiagnosticsSnapshot }) {
  const app = snapshot.current.app;
  const features = Object.entries(app?.gpuFeatureStatus ?? {}).toSorted(([left], [right]) =>
    left.localeCompare(right),
  );
  return (
    <Card className="@container/details min-w-0 rounded-xl border border-border ring-0">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Gauge className="size-4" aria-hidden="true" />
          GPU and collection
        </CardTitle>
        <CardDescription className="text-compact">
          Capability status and the diagnostic observer's own cost.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <DetailRow
          label="Hardware acceleration"
          value={app ? (app.hardwareAcceleration ? "Enabled" : "Disabled") : "Unavailable"}
        />
        <DetailRow
          label="Collection time"
          value={formatMilliseconds(snapshot.collector.lastCollectionDurationMs)}
        />
        <DetailRow
          label="Average collection"
          value={formatMilliseconds(snapshot.collector.averageCollectionDurationMs)}
        />
        {features.length > 0 ? (
          features.map(([name, value]) => (
            <DetailRow key={name} label={sentenceCase(name.replaceAll("_", " "))} value={value} />
          ))
        ) : (
          <DetailRow label="GPU features" value="Waiting for snapshot" />
        )}
      </CardContent>
    </Card>
  );
}

function DetailRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="grid min-w-0 gap-1 border-t border-border py-3 first:border-t-0 @md/details:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] @md/details:gap-4">
      <span className="text-compact text-muted-foreground">{label}</span>
      <span className="min-w-0 font-mono text-code-compact tabular-nums wrap-anywhere @md/details:text-right">
        {value}
      </span>
    </div>
  );
}

function PhaseBadge({ phase }: { phase: DiagnosticsPhase }) {
  return (
    <Badge
      variant={phase === "live" ? "secondary" : phase === "degraded" ? "destructive" : "outline"}
    >
      {phase === "live" ? <CheckCircle2 data-icon="inline-start" aria-hidden="true" /> : null}
      {phase}
    </Badge>
  );
}

function CapabilityBadge({ label, enabled }: { label: string; enabled: boolean }) {
  return (
    <Badge variant={enabled ? "secondary" : "destructive"}>
      {label} {enabled ? "available" : "unavailable"}
    </Badge>
  );
}

function formatCpu(snapshot: DiagnosticsSnapshot): string {
  if (!snapshot.current.cpuReady) return "Warming";
  return snapshot.current.cpuPercent === null ? "-" : `${snapshot.current.cpuPercent.toFixed(1)}%`;
}

function formatKiB(value: number | null): string {
  if (value === null) return "-";
  const mib = value / 1_024;
  return `${mib.toFixed(mib >= 100 ? 0 : 1)} MiB`;
}

function formatMilliseconds(value: number | null | undefined): string {
  if (value === null || value === undefined) return "-";
  return `${value.toFixed(value >= 100 ? 0 : 1)} ms`;
}

function formatFps(value: number | null | undefined): string {
  return value === null || value === undefined ? "-" : value.toFixed(0);
}

function formatDuration(value: number): string {
  return value < 1_000 ? `${value} ms` : `${value / 1_000}s`;
}

function lastSampleLabel(value: number | null): string {
  if (value === null) return "Waiting for the first sample";
  return `Sampled at ${DIAGNOSTICS_TIME_FORMATTER.format(value)}`;
}

function formatChartTime(value: unknown): string {
  return typeof value === "number" ? DIAGNOSTICS_TIME_FORMATTER.format(value) : "Sample";
}

function historyChartRows(
  history: DiagnosticsSnapshot["history"],
  series: readonly HistorySeries[],
  normalize: boolean,
): HistoryChartRow[] {
  const ranges = new Map(
    series.map((item) => {
      const values = history.flatMap((point) => {
        const value = item.read(point);
        return value === null ? [] : [value];
      });
      return [
        item.label,
        {
          minimum: values.length ? Math.min(...values) : 0,
          maximum: values.length ? Math.max(...values) : 0,
        },
      ] as const;
    }),
  );

  return history.flatMap((point) =>
    series.flatMap((item) => {
      const rawValue = item.read(point);
      if (rawValue === null) return [];
      const range = ranges.get(item.label);
      const spread = range ? range.maximum - range.minimum : 0;
      const value = normalize
        ? spread > 0
          ? (rawValue - (range?.minimum ?? 0)) / spread
          : 0.5
        : rawValue;
      return [
        {
          capturedAt: point.capturedAt,
          series: item.label,
          value,
          displayValue: item.format(rawValue),
        },
      ];
    }),
  );
}

function historyTooltipContent(
  points: readonly ChartPoint<HistoryChartRow>[],
): ChartTooltipContent {
  return {
    title: formatChartTime(points[0]?.datum.capturedAt),
    rows: points.map((point) => ({
      label: point.datum.series,
      value: point.datum.displayValue,
      color: point.color,
    })),
  };
}

function windowStateLabel(
  windowState: DiagnosticsSnapshot["current"]["app"] extends infer _T
    ? NonNullable<DiagnosticsSnapshot["current"]["app"]>["window"]
    : never,
): string {
  if (!windowState) return "Unavailable";
  if (windowState.minimized) return "Minimized";
  if (!windowState.visible) return "Hidden";
  return windowState.focused ? "Visible / focused" : "Visible / inactive";
}

function sentenceCase(value: string): string {
  return value ? `${value[0]?.toUpperCase()}${value.slice(1)}` : value;
}

function showDiagnosticsError(title: string, cause: unknown) {
  toast.add({
    type: "error",
    title,
    description: cause instanceof Error ? cause.message : "The diagnostic action failed.",
  });
}
