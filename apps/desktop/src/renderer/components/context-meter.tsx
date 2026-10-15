/** Composer context meter, its popover, and the compact-before-send control. */

import type { TokenUsageInfo } from "@opencode/client";
import { useSetAtom } from "jotai";
import { ChevronDown, PanelRight, Shrink } from "lucide-react";
import { memo, useEffect, useState } from "react";
import { compactBeforeSendSuggestionAtom } from "../atoms/ui";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { InputGroupButton } from "./ui/input-group";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { Spinner } from "./ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

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
  /** The task's model is priced at zero, so a zero cost is not worth showing inline. */
  freeModel?: boolean;
  lastCompactedAt: number | null;
  compacting: boolean;
  /** Why Compact now is unavailable; null when it can run. */
  compactDisabledReason: string | null;
  onCompact(): void;
  onOpenDetails(): void;
}

/** A ring in the composer; hovering or pressing it opens the context summary and actions. */
export const ContextMeter = memo(function ContextMeter({
  usage,
  sessionTokens,
  cost,
  freeModel = false,
  lastCompactedAt,
  compacting,
  compactDisabledReason,
  onCompact,
  onOpenDetails,
}: ContextMeterProps) {
  const [open, setOpen] = useState(false);
  const percentage = usage && !usage.compacted ? usage.percentage : null;
  const status = contextStatus(percentage);
  const visualPercentage = Math.min(100, Math.max(0, percentage ?? 0));
  const wording = usage ? describeContextUsage(usage) : null;
  const processed = sumTokens(sessionTokens);
  const label = !usage
    ? "Context window: no usage yet"
    : usage.compacted
      ? "Context window: compacted"
      : (wording?.summary ?? "Context window");
  // Spend from earlier paid turns stays visible even after switching to a free model.
  const inlineCost = cost !== null && (cost > 0 || !freeModel) ? formatUsd(cost) : null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        openOnHover
        delay={150}
        closeDelay={150}
        render={
          <InputGroupButton
            type="button"
            size="composer"
            className="palot-context-trigger min-w-7 justify-center rounded-full px-1.5"
            aria-label={label}
            data-status={status}
          />
        }
      >
        <svg
          viewBox="0 0 20 20"
          data-status={status}
          className={cn(
            "size-4 shrink-0 -rotate-90",
            status === "critical"
              ? "text-destructive"
              : status === "warning"
                ? "text-warning"
                : "text-foreground/75",
          )}
          aria-hidden="true"
        >
          <circle
            cx="10"
            cy="10"
            r="7"
            pathLength="100"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            className="text-muted"
          />
          <circle
            cx="10"
            cy="10"
            r="7"
            pathLength="100"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeDasharray="100"
            strokeDashoffset={100 - visualPercentage}
            className="transition-[stroke-dashoffset] motion-reduce:transition-none"
          />
        </svg>
        {/* The popover carries the same figures for assistive tech; narrow composers keep the ring. */}
        <span
          aria-hidden="true"
          data-palot-context-label
          className="whitespace-nowrap pr-0.5 text-muted-foreground tabular-nums @max-[30rem]/composer:hidden"
        >
          {formatTokenCount(usage && !usage.compacted ? usage.total : 0)}
          {inlineCost ? (
            <>
              <span className="px-1 text-muted-foreground/60">·</span>
              {inlineCost}
            </>
          ) : null}
        </span>
      </PopoverTrigger>
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

/** Replaces Send while a large, idle task would re-read its whole history uncached. */
export function CompactAndSendControl({
  tokens,
  disabled,
  sending,
  onCompactAndSend,
  onSendWithoutCompacting,
}: {
  tokens: number;
  disabled: boolean;
  sending: boolean;
  onCompactAndSend(): void;
  onSendWithoutCompacting(): void;
}) {
  const setSuggestion = useSetAtom(compactBeforeSendSuggestionAtom);
  return (
    <div className="flex items-center overflow-hidden rounded-full" data-palot-compact-and-send>
      <Tooltip>
        <TooltipTrigger
          render={
            <InputGroupButton
              type="button"
              size="sm"
              className="h-7 rounded-r-none rounded-l-full bg-primary px-2.5 text-primary-foreground hover:bg-primary/90"
              aria-label="Compact and send"
              disabled={disabled}
              onClick={onCompactAndSend}
            />
          }
        >
          {sending ? <Spinner aria-hidden="true" /> : <Shrink aria-hidden="true" />}
          Compact and send
        </TooltipTrigger>
        <TooltipContent>
          {`Summarize ${formatTokenCount(tokens)} tokens of history, then send`}
        </TooltipContent>
      </Tooltip>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <InputGroupButton
              type="button"
              size="icon-sm"
              className="w-5 rounded-r-full rounded-l-none border-l border-primary-foreground/20 bg-primary px-0 text-primary-foreground hover:bg-primary/90"
              aria-label="More send options"
              disabled={sending}
            />
          }
        >
          <ChevronDown className="size-3" aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="end" sideOffset={6} className="w-60">
          <DropdownMenuItem disabled={disabled} onClick={onSendWithoutCompacting}>
            Send without compacting
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setSuggestion(false)}>
            Don&apos;t suggest again
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
