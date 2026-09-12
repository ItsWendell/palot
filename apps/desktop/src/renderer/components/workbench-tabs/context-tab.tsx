import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleAlert, RefreshCw, Trash2 } from "lucide-react";
import { useAtom, useAtomValue } from "jotai";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { PalotMessage, PalotModel, PalotSession } from "../../../shared";
import { contextMessageTargetAtom } from "../../atoms/workbench";
import { runtimeAtom } from "../../atoms/workspace";
import { useModelCatalog } from "../../hooks/use-model-catalog";
import { useCatalogSession } from "../../hooks/use-session-catalog";
import { useSessionTranscript } from "../../hooks/use-session-transcript";
import { getContextUsage } from "../../lib/context-usage";
import { likelyCacheBusts } from "../../lib/cache-bust";
import { openCodeKeys } from "../../lib/opencode-query";
import { showErrorToast } from "../../lib/toast-error";
import { palot } from "../../services/palot";
import type { WorkbenchTab } from "../../lib/workbench-tabs";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "../ui/accordion";
import { Button } from "../ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { ScrollArea } from "../ui/scroll-area";
import { Spinner } from "../ui/spinner";

const NUMBER_FORMATTER = new Intl.NumberFormat(undefined);
const CURRENCY_FORMATTER = new Intl.NumberFormat(undefined, {
  style: "currency",
  currency: "USD",
});
const DATE_FORMATTER = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

const BREAKDOWN = [
  { key: "input", label: "Input", color: "bg-info" },
  { key: "output", label: "Output", color: "bg-success" },
  { key: "reasoning", label: "Reasoning", color: "bg-primary" },
  { key: "cacheRead", label: "Cache read", color: "bg-warning" },
  { key: "cacheWrite", label: "Cache write", color: "bg-destructive" },
] as const;

export function ContextTab({ tab }: { tab: Extract<WorkbenchTab, { kind: "context" }> }) {
  const session = useCatalogSession(tab.resource.sessionID);

  if (!session) {
    return (
      <Empty className="rounded-none p-5">
        <EmptyHeader>
          <EmptyTitle>Context unavailable</EmptyTitle>
          <EmptyDescription>
            This session is no longer available in the session catalog.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return <SessionContext session={session} />;
}

function SessionContext({ session }: { session: PalotSession }) {
  const [expandedMessageIDs, setExpandedMessageIDs] = useState<string[]>([]);
  const [activeContextOpen, setActiveContextOpen] = useState(false);
  const [diagnosticSections, setDiagnosticSections] = useState<string[]>([]);
  const [removingInstruction, setRemovingInstruction] = useState<string | null>(null);
  const [messageTarget, setMessageTarget] = useAtom(contextMessageTargetAtom);
  const runtime = useAtomValue(runtimeAtom);
  const queryClient = useQueryClient();
  const transcript = useSessionTranscript(session);
  const modelCatalog = useModelCatalog(session.location);
  const models = modelCatalog.data?.models ?? [];
  const providers = modelCatalog.data?.providers ?? [];
  const messages = transcript.messages;
  const latest = useMemo(() => latestContextMessage(messages), [messages]);
  const usage = useMemo(() => getContextUsage(messages, models), [messages, models]);
  const cacheBusts = useMemo(() => likelyCacheBusts(messages), [messages]);
  const activeContextKey = openCodeKeys.sessionContext(
    runtime?.connectionID ?? "disconnected",
    session.id,
  );
  const activeContext = useQuery({
    queryKey: activeContextKey,
    queryFn: () => palot.loadSessionContext(session.id),
    enabled: runtime?.connected === true && activeContextOpen,
    staleTime: 30_000,
  });
  const instructionEntries = useQuery({
    queryKey: openCodeKeys.sessionInstructionEntries(
      runtime?.connectionID ?? "disconnected",
      session.id,
    ),
    queryFn: () => palot.listSessionInstructionEntries(session.id),
    enabled: runtime?.connected === true,
    staleTime: 30_000,
  });
  const counts = useMemo(
    () => ({
      all: messages.length,
      user: messages.filter((message) => message.type === "user").length,
      assistant: messages.filter((message) => message.type === "assistant").length,
    }),
    [messages],
  );
  const modelRef = latest?.model ?? session.model;
  const model = findModel(models, modelRef);
  const provider = providers.find((candidate) => candidate.id === modelRef?.providerID);
  const tokens = latest?.tokens;
  const processedTokens = session.tokens;
  const processedTotal =
    processedTokens.input +
    processedTokens.output +
    processedTokens.reasoning +
    processedTokens.cache.read +
    processedTokens.cache.write;
  const breakdown = useMemo(() => {
    if (!tokens) return [];
    const values = {
      input: tokens.input,
      output: tokens.output,
      reasoning: tokens.reasoning,
      cacheRead: tokens.cache.read,
      cacheWrite: tokens.cache.write,
    };
    const total = Object.values(values).reduce((sum, value) => sum + value, 0);
    if (total === 0) return [];
    return BREAKDOWN.map((item) => ({
      ...item,
      value: values[item.key],
      percentage: (values[item.key] / total) * 100,
    })).filter((item) => item.value > 0);
  }, [tokens]);

  const openRawMessage = useCallback((messageID: string) => {
    setExpandedMessageIDs((current) =>
      current.includes(messageID) ? current : [...current, messageID],
    );
    requestAnimationFrame(() => {
      document.getElementById(`context-message-${messageID}`)?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
  }, []);

  const removeInstruction = useCallback(
    async (key: string) => {
      if (removingInstruction) return;
      setRemovingInstruction(key);
      try {
        await palot.removeSessionInstructionEntry(session.id, key);
        await instructionEntries.refetch();
        await queryClient.invalidateQueries({ queryKey: activeContextKey });
      } catch (error) {
        showErrorToast("Could not remove instruction entry", error);
      } finally {
        setRemovingInstruction(null);
      }
    },
    [activeContextKey, instructionEntries, queryClient, removingInstruction, session.id],
  );

  useEffect(() => {
    if (messageTarget?.sessionID !== session.id) return;
    setDiagnosticSections((current) =>
      current.includes("projected") ? current : [...current, "projected"],
    );
    openRawMessage(messageTarget.messageID);
    setMessageTarget(null);
  }, [messageTarget, openRawMessage, session.id, setMessageTarget]);

  if (transcript.isPending && messages.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center gap-2 text-xs text-muted-foreground">
        <Spinner /> Loading context
      </div>
    );
  }

  if (transcript.error && messages.length === 0) {
    return (
      <Empty className="rounded-none p-5">
        <EmptyHeader>
          <EmptyTitle>Could not load context</EmptyTitle>
          <EmptyDescription>{transcript.error.message}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  const overviewStats = [
    { label: "Session", value: session.title ?? session.id },
    { label: "Loaded messages", value: formatNumber(counts.all) },
    { label: "Provider", value: provider?.name ?? modelRef?.providerID ?? "Unavailable" },
    { label: "Model", value: model?.name ?? modelRef?.id ?? "Unavailable" },
    { label: "Loaded user messages", value: formatNumber(counts.user) },
    { label: "Loaded assistant messages", value: formatNumber(counts.assistant) },
    { label: "Session created", value: DATE_FORMATTER.format(session.createdAt) },
    {
      label: "Latest context step",
      value: latest ? DATE_FORMATTER.format(latest.createdAt) : "Unavailable",
    },
  ];
  const currentContextStats = [
    { label: "Context limit", value: usage?.limit ? formatNumber(usage.limit) : "Unavailable" },
    { label: "Context tokens", value: usage ? formatNumber(usage.total) : "Unavailable" },
    {
      label: "Usage",
      value: usage?.percentage === null || !usage ? "Unavailable" : `${usage.percentage}%`,
    },
    { label: "Input tokens", value: tokens ? formatNumber(tokens.input) : "Unavailable" },
    { label: "Output tokens", value: tokens ? formatNumber(tokens.output) : "Unavailable" },
    { label: "Reasoning tokens", value: tokens ? formatNumber(tokens.reasoning) : "Unavailable" },
    {
      label: "Cache read / write",
      value: tokens
        ? `${formatNumber(tokens.cache.read)} / ${formatNumber(tokens.cache.write)}`
        : "Unavailable",
    },
  ];
  const sessionProcessingStats = [
    { label: "Processed tokens", value: formatNumber(processedTotal) },
    { label: "Processed input", value: formatNumber(processedTokens.input) },
    { label: "Processed output", value: formatNumber(processedTokens.output) },
    { label: "Processed reasoning", value: formatNumber(processedTokens.reasoning) },
    {
      label: "Processed cache read / write",
      value: `${formatNumber(processedTokens.cache.read)} / ${formatNumber(processedTokens.cache.write)}`,
    },
    {
      label: "Total cost",
      value: session.cost === null ? "Unavailable" : CURRENCY_FORMATTER.format(session.cost),
    },
  ];

  return (
    <ScrollArea className="@container min-h-0 flex-1 bg-background">
      <div className="flex min-w-0 flex-col gap-8 px-5 pt-4 pb-10 @min-[42rem]:px-6">
        <section className="grid grid-cols-1 gap-x-8 gap-y-4 @min-[30rem]:grid-cols-2">
          {overviewStats.map((stat) => (
            <ContextStat key={stat.label} label={stat.label} value={stat.value} />
          ))}
        </section>

        <ContextStatsSection title="Current context" stats={currentContextStats} />

        {breakdown.length > 0 ? (
          <section className="flex flex-col gap-2" aria-labelledby="context-token-breakdown">
            <div id="context-token-breakdown" className="text-xs text-muted-foreground">
              Latest token breakdown
            </div>
            <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted">
              {breakdown.map((item) => (
                <div
                  key={item.key}
                  className={item.color}
                  style={{ width: `${item.percentage}%` }}
                  title={`${item.label}: ${formatNumber(item.value)} tokens`}
                />
              ))}
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              {breakdown.map((item) => (
                <div
                  key={item.key}
                  className="flex items-center gap-1 text-meta text-muted-foreground"
                >
                  <span className={`size-2 rounded-sm ${item.color}`} aria-hidden="true" />
                  <span>{item.label}</span>
                  <span className="text-muted-foreground/70 tabular-nums">
                    {Math.round(item.percentage)}%
                  </span>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <ContextStatsSection title="Session processing" stats={sessionProcessingStats} />

        <section className="flex min-w-0 flex-col gap-2" aria-labelledby="context-active-messages">
          <div id="context-active-messages" className="text-xs text-muted-foreground">
            Context details
          </div>
          <Accordion
            value={activeContextOpen ? ["active"] : []}
            onValueChange={(value) => setActiveContextOpen(value.includes("active"))}
            multiple
            className="bg-card"
          >
            <AccordionItem value="active">
              <AccordionTrigger className="px-3 py-2.5 hover:no-underline">
                <span className="min-w-0">
                  <span className="block text-xs font-medium">Post-compaction context</span>
                  <span className="block text-meta font-normal text-muted-foreground">
                    The messages OpenCode currently retains for the next model call
                  </span>
                </span>
              </AccordionTrigger>
              <AccordionContent className="px-1 pb-1">
                {activeContextOpen ? (
                  <div className="flex min-w-0 flex-col gap-2">
                    <div className="flex justify-end">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={activeContext.isFetching}
                        onClick={() => void activeContext.refetch()}
                      >
                        {activeContext.isFetching ? <Spinner /> : <RefreshCw aria-hidden="true" />}
                        Refresh
                      </Button>
                    </div>
                    {activeContext.error ? (
                      <p className="text-xs text-destructive">Could not load active context.</p>
                    ) : activeContext.data?.length ? (
                      <pre className="m-0 max-h-[32rem] overflow-auto rounded-md border border-border/70 bg-background p-3 font-mono text-code-compact/relaxed whitespace-pre-wrap break-words text-foreground/75 select-text">
                        {JSON.stringify(activeContext.data, null, 2)}
                      </pre>
                    ) : (
                      <div className="rounded-md border border-dashed border-border p-4 text-xs text-muted-foreground">
                        {activeContext.isPending
                          ? "Loading post-compaction context..."
                          : "No post-compaction context messages."}
                      </div>
                    )}
                  </div>
                ) : null}
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </section>

        <section
          className="flex min-w-0 flex-col gap-2"
          aria-labelledby="context-instruction-entries"
        >
          <div id="context-instruction-entries" className="text-xs text-muted-foreground">
            Instruction entries
          </div>
          {instructionEntries.error ? (
            <p className="text-xs text-destructive">Could not load instruction entries.</p>
          ) : instructionEntries.data?.length ? (
            <div className="overflow-hidden rounded-lg border border-border">
              {instructionEntries.data.map((entry) => (
                <div
                  key={entry.key}
                  className="flex items-start gap-3 border-b border-border px-3 py-2.5 last:border-b-0"
                >
                  <div className="min-w-0 flex-1">
                    <div className="font-mono text-tree font-medium">{entry.key}</div>
                    <pre className="mt-1 max-h-28 overflow-auto font-mono text-code-compact/relaxed whitespace-pre-wrap break-words text-muted-foreground">
                      {JSON.stringify(entry.value, null, 2)}
                    </pre>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Remove instruction ${entry.key}`}
                    disabled={removingInstruction !== null}
                    onClick={() => void removeInstruction(entry.key)}
                  >
                    {removingInstruction === entry.key ? (
                      <Spinner />
                    ) : (
                      <Trash2 aria-hidden="true" />
                    )}
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-md border border-dashed border-border p-4 text-xs text-muted-foreground">
              {instructionEntries.isPending
                ? "Loading instruction entries..."
                : "No instruction entries."}
            </div>
          )}
        </section>

        <section className="flex min-w-0 flex-col gap-2" aria-labelledby="context-diagnostics">
          <div>
            <div id="context-diagnostics" className="text-xs text-muted-foreground">
              Developer diagnostics
            </div>
            <p className="mt-1 text-meta text-muted-foreground/80">
              Derived cache signals and Palot's mapped message records.
            </p>
          </div>
          <Accordion
            multiple
            value={diagnosticSections}
            onValueChange={setDiagnosticSections}
            className="min-w-0 bg-card"
          >
            <AccordionItem value="cache">
              <AccordionTrigger className="px-3 py-2.5 text-xs hover:no-underline">
                Cache diagnostics
              </AccordionTrigger>
              <AccordionContent className="px-1 pb-1">
                {diagnosticSections.includes("cache") ? (
                  cacheBusts.length > 0 ? (
                    <div className="overflow-hidden rounded-lg border border-warning/30 bg-warning/6">
                      {cacheBusts.map((warning) => (
                        <div
                          key={warning.messageID}
                          className="flex items-start gap-2 border-b border-warning/20 px-3 py-2.5 text-xs last:border-b-0"
                        >
                          <CircleAlert
                            className="mt-0.5 size-3.5 shrink-0 text-warning"
                            aria-hidden="true"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="font-medium">
                              Likely cache bust: {formatNumber(warning.drop)} fewer cached tokens
                              than the previous step
                            </div>
                            <button
                              type="button"
                              className="mt-0.5 block max-w-full truncate font-mono text-code-compact text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                              aria-label={`Open projected message ${warning.messageID}`}
                              onClick={() => {
                                setDiagnosticSections((current) =>
                                  current.includes("projected")
                                    ? current
                                    : [...current, "projected"],
                                );
                                openRawMessage(warning.messageID);
                              }}
                            >
                              {warning.messageID}
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-md border border-dashed border-border p-4 text-xs text-muted-foreground">
                      {transcript.hasNextPage
                        ? "No likely cache busts detected in loaded messages. Load earlier records to scan more of the session."
                        : "No likely cache busts detected in the loaded transcript."}
                    </div>
                  )
                ) : null}
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="projected">
              <AccordionTrigger className="px-3 py-2.5 hover:no-underline">
                <span className="min-w-0">
                  <span className="block text-xs font-medium">Projected message records</span>
                  <span className="block text-meta font-normal text-muted-foreground">
                    PalotMessage values mapped from the OpenCode transcript
                  </span>
                </span>
              </AccordionTrigger>
              <AccordionContent className="px-1 pb-1">
                {diagnosticSections.includes("projected") ? (
                  <div className="flex min-w-0 flex-col gap-2">
                    {transcript.hasNextPage ? (
                      <div className="flex justify-end">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={transcript.isFetchingNextPage}
                          onClick={() => void transcript.fetchNextPage()}
                        >
                          {transcript.isFetchingNextPage ? (
                            <Spinner />
                          ) : (
                            <RefreshCw aria-hidden="true" />
                          )}
                          Load earlier
                        </Button>
                      </div>
                    ) : null}
                    {transcript.isFetchNextPageError ? (
                      <p className="text-xs text-destructive">
                        Could not load earlier projected records.
                      </p>
                    ) : null}
                    {messages.length > 0 ? (
                      <Accordion
                        multiple
                        value={expandedMessageIDs}
                        onValueChange={setExpandedMessageIDs}
                        className="min-w-0 bg-background"
                      >
                        {messages.map((message) => (
                          <AccordionItem
                            key={message.id}
                            value={message.id}
                            id={`context-message-${message.id}`}
                            data-context-message-id={message.id}
                          >
                            <AccordionTrigger className="min-w-0 items-center gap-3 px-3 py-2 text-xs hover:no-underline">
                              <span className="min-w-0 flex-1 truncate font-medium">
                                {message.type}{" "}
                                <span className="font-normal text-muted-foreground">
                                  · {message.id}
                                </span>
                              </span>
                              <span className="shrink-0 pr-1 text-meta font-normal text-muted-foreground tabular-nums">
                                {DATE_FORMATTER.format(message.createdAt)}
                              </span>
                            </AccordionTrigger>
                            <AccordionContent className="px-1 pb-1">
                              {expandedMessageIDs.includes(message.id) ? (
                                <pre className="m-0 max-h-[32rem] overflow-auto rounded-md border border-border/70 bg-background p-3 font-mono text-code-compact/relaxed whitespace-pre-wrap break-words text-foreground/75 select-text">
                                  {JSON.stringify(message, null, 2)}
                                </pre>
                              ) : null}
                            </AccordionContent>
                          </AccordionItem>
                        ))}
                      </Accordion>
                    ) : (
                      <div className="rounded-md border border-dashed border-border p-4 text-xs text-muted-foreground">
                        Projected records will appear after the session starts.
                      </div>
                    )}
                  </div>
                ) : null}
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </section>
      </div>
    </ScrollArea>
  );
}

function ContextStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="truncate text-xs font-medium tabular-nums" title={value}>
        {value}
      </div>
    </div>
  );
}

function ContextStatsSection({
  title,
  stats,
}: {
  title: string;
  stats: Array<{ label: string; value: string }>;
}) {
  const id = `context-${title.toLowerCase().replaceAll(" ", "-")}`;
  return (
    <section className="flex min-w-0 flex-col gap-4" aria-labelledby={id}>
      <div id={id} className="text-xs text-muted-foreground">
        {title}
      </div>
      <div className="grid grid-cols-1 gap-x-8 gap-y-4 @min-[30rem]:grid-cols-2">
        {stats.map((stat) => (
          <ContextStat key={stat.label} label={stat.label} value={stat.value} />
        ))}
      </div>
    </section>
  );
}

function latestContextMessage(messages: PalotMessage[]): PalotMessage | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || message.type !== "assistant" || !message.tokens) continue;
    const total =
      message.tokens.input +
      message.tokens.output +
      message.tokens.reasoning +
      message.tokens.cache.read +
      message.tokens.cache.write;
    if (total > 0) return message;
  }
  return null;
}

function findModel(models: PalotModel[], ref: PalotMessage["model"]): PalotModel | null {
  if (!ref) return null;
  return (
    models.find(
      (model) =>
        model.providerID === ref.providerID && (model.id === ref.id || model.modelID === ref.id),
    ) ?? null
  );
}

function formatNumber(value: number): string {
  return NUMBER_FORMATTER.format(value);
}
