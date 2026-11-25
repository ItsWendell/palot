import { useAtom } from "jotai";
import { Brain, ChevronDown, ChevronRight, FileText } from "lucide-react";
import { Fragment, memo, useContext, useEffect, useMemo, useRef, useState } from "react";
import { activityGroupOpenAtomFamily, turnActivityOpenAtomFamily } from "../../atoms/ui";
import { cn } from "../../lib/cn";
import { BoundedScroll } from "./bounded-scroll";
import { projectToolExecution, toolExecutionMachines } from "../../lib/tool-executions";
import { projectArtifactCalls } from "../../lib/artifact-calls";
import {
  activityDetailRows,
  activityFailureCount,
  createReasoningTitle,
  reasoningRowMerges,
  sameTurnActivityGroup,
  splitReasoningContent,
  type TurnActivityGroup,
  type TranscriptTurn,
  type TurnPart,
} from "../../lib/turn-projection";
import { isTool, messageText } from "../../lib/view-models";
import { CompactionBoundary } from "./compaction-row";
import { MessagePartView, MessageRow } from "./message-row";
import { formatDurationPrecise, formatElapsed } from "../../lib/duration";
import { turnWorkSummary, turnWorkSummaryClauses } from "../../lib/turn-work-summary";
import { LiveTurnContext } from "./live-turn-context";
import { useCurrentTime } from "./shared";
import { ThoughtDisclosure, TimelineBoundary } from "./timeline-parts";
import { MarkdownContent } from "../markdown-content";
import { Button } from "../ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../ui/collapsible";
import { ThinkingShimmer } from "../thinking-shimmer";
import { ReadToolExecutionGroup, ToolExecution } from "../tool-execution";
import { SubagentLaunch } from "../subagent-activity";

/**
 * Whether the turn shows the turn bar: a conversation turn with work to fold. Compaction-only
 * turns and returned subagent results show their rows without one.
 */
export function turnShowsBar(turn: TranscriptTurn): boolean {
  return (
    turn.kind !== "subagent" &&
    turn.activity.length > 0 &&
    !turn.activity.every((group) => group.kind === "compaction")
  );
}

/**
 * The bar's opening words; a running turn's clock ticks until the turn ends. The latest turn's
 * outcome waits while subagents it started still run: they report back and wake the task.
 */
function turnBarLead(turn: TranscriptTurn, now: number, runningSubagents: number): string {
  if (turn.status === "working") return `Working for ${formatElapsed(now - turn.startedAt)}`;
  if (runningSubagents > 0) {
    return runningSubagents === 1
      ? "Waiting for 1 subagent"
      : `Waiting for ${runningSubagents} subagents`;
  }
  const end = turn.completedAt ?? turn.workCompletedAt ?? turn.startedAt;
  // A finished turn took some time, so it never reads "0s".
  const duration = formatElapsed(Math.max(1_000, end - turn.startedAt));
  if (turn.status === "interrupted") return `You stopped after ${duration}`;
  if (turn.status === "failed") return `Failed after ${duration}`;
  return `Worked for ${duration}`;
}

interface TurnBarClause {
  text: string;
  failed: boolean;
}

// Settled turns keep their object identity, so their summary is computed once.
const turnBarClauseCache = new WeakMap<TranscriptTurn, TurnBarClause[]>();

function turnBarClauses(turn: TranscriptTurn, runningSubagents: number): TurnBarClause[] {
  if (turn.status === "working" || runningSubagents > 0) return [];
  const cached = turnBarClauseCache.get(turn);
  if (cached) return cached;
  const summary = turnWorkSummary(turn);
  const texts = turnWorkSummaryClauses(summary);
  const clauses = texts.map((text, index) => ({
    text,
    // The failure count is always the last clause.
    failed: summary.failed > 0 && index === texts.length - 1,
  }));
  turnBarClauseCache.set(turn, clauses);
  return clauses;
}

const activityDisclosureTriggerClassName =
  "h-auto min-h-7 max-w-full justify-start py-1 pr-0 pl-0! text-xs font-normal hover:bg-transparent! hover:text-foreground aria-expanded:bg-transparent!";
const activityDisclosureTitleClassName = "min-w-0 truncate text-foreground/85";

function TurnActivitySummary({
  turn,
  runningSubagents = 0,
}: {
  turn: TranscriptTurn;
  runningSubagents?: number;
}) {
  const now = useCurrentTime(turn.status === "working");
  const clauses = turnBarClauses(turn, runningSubagents);
  return (
    <span className="flex min-w-0 flex-1 items-center gap-1 text-left">
      {/* The duration never truncates; the clauses after it do. */}
      <span className="shrink-0 tabular-nums text-foreground/85" data-palot-turn-bar-duration>
        {turnBarLead(turn, now, runningSubagents)}
      </span>
      {clauses.length > 0 ? (
        <span className="min-w-0 truncate text-muted-foreground">
          {clauses.map((clause) => (
            <Fragment key={clause.text}>
              {" · "}
              <span className={cn(clause.failed && "text-destructive")}>{clause.text}</span>
            </Fragment>
          ))}
        </span>
      ) : null}
    </span>
  );
}

function activityAnchors(group: TurnActivityGroup): TurnActivityGroup[] {
  return group.entries.flatMap((entry): TurnActivityGroup[] => {
    if (!isTool(entry.part)) return [];
    // A published artifact is a deliverable: its card stays in view when the activity folds.
    if (
      projectArtifactCalls(entry.part, entry.index)?.calls.some(
        (call) => call.operation === "create" || call.operation === "update",
      )
    ) {
      return [
        {
          id: `artifact:${entryID(entry)}`,
          kind: "tools",
          title: "Artifact",
          status: group.status,
          entries: [entry],
          presentation: "individual",
        },
      ];
    }
    if (
      group.presentation !== "grouped" ||
      projectToolExecution(entry.part, entry.index).kind !== "subagent"
    ) {
      return [];
    }
    return [
      {
        id: entryID(entry),
        kind: "subagent-tool" as const,
        title: "Delegated work",
        status: group.status,
        entries: [entry],
      },
    ];
  });
}

export function TurnActivity({
  turn,
  sessionID,
  preventAutoCollapse = false,
  runningSubagents = 0,
}: {
  turn: TranscriptTurn;
  sessionID: string;
  preventAutoCollapse?: boolean;
  /** Subagents of the task still running; the latest turn's outcome waits for them. */
  runningSubagents?: number;
}) {
  const disclosureAtom = useMemo(
    () => turnActivityOpenAtomFamily(sessionID, turn.id),
    [sessionID, turn.id],
  );
  const [persistedOpen, setPersistedOpen] = useAtom(disclosureAtom);
  const [interacted, setInteracted] = useState(false);
  const defaultOpen = preventAutoCollapse || !turn.shouldAutoCollapse || !turn.canCollapse;
  const canDisclose = turn.blockingRequests.length === 0;
  const open = canDisclose ? (persistedOpen ?? defaultOpen) : true;

  if (turn.activity.length === 0) return null;

  // A returned child is a chronological event, not another timed period of parent work.
  if (turn.kind === "subagent") {
    return <ActivityGroups groups={turn.activity} live={false} sessionID={sessionID} />;
  }

  if (turn.activity.length > 0 && turn.activity.every((group) => group.kind === "compaction")) {
    return (
      <div className="my-2">
        <ActivityGroups
          groups={turn.activity}
          live={turn.status === "working"}
          sessionID={sessionID}
        />
      </div>
    );
  }

  if (!canDisclose) {
    return (
      <div className="my-2">
        <div className="mb-1 flex h-7 items-center gap-1.5 text-meta text-muted-foreground/75">
          <TurnActivitySummary turn={turn} runningSubagents={runningSubagents} />
        </div>
        <ActivityGroups
          groups={turn.activity}
          live={turn.status === "working"}
          sessionID={sessionID}
        />
      </div>
    );
  }

  const pinnedActivity = turn.activity.flatMap((group) => {
    if (group.pinned || group.kind === "subagent-tool") return [group];
    return activityAnchors(group);
  });

  if (pinnedActivity.length > 0) {
    return (
      <Collapsible
        open={open}
        onOpenChange={(value) => {
          setInteracted(true);
          setPersistedOpen(value);
        }}
        data-palot-turn-activity
        className="my-3"
      >
        <CollapsibleTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={activityDisclosureTriggerClassName}
            />
          }
        >
          <TurnActivitySummary turn={turn} runningSubagents={runningSubagents} />
          {open ? (
            <ChevronDown data-icon="inline-end" aria-hidden="true" />
          ) : (
            <ChevronRight data-icon="inline-end" aria-hidden="true" />
          )}
        </CollapsibleTrigger>
        {!open ? (
          <div className="pt-2">
            <ActivityGroups groups={pinnedActivity} live={false} sessionID={sessionID} />
          </div>
        ) : null}
        <CollapsibleContent smooth animate={interacted} className="pt-2">
          <ActivityGroups
            groups={turn.activity}
            live={turn.status === "working"}
            sessionID={sessionID}
          />
        </CollapsibleContent>
      </Collapsible>
    );
  }

  return (
    <Collapsible
      open={open}
      onOpenChange={(value) => {
        setInteracted(true);
        setPersistedOpen(value);
      }}
      data-palot-turn-activity
      className="my-3"
    >
      <CollapsibleTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={activityDisclosureTriggerClassName}
          />
        }
      >
        <TurnActivitySummary turn={turn} runningSubagents={runningSubagents} />
        {open ? (
          <ChevronDown data-icon="inline-end" aria-hidden="true" />
        ) : (
          <ChevronRight data-icon="inline-end" aria-hidden="true" />
        )}
      </CollapsibleTrigger>
      <CollapsibleContent smooth animate={interacted} className="pt-2">
        <ActivityGroups
          groups={turn.activity}
          live={turn.status === "working"}
          sessionID={sessionID}
        />
      </CollapsibleContent>
    </Collapsible>
  );
}

export function ActivityGroups({
  groups,
  live,
  sessionID,
  reveal = false,
  revealGeneration = 0,
}: {
  groups: TurnActivityGroup[];
  live: boolean;
  sessionID: string;
  reveal?: boolean;
  revealGeneration?: number;
}) {
  return (
    <div className="flex flex-col gap-1">
      {groups.map((group, index) => (
        <ActivityGroupItem
          key={group.id}
          group={group}
          live={live && index === groups.length - 1}
          reveal={reveal}
          revealGeneration={revealGeneration}
          sessionID={sessionID}
        />
      ))}
    </div>
  );
}

const ActivityGroupItem = memo(
  function ActivityGroupItem({
    group,
    live,
    reveal,
    revealGeneration,
    sessionID,
  }: {
    group: TurnActivityGroup;
    live: boolean;
    reveal: boolean;
    revealGeneration: number;
    sessionID: string;
  }) {
    if (group.kind === "input") {
      // A prompt sent while the turn was running, in the order the agent received it.
      return (
        <div className="my-2 flex flex-col gap-2">
          {(group.messages ?? []).map((message) => (
            <MessageRow key={message.id} message={message} label="Steer" />
          ))}
        </div>
      );
    }
    if (group.kind === "content") return <ActivityParts entries={group.entries} live={live} />;
    if (group.kind === "compaction") return <CompactionBoundary group={group} />;
    if (group.kind === "boundary") return <TimelineBoundary group={group} />;
    if (group.kind === "subagent-tool") {
      return <SubagentLaunch group={group} parentSessionID={sessionID} />;
    }
    if (
      group.showReasoningSummaries === false &&
      group.entries.every((entry) => entry.part.type === "reasoning")
    ) {
      return (
        <div className="flex min-h-7 flex-col justify-center text-xs text-muted-foreground">
          <span className="text-foreground/75">{group.title}</span>
          {live && group.currentAction ? (
            <ThinkingShimmer className="text-meta">{group.currentAction}</ThinkingShimmer>
          ) : null}
        </div>
      );
    }
    // An individual step's rows have no header. A group that drops its header when the turn
    // settles stays in ActivityGroup so its rows keep their elements (a running subagent card
    // must not remount when the parent's turn ends).
    if (group.presentation === "individual") {
      return (
        <GroupedActivityDetails
          entries={group.entries}
          live={live}
          detailsDefaultOpen={group.detailsDefaultOpen}
          showReasoningSummaries={group.showReasoningSummaries}
          sessionID={sessionID}
          groupSameFileReads={group.groupSameFileReads}
        />
      );
    }
    return (
      <ActivityGroup
        group={group}
        live={live}
        defaultOpen={reveal || group.defaultOpen}
        revealGeneration={revealGeneration}
        sessionID={sessionID}
      />
    );
  },
  (previous, next) =>
    previous.live === next.live &&
    previous.reveal === next.reveal &&
    previous.revealGeneration === next.revealGeneration &&
    previous.sessionID === next.sessionID &&
    sameTurnActivityGroup(previous.group, next.group),
);

/** The OpenCode machines a group's calls worked on, so a folded group still says where it ran. */
function activityGroupMachines(entries: readonly TurnPart[]): string[] {
  const machines: string[] = [];
  for (const entry of entries) {
    if (!isTool(entry.part)) continue;
    for (const machine of toolExecutionMachines(projectToolExecution(entry.part, entry.index)))
      if (!machines.includes(machine)) machines.push(machine);
  }
  return machines;
}

export function ActivityGroup({
  group,
  live,
  defaultOpen = false,
  revealGeneration = 0,
  sessionID = "",
}: {
  group: TurnActivityGroup;
  live: boolean;
  defaultOpen?: boolean;
  revealGeneration?: number;
  sessionID?: string;
}) {
  const disclosureAtom = useMemo(
    () => activityGroupOpenAtomFamily(sessionID, group.id),
    [sessionID, group.id],
  );
  const [persistedOpen, setPersistedOpen] = useAtom(disclosureAtom);
  const [animate, setAnimate] = useState(false);
  const appliedRevealGeneration = useRef(0);
  const failed = activityFailureCount(group);
  // A group too small to be worth folding shows its rows without a header. It keeps the same
  // containers as a headed group, so the rows do not remount when the header comes or goes.
  const headerless = group.headerless === true;
  const forcedOpen = headerless || group.forceOpen === true;
  const open = forcedOpen ? true : (persistedOpen ?? defaultOpen);
  const shimmer = live || group.kind === "compaction";
  const visibleAnchors = headerless ? [] : activityAnchors(group);
  const machines = useMemo(() => activityGroupMachines(group.entries), [group.entries]);

  useEffect(() => {
    if (revealGeneration <= appliedRevealGeneration.current) return;
    appliedRevealGeneration.current = revealGeneration;
    setPersistedOpen(true);
  }, [revealGeneration, setPersistedOpen]);

  return (
    <Collapsible
      open={open}
      onOpenChange={(value) => {
        if (forcedOpen) return;
        setAnimate(true);
        setPersistedOpen(value);
      }}
      data-palot-activity-group={headerless ? undefined : group.kind}
      className={headerless ? "min-w-0" : "my-1 min-w-0 text-muted-foreground"}
    >
      {headerless ? null : (
        <CollapsibleTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={activityDisclosureTriggerClassName}
            />
          }
        >
          <span className="flex min-w-0 flex-1 items-center gap-1 text-left">
            <span className={activityDisclosureTitleClassName}>{group.title}</span>
            {machines.length > 0 ? (
              <span className="shrink-0 truncate text-muted-foreground/80">{` · on ${machines.join(", ")}`}</span>
            ) : null}
            {failed > 0 ? (
              <span className="shrink-0 text-destructive">{` · ${failed} failed`}</span>
            ) : null}
            {shimmer && group.currentAction ? (
              <CurrentActionSuffix action={group.currentAction} />
            ) : null}
          </span>
          {open ? (
            <ChevronDown data-icon="inline-end" aria-hidden="true" />
          ) : (
            <ChevronRight data-icon="inline-end" aria-hidden="true" />
          )}
        </CollapsibleTrigger>
      )}
      {!open && visibleAnchors.length > 0 ? (
        <ActivityGroups groups={visibleAnchors} live={false} sessionID={sessionID} />
      ) : null}
      <CollapsibleContent
        smooth
        animate={animate}
        className={headerless ? "min-w-0" : "min-w-0 pt-1"}
      >
        <GroupedActivityDetails
          entries={group.entries}
          live={live}
          detailsDefaultOpen={group.detailsDefaultOpen}
          showReasoningSummaries={group.showReasoningSummaries}
          sessionID={sessionID}
          groupSameFileReads={group.groupSameFileReads}
        />
      </CollapsibleContent>
    </Collapsible>
  );
}

/** The running group's current action, unless the turn's live line already says it. */
function CurrentActionSuffix({ action }: { action: string }) {
  const live = useContext(LiveTurnContext);
  if (live?.label === action) return null;
  return (
    <ThinkingShimmer className="min-w-0 truncate text-muted-foreground">· {action}</ThinkingShimmer>
  );
}

function GroupedActivityDetails({
  entries,
  live,
  detailsDefaultOpen = false,
  showReasoningSummaries = true,
  sessionID,
  groupSameFileReads = false,
  groupAdjacentReads = true,
}: {
  entries: TurnPart[];
  live: boolean;
  detailsDefaultOpen?: boolean;
  showReasoningSummaries?: boolean;
  sessionID: string;
  groupSameFileReads?: boolean;
  groupAdjacentReads?: boolean;
}) {
  const rows = activityDetailRows(
    entries,
    groupSameFileReads,
    showReasoningSummaries,
    groupAdjacentReads,
  );
  const lastEntry = entries.at(-1);
  return (
    <div className="flex flex-col gap-1">
      {rows.map((row) =>
        row.kind === "reasoning" ? (
          reasoningRowMerges(row.entries) ? (
            <ThoughtGroupDisclosure
              key={row.id}
              entries={row.entries}
              live={live && row.entries.includes(lastEntry!)}
              defaultOpen={showReasoningSummaries}
            />
          ) : (
            <div key={row.id} className="flex flex-col gap-1">
              {row.entries.map((entry) => (
                <ThoughtDisclosure
                  key={entryID(entry)}
                  entry={entry}
                  live={live && entry === lastEntry}
                  defaultOpen={showReasoningSummaries}
                />
              ))}
            </div>
          )
        ) : row.kind === "reads" ? (
          <CompactReadGroup
            key={row.id}
            entries={row.entries}
            sessionID={sessionID}
            defaultOpen={detailsDefaultOpen}
            groupSameFileReads={groupSameFileReads}
          />
        ) : row.kind === "read" ? (
          <ReadToolExecutionGroup
            key={row.id}
            entries={row.entries.map((entry) => ({ part: entry.part, index: entry.index }))}
            defaultOpen={detailsDefaultOpen}
          />
        ) : row.kind === "compaction" ? (
          <CompactionBoundary
            key={row.id}
            group={{
              id: row.id,
              kind: "compaction",
              title: "Compacting context",
              status:
                row.entry.part.status === "failed"
                  ? "failed"
                  : row.entry.part.status === "running"
                    ? "running"
                    : "completed",
              entries: [row.entry],
            }}
          />
        ) : (
          <ActivityPartDetail
            key={row.id}
            entry={row.entry}
            live={live && row.entry.message.completedAt === null}
            defaultOpen={detailsDefaultOpen}
            sessionID={sessionID}
          />
        ),
      )}
    </div>
  );
}

function CompactReadGroup({
  entries,
  sessionID,
  defaultOpen,
  groupSameFileReads,
}: {
  entries: TurnPart[];
  sessionID: string;
  defaultOpen: boolean;
  groupSameFileReads: boolean;
}) {
  const disclosure = useMemo(
    () => activityGroupOpenAtomFamily(sessionID, `reads:${entryID(entries[0]!)}`),
    [sessionID, entries],
  );
  const [persistedOpen, setOpen] = useAtom(disclosure);
  const [animate, setAnimate] = useState(false);
  if (entries.length === 1)
    return (
      <ToolExecution part={entries[0]!.part} index={entries[0]!.index} defaultOpen={defaultOpen} />
    );
  const count = new Set(
    entries.map((entry) => {
      const view = projectToolExecution(entry.part, entry.index);
      return view.kind === "read" ? view.path : "";
    }),
  ).size;
  const open = persistedOpen ?? defaultOpen;
  if (count === 1 && groupSameFileReads) {
    return (
      <ReadToolExecutionGroup
        entries={entries.map((entry) => ({ part: entry.part, index: entry.index }))}
        defaultOpen={defaultOpen}
      />
    );
  }
  return (
    <Collapsible
      open={open}
      onOpenChange={(value) => {
        setAnimate(true);
        setOpen(value);
      }}
      data-palot-read-group
      className="my-0.5 min-w-0 text-muted-foreground"
    >
      <CollapsibleTrigger
        render={<Button variant="ghost" size="sm" className={activityDisclosureTriggerClassName} />}
      >
        <FileText data-icon="inline-start" aria-hidden="true" />
        <span className="min-w-0 flex-1 text-left">
          Read {count} {count === 1 ? "file" : "files"}
        </span>
        {open ? (
          <ChevronDown data-icon="inline-end" aria-hidden="true" />
        ) : (
          <ChevronRight data-icon="inline-end" aria-hidden="true" />
        )}
      </CollapsibleTrigger>
      <CollapsibleContent smooth animate={animate} className="min-w-0 pl-3">
        <GroupedActivityDetails
          entries={entries}
          live={false}
          detailsDefaultOpen={defaultOpen}
          sessionID={sessionID}
          groupSameFileReads={groupSameFileReads}
          groupAdjacentReads={false}
        />
      </CollapsibleContent>
    </Collapsible>
  );
}

function ActivityPartDetail({
  entry,
  live,
  defaultOpen,
  sessionID,
}: {
  entry: TurnPart;
  live: boolean;
  defaultOpen: boolean;
  sessionID: string;
}) {
  if (isTool(entry.part)) {
    const execution = projectToolExecution(entry.part, entry.index);
    if (execution.kind === "subagent") {
      const status =
        execution.status === "error"
          ? "failed"
          : execution.status === "interrupted"
            ? "interrupted"
            : execution.status === "running"
              ? "running"
              : execution.status === "pending"
                ? "pending"
                : "completed";
      return (
        <SubagentLaunch
          group={{
            id: entryID(entry),
            kind: "subagent-tool",
            title: execution.description || "Delegated work",
            status,
            entries: [entry],
          }}
          parentSessionID={sessionID}
        />
      );
    }
  }
  return (
    <MessagePartView
      message={entry.message}
      part={entry.part}
      index={entry.index}
      live={live}
      defaultOpen={defaultOpen}
    />
  );
}

function entryID(entry: TurnPart): string {
  return entry.part.id ?? `${entry.message.id}:${entry.part.type}:${entry.index}`;
}

function ThoughtGroupDisclosure({
  entries,
  live,
  defaultOpen = false,
}: {
  entries: TurnPart[];
  live: boolean;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const interacted = useRef(false);
  const [animate, setAnimate] = useState(false);
  const thoughts = useMemo(
    () =>
      entries.map((entry) => {
        const text = messageText(entry.message, entry.part).trim();
        return {
          id: entryID(entry),
          title: createReasoningTitle(text),
          content: splitReasoningContent(text),
        };
      }),
    [entries],
  );
  const duration = useMemo(() => {
    const created = entries.flatMap((entry) =>
      entry.part.time?.created === undefined ? [] : [entry.part.time.created],
    );
    const completed = entries.flatMap((entry) =>
      entry.part.time?.completed === undefined ? [] : [entry.part.time.completed],
    );
    if (created.length !== entries.length || completed.length !== entries.length) return null;
    return formatDurationPrecise(Math.max(...completed) - Math.min(...created));
  }, [entries]);
  const done = !live || entries.every((entry) => entry.part.time?.completed !== undefined);
  const stateLabel = "Reasoning";
  const title = open ? stateLabel : `${stateLabel}: ${thoughts.at(-1)?.title ?? "Reasoning"}`;
  const summary = `${entries.length} steps${duration ? ` · ${duration}` : ""}`;

  useEffect(() => {
    if (!interacted.current) setOpen(defaultOpen);
  }, [defaultOpen]);

  return (
    <Collapsible
      open={open}
      onOpenChange={(value) => {
        interacted.current = true;
        setAnimate(true);
        setOpen(value);
      }}
      className="my-0.5 min-w-0 text-muted-foreground"
    >
      <CollapsibleTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={`${title} · ${summary}`}
            className="h-7 w-full justify-start px-0! text-xs font-normal hover:bg-transparent! hover:text-foreground aria-expanded:bg-transparent!"
          />
        }
      >
        <Brain data-icon="inline-start" aria-hidden="true" />
        {done ? (
          <span className="min-w-0 flex-1 truncate text-left text-foreground/80 transition-colors group-hover/button:text-foreground">
            {title}
          </span>
        ) : (
          <ThinkingShimmer className="min-w-0 flex-1 truncate text-left transition-colors group-hover/button:text-foreground">
            {title}
          </ThinkingShimmer>
        )}
        <span className="shrink-0 tabular-nums text-muted-foreground/65 transition-colors group-hover/button:text-foreground/80">
          {summary}
        </span>
        {open ? (
          <ChevronDown data-icon="inline-end" aria-hidden="true" />
        ) : (
          <ChevronRight data-icon="inline-end" aria-hidden="true" />
        )}
      </CollapsibleTrigger>
      <CollapsibleContent smooth animate={animate} className="min-w-0 pt-1">
        {/* One train of thought: every step shares a single capped scroll region. */}
        <BoundedScroll
          label="Reasoning steps"
          follow={!done}
          className="my-1 border-l border-border/70"
          viewportClassName="max-h-96"
        >
          <div className="flex flex-col gap-3 pr-3 pl-3 text-xs/relaxed text-muted-foreground">
            {thoughts.map((thought) => (
              <div key={thought.id}>
                {thought.content.title ? (
                  <div className="font-medium text-foreground/80">{thought.content.title}</div>
                ) : null}
                {thought.content.body ? (
                  <MarkdownContent
                    value={thought.content.body}
                    className={cn(
                      "text-xs/relaxed text-muted-foreground",
                      thought.content.title && "mt-1",
                    )}
                  />
                ) : thought.content.title ? null : (
                  thought.title
                )}
              </div>
            ))}
          </div>
        </BoundedScroll>
      </CollapsibleContent>
    </Collapsible>
  );
}

function ActivityParts({ entries, live }: { entries: TurnPart[]; live: boolean }) {
  return (
    <div className="flex flex-col gap-1">
      {entries.map((entry) => (
        <MessagePartView
          key={`${entry.message.id}:${entry.part.id ?? entry.index}`}
          message={entry.message}
          part={entry.part}
          index={entry.index}
          live={live && entry.message.completedAt === null}
        />
      ))}
    </div>
  );
}
