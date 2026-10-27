import type { UsageLimitsBudget, UsageLimitsMeter } from "@opencode/client";
import { RefreshCw } from "lucide-react";
import { useAtomValue } from "jotai";
import { useEffect, useState } from "react";
import { runtimeAtom } from "../../atoms/workspace";
import { useUsageLimits } from "../../hooks/use-usage-limits";
import {
  budgetSummary,
  formatResetsIn,
  GO_WINDOWS,
  usagePace,
  type GoWindow,
} from "../../lib/usage-limits";
import { palot } from "../../services/palot";
import { Badge } from "../ui/badge";
import { Banner } from "../ui/banner";
import { Button } from "../ui/button";
import { Skeleton } from "../ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";

export function UsageLimitsSection({ directory }: { directory: string }) {
  const runtime = useAtomValue(runtimeAtom);
  const limits = useUsageLimits(directory);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  const info = limits.data && limits.data !== "unavailable" ? limits.data : null;
  return (
    <section aria-label="Limits" className="mb-8 min-w-0 rounded-xl border border-border/75 p-5">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-medium">Limits</h2>
          <p className="text-meta text-muted-foreground">
            {info?.workspace.name ?? "OpenCode Console"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {info ? (
            <Button
              variant="link"
              size="sm"
              render={<a href={info.workspace.usageURL} />}
              onClick={(event) => {
                event.preventDefault();
                void palot.openExternalUrl(info.workspace.usageURL);
              }}
            >
              Manage usage ↗
            </Button>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Refresh limits"
            disabled={
              !directory || runtime?.connected !== true || limits.unavailable || limits.isFetching
            }
            onClick={() => void limits.refetch()}
          >
            <RefreshCw className={limits.isFetching ? "animate-spin" : undefined} />
          </Button>
        </div>
      </header>
      {limits.unavailable ? (
        <p className="text-sm text-muted-foreground">
          Limits need OpenCode 2.2.0 or newer on this server.
        </p>
      ) : !info && runtime?.connected !== true ? (
        <p className="text-sm text-muted-foreground">Reconnect OpenCode to see plan limits.</p>
      ) : !directory ? (
        <p className="text-sm text-muted-foreground">Choose a project to see plan limits.</p>
      ) : limits.isPending ? (
        <div role="status" aria-label="Loading limits">
          <Skeleton className="h-32 w-full" />
        </div>
      ) : limits.data === null ? (
        <p className="text-sm text-muted-foreground">
          Sign in to OpenCode Console on this server to see plan limits.
        </p>
      ) : info ? (
        <div className="grid gap-4">
          {info.go ? (
            <div className="grid gap-3 @min-[38rem]/usage:grid-cols-3">
              {GO_WINDOWS.map(({ id, label }) => (
                <GoLimitCard key={id} window={id} label={label} meter={info.go![id]} now={now} />
              ))}
            </div>
          ) : null}
          {info.budgets.map((budget) => (
            <BudgetLimitRow key={budget.id} budget={budget} now={now} />
          ))}
          {!info.go && !info.budgets.length ? (
            <p className="text-sm text-muted-foreground">
              No plan limits or budgets are set for this workspace.
            </p>
          ) : null}
          {runtime?.connected !== true ? (
            <p className="text-meta text-muted-foreground">
              Cached limits · Reconnect OpenCode to update.
            </p>
          ) : null}
        </div>
      ) : null}
      <Banner
        open={Boolean(limits.error)}
        status="error"
        className="mt-3"
        title={info ? "Could not refresh limits" : "Could not load limits"}
        actions={
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={runtime?.connected !== true || limits.isFetching}
            onClick={() => void limits.refetch()}
          >
            Retry limits
          </Button>
        }
      >
        {limits.error?.message}
      </Banner>
    </section>
  );
}

function GoLimitCard({
  window,
  label,
  meter,
  now,
}: {
  window: GoWindow;
  label: string;
  meter: UsageLimitsMeter;
  now: number;
}) {
  const pace = usagePace(window, meter.percent, meter.resetsAt, now);
  return (
    <article className="min-w-0 rounded-lg border border-border/70 p-4" aria-label={label}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-compact font-medium">{label}</h3>
        {meter.limited ? <Badge variant="warning">Limited</Badge> : null}
      </div>
      <p className="mt-3 text-page-title font-medium tabular-nums">
        {Math.round(pace.remaining)}% left
      </p>
      <LimitBar
        label={`${label} remaining`}
        percent={pace.remaining}
        tick={pace.evenPaceRemaining}
        warning={meter.limited}
      />
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-meta text-muted-foreground">
        <Tooltip>
          <TooltipTrigger render={<span tabIndex={0} />}>{pace.label}</TooltipTrigger>
          <TooltipContent>{pace.hint}</TooltipContent>
        </Tooltip>
        <ResetTime resetsAt={meter.resetsAt} now={now} />
      </div>
    </article>
  );
}

function BudgetLimitRow({ budget, now }: { budget: UsageLimitsBudget; now: number }) {
  const summary = budgetSummary(budget);
  return (
    <article aria-label="Monthly budget" className="min-w-0 rounded-lg border border-border/70 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium tabular-nums">{summary.amount}</h3>
        <div className="flex items-center gap-2 text-meta text-muted-foreground">
          {summary.reached ? <Badge variant="warning">Limited</Badge> : null}
          <ResetTime resetsAt={budget.resetsAt} now={now} />
        </div>
      </div>
      <LimitBar
        label="Monthly budget spent"
        percent={summary.percentUsed}
        warning={summary.reached}
      />
      <div className="mt-3 flex flex-wrap gap-1.5">
        {summary.chips.map((chip) => (
          <Badge key={chip} variant="neutral" className="max-w-full" title={chip}>
            <span className="truncate">{chip}</span>
          </Badge>
        ))}
      </div>
      {budget.per === "model" ? (
        <p className="mt-2 text-meta text-muted-foreground">
          Spend shown for the model with the most usage.
        </p>
      ) : null}
      {summary.shared ? (
        <p className="mt-2 text-meta text-muted-foreground">{summary.shared}</p>
      ) : null}
    </article>
  );
}

function LimitBar({
  label,
  percent,
  tick,
  warning,
}: {
  label: string;
  percent: number;
  tick?: number;
  warning: boolean;
}) {
  return (
    <div
      className="relative h-2 rounded-full bg-muted"
      role="progressbar"
      aria-label={label}
      aria-valuenow={Math.round(percent)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className={`h-full rounded-full ${warning ? "bg-warning/35" : "bg-primary/35"}`}
        style={{ width: `${percent}%` }}
      />
      {tick === undefined ? null : (
        <span
          aria-hidden="true"
          className="absolute -top-0.5 h-3 w-px bg-foreground/65"
          style={{ left: `${tick}%` }}
        />
      )}
    </div>
  );
}

function ResetTime({ resetsAt, now }: { resetsAt: number; now: number }) {
  return (
    <Tooltip>
      <TooltipTrigger render={<time dateTime={new Date(resetsAt).toISOString()} tabIndex={0} />}>
        {formatResetsIn(resetsAt, now)}
      </TooltipTrigger>
      <TooltipContent>Resets {new Date(resetsAt).toLocaleString()}</TooltipContent>
    </Tooltip>
  );
}
