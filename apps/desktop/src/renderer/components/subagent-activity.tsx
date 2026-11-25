import {
  ArrowRight,
  BrainCircuit,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  CircleHelp,
  LoaderCircle,
  Square,
} from "lucide-react";
import { useAtomValue } from "jotai";
import { createContext, memo, useContext, useMemo, useState } from "react";
import type { PalotMessage, PalotRunningShell, PalotSession } from "../../shared";
import {
  belongsToSession,
  runtimeAtom,
  sessionsWithRunningDescendants,
  type SessionExecutionState,
} from "../atoms/workspace";
import { usePalotNavigation } from "../hooks/use-navigation";
import { useSessionActivity } from "../hooks/use-session-activity";
import { useChildSessions, useSessionCatalog } from "../hooks/use-session-catalog";
import { useSessionFamilyRequestViews } from "../hooks/use-session-requests";
import { cn } from "../lib/cn";
import { writeClipboardText } from "../lib/clipboard";
import { canFetchOpenCode } from "../lib/opencode-runtime-query";
import { subagentShowsBackgroundChip } from "../lib/subagent-background";
import { projectToolExecution, type SubagentExecution } from "../lib/tool-executions";
import {
  type TranscriptBackgroundFacts,
  type TranscriptBackgroundResponseSource,
  type TranscriptBackgroundToolSource,
  type TurnActivityGroup,
} from "../lib/turn-projection";
import { MarkdownContent } from "./markdown-content";
import { BoundedScroll } from "./transcript/bounded-scroll";
import { ElapsedTime } from "./elapsed-time";
import { interruptChildSession } from "./running-work-control";
import { Button } from "./ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./ui/collapsible";
import { PulseDot } from "./ui/pulse-dot";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "./ui/popover";

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function string(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function titleCase(value: string): string {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

/** Agent and task description for a child session, parsed from OpenCode's subagent title. */
export function sessionPresentation(session: PalotSession | undefined) {
  const title = session?.title?.trim() || "Delegated task";
  const match = title.match(/^(.*?)\s+\(@([^()]+) subagent\)$/i);
  return {
    agent: titleCase(match?.[2] ?? session?.agent ?? "subagent"),
    description: match?.[1]?.trim() || title,
  };
}

/** One `<subagent>` report a child sent its parent. */
export interface SubagentReport {
  id: string;
  childID: string;
  agent: string | null;
  description: string | null;
  text: string;
  status: "running" | "completed" | "failed" | "interrupted";
  /** It went idle with background work of its own still running, so it is not finished. */
  backgroundWork: boolean;
  /** That work is only its own subagents. */
  waitingOnSubagents: boolean;
  createdAt: number;
}

/**
 * A child's reports in the order they arrived. OpenCode 2.2.7 reports a background child once;
 * later releases report every time the child goes idle, so one child can have several.
 */
export function subagentReportsByChild(
  sources: readonly TranscriptBackgroundResponseSource[],
): Map<string, SubagentReport[]> {
  const reports = new Map<string, SubagentReport[]>();
  for (const { part, messageCreatedAt } of sources) {
    const data = record(part.data);
    const childID = string(data.childID);
    if (!childID) continue;
    const list = reports.get(childID) ?? [];
    list.push({
      id: part.id ?? `${childID}:${messageCreatedAt}`,
      childID,
      agent: string(data.agent),
      description: part.name ?? null,
      text: part.text?.trim() ?? "",
      status: part.status ?? "completed",
      backgroundWork: data.backgroundWork === true,
      waitingOnSubagents: data.waitingOnSubagents === true,
      createdAt: messageCreatedAt,
    });
    reports.set(childID, list);
  }
  for (const list of reports.values()) list.sort((left, right) => left.createdAt - right.createdAt);
  return reports;
}

const NO_REPORTS: ReadonlyMap<string, SubagentReport[]> = new Map();
const NO_SESSIONS: PalotSession[] = [];

/** Every report in the loaded transcript, by child, so a launch row can show its child's result. */
export const SubagentReportsContext =
  createContext<ReadonlyMap<string, SubagentReport[]>>(NO_REPORTS);

type Fallback = SubagentExecution["status"] | TurnActivityGroup["status"];

const WAITING_FOR_SUBAGENT = {
  label: "Waiting for subagent",
  running: true,
  failed: false,
} as const;
const WAITING_FOR_BACKGROUND_WORK = {
  label: "Waiting for background work",
  running: true,
  failed: false,
} as const;
const WAITING_LABELS: ReadonlySet<string> = new Set([
  WAITING_FOR_SUBAGENT.label,
  WAITING_FOR_BACKGROUND_WORK.label,
]);

/**
 * A subagent's state: the child session's own execution state first, then its own work, then
 * its latest report, then the call's status. An idle subagent is waiting, not finished, while
 * a subagent it started runs (`runningDescendant`, which includes one waiting for the user's
 * answer) or while its latest report lists background work still running: that work wakes it,
 * and it reports again.
 */
export function statusPresentation(
  state: SessionExecutionState | undefined,
  fallback: Fallback,
  report: SubagentReport | null = null,
  runningDescendant = false,
): { label: string; running: boolean; failed: boolean } {
  if (state?.status === "running") {
    return { label: "Running", running: true, failed: false };
  }
  if (state?.status === "failed") {
    return { label: "Failed", running: false, failed: true };
  }
  if (state?.status === "interrupted") {
    return { label: "Stopped", running: false, failed: false };
  }
  if (runningDescendant || report?.waitingOnSubagents) return WAITING_FOR_SUBAGENT;
  if (report?.backgroundWork) return WAITING_FOR_BACKGROUND_WORK;
  if (state?.status === "succeeded" || state?.status === "inactive") {
    return { label: "Finished", running: false, failed: false };
  }
  const status = report?.status ?? fallback;
  if (status === "running" || status === "pending") {
    return { label: "Running", running: true, failed: false };
  }
  if (status === "failed" || status === "error") {
    return { label: "Failed", running: false, failed: true };
  }
  if (status === "interrupted") return { label: "Stopped", running: false, failed: false };
  return { label: "Finished", running: false, failed: false };
}

function subagentExecution(group: TurnActivityGroup): SubagentExecution | null {
  const entry = group.entries[0];
  if (!entry) return null;
  const view = projectToolExecution(entry.part, entry.index);
  return view.kind === "subagent" ? view : null;
}

function resolveSubagentSession(
  view: SubagentExecution,
  sessions: PalotSession[],
  parentSessionID: string,
) {
  if (view.sessionID) return sessions.find((candidate) => candidate.id === view.sessionID);
  const agent = view.agent.toLowerCase();
  const candidates = sessions.filter((candidate) => {
    if (candidate.parentID !== parentSessionID) return false;
    const presentation = sessionPresentation(candidate);
    return (
      presentation.agent.toLowerCase() === agent && presentation.description === view.description
    );
  });
  return candidates.toSorted(
    (left, right) =>
      Math.abs(left.createdAt - (view.startedAt ?? left.createdAt)) -
      Math.abs(right.createdAt - (view.startedAt ?? right.createdAt)),
  )[0];
}

export function SubagentLaunch({
  group,
  parentSessionID,
}: {
  group: TurnActivityGroup;
  parentSessionID: string;
}) {
  const sessions = useSessionCatalog();
  const view = useMemo(() => subagentExecution(group), [group]);
  const session = view ? resolveSubagentSession(view, sessions, parentSessionID) : undefined;
  const runtime = useAtomValue(runtimeAtom);
  if (!view) return null;
  const presentation = sessionPresentation(session);
  return (
    <SubagentRow
      childID={view.sessionID ?? session?.id ?? null}
      rowID={group.id}
      agent={titleCase(view.agent || presentation.agent)}
      description={view.description || presentation.description}
      startedAt={view.startedAt}
      // A background call returns before its child ends, so its own duration says nothing.
      callDurationMs={view.background ? null : view.durationMs}
      fallback={view.background ? "completed" : view.status}
      background={subagentShowsBackgroundChip(view, runtime?.version)}
    />
  );
}

/**
 * How deep nested subagents show under a row. OpenCode's `experimental.subagent_depth` bounds
 * real families; this bounds the rows even if the data had a cycle or a deeper chain.
 */
export const MAX_NESTED_SUBAGENT_DEPTH = 4;

function outcomeFallback(session: PalotSession): Fallback {
  if (session.outcome === "failed") return "failed";
  if (session.outcome === "interrupted") return "interrupted";
  return "completed";
}

/** A subagent's own subagent, shown under its parent's row with the same row. */
function NestedSubagentRow({ session, depth }: { session: PalotSession; depth: number }) {
  const presentation = sessionPresentation(session);
  return (
    <SubagentRow
      childID={session.id}
      rowID={session.id}
      agent={presentation.agent}
      description={presentation.description}
      startedAt={session.createdAt}
      callDurationMs={null}
      fallback={outcomeFallback(session)}
      background={false}
      depth={depth}
    />
  );
}

/**
 * One subagent: what it is, its live state, Stop while it runs, and its latest report on
 * expand, with earlier reports below it. Subagents it started show indented under it, open
 * while it runs and folded behind a count once it has finished.
 */
function SubagentRow({
  childID,
  rowID,
  agent,
  description,
  startedAt,
  callDurationMs,
  fallback,
  background,
  depth = 0,
}: {
  childID: string | null;
  rowID: string;
  agent: string;
  description: string;
  startedAt: number | null;
  callDurationMs: number | null;
  fallback: Fallback;
  background: boolean;
  depth?: number;
}) {
  const { openSession } = usePalotNavigation();
  const states = useSessionActivity().data?.execution ?? new Map();
  const reports = useContext(SubagentReportsContext);
  const childReports = (childID ? reports.get(childID) : undefined) ?? [];
  const latest = childReports.at(-1) ?? null;
  const needsInput = useSessionFamilyRequestViews(childID).length > 0;
  const state = childID ? states.get(childID) : undefined;
  const runningDescendant = useMemo(
    () => (childID ? sessionsWithRunningDescendants(states).has(childID) : false),
    [childID, states],
  );
  const status = statusPresentation(state, fallback, latest, runningDescendant);
  const runtime = useAtomValue(runtimeAtom);
  const [stopping, setStopping] = useState(false);
  const [stopError, setStopError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const nestedParent = depth + 1 < MAX_NESTED_SUBAGENT_DEPTH ? childID : null;
  const children = useChildSessions(nestedParent);
  // `useChildSessions(null)` lists root sessions; a row without a child has no subagents.
  const nested = nestedParent ? children : NO_SESSIONS;
  const [nestedChoice, setNestedOpen] = useState<boolean | null>(null);
  const nestedOpen = nestedChoice ?? status.running;
  const nestedLabel = `${nested.length} ${nested.length === 1 ? "subagent" : "subagents"}`;
  const statusLabel = needsInput ? "needs input" : status.label.toLowerCase();
  const visibleStatus =
    needsInput || status.failed || status.label === "Stopped" || WAITING_LABELS.has(status.label);
  const connectionID = runtime && canFetchOpenCode(runtime) ? runtime.connectionID : null;
  const completedAt = state?.completedAt ?? (status.running ? null : (latest?.createdAt ?? null));
  const stop = async () => {
    if (!childID || !connectionID || stopping) return;
    setStopping(true);
    setStopError(null);
    try {
      await interruptChildSession(connectionID, childID);
    } catch (cause) {
      setStopError(cause instanceof Error ? cause.message : "Could not stop the subagent.");
    } finally {
      setStopping(false);
    }
  };

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="my-1 min-w-0">
      <div
        className={cn(
          "min-w-0 rounded-md border border-border/60 bg-muted/15",
          open && "bg-muted/20",
        )}
      >
        <div className="flex min-w-0 items-center rounded-md transition-colors hover:bg-muted/30">
          <button
            type="button"
            disabled={!childID}
            onClick={() => {
              if (childID) void openSession(childID);
            }}
            className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md pr-2 pl-2.5 text-left text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:opacity-80"
            aria-label={`${agent} subagent ${statusLabel}: ${description}`}
            data-palot-subagent-launch={childID ?? rowID}
            data-palot-subagent-state={status.running ? "running" : status.label.toLowerCase()}
          >
            <BrainCircuit
              className={cn(
                "size-3.5 shrink-0",
                status.failed ? "text-destructive" : "text-muted-foreground",
              )}
              aria-hidden="true"
            />
            <span className="min-w-0 flex-1 truncate">
              <span
                className={cn(
                  "font-medium",
                  needsInput
                    ? "text-warning"
                    : status.failed
                      ? "text-destructive"
                      : "text-foreground/85",
                )}
              >
                {agent}
                {visibleStatus ? ` ${statusLabel}` : null}
              </span>
              <span className="text-muted-foreground"> · {description}</span>
            </span>
            {background ? (
              <span className="shrink-0 rounded-sm bg-muted px-1 py-0.5 text-micro leading-none text-muted-foreground">
                background
              </span>
            ) : null}
            <span className="flex shrink-0 items-center gap-1.5 tabular-nums text-muted-foreground/70">
              {needsInput ? (
                <CircleHelp className="size-3.5 text-warning" aria-hidden="true" />
              ) : status.running ? (
                <PulseDot className="size-1.5" aria-hidden="true" />
              ) : null}
              <ElapsedTime
                startedAt={state?.startedAt ?? startedAt}
                completedAt={completedAt}
                running={status.running}
                fallbackDurationMs={callDurationMs}
                titlePrefix={status.running ? "Running for" : "Ran for"}
              />
              {childID ? <ChevronRight className="size-3.5" aria-hidden="true" /> : null}
            </span>
          </button>
          {status.running && childID ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="mr-1 shrink-0"
              aria-label={`Stop ${agent} subagent`}
              disabled={!connectionID || stopping}
              onClick={() => void stop()}
            >
              {stopping ? (
                <LoaderCircle className="animate-spin" aria-hidden="true" />
              ) : (
                <Square aria-hidden="true" />
              )}
            </Button>
          ) : null}
          {nested.length > 0 ? (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className="mr-1 shrink-0 text-muted-foreground"
              aria-expanded={nestedOpen}
              aria-label={`${nestedOpen ? "Hide" : "Show"} ${nestedLabel} under ${agent}`}
              onClick={() => setNestedOpen(!nestedOpen)}
            >
              {nestedLabel}
              {nestedOpen ? (
                <ChevronDown data-icon="inline-end" aria-hidden="true" />
              ) : (
                <ChevronRight data-icon="inline-end" aria-hidden="true" />
              )}
            </Button>
          ) : null}
          {latest ? (
            <CollapsibleTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="mr-1 shrink-0"
                  aria-label={`${open ? "Hide" : "Show"} ${agent} result`}
                />
              }
            >
              {open ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
            </CollapsibleTrigger>
          ) : null}
        </div>
        {latest ? (
          <CollapsibleContent className="border-t border-border/50 px-3 py-3">
            <SubagentReportBody
              agent={agent}
              childID={childID}
              report={latest}
              earlier={childReports.slice(0, -1)}
            />
          </CollapsibleContent>
        ) : null}
      </div>
      {stopError ? (
        <p role="alert" className="m-0 px-2.5 pt-1 text-meta text-destructive">
          {stopError}
        </p>
      ) : null}
      {nested.length > 0 && nestedOpen ? (
        <div
          role="group"
          aria-label={`Subagents of ${agent}`}
          className="ml-3 border-l border-border/60 pl-2"
          data-palot-nested-subagents={childID ?? rowID}
        >
          {nested.map((session) => (
            <NestedSubagentRow key={session.id} session={session} depth={depth + 1} />
          ))}
        </div>
      ) : null}
    </Collapsible>
  );
}

function reportTime(createdAt: number): string {
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(
    createdAt,
  );
}

function reportOutcome(report: SubagentReport): string {
  if (report.status === "failed") return "Failed";
  if (report.status === "interrupted") return "Stopped";
  return "Reported";
}

/** The latest report as the result; earlier reports from the same child fold under it. */
function SubagentReportBody({
  agent,
  childID,
  report,
  earlier,
}: {
  agent: string;
  childID: string | null;
  report: SubagentReport;
  earlier: SubagentReport[];
}) {
  const { openSession } = usePalotNavigation();
  const [copied, setCopied] = useState(false);
  return (
    <div data-palot-subagent-result={childID ?? report.id}>
      <ReportText agent={agent} report={report} />
      <div className="mt-3 flex items-center gap-1 border-t border-border/40 pt-2.5">
        {childID ? (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            aria-label={`Open ${agent} subagent task`}
            onClick={() => void openSession(childID)}
          >
            <ArrowRight data-icon="inline-start" aria-hidden="true" />
            Open task
          </Button>
        ) : null}
        {report.text ? (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={() => {
              void writeClipboardText(report.text);
              setCopied(true);
            }}
          >
            <Copy data-icon="inline-start" aria-hidden="true" />
            {copied ? "Copied" : "Copy response"}
          </Button>
        ) : null}
      </div>
      {earlier.length > 0 ? (
        <Collapsible className="mt-2 border-t border-border/40 pt-2">
          <CollapsibleTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="xs"
                className="text-muted-foreground aria-expanded:bg-transparent"
              />
            }
          >
            <ChevronRight data-icon="inline-start" aria-hidden="true" />
            {earlier.length} earlier {earlier.length === 1 ? "report" : "reports"}
          </CollapsibleTrigger>
          <CollapsibleContent>
            <ol className="m-0 flex list-none flex-col gap-3 p-0 pt-2">
              {earlier.toReversed().map((item) => (
                <li key={item.id} className="min-w-0">
                  <p className="m-0 mb-1 text-micro text-muted-foreground">
                    {reportOutcome(item)} at {reportTime(item.createdAt)}
                  </p>
                  <ReportText agent={agent} report={item} />
                </li>
              ))}
            </ol>
          </CollapsibleContent>
        </Collapsible>
      ) : null}
    </div>
  );
}

function ReportText({ agent, report }: { agent: string; report: SubagentReport }) {
  if (!report.text) {
    return <p className="m-0 text-xs text-muted-foreground">No response content was provided.</p>;
  }
  return (
    <BoundedScroll label={`${agent} response`} viewportClassName="max-h-[32rem]">
      <MarkdownContent value={report.text} className="pr-3 text-xs/relaxed text-foreground/80" />
    </BoundedScroll>
  );
}
export interface SubagentWorkItem {
  kind: "subagent";
  id: string;
  agent: string;
  description: string;
  startedAt: number;
  fallbackStatus: SubagentExecution["status"] | TurnActivityGroup["status"];
  /** The parent does not wait for it, so it never blocks a steer. */
  background: boolean;
  /** For the "Background" label; see `subagentShowsBackgroundChip`. */
  requestedBackground?: boolean;
  launchOnly?: boolean;
  /** A subagent's subagent: how many levels below the task's own subagents. */
  depth?: number;
  parentID?: string;
}

export interface ShellWorkItem {
  kind: "shell";
  id: string;
  command: string;
  startedAt: number;
  background: boolean;
}

export type BackgroundWorkItem = SubagentWorkItem | ShellWorkItem;

function menuItems(
  background: TranscriptBackgroundFacts,
  sessions: PalotSession[],
  sessionID: string,
) {
  const items = new Map<string, Omit<SubagentWorkItem, "kind">>();
  for (const source of background.subagentTools) {
    const view = projectToolExecution(source.part, source.index);
    if (view.kind !== "subagent" || !view.sessionID) continue;
    const session = sessions.find((candidate) => candidate.id === view.sessionID);
    const presentation = sessionPresentation(session);
    items.set(view.sessionID, {
      id: view.sessionID,
      agent: titleCase(view.agent || presentation.agent),
      description: view.description || presentation.description,
      startedAt: source.part.time?.created ?? source.messageCreatedAt,
      fallbackStatus: view.status,
      background: view.background,
      requestedBackground: view.requestedBackground,
      launchOnly: view.launchOnly,
    });
  }
  for (const source of background.subagentResponses) {
    const part = source.part;
    const data = record(part.data);
    const childID = string(data.childID);
    if (!childID) continue;
    const session = sessions.find((candidate) => candidate.id === childID);
    const presentation = sessionPresentation(session);
    const existing = items.get(childID);
    items.set(childID, {
      id: childID,
      agent: titleCase(string(data.agent) ?? existing?.agent ?? presentation.agent),
      description: part.name ?? existing?.description ?? presentation.description,
      startedAt: existing?.startedAt ?? source.messageCreatedAt,
      fallbackStatus:
        part.status === "running" || part.status === "failed" || part.status === "interrupted"
          ? part.status
          : "completed",
      // Only a child the parent did not wait for reports back, so its later runs never block.
      background: true,
      requestedBackground: existing?.requestedBackground ?? false,
      launchOnly: existing?.launchOnly ?? false,
    });
  }
  for (const session of sessions) {
    if (session.parentID !== sessionID || items.has(session.id)) continue;
    const presentation = sessionPresentation(session);
    items.set(session.id, {
      id: session.id,
      agent: presentation.agent,
      description: presentation.description,
      startedAt: session.createdAt,
      fallbackStatus: "completed",
      background: false,
      requestedBackground: false,
      launchOnly: false,
    });
  }
  return [...items.values()].toSorted((left, right) => left.startedAt - right.startedAt);
}

function backgroundShells(sources: TranscriptBackgroundToolSource[]) {
  const ids = new Set<string>();
  for (const source of sources) {
    const state = record(source.part.state);
    const metadata = record(state.metadata);
    if (string(state.status) !== "completed" || string(metadata.status) !== "running") continue;
    const shellID = string(metadata.shellID) ?? string(metadata.shellId);
    if (shellID) ids.add(shellID);
  }
  return ids;
}

function shellItems(
  messages: PalotMessage[],
  runningShells: PalotRunningShell[] | null,
  toolSources: TranscriptBackgroundToolSource[],
  sessionID: string,
  states: Map<string, SessionExecutionState>,
) {
  const serverShells = new Map(
    (runningShells ?? [])
      .filter(
        (shell) => shell.sessionID !== null && belongsToSession(states, shell.sessionID, sessionID),
      )
      .map((shell) => [shell.id, shell]),
  );
  const backgroundIDs = backgroundShells(toolSources);
  const commandsByID = new Map<string, string>();
  const unmatchedCommands: string[] = [];
  for (const source of toolSources) {
    const state = record(source.part.state);
    const metadata = record(state.metadata);
    if (string(state.status) !== "running" && string(metadata.status) !== "running") continue;
    const command = string(record(state.input).command);
    if (!command) continue;
    const shellID = string(metadata.shellID) ?? string(metadata.shellId);
    if (shellID) commandsByID.set(shellID, command);
    else unmatchedCommands.push(command);
  }
  const items = new Map<string, Omit<ShellWorkItem, "kind">>();
  for (const message of messages) {
    if (message.type !== "shell") continue;
    const data = record(message.data);
    const id = string(data.shellID) ?? message.id;
    const active =
      runningShells === null ? string(data.status) === "running" : serverShells.has(id);
    if (!active) continue;
    items.set(id, {
      id,
      command: serverShells.get(id)?.command ?? string(data.command) ?? "Shell command",
      startedAt: serverShells.get(id)?.startedAt ?? message.createdAt,
      background: backgroundIDs.has(id),
    });
  }
  for (const [id, shell] of serverShells) {
    if (items.has(id)) continue;
    items.set(id, {
      id,
      command:
        shell.command || commandsByID.get(id) || unmatchedCommands.shift() || "Shell command",
      startedAt: shell.startedAt,
      background: backgroundIDs.has(id),
    });
  }
  return [...items.values()];
}

export function projectBackgroundWork(input: {
  sessionID: string;
  background: TranscriptBackgroundFacts;
  runningShells: PalotRunningShell[] | null;
  sessions: PalotSession[];
  states: Map<string, SessionExecutionState>;
}): BackgroundWorkItem[] {
  const subagents = menuItems(input.background, input.sessions, input.sessionID);
  const shells = shellItems(
    input.background.shellMessages,
    input.runningShells,
    input.background.shellTools,
    input.sessionID,
    input.states,
  );
  const running = subagents
    .filter((item) => input.states.get(item.id)?.status === "running")
    .map((item) => ({
      ...item,
      kind: "subagent" as const,
      startedAt: input.states.get(item.id)?.startedAt ?? item.startedAt,
    }));
  const top = [...shells.map((item) => ({ ...item, kind: "shell" as const })), ...running];
  return withNestedSubagents(
    top.toSorted((left, right) => left.startedAt - right.startedAt),
    input,
  );
}

/**
 * Running subagents of subagents, each right after the row it belongs to and one level deeper.
 * A nested subagent whose parent is not listed (the parent is idle) is listed at the top level.
 */
function withNestedSubagents(
  items: BackgroundWorkItem[],
  input: {
    sessionID: string;
    sessions: PalotSession[];
    states: Map<string, SessionExecutionState>;
  },
): BackgroundWorkItem[] {
  const listed = new Set(items.map((item) => item.id));
  const nested = new Map<string, SubagentWorkItem[]>();
  const orphans: SubagentWorkItem[] = [];
  for (const [id, state] of input.states) {
    if (state.status !== "running" || listed.has(id) || id === input.sessionID) continue;
    if (!state.parentID || state.parentID === input.sessionID) continue;
    if (!belongsToSession(input.states, id, input.sessionID)) continue;
    const session = input.sessions.find((candidate) => candidate.id === id);
    const presentation = sessionPresentation(session);
    const item: SubagentWorkItem = {
      kind: "subagent",
      id,
      agent: presentation.agent,
      description: presentation.description,
      startedAt: state.startedAt ?? session?.createdAt ?? 0,
      fallbackStatus: "running",
      // The task's own steer never waits behind a subagent's subagent.
      background: true,
      parentID: state.parentID,
    };
    const siblings = nested.get(state.parentID) ?? [];
    siblings.push(item);
    nested.set(state.parentID, siblings);
  }
  const placed = new Set<string>();
  const result: BackgroundWorkItem[] = [];
  const place = (item: BackgroundWorkItem, depth: number) => {
    if (placed.has(item.id)) return;
    placed.add(item.id);
    result.push(item.kind === "subagent" && depth > 0 ? { ...item, depth } : item);
    if (depth + 1 >= MAX_NESTED_SUBAGENT_DEPTH) return;
    for (const child of (nested.get(item.id) ?? []).toSorted(
      (left, right) => left.startedAt - right.startedAt,
    )) {
      place(child, depth + 1);
    }
  };
  for (const item of items) place(item, 0);
  for (const siblings of nested.values()) {
    for (const item of siblings) if (!placed.has(item.id)) orphans.push(item);
  }
  for (const item of orphans.toSorted((left, right) => left.startedAt - right.startedAt)) {
    place(item, 0);
  }
  return result;
}

export const SubagentFooterControl = memo(function SubagentFooterControl({
  sessionID,
  items,
}: {
  sessionID: string;
  items: BackgroundWorkItem[];
}) {
  useChildSessions(sessionID);
  const [open, setOpen] = useState(false);
  const subagents = items.filter((item): item is SubagentWorkItem => item.kind === "subagent");
  if (subagents.length === 0) return null;

  return (
    <div className="flex shrink-0 items-center gap-2">
      {subagents.length > 0 ? (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger
            render={
              <button
                type="button"
                className="flex h-6 shrink-0 items-center gap-1 rounded-md px-1.5 outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={`View ${subagents.length} active ${subagents.length === 1 ? "subagent" : "subagents"}`}
              />
            }
          >
            <BrainCircuit className="size-3" aria-hidden="true" />
            <span>
              {subagents.length} {subagents.length === 1 ? "agent" : "agents"}
            </span>
            <ChevronDown className="size-3" aria-hidden="true" />
          </PopoverTrigger>
          <PopoverContent side="top" align="end" className="w-[340px] gap-1 p-1.5">
            <PopoverHeader className="px-2 py-1">
              <PopoverTitle>Active subagents</PopoverTitle>
              <PopoverDescription>
                Open a delegated task to inspect its live session.
              </PopoverDescription>
            </PopoverHeader>
            <SubagentWorkList subagents={subagents} onClose={() => setOpen(false)} />
          </PopoverContent>
        </Popover>
      ) : null}
    </div>
  );
});

function SubagentWorkList({
  subagents,
  onClose,
}: {
  subagents: SubagentWorkItem[];
  onClose(): void;
}) {
  const states = useSessionActivity().data?.execution ?? new Map();
  const parentsOfRunning = sessionsWithRunningDescendants(states);

  return (
    <div className="flex max-h-72 flex-col overflow-y-auto">
      {subagents.map((item) => (
        <SubagentWorkRow
          key={item.id}
          item={item}
          state={states.get(item.id)}
          runningDescendant={parentsOfRunning.has(item.id)}
          onClose={onClose}
        />
      ))}
    </div>
  );
}

function SubagentWorkRow({
  item,
  state,
  runningDescendant,
  onClose,
}: {
  item: SubagentWorkItem;
  state: SessionExecutionState | undefined;
  runningDescendant: boolean;
  onClose(): void;
}) {
  const { openSession } = usePalotNavigation();
  const runtime = useAtomValue(runtimeAtom);
  const needsInput = useSessionFamilyRequestViews(item.id).length > 0;
  const status = statusPresentation(state, item.fallbackStatus, null, runningDescendant);
  const background = subagentShowsBackgroundChip(item, runtime?.version);
  return (
    <button
      type="button"
      className={cn(
        "flex min-w-0 items-center gap-2 rounded-md px-2 py-2 text-left outline-none hover:bg-muted focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-ring",
        item.depth && "rounded-l-none border-l border-border/60",
      )}
      style={item.depth ? { marginInlineStart: `${item.depth * 0.75}rem` } : undefined}
      onClick={() => {
        onClose();
        void openSession(item.id);
      }}
    >
      <BrainCircuit className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium text-foreground/85">{item.description}</span>
        <span
          className={cn(
            "mt-0.5 block truncate text-micro",
            needsInput ? "text-warning" : "text-muted-foreground",
          )}
        >
          {item.agent} · {needsInput ? "Needs input" : background ? "Background" : status.label}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-1 tabular-nums text-muted-foreground/70">
        {needsInput ? (
          <CircleHelp className="size-3.5 text-warning" aria-hidden="true" />
        ) : (
          <PulseDot className="size-1.5" aria-hidden="true" />
        )}
        <ElapsedTime
          startedAt={state?.startedAt ?? item.startedAt}
          completedAt={state?.completedAt ?? null}
          running={status.running}
        />
        <ChevronRight className="size-3.5" aria-hidden="true" />
      </span>
    </button>
  );
}

/** "Running 1m 20s", "Done in 3m", "Failed after 40s": the subagent's state at a glance. */
function SubagentDockState({
  session,
  execution,
}: {
  session: PalotSession;
  execution: SessionExecutionState | null;
}) {
  const running = execution?.status === "running";
  const outcome = running ? null : (execution?.status ?? session.outcome ?? null);
  const label = running
    ? "Running"
    : outcome === "failed"
      ? "Failed after"
      : outcome === "interrupted"
        ? "Stopped after"
        : "Done in";
  return (
    <span
      className={cn(
        "flex shrink-0 items-center gap-1 tabular-nums",
        outcome === "failed" && "text-destructive",
      )}
      data-palot-subagent-state={running ? "running" : (outcome ?? "done")}
    >
      {running ? <PulseDot className="size-1.5" aria-hidden="true" /> : null}
      {label}{" "}
      <ElapsedTime
        startedAt={execution?.startedAt ?? session.createdAt}
        completedAt={execution?.completedAt ?? session.idleAt ?? null}
        running={running}
        titlePrefix={running ? "Running for" : "Ran for"}
      />
      <span aria-hidden="true">·</span>
    </span>
  );
}

function modelName(model: PalotSession["model"]): string | null {
  if (!model) return null;
  return model.variant ? `${model.id} ${model.variant}` : model.id;
}

/**
 * The composer's context bar in a subagent task. OpenCode runs a message sent here in the
 * subagent, then reports the round back to the main task and wakes it.
 */
export function SubagentComposerNote() {
  return (
    <div
      className="flex h-6 min-w-0 items-center gap-1 px-1.5 text-meta leading-none text-muted-foreground"
      data-palot-subagent-composer-note=""
    >
      <BrainCircuit className="size-3 shrink-0" aria-hidden="true" />
      <span className="truncate">
        Messages go to this subagent; it reports back to the main task
      </span>
    </div>
  );
}

export function SubagentSessionDock({ session }: { session: PalotSession }) {
  const { openSession } = usePalotNavigation();
  const parentID = session.parentID;
  const siblings = useChildSessions(parentID);
  const execution = useSessionActivity().data?.execution.get(session.id) ?? null;

  if (!parentID) return null;
  const index = siblings.findIndex((candidate) => candidate.id === session.id);
  const previous = index > 0 ? siblings[index - 1] : null;
  const next = index >= 0 && index < siblings.length - 1 ? siblings[index + 1] : null;
  const presentation = sessionPresentation(session);

  return (
    <div className="mx-auto w-[calc(100%-40px)] max-w-[760px] pb-3 max-[720px]:w-[calc(100%-22px)]">
      <div
        className="flex min-w-0 items-center gap-2 rounded-xl border border-border/70 bg-background/95 px-2.5 py-2 shadow-lg backdrop-blur-sm"
        data-palot-subagent-session={session.id}
      >
        <BrainCircuit className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-medium text-foreground/85">
            {presentation.agent} subagent
            {siblings.length > 0 && index >= 0 ? ` · ${index + 1} of ${siblings.length}` : ""}
          </span>
          <span className="flex min-w-0 items-center gap-1 text-micro text-muted-foreground">
            <SubagentDockState session={session} execution={execution} />
            <span className="min-w-0 truncate">
              {[presentation.description, modelName(session.model)].filter(Boolean).join(" · ")}
            </span>
          </span>
        </span>
        {/* The task header's breadcrumb owns navigation back to the parent. */}
        {index >= 0 && siblings.length > 1 ? (
          <>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={!previous}
              aria-label="Previous subagent"
              onClick={() => {
                if (previous) void openSession(previous.id);
              }}
            >
              <ChevronLeft aria-hidden="true" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={!next}
              aria-label="Next subagent"
              onClick={() => {
                if (next) void openSession(next.id);
              }}
            >
              <ChevronRight aria-hidden="true" />
            </Button>
          </>
        ) : null}
      </div>
    </div>
  );
}
