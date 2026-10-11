import {
  ArrowRight,
  ArrowUpLeft,
  BrainCircuit,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  CornerDownRight,
  CircleHelp,
  LoaderCircle,
  SendToBack,
  Square,
} from "lucide-react";
import { useAtomValue } from "jotai";
import { memo, useMemo, useState } from "react";
import type { PalotMessage, PalotRunningShell, PalotSession } from "../../shared";
import { belongsToSession, runtimeAtom, type SessionExecutionState } from "../atoms/workspace";
import { usePalotNavigation } from "../hooks/use-navigation";
import { useSessionActivity } from "../hooks/use-session-activity";
import { useChildSessions, useSessionCatalog } from "../hooks/use-session-catalog";
import { useSessionFamilyRequestViews } from "../hooks/use-session-requests";
import { cn } from "../lib/cn";
import { writeClipboardText } from "../lib/clipboard";
import { canFetchOpenCode } from "../lib/opencode-runtime-query";
import { projectToolExecution, type SubagentExecution } from "../lib/tool-executions";
import {
  type TranscriptBackgroundFacts,
  type TranscriptBackgroundToolSource,
  type TurnActivityGroup,
} from "../lib/turn-projection";
import { MarkdownContent } from "./markdown-content";
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

function sessionPresentation(session: PalotSession | undefined) {
  const title = session?.title?.trim() || "Delegated task";
  const match = title.match(/^(.*?)\s+\(@([^()]+) subagent\)$/i);
  return {
    agent: titleCase(match?.[2] ?? session?.agent ?? "subagent"),
    description: match?.[1]?.trim() || title,
  };
}

function statusPresentation(
  state: SessionExecutionState | undefined,
  fallback: SubagentExecution["status"] | TurnActivityGroup["status"],
) {
  if (state?.status === "running") {
    return { label: "Running", running: true, failed: false };
  }
  if (state?.status === "failed") {
    return { label: "Failed", running: false, failed: true };
  }
  if (state?.status === "interrupted") {
    return { label: "Stopped", running: false, failed: false };
  }
  if (state?.status === "succeeded" || state?.status === "inactive") {
    return { label: "Finished", running: false, failed: false };
  }
  if (fallback === "running" || fallback === "pending") {
    return { label: "Running", running: true, failed: false };
  }
  if (fallback === "failed" || fallback === "error") {
    return { label: "Failed", running: false, failed: true };
  }
  if (fallback === "interrupted") return { label: "Stopped", running: false, failed: false };
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
  const { openSession } = usePalotNavigation();
  const sessions = useSessionCatalog();
  const states = useSessionActivity().data?.execution ?? new Map();
  const view = useMemo(() => subagentExecution(group), [group]);
  const session = view ? resolveSubagentSession(view, sessions, parentSessionID) : undefined;
  const childID = view?.sessionID ?? session?.id ?? null;
  const needsInput = useSessionFamilyRequestViews(childID).length > 0;
  const presentation = sessionPresentation(session);
  const state = childID ? states.get(childID) : undefined;
  const status = statusPresentation(state, view?.status ?? group.status);
  const runtime = useAtomValue(runtimeAtom);
  const [stopping, setStopping] = useState(false);
  const [stopError, setStopError] = useState<string | null>(null);
  if (!view) return null;
  const agent = titleCase(view.agent || presentation.agent);
  const description = view.description || presentation.description;
  const statusLabel = needsInput ? "needs input" : status.label.toLowerCase();
  const visibleStatus = needsInput || status.failed || status.label === "Stopped";
  const connectionID = runtime && canFetchOpenCode(runtime) ? runtime.connectionID : null;
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
    <div className="my-1 min-w-0">
      <div className="flex min-w-0 items-center rounded-md border border-border/60 bg-muted/15 transition-colors hover:bg-muted/30">
        <button
          type="button"
          disabled={!childID}
          onClick={() => {
            if (childID) void openSession(childID);
          }}
          className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md pr-2 pl-2.5 text-left text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:opacity-80"
          aria-label={`${agent} subagent ${statusLabel}: ${description}`}
          data-palot-subagent-launch={childID ?? group.id}
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
          {view.background ? (
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
              startedAt={state?.startedAt ?? view.startedAt}
              completedAt={state?.completedAt ?? null}
              running={status.running}
              fallbackDurationMs={view.background ? null : view.durationMs}
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
              <LoaderCircle
                className="animate-spin motion-reduce:animate-none"
                aria-hidden="true"
              />
            ) : (
              <Square aria-hidden="true" />
            )}
          </Button>
        ) : null}
      </div>
      {stopError ? (
        <p role="alert" className="m-0 px-2.5 pt-1 text-meta text-destructive">
          {stopError}
        </p>
      ) : null}
    </div>
  );
}

export function SubagentResponse({ group }: { group: TurnActivityGroup }) {
  const { openSession } = usePalotNavigation();
  const sessions = useSessionCatalog();
  const states = useSessionActivity().data?.execution ?? new Map();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const part = group.entries[0]?.part;
  const data = record(part?.data);
  const childID = string(data.childID);
  const session = childID ? sessions.find((candidate) => candidate.id === childID) : undefined;
  const presentation = sessionPresentation(session);
  const agent = titleCase(string(data.agent) ?? presentation.agent);
  const description = part?.name ?? presentation.description ?? group.title;
  const response = part?.text?.trim() ?? "";
  const state = childID ? states.get(childID) : undefined;
  const status = statusPresentation(state, group.status);
  if (!part) return null;
  const returnedAt = group.entries[0]?.message.createdAt ?? null;
  const sessionDuration =
    session && returnedAt !== null ? Math.max(0, returnedAt - session.createdAt) : null;

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="my-1 min-w-0 rounded-md border border-border/60 bg-muted/15"
      data-palot-subagent-response={childID ?? "unknown"}
    >
      {/* One quiet line, paired with the launch row; the task link lives in the expanded body. */}
      <CollapsibleTrigger
        render={
          <button
            type="button"
            aria-label={`${agent} ${status.failed ? "failed" : "returned"}: ${description}`}
            className="flex h-8 w-full min-w-0 items-center gap-2 rounded-md pr-2 pl-2.5 text-left text-xs outline-none transition-colors hover:bg-muted/30 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          />
        }
      >
        <CornerDownRight
          className={cn(
            "size-3.5 shrink-0",
            status.failed ? "text-destructive" : "text-muted-foreground",
          )}
          aria-hidden="true"
        />
        <span className="min-w-0 flex-1 truncate">
          <span
            className={cn("font-medium", status.failed ? "text-destructive" : "text-foreground/85")}
          >
            {agent} {status.failed ? "failed" : "returned"}
          </span>
          <span className="text-muted-foreground"> · {description}</span>
        </span>
        <span className="flex shrink-0 items-center gap-1.5 tabular-nums text-muted-foreground/70">
          <ElapsedTime
            startedAt={state?.startedAt ?? null}
            completedAt={state?.completedAt ?? null}
            running={status.running}
            fallbackDurationMs={sessionDuration}
            titlePrefix="Returned after"
          />
          {open ? (
            <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          ) : (
            <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          )}
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent className="border-t border-border/50 px-3 py-3">
        {response ? (
          <MarkdownContent
            value={response}
            className="max-h-[32rem] overflow-y-auto pr-2 text-xs/relaxed text-foreground/80"
          />
        ) : (
          <p className="m-0 text-xs text-muted-foreground">No response content was provided.</p>
        )}
        {response || childID ? (
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
            {response ? (
              <Button
                type="button"
                variant="ghost"
                size="xs"
                onClick={() => {
                  void writeClipboardText(response);
                  setCopied(true);
                }}
              >
                <Copy data-icon="inline-start" aria-hidden="true" />
                {copied ? "Copied" : "Copy response"}
              </Button>
            ) : null}
          </div>
        ) : null}
      </CollapsibleContent>
    </Collapsible>
  );
}

export interface SubagentWorkItem {
  kind: "subagent";
  id: string;
  agent: string;
  description: string;
  startedAt: number;
  fallbackStatus: SubagentExecution["status"] | TurnActivityGroup["status"];
  background: boolean;
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
      background: false,
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
  return [
    ...shells.map((item) => ({ ...item, kind: "shell" as const })),
    ...subagents
      .filter((item) => input.states.get(item.id)?.status === "running")
      .map((item) => ({
        ...item,
        kind: "subagent" as const,
        startedAt: input.states.get(item.id)?.startedAt ?? item.startedAt,
      })),
  ].toSorted((left, right) => left.startedAt - right.startedAt);
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

  return (
    <div className="flex max-h-72 flex-col overflow-y-auto">
      {subagents.map((item) => (
        <SubagentWorkRow key={item.id} item={item} state={states.get(item.id)} onClose={onClose} />
      ))}
    </div>
  );
}

function SubagentWorkRow({
  item,
  state,
  onClose,
}: {
  item: SubagentWorkItem;
  state: SessionExecutionState | undefined;
  onClose(): void;
}) {
  const { openSession } = usePalotNavigation();
  const needsInput = useSessionFamilyRequestViews(item.id).length > 0;
  const status = statusPresentation(state, item.fallbackStatus);
  return (
    <button
      type="button"
      className="flex min-w-0 items-center gap-2 rounded-md px-2 py-2 text-left outline-none hover:bg-muted focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
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
          {item.agent} ·{" "}
          {needsInput ? "Needs input" : item.background ? "Background" : status.label}
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

function describeBackgroundableWork(items: BackgroundWorkItem[]): string {
  const shells = items.filter((item) => item.kind === "shell").length;
  const subagents = items.length - shells;
  return [
    shells > 0 ? `${shells} ${shells === 1 ? "shell command" : "shell commands"}` : null,
    subagents > 0 ? `${subagents} ${subagents === 1 ? "subagent" : "subagents"}` : null,
  ]
    .filter((label): label is string => label !== null)
    .join(" and ");
}

export const BackgroundWorkPrompt = memo(function BackgroundWorkPrompt({
  items,
  backgrounding,
  retry,
  error,
  onBackground,
}: {
  items: BackgroundWorkItem[];
  backgrounding: boolean;
  retry: boolean;
  error: string | null;
  onBackground(): void;
}) {
  if (items.length === 0) return null;
  const singleItem = items.length === 1 ? items[0] : null;
  const blocker = singleItem
    ? singleItem.kind === "shell"
      ? singleItem.command === "Shell command"
        ? "The shell command is"
        : `The shell command '${singleItem.command}' is`
      : `The subagent '${singleItem.description}' is`
    : `${describeBackgroundableWork(items)} are`;

  return (
    <div
      className="relative z-10 mb-2 flex min-h-9 min-w-0 items-center gap-2 rounded-xl border border-border/70 bg-card/96 px-2.5 py-1.5 shadow-lg backdrop-blur-sm"
      data-palot-background-work-prompt
    >
      <span className="min-w-0 flex-1 text-xs font-medium text-foreground/85">
        {blocker} blocking your message from steering this turn.
        {error ? <span className="ml-1 text-destructive">{error}</span> : null}
      </span>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="shrink-0"
        aria-label={
          retry
            ? "Retry sending blocking work to background"
            : "Send blocking work to background so the message can steer this turn"
        }
        disabled={backgrounding}
        onClick={onBackground}
      >
        {backgrounding ? (
          <LoaderCircle data-icon="inline-start" className="animate-spin" aria-hidden="true" />
        ) : (
          <SendToBack data-icon="inline-start" aria-hidden="true" />
        )}
        {retry ? "Try again" : "Send to background"}
      </Button>
    </div>
  );
});

export function SubagentSessionDock({ session }: { session: PalotSession }) {
  const { openSession } = usePalotNavigation();
  const parentID = session.parentID;
  const siblings = useChildSessions(parentID);

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
          <span className="block truncate text-micro text-muted-foreground">
            {presentation.description} · Read-only session
          </span>
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void openSession(parentID)}
        >
          <ArrowUpLeft data-icon="inline-start" aria-hidden="true" />
          Parent task
        </Button>
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
