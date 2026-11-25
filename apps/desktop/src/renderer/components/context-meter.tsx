/** The composer's context pie, its popover, and the compact-before-send choices in it. */

import type { TokenUsageInfo } from "@opencode/client";
import { PanelRight, Shrink } from "lucide-react";
import { memo, useEffect, useState } from "react";
import { cn } from "../lib/cn";
import {
  compactSuggestionDueAt,
  compactSuggestionTokens,
  contextStatus,
  describeContextUsage,
  formatAgo,
  formatTokenCount,
  formatTokenExact,
  formatUsd,
  sumTokens,
  type CompactSuggestionInput,
  type ContextBreakdown,
  type ContextStatus,
  type ContextUsage,
} from "../lib/context-usage";
import { Button } from "./ui/button";
import { ComposerContextPie } from "./ui/composer";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { Spinner } from "./ui/spinner";

const SEGMENTS = [
  { key: "cached", label: "Cached input", swatch: "bg-muted-foreground/45" },
  { key: "uncached", label: "Uncached input", swatch: "bg-foreground/75" },
  { key: "output", label: "Output", swatch: "bg-primary" },
] as const satisfies ReadonlyArray<{ key: keyof ContextBreakdown; label: string; swatch: string }>;

const STATUS_TEXT: Record<ContextStatus, string> = {
  unavailable: "text-foreground",
  normal: "text-foreground",
  warning: "text-warning",
  critical: "text-destructive",
};

/**
 * The window split into cached input, uncached input, and output. Segment widths are shares of
 * the model's window when known, so the empty track is the room left.
 */
export function ContextBar({
  breakdown,
  limit,
  size = "sm",
  className,
}: {
  breakdown: ContextBreakdown;
  limit: number | null;
  size?: "sm" | "lg";
  className?: string;
}) {
  const total = breakdown.cached + breakdown.uncached + breakdown.output;
  const scale = Math.max(limit ?? 0, total, 1);
  const used = Math.min(100, Math.round((total / scale) * 100));
  return (
    <div
      role="meter"
      aria-label="Context window usage"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={used}
      aria-valuetext={SEGMENTS.map(
        (segment) => `${segment.label} ${formatTokenCount(breakdown[segment.key])}`,
      ).join(", ")}
      className={cn(
        "flex w-full overflow-hidden rounded-full bg-muted",
        size === "lg" ? "h-2.5" : "h-1.5",
        className,
      )}
    >
      {SEGMENTS.map((segment) =>
        breakdown[segment.key] > 0 ? (
          <div
            key={segment.key}
            className={cn("h-full", segment.swatch)}
            style={{ width: `${(breakdown[segment.key] / scale) * 100}%` }}
          />
        ) : null,
      )}
    </div>
  );
}

export function ContextLegend({
  breakdown,
  exact = false,
  className,
}: {
  breakdown: ContextBreakdown;
  exact?: boolean;
  className?: string;
}) {
  return (
    <ul className={cn("m-0 flex list-none flex-wrap gap-x-3 gap-y-1 p-0", className)}>
      {SEGMENTS.map((segment) => (
        <li key={segment.key} className="flex items-center gap-1.5 text-meta text-muted-foreground">
          <span className={cn("size-2 rounded-sm", segment.swatch)} aria-hidden="true" />
          <span>{segment.label}</span>
          <span className="text-foreground/80 tabular-nums">
            {exact
              ? formatTokenExact(breakdown[segment.key])
              : formatTokenCount(breakdown[segment.key])}
          </span>
        </li>
      ))}
    </ul>
  );
}

export interface ContextMeterProps {
  usage: ContextUsage | null;
  sessionTokens: TokenUsageInfo;
  cost: number | null;
  lastCompactedAt: number | null;
  compacting: boolean;
  /** Why Compact now is unavailable; null when it can run. */
  compactDisabledReason: string | null;
  onCompact(): void;
  onOpenDetails(): void;
}

/**
 * A pie in the composer row (its percentage shows from 70% full, in the warning colour from
 * 90%); hovering or pressing it opens the context summary and actions.
 */
export const ContextMeter = memo(function ContextMeter({
  usage,
  sessionTokens,
  cost,
  lastCompactedAt,
  compacting,
  compactDisabledReason,
  onCompact,
  onOpenDetails,
}: ContextMeterProps) {
  const [open, setOpen] = useState(false);
  const percentage = usage && !usage.compacted ? usage.percentage : null;
  const status = contextStatus(percentage);
  const wording = usage ? describeContextUsage(usage) : null;
  const processed = sumTokens(sessionTokens);
  const label = !usage
    ? "Context window: no usage yet"
    : usage.compacted
      ? "Context window: compacted"
      : (wording?.summary ?? "Context window");

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        openOnHover
        delay={150}
        closeDelay={150}
        render={
          <ComposerContextPie
            value={(percentage ?? 0) / 100}
            aria-label={label}
            data-status={status}
            data-palot-context-meter
          />
        }
      />
      <PopoverContent side="top" align="end" sideOffset={8} className="w-72 gap-3 p-3">
        <section aria-label="Context window" className="flex flex-col gap-2">
          {usage && !usage.compacted && wording ? (
            <>
              <div className="flex flex-col gap-0.5">
                <p className={cn("m-0 text-compact font-medium", STATUS_TEXT[status])}>
                  {wording.summary}
                </p>
                <p className="m-0 text-meta text-muted-foreground tabular-nums">{wording.detail}</p>
              </div>
              <ContextBar breakdown={usage.breakdown} limit={usage.limit} />
              <ContextLegend breakdown={usage.breakdown} />
            </>
          ) : (
            <p className="m-0 text-compact text-muted-foreground">
              {usage?.compacted
                ? "Context compacted. Usage updates after the next reply."
                : "No model replies yet. Usage appears after the first reply."}
            </p>
          )}
        </section>
        <dl className="m-0 grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-meta">
          <dt className="text-muted-foreground">Session cost</dt>
          <dd className="m-0 text-right font-medium tabular-nums">
            {cost === null ? "Unavailable" : formatUsd(cost)}
          </dd>
          <dt className="text-muted-foreground">Total processed</dt>
          <dd className="m-0 text-right tabular-nums">{formatTokenCount(processed)} tokens</dd>
          {lastCompactedAt !== null ? (
            <>
              <dt className="text-muted-foreground">Last compacted</dt>
              <dd className="m-0 text-right tabular-nums">{formatAgo(lastCompactedAt)}</dd>
            </>
          ) : null}
        </dl>
        <div className="flex flex-col gap-1.5">
          <div className="flex gap-1.5">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="flex-1"
              disabled={compactDisabledReason !== null}
              aria-describedby={compactDisabledReason ? "context-meter-compact-reason" : undefined}
              onClick={() => {
                setOpen(false);
                onCompact();
              }}
            >
              {compacting ? <Spinner aria-hidden="true" /> : <Shrink aria-hidden="true" />}
              {compacting ? "Compacting…" : "Compact now"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="flex-1"
              onClick={() => {
                setOpen(false);
                onOpenDetails();
              }}
            >
              <PanelRight aria-hidden="true" />
              Context details
            </Button>
          </div>
          {compactDisabledReason ? (
            <p id="context-meter-compact-reason" className="m-0 text-meta text-muted-foreground">
              {compactDisabledReason}
            </p>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
});

/**
 * Tokens to summarize before the next send, re-evaluated when the task's idle time crosses
 * the cache-expiry threshold.
 */
export function useCompactSuggestion(input: Omit<CompactSuggestionInput, "now">): number | null {
  const [now, setNow] = useState(() => Date.now());
  const dueAt = compactSuggestionDueAt(input);
  useEffect(() => {
    if (dueAt === null) return;
    const delay = dueAt - Date.now();
    if (delay <= 0) {
      setNow(Date.now());
      return;
    }
    const timer = window.setTimeout(() => setNow(Date.now()), Math.min(delay, 2_147_483_647));
    return () => window.clearTimeout(timer);
  }, [dueAt]);
  return compactSuggestionTokens({ ...input, now });
}
