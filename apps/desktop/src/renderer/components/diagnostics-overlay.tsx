import { Activity, Copy, ScanSearch, Settings2, X } from "lucide-react";
import { diagnostics } from "../lib/diagnostics-controller";
import { useDiagnostics } from "../hooks/use-diagnostics";
import { router } from "../router";
import { Button } from "./ui/button";
import { toast } from "./ui/toast";

export function DiagnosticsOverlay() {
  const snapshot = useDiagnostics("overlay");
  const renderer = snapshot.current.renderer;

  return (
    <aside
      data-palot-diagnostics-overlay
      aria-label="Diagnostics overlay"
      className="pointer-events-auto absolute top-[58px] right-3 w-[min(294px,calc(100vw-24px))] overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-2xl [contain:layout_paint_style]"
    >
      <header className="flex items-center gap-2 border-b border-border px-3 py-2.5">
        <Activity className="size-3.5 text-info" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-micro font-semibold tracking-[0.12em] uppercase">
              Diagnostics
            </span>
            <span className="font-mono text-micro text-muted-foreground tabular-nums">
              {snapshot.phase}
            </span>
          </div>
          <p className="mt-0.5 text-micro text-muted-foreground">Observer cost is included</p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label="Hide diagnostics overlay"
          onClick={() => diagnostics.setOverlayVisible(false)}
        >
          <X aria-hidden="true" />
        </Button>
      </header>
      <div className="grid grid-cols-2 divide-x divide-y divide-border/70">
        <OverlayMetric
          label="CPU"
          value={formatPercent(snapshot.current.cpuPercent, snapshot.current.cpuReady)}
        />
        <OverlayMetric label="Memory" value={formatMemory(snapshot.current.workingSetKiB)} />
        <OverlayMetric label="FPS" value={formatFps(renderer?.frames.fps)} />
        <OverlayMetric label="Frame p95" value={formatMilliseconds(renderer?.frames.p95)} />
        <OverlayMetric
          label="Long tasks"
          value={
            renderer
              ? `${renderer.longTasks.count} / ${formatMilliseconds(renderer.longTasks.max)}`
              : "-"
          }
        />
        <OverlayMetric
          label="React renders"
          value={renderer?.reactScan ? String(renderer.reactScan.renderCount) : "-"}
        />
        <OverlayMetric
          label="Stream p95"
          value={formatMilliseconds(renderer?.streamingLatency.p95)}
        />
        <OverlayMetric
          label="Collector"
          value={formatMilliseconds(snapshot.collector.lastCollectionDurationMs)}
        />
      </div>
      <footer className="flex items-center gap-1 border-t border-border px-2 py-2">
        <span className="mr-auto inline-flex min-w-0 items-center gap-1.5 px-1 text-micro text-muted-foreground">
          <ScanSearch className="size-3 shrink-0" aria-hidden="true" />
          <span className="truncate">
            React Scan {snapshot.preferences.reactScanActive ? "on" : "off"}
            {renderer?.reactScan?.fps ? ` / ${formatFps(renderer.reactScan.fps)} fps` : ""}
          </span>
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label="Copy diagnostics report"
          onClick={() => void copyReport()}
        >
          <Copy aria-hidden="true" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label="Open diagnostics settings"
          onClick={() => void router.navigate({ to: "/settings/diagnostics" })}
        >
          <Settings2 aria-hidden="true" />
        </Button>
      </footer>
    </aside>
  );
}

async function copyReport(): Promise<void> {
  try {
    await diagnostics.copySafeReport();
    toast.add({ type: "success", title: "Diagnostics copied" });
  } catch (error) {
    toast.add({
      type: "error",
      title: "Could not copy diagnostics",
      description: error instanceof Error ? error.message : "Clipboard access failed.",
    });
  }
}

function OverlayMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 px-3 py-2.5">
      <div className="truncate text-micro font-medium tracking-[0.08em] text-muted-foreground uppercase">
        {label}
      </div>
      <div className="mt-1 truncate font-mono text-xs font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function formatPercent(value: number | null, ready = true): string {
  if (!ready) return "warming";
  return value === null ? "-" : `${value.toFixed(1)}%`;
}

function formatMemory(value: number | null): string {
  return value === null ? "-" : `${(value / 1_024).toFixed(value >= 102_400 ? 0 : 1)} MiB`;
}

function formatMilliseconds(value: number | null | undefined): string {
  return value === null || value === undefined ? "-" : `${value.toFixed(value >= 100 ? 0 : 1)} ms`;
}

function formatFps(value: number | null | undefined): string {
  return value === null || value === undefined ? "-" : value.toFixed(0);
}
