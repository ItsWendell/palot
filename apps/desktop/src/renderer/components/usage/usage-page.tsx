import { useNavigate, useRouterState } from "@tanstack/react-router";
import type { SessionStatsInfo, SessionStatsModelUsage } from "@opencode/client";
import type { PalotModel, PalotProvider } from "../../../shared";
import { BarChart3, RefreshCw, TriangleAlert } from "lucide-react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useEffect, useMemo, useState } from "react";
import { runtimeAtom } from "../../atoms/workspace";
import { usageRangeAtom, usageToolDetailsOpenAtom } from "../../atoms/ui";
import { useModelCatalog } from "../../hooks/use-model-catalog";
import { useSessionStats } from "../../hooks/use-session-stats";
import { useProjectCatalogState } from "../../hooks/use-session-catalog";
import {
  isUsageRangeDays,
  USAGE_RANGE_OPTIONS,
  validateUsageSearch,
  type UsageRangeDays,
} from "../../lib/route-search";
import { formatUsageDateRange, usageDateRange } from "../../lib/session-stats-range";
import { orderProjects, projectLocation, visibleProjects } from "../../lib/view-models";
import { ProjectSelect } from "../project-select";
import { Alert, AlertDescription, AlertTitle } from "../ui/alert";
import { Button } from "../ui/button";
import { Skeleton } from "../ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";
import { ToggleGroup, ToggleGroupItem } from "../ui/toggle-group";
import { UsageActivityChart } from "./usage-activity-chart";

type ModelSort = "cost" | "tokens" | "steps";

const CURRENCY = new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" });
const NUMBER = new Intl.NumberFormat(undefined);
const COMPACT = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });
const PERCENT = new Intl.NumberFormat(undefined, { style: "percent", maximumFractionDigits: 0 });
const UPDATED = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

export function UsagePage() {
  const search = useRouterState({
    select: (state) => validateUsageSearch(state.location.search as Record<string, unknown>),
  });
  const navigate = useNavigate();
  const runtime = useAtomValue(runtimeAtom);
  const setUsageRange = useSetAtom(usageRangeAtom);
  const projectCatalog = useProjectCatalogState();
  const projects = projectCatalog.projects;
  const visible = useMemo(() => visibleProjects(orderProjects(projects, [])), [projects]);
  const selectedProject = visible.find((project) => project.id === search.projectID) ?? null;
  const modelCatalog = useModelCatalog(
    { directory: selectedProject ? projectLocation(selectedProject) : "" },
    Boolean(selectedProject),
  );
  const [rangeAnchorMs, setRangeAnchorMs] = useState(() => Date.now());
  const [freshnessNowMs, setFreshnessNowMs] = useState(() => Date.now());
  const [lastSuccessfulUpdateAt, setLastSuccessfulUpdateAt] = useState(0);
  const [modelSort, setModelSort] = useState<ModelSort>("cost");
  const [toolDetailsOpen, setToolDetailsOpen] = useAtom(usageToolDetailsOpenAtom);
  const range = useMemo(
    () => usageDateRange(search.days, rangeAnchorMs),
    [rangeAnchorMs, search.days],
  );
  const projectScopeReady = !search.projectID || (projectCatalog.ready && Boolean(selectedProject));
  const summaryInput = useMemo(
    () => ({
      from: range.from,
      to: range.to,
      timezone: range.timezone,
      tools: "summary" as const,
      ...(search.projectID ? { project: search.projectID } : {}),
    }),
    [range.from, range.timezone, range.to, search.projectID],
  );
  const detailInput = useMemo(
    () => ({ ...summaryInput, tools: "detail" as const }),
    [summaryInput],
  );
  const summary = useSessionStats(summaryInput, projectScopeReady);
  const details = useSessionStats(detailInput, toolDetailsOpen && projectScopeReady);
  const data = summary.data;
  const projectScopeError = search.projectID ? projectCatalog.error : null;
  const displayedUpdateAt = summary.dataUpdatedAt || lastSuccessfulUpdateAt;

  useEffect(() => {
    const delay = Math.max(1_000, range.to - Date.now() + 1_000);
    const timer = setTimeout(() => setRangeAnchorMs(Date.now()), delay);
    return () => clearTimeout(timer);
  }, [range.to]);

  useEffect(() => {
    if (summary.dataUpdatedAt > 0) setLastSuccessfulUpdateAt(summary.dataUpdatedAt);
  }, [summary.dataUpdatedAt]);

  useEffect(() => {
    const timer = setInterval(() => setFreshnessNowMs(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (projectCatalog.ready && search.projectID && !selectedProject) {
      void navigate({ to: "/usage", search: { days: search.days }, replace: true });
    }
  }, [navigate, projectCatalog.ready, search.days, search.projectID, selectedProject]);

  const updateSearch = (input: { days?: UsageRangeDays; projectID?: string | null }) =>
    navigate({
      to: "/usage",
      search: {
        days: input.days ?? search.days,
        ...((input.projectID === undefined ? search.projectID : input.projectID)
          ? { projectID: input.projectID === undefined ? search.projectID : input.projectID! }
          : {}),
      },
      replace: true,
    });

  return (
    <main
      className="palot-main-surface @container/usage relative size-full min-h-0 min-w-0 overflow-hidden bg-background"
      aria-label="Usage"
    >
      <div className="window-drag h-(--shell-header-height) shrink-0" aria-hidden="true" />
      <div className="palot-native-scrollbar h-[calc(100%-var(--shell-header-height))] overflow-y-auto px-6 pb-16 @max-[42rem]/usage:px-3">
        <div className="mx-auto w-full max-w-5xl pt-5">
          <header className="mb-7 flex flex-wrap items-start gap-4 px-2">
            <div className="min-w-0 flex-1">
              <h1 className="text-page-title/tight font-medium tracking-[-0.035em]">Usage</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {data
                  ? `${formatUsageDateRange({ ...data.range, timezone: range.timezone })} · ${updatedLabel(displayedUpdateAt, freshnessNowMs)}${runtime?.connected === false ? " · Cached" : ""}`
                  : "Local OpenCode activity, model usage, and tool reliability."}
                {(summary.isFetching || summary.isPlaceholderData) && data ? " · Updating" : ""}
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <ProjectSelect
                projects={visible}
                value={selectedProject?.id ?? null}
                onValueChange={(projectID) => void updateSearch({ projectID })}
                ariaLabel="Filter usage by project"
                allLabel="All projects"
              />
              <ToggleGroup
                value={[String(search.days)]}
                onValueChange={(values) => {
                  const days = Number(values[0]);
                  if (isUsageRangeDays(days)) {
                    setUsageRange(days);
                    void updateSearch({ days });
                  }
                }}
                variant="outline"
                size="sm"
                aria-label="Usage date range"
              >
                {USAGE_RANGE_OPTIONS.map((days) => (
                  <ToggleGroupItem
                    key={days}
                    value={String(days)}
                    aria-label={days === 1 ? "24 hours" : `${days} days`}
                  >
                    {days === 1 ? "24h" : `${days}d`}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Refresh usage"
                disabled={runtime?.connected !== true || summary.isFetching}
                onClick={() => void summary.refetch()}
              >
                <RefreshCw className={summary.isFetching ? "animate-spin" : undefined} />
              </Button>
            </div>
          </header>

          {!data && runtime?.connected === false ? <UsageUnavailable /> : null}
          {!data && runtime?.connected !== false && projectScopeError ? (
            <UsageError
              message={projectScopeError.message}
              retry={() => void projectCatalog.refetch()}
            />
          ) : null}
          {!data && runtime?.connected !== false && !projectScopeError && summary.isPending ? (
            <UsageSkeleton />
          ) : null}
          {!data && runtime?.connected !== false && !projectScopeError && summary.error ? (
            <UsageError message={summary.error.message} retry={() => void summary.refetch()} />
          ) : null}
          {data ? (
            <>
              {summary.isPlaceholderData ? (
                <div
                  role="status"
                  className="mb-5 rounded-lg border border-border/70 bg-muted/35 px-3 py-2 text-xs text-muted-foreground"
                >
                  Showing the previous selection while this usage scope updates.
                </div>
              ) : null}
              <UsageContent
                data={data}
                catalogModels={modelCatalog.data?.models ?? []}
                catalogProviders={modelCatalog.data?.providers ?? []}
                timezone={range.timezone}
                modelSort={modelSort}
                onModelSortChange={setModelSort}
                toolDetailsOpen={toolDetailsOpen}
                onToolDetailsOpenChange={setToolDetailsOpen}
                detailData={details.isPlaceholderData ? null : (details.data ?? null)}
                detailPending={details.isFetching}
                detailError={details.error?.message ?? null}
                detailWaitingForConnection={
                  runtime?.connected !== true && details.isPlaceholderData
                }
                toolDetailsDisabled={
                  runtime?.connected !== true && (!details.data || details.isPlaceholderData)
                }
                detailRetryDisabled={runtime?.connected !== true}
                retryDetails={() => void details.refetch()}
              />
            </>
          ) : null}
          {data && summary.error ? (
            <Alert className="mt-5">
              <TriangleAlert aria-hidden="true" />
              <AlertTitle>Showing cached usage</AlertTitle>
              <AlertDescription>
                The latest background refresh failed. Refresh to try again.
              </AlertDescription>
            </Alert>
          ) : null}
        </div>
      </div>
    </main>
  );
}

function UsageContent({
  data,
  catalogModels,
  catalogProviders,
  timezone,
  modelSort,
  onModelSortChange,
  toolDetailsOpen,
  onToolDetailsOpenChange,
  detailData,
  detailPending,
  detailError,
  detailWaitingForConnection,
  toolDetailsDisabled,
  detailRetryDisabled,
  retryDetails,
}: {
  data: SessionStatsInfo;
  catalogModels: readonly PalotModel[];
  catalogProviders: readonly PalotProvider[];
  timezone: string;
  modelSort: ModelSort;
  onModelSortChange(value: ModelSort): void;
  toolDetailsOpen: boolean;
  onToolDetailsOpenChange(value: boolean): void;
  detailData: SessionStatsInfo | null;
  detailPending: boolean;
  detailError: string | null;
  detailWaitingForConnection: boolean;
  toolDetailsDisabled: boolean;
  detailRetryDisabled: boolean;
  retryDetails(): void;
}) {
  const modelTokens = modelTokenTotal(data.tokens);
  const models = useMemo(() => sortModels(data.models, modelSort), [data.models, modelSort]);
  const providers = useMemo(() => summarizeProviders(data.models), [data.models]);
  const toolTotals = data.tools.mode === "none" ? null : data.tools.totals;
  const toolUsage = detailData?.tools.mode === "detail" ? detailData.tools.usage : [];

  return (
    <div className="flex flex-col gap-8">
      <section className="overflow-hidden rounded-2xl border border-border/75 bg-card/55">
        <div className="grid @min-[42rem]/usage:grid-cols-2">
          <div className="border-b border-border/70 p-6 @min-[42rem]/usage:border-r">
            <div className="text-xs text-muted-foreground">Reported cost</div>
            <div className="mt-2 text-4xl font-semibold tracking-[-0.05em] tabular-nums">
              {CURRENCY.format(data.cost)}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              Aggregate model cost returned by OpenCode
            </div>
          </div>
          <div className="border-b border-border/70 p-6">
            <div className="text-xs text-muted-foreground">Model tokens</div>
            <div className="mt-2 text-4xl font-semibold tracking-[-0.05em] tabular-nums">
              {COMPACT.format(modelTokens)}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {NUMBER.format(modelTokens)} input, output, and reasoning tokens
            </div>
          </div>
        </div>
        <div className="border-b border-border/70 p-5">
          <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
            <UsageSectionHeading
              title="Token composition"
              description="Cache activity is reported separately from model-token totals."
            />
            <TokenCompositionBar tokens={data.tokens} />
          </div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-4 @min-[34rem]/usage:grid-cols-5">
            <UsageValue label="Input" value={COMPACT.format(data.tokens.input)} />
            <UsageValue label="Output" value={COMPACT.format(data.tokens.output)} />
            <UsageValue label="Reasoning" value={COMPACT.format(data.tokens.reasoning)} />
            <UsageValue label="Cache read" value={COMPACT.format(data.tokens.cache.read)} />
            <UsageValue label="Cache write" value={COMPACT.format(data.tokens.cache.write)} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-4 p-5 @min-[42rem]/usage:grid-cols-6">
          <UsageValue label="Sessions" value={NUMBER.format(data.sessions)} compact />
          <UsageValue label="Prompts" value={NUMBER.format(data.prompts)} compact />
          <UsageValue label="Subagents" value={NUMBER.format(data.subagents)} compact />
          <UsageValue label="Active days" value={NUMBER.format(data.activeDays)} compact />
          <UsageValue label="Day streak" value={NUMBER.format(data.streak)} compact />
          <UsageValue label="Steps" value={NUMBER.format(data.steps)} compact />
        </div>
      </section>

      <section className="grid gap-5 @min-[52rem]/usage:grid-cols-[minmax(15rem,0.72fr)_minmax(0,1.4fr)]">
        <div className="min-w-0 rounded-xl border border-border/75 p-5">
          <UsageSectionHeading
            title="Providers"
            description="Share of reported cost"
            className="mb-4"
          />
          {providers.length ? (
            <div className="flex flex-col gap-4">
              {providers.map((provider) => (
                <ProviderUsageRow
                  key={provider.providerID}
                  provider={provider}
                  displayName={
                    catalogProviders.find((candidate) => candidate.id === provider.providerID)
                      ?.name ?? provider.providerID
                  }
                  totalCost={data.cost}
                />
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No provider usage in this range.</p>
          )}
        </div>
        <div className="min-w-0 rounded-xl border border-border/75 p-5">
          <div className="mb-3 flex items-center justify-between gap-4">
            <UsageSectionHeading
              title="Daily activity"
              description="Steps are the only daily series returned by OpenCode."
            />
            <BarChart3 className="size-4 text-info" aria-hidden="true" />
          </div>
          <UsageActivityChart
            activity={data.activity}
            from={data.range.from}
            to={data.range.to}
            timezone={timezone}
          />
        </div>
      </section>

      <section className="min-w-0">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3 px-1">
          <UsageSectionHeading
            title="Models"
            description="Cost, model tokens, cache activity, and supporting step counts"
          />
          <ToggleGroup
            value={[modelSort]}
            onValueChange={(values) => {
              const value = values[0];
              if (value === "cost" || value === "tokens" || value === "steps")
                onModelSortChange(value);
            }}
            variant="outline"
            size="sm"
            aria-label="Sort model usage"
          >
            <ToggleGroupItem value="cost">Cost</ToggleGroupItem>
            <ToggleGroupItem value="tokens">Tokens</ToggleGroupItem>
            <ToggleGroupItem value="steps">Steps</ToggleGroupItem>
          </ToggleGroup>
        </div>
        <div className="hidden overflow-x-auto rounded-xl border border-border/75 @min-[44rem]/usage:block">
          <Table className="min-w-[46rem]">
            <TableHeader>
              <TableRow>
                <TableHead>Model</TableHead>
                <TableHead className="text-right">Cost</TableHead>
                <TableHead className="text-right">Model tokens</TableHead>
                <TableHead className="text-right">Cache read</TableHead>
                <TableHead className="text-right">Steps</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {models.length ? (
                models.map((item) => (
                  <ModelUsageRow
                    key={`${item.model.providerID}/${item.model.id}/${item.model.variant ?? ""}`}
                    usage={item}
                    models={catalogModels}
                    providers={catalogProviders}
                    totalCost={data.cost}
                    totalModelTokens={modelTokens}
                  />
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={5} className="h-20 text-center text-muted-foreground">
                    No model usage in this range.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
        <div className="grid gap-2 @min-[44rem]/usage:hidden">
          {models.length ? (
            models.map((item) => (
              <ModelUsageCard
                key={`${item.model.providerID}/${item.model.id}/${item.model.variant ?? ""}`}
                usage={item}
                models={catalogModels}
                providers={catalogProviders}
                totalCost={data.cost}
                totalModelTokens={modelTokens}
              />
            ))
          ) : (
            <div className="rounded-xl border border-border/75 p-5 text-center text-sm text-muted-foreground">
              No model usage in this range.
            </div>
          )}
        </div>
      </section>

      <section className="min-w-0 rounded-xl border border-border/75 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <UsageSectionHeading
            title="Tool reliability"
            description="Completed and unfinished tool calls"
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={toolDetailsDisabled}
            aria-expanded={toolDetailsOpen}
            aria-controls="usage-tool-details"
            onClick={() => onToolDetailsOpenChange(!toolDetailsOpen)}
          >
            {toolDetailsOpen ? "Hide details" : "Show details"}
          </Button>
        </div>
        {toolTotals ? (
          <div className="mt-5 grid grid-cols-2 gap-4 @min-[34rem]/usage:grid-cols-4">
            <UsageValue label="Calls" value={NUMBER.format(toolTotals.calls)} />
            <UsageValue label="Succeeded" value={NUMBER.format(toolTotals.succeeded)} />
            <UsageValue label="Failed" value={NUMBER.format(toolTotals.failed)} />
            <UsageValue label="Unfinished" value={NUMBER.format(toolTotals.unfinished)} />
          </div>
        ) : (
          <p className="mt-4 text-sm text-muted-foreground">Tool totals are unavailable.</p>
        )}
        <div
          id="usage-tool-details"
          hidden={!toolDetailsOpen}
          aria-live="polite"
          aria-busy={toolDetailsOpen && detailPending}
          className="mt-5 border-t border-border/70 pt-4"
        >
          {toolDetailsOpen ? (
            <>
              <p className="sr-only" role="status">
                {detailPending
                  ? "Loading tool details."
                  : detailError
                    ? "Tool details could not be loaded."
                    : detailData
                      ? `Tool details loaded for ${toolUsage.length} ${toolUsage.length === 1 ? "tool" : "tools"}.`
                      : ""}
              </p>
              {detailPending && !detailData ? <Skeleton className="h-24 w-full" /> : null}
              {detailWaitingForConnection ? (
                <p className="text-sm text-muted-foreground">
                  Reconnect OpenCode to update tool details for this scope.
                </p>
              ) : null}
              {detailError ? (
                <div className="flex items-center justify-between gap-3 text-sm text-destructive">
                  <span>Could not load tool details.</span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={detailRetryDisabled}
                    onClick={retryDetails}
                  >
                    Retry
                  </Button>
                </div>
              ) : null}
              {toolUsage.length ? (
                <div className="grid gap-2">
                  {toolUsage.map((tool) => (
                    <div
                      key={tool.name}
                      className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-lg bg-muted/45 px-3 py-2 text-sm"
                    >
                      <span className="truncate font-mono text-xs">{tool.name}</span>
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {tool.calls} calls · {tool.succeeded} succeeded · {tool.failed} failed ·{" "}
                        {tool.unfinished} unfinished
                        {tool.durationP50 === undefined
                          ? ""
                          : ` · ${Math.round(tool.durationP50)} ms p50`}
                      </span>
                    </div>
                  ))}
                </div>
              ) : null}
              {!detailPending && !detailError && detailData && toolUsage.length === 0 ? (
                <p className="text-sm text-muted-foreground">No per-tool usage in this range.</p>
              ) : null}
            </>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function ModelUsageRow({
  usage,
  models,
  providers,
  totalCost,
  totalModelTokens,
}: {
  usage: SessionStatsModelUsage;
  models: readonly PalotModel[];
  providers: readonly PalotProvider[];
  totalCost: number;
  totalModelTokens: number;
}) {
  const identity = modelUsageIdentity(usage, models, providers);
  const tokens = modelTokenTotal(usage.tokens);
  return (
    <TableRow>
      <TableCell>
        <div className="font-medium">{identity.modelName}</div>
        <div className="text-meta text-muted-foreground">
          {identity.providerName} · {usage.model.id}
          {usage.model.variant ? ` · ${usage.model.variant}` : ""}
        </div>
      </TableCell>
      <TableCell className="text-right tabular-nums">
        <div>{CURRENCY.format(usage.cost)}</div>
        <div className="text-micro text-muted-foreground">
          {formatShare(usage.cost, totalCost)} of cost
        </div>
      </TableCell>
      <TableCell className="text-right tabular-nums">
        <div>{COMPACT.format(tokens)}</div>
        <div className="text-micro text-muted-foreground">
          {COMPACT.format(usage.tokens.input)} in · {COMPACT.format(usage.tokens.output)} out
          {usage.tokens.reasoning > 0
            ? ` · ${COMPACT.format(usage.tokens.reasoning)} reasoning`
            : ""}
        </div>
        <div className="text-micro text-muted-foreground">
          {formatShare(tokens, totalModelTokens)} of model tokens
        </div>
      </TableCell>
      <TableCell className="text-right tabular-nums">
        <div>{COMPACT.format(usage.tokens.cache.read)}</div>
        <div className="text-micro text-muted-foreground">
          {COMPACT.format(usage.tokens.cache.write)} write
        </div>
      </TableCell>
      <TableCell className="text-right tabular-nums">{NUMBER.format(usage.steps)}</TableCell>
    </TableRow>
  );
}

function ModelUsageCard({
  usage,
  models,
  providers,
  totalCost,
  totalModelTokens,
}: {
  usage: SessionStatsModelUsage;
  models: readonly PalotModel[];
  providers: readonly PalotProvider[];
  totalCost: number;
  totalModelTokens: number;
}) {
  const identity = modelUsageIdentity(usage, models, providers);
  const tokens = modelTokenTotal(usage.tokens);
  return (
    <article className="rounded-xl border border-border/75 p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-medium">{identity.modelName}</h3>
          <p className="truncate text-meta text-muted-foreground">
            {identity.providerName} · {usage.model.id}
            {usage.model.variant ? ` · ${usage.model.variant}` : ""}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-sm font-medium tabular-nums">{CURRENCY.format(usage.cost)}</div>
          <div className="text-micro text-muted-foreground">
            {formatShare(usage.cost, totalCost)} of cost
          </div>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-x-5 gap-y-3">
        <UsageValue label="Model tokens" value={COMPACT.format(tokens)} compact />
        <UsageValue
          label="Cache read / write"
          value={`${COMPACT.format(usage.tokens.cache.read)} / ${COMPACT.format(usage.tokens.cache.write)}`}
          compact
        />
        <UsageValue label="Steps" value={NUMBER.format(usage.steps)} compact />
        <UsageValue label="Token share" value={formatShare(tokens, totalModelTokens)} compact />
      </div>
      <p className="mt-3 text-meta text-muted-foreground tabular-nums">
        {COMPACT.format(usage.tokens.input)} input · {COMPACT.format(usage.tokens.output)} output
        {usage.tokens.reasoning > 0 ? ` · ${COMPACT.format(usage.tokens.reasoning)} reasoning` : ""}
      </p>
    </article>
  );
}

function ProviderUsageRow({
  provider,
  displayName,
  totalCost,
}: {
  provider: ProviderUsageSummary;
  displayName: string;
  totalCost: number;
}) {
  const share = totalCost > 0 ? provider.cost / totalCost : 0;
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-4">
        <div className="min-w-0 truncate text-sm font-medium">{displayName}</div>
        <div className="shrink-0 text-sm font-medium tabular-nums">
          {CURRENCY.format(provider.cost)}
        </div>
      </div>
      <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted" aria-hidden="true">
        <div className="h-full rounded-full bg-primary" style={{ width: `${share * 100}%` }} />
      </div>
      <div className="mt-1 flex items-center justify-between gap-3 text-meta text-muted-foreground">
        <span>
          {provider.models} {provider.models === 1 ? "model" : "models"} ·{" "}
          {COMPACT.format(provider.tokens)} tokens
        </span>
        <span className="tabular-nums">{PERCENT.format(share)}</span>
      </div>
    </div>
  );
}

function TokenCompositionBar({ tokens }: { tokens: SessionStatsInfo["tokens"] }) {
  const total = modelTokenTotal(tokens);
  if (total <= 0) return null;
  const parts = [
    { key: "input", label: "Input", value: tokens.input, className: "bg-info" },
    { key: "output", label: "Output", value: tokens.output, className: "bg-success" },
    { key: "reasoning", label: "Reasoning", value: tokens.reasoning, className: "bg-primary" },
  ];
  return (
    <div
      className="flex h-1.5 w-full max-w-56 overflow-hidden rounded-full bg-muted"
      role="img"
      aria-label={parts
        .map((part) => `${part.label} ${PERCENT.format(part.value / total)}`)
        .join(", ")}
    >
      {parts.map((part) => (
        <span
          key={part.key}
          className={part.className}
          style={{ width: `${(part.value / total) * 100}%` }}
          aria-hidden="true"
        />
      ))}
    </div>
  );
}

function UsageValue({
  label,
  value,
  compact = false,
}: {
  label: string;
  value: string;
  compact?: boolean;
}) {
  return (
    <div className="min-w-0">
      <div
        className={`${compact ? "text-base" : "text-lg"} font-medium tracking-tight tabular-nums`}
      >
        {value}
      </div>
      <div className="truncate text-meta text-muted-foreground">{label}</div>
    </div>
  );
}

function UsageSectionHeading({
  title,
  description,
  className,
}: {
  title: string;
  description: string;
  className?: string;
}) {
  return (
    <div className={`grid gap-0.5 ${className ?? ""}`}>
      <h2 className="text-sm font-medium">{title}</h2>
      <p className="text-xs text-muted-foreground">{description}</p>
    </div>
  );
}

function UsageSkeleton() {
  return (
    <div className="grid gap-6">
      <Skeleton className="h-[340px] rounded-2xl" />
      <Skeleton className="h-64 rounded-xl" />
      <Skeleton className="h-40 rounded-xl" />
    </div>
  );
}

function UsageUnavailable() {
  return (
    <div className="flex min-h-72 items-center justify-center">
      <div className="max-w-md text-center">
        <TriangleAlert className="mx-auto size-8 text-muted-foreground" aria-hidden="true" />
        <h2 className="mt-3 text-base font-medium">OpenCode is disconnected</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Usage will load after the local OpenCode service reconnects.
        </p>
      </div>
    </div>
  );
}

function UsageError({ message, retry }: { message: string; retry(): void }) {
  return (
    <div className="flex min-h-72 items-center justify-center">
      <div className="max-w-md text-center">
        <TriangleAlert className="mx-auto size-8 text-destructive" aria-hidden="true" />
        <h2 className="mt-3 text-base font-medium">Could not load usage</h2>
        <p className="mt-1 text-sm text-muted-foreground">{message}</p>
        <Button type="button" variant="outline" size="sm" className="mt-4" onClick={retry}>
          Retry
        </Button>
      </div>
    </div>
  );
}

function sortModels(models: readonly SessionStatsModelUsage[], sort: ModelSort) {
  return [...models].toSorted((left, right) => {
    const metricDifference =
      sort === "steps"
        ? right.steps - left.steps
        : sort === "tokens"
          ? modelTokenTotal(right.tokens) - modelTokenTotal(left.tokens)
          : right.cost - left.cost;
    return (
      metricDifference ||
      right.cost - left.cost ||
      modelTokenTotal(right.tokens) - modelTokenTotal(left.tokens) ||
      modelUsageKey(left).localeCompare(modelUsageKey(right))
    );
  });
}

function modelUsageKey(usage: SessionStatsModelUsage): string {
  return `${usage.model.providerID}/${usage.model.id}/${usage.model.variant ?? ""}`;
}

function modelTokenTotal(tokens: SessionStatsInfo["tokens"]): number {
  return tokens.input + tokens.output + tokens.reasoning;
}

interface ProviderUsageSummary {
  providerID: string;
  models: number;
  cost: number;
  tokens: number;
}

function summarizeProviders(models: readonly SessionStatsModelUsage[]): ProviderUsageSummary[] {
  const providers = new Map<string, { summary: ProviderUsageSummary; modelIDs: Set<string> }>();
  for (const model of models) {
    const current = providers.get(model.model.providerID) ?? {
      summary: {
        providerID: model.model.providerID,
        models: 0,
        cost: 0,
        tokens: 0,
      },
      modelIDs: new Set<string>(),
    };
    current.modelIDs.add(model.model.id);
    current.summary.models = current.modelIDs.size;
    current.summary.cost += model.cost;
    current.summary.tokens += modelTokenTotal(model.tokens);
    providers.set(model.model.providerID, current);
  }
  return [...providers.values()]
    .map(({ summary }) => summary)
    .toSorted(
      (left, right) =>
        right.cost - left.cost ||
        right.tokens - left.tokens ||
        left.providerID.localeCompare(right.providerID),
    );
}

function modelUsageIdentity(
  usage: SessionStatsModelUsage,
  models: readonly PalotModel[],
  providers: readonly PalotProvider[],
) {
  const model = models.find(
    (candidate) =>
      candidate.providerID === usage.model.providerID && candidate.modelID === usage.model.id,
  );
  const provider = providers.find((candidate) => candidate.id === usage.model.providerID);
  return {
    modelName: model?.name ?? usage.model.id,
    providerName: provider?.name ?? usage.model.providerID,
  };
}

function formatShare(value: number, total: number): string {
  return PERCENT.format(total > 0 ? value / total : 0);
}

function updatedLabel(updatedAt: number, now: number): string {
  if (!updatedAt) return "Not updated yet";
  const minutes = Math.min(0, Math.round((updatedAt - now) / 60_000));
  return `Updated ${UPDATED.format(minutes, "minute")}`;
}
