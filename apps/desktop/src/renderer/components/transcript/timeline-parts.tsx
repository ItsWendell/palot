import {
  ArrowRight,
  BookOpen,
  Braces,
  Brain,
  BrainCircuit,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CircleStop,
  Eye,
  Film,
  GitFork,
  ImageIcon,
  RotateCcw,
  Sparkles,
  Target,
  Terminal,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PalotMessageContent, PalotSession } from "../../../shared";
import { LinkedText } from "../link-actions";
import { cn } from "../../lib/cn";
import { formatDurationPrecise } from "../../lib/duration";
import { usageLimitRetryLabel } from "../../lib/usage-limit-reset";
import { BoundedScroll } from "./bounded-scroll";
import { useModelSwitchLabel } from "./model-switch";
import { UsageLimitActions } from "../usage-limit-actions";
import { ClaudeCodeFailureActions } from "../claude-code-failure-actions";
import {
  backgroundReportTitle,
  createReasoningTitle,
  distinctBackgroundReports,
  groupBackgroundReports,
  splitReasoningContent,
  type BackgroundReport,
  type TranscriptNoticeKind,
  type TurnActivityGroup,
  type TurnPart,
} from "../../lib/turn-projection";
import { usePalotNavigation } from "../../hooks/use-navigation";
import { useSessionCatalogSelector } from "../../hooks/use-session-catalog";
import { messageText } from "../../lib/view-models";
import { MarkdownContent } from "../markdown-content";
import { Button } from "../ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../ui/collapsible";
import { ThinkingShimmer } from "../thinking-shimmer";

export function TimelineBoundary({ group }: { group: TurnActivityGroup }) {
  const part = group.entries[0]?.part;
  if (!part) return null;
  const data =
    part.data && typeof part.data === "object" && !Array.isArray(part.data) ? part.data : {};
  const reports = groupBackgroundReports(group);
  if (reports) return <BackgroundReportRow group={group} reports={reports} />;
  if (data.notice === "fork")
    return (
      <ForkNotice
        group={group}
        sessionID={typeof data.sessionID === "string" ? data.sessionID : null}
      />
    );
  if (typeof data.notice === "string" && data.notice in NOTICE_ICONS) {
    const notice = data.notice as TranscriptNoticeKind;
    return (
      <SyntheticUpdate
        group={group}
        icon={NOTICE_ICONS[notice]}
        notice={notice}
        failed={data.state === "error" || data.state === "failed"}
      />
    );
  }
  if (data.kind === "synthetic") return <SyntheticUpdate group={group} />;
  if (data.kind === "model-switch") return <ModelSwitchBoundary group={group} part={part} />;
  return <StandardTimelineBoundary group={group} part={part} />;
}

const NOTICE_ICONS: Record<TranscriptNoticeKind, LucideIcon> = {
  goal: Target,
  fork: GitFork,
  restart: RotateCcw,
  instructions: BookOpen,
  shell: Terminal,
  image: ImageIcon,
  video: Film,
  "console-watch": Eye,
  codemode: Braces,
};

function ModelSwitchBoundary({
  group,
  part,
}: {
  group: TurnActivityGroup;
  part: PalotMessageContent;
}) {
  const label = useModelSwitchLabel(part);
  const named = useMemo(() => ({ ...part, name: label }), [label, part]);
  return <StandardTimelineBoundary group={group} part={named} />;
}

function StandardTimelineBoundary({
  group,
  part,
}: {
  group: TurnActivityGroup;
  part: PalotMessageContent;
}) {
  const data =
    part.data && typeof part.data === "object" && !Array.isArray(part.data) ? part.data : {};
  const detail = part.text?.trim();
  const failed = group.status === "failed";
  const running = group.status === "running";
  const interrupted = group.status === "interrupted";
  const role = failed ? "alert" : running ? "status" : "separator";
  const label = part.name ?? group.title;
  const retryAt = typeof data.at === "number" ? data.at : null;
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!running || retryAt === null) return;
    const interval = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, [retryAt, running]);

  const retryDelay = retryAt === null ? null : Math.max(0, Math.ceil((retryAt - now) / 1_000));
  // A usage or rate limit OpenCode is waiting out: "Usage limit reached · retrying in 40s (attempt 2)".
  const limit = data.tone === "warning" && typeof data.limit === "string" ? data.limit : null;
  const visibleLabel = limit
    ? usageLimitRetryLabel(
        limit,
        typeof data.attempt === "number" ? data.attempt : null,
        running ? retryDelay : null,
      )
    : retryDelay && retryDelay > 0
      ? `${label} in ${retryDelay}s`
      : label;

  if (failed || interrupted) {
    const Icon = failed ? CircleAlert : CircleStop;
    return (
      <div
        className={cn(
          "my-3 flex min-w-0 items-start gap-2.5 rounded-lg border px-3 py-2.5",
          failed ? "border-destructive/25 bg-destructive/[0.045]" : "border-border/60 bg-muted/20",
        )}
        role={role}
        aria-label={label}
        data-palot-boundary={typeof data.kind === "string" ? data.kind : "session"}
      >
        <Icon
          className={cn(
            "mt-0.5 size-3.5 shrink-0",
            failed ? "text-destructive" : "text-muted-foreground/75",
          )}
          aria-hidden="true"
        />
        <div className="min-w-0">
          <p
            className={cn(
              "m-0 text-xs font-medium",
              failed ? "text-destructive" : "text-foreground/80",
            )}
          >
            {label}
          </p>
          {detail ? (
            <p
              className={cn(
                "mt-0.5 mb-0 text-xs/relaxed",
                failed ? "text-destructive/80" : "text-muted-foreground/70",
              )}
            >
              <LinkedText text={detail} />
            </p>
          ) : null}
          {failed ? <UsageLimitActions message={group.entries[0]?.message} /> : null}
          {failed ? <ClaudeCodeFailureActions detail={detail} /> : null}
        </div>
      </div>
    );
  }

  return (
    <div
      className="my-3 flex min-w-0 flex-col gap-1.5"
      role={role}
      aria-label={visibleLabel}
      data-palot-boundary={typeof data.kind === "string" ? data.kind : "session"}
    >
      <div
        className={cn(
          "flex items-center gap-3 text-xs",
          limit ? "text-warning" : "text-muted-foreground/65",
        )}
      >
        <span className="h-px min-w-6 flex-1 bg-border/70" aria-hidden="true" />
        {running ? (
          <ThinkingShimmer className={limit ? "text-warning!" : undefined}>
            {visibleLabel}
          </ThinkingShimmer>
        ) : (
          <span>{label}</span>
        )}
        <span className="h-px min-w-6 flex-1 bg-border/70" aria-hidden="true" />
      </div>
      {detail ? (
        <p
          className={cn(
            "m-0 text-center text-xs/relaxed",
            limit ? "whitespace-pre-line text-warning/80" : "text-muted-foreground/55",
          )}
        >
          <LinkedText text={detail} />
        </p>
      ) : null}
    </div>
  );
}

/** The source task's title for the notice OpenCode queues in a new fork, once the catalog has it. */
function ForkNotice({ group, sessionID }: { group: TurnActivityGroup; sessionID: string | null }) {
  const selectSource = useCallback(
    (sessions: PalotSession[]) => {
      const fork = sessionID ? sessions.find((session) => session.id === sessionID) : undefined;
      const source = fork?.forkedFrom
        ? sessions.find((session) => session.id === fork.forkedFrom)
        : undefined;
      return source ? source.title?.trim() || "Untitled task" : null;
    },
    [sessionID],
  );
  const source = useSessionCatalogSelector(selectSource);
  return (
    <SyntheticUpdate
      group={group}
      icon={GitFork}
      notice="fork"
      label={source ? `Forked from ${source}` : undefined}
    />
  );
}

/** A quiet one-line notice; a notice with detail expands to show it. */
function SyntheticUpdate({
  group,
  icon: Icon = Sparkles,
  notice,
  failed = false,
  label: labelOverride,
}: {
  group: TurnActivityGroup;
  icon?: LucideIcon;
  notice?: TranscriptNoticeKind;
  failed?: boolean;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const part = group.entries[0]?.part;
  if (!part) return null;
  const detail = part.text?.trim();
  const label = labelOverride ?? part.name ?? group.title;

  if (!detail) {
    return (
      <div
        className="my-2 flex h-7 min-w-0 items-center gap-2 text-xs text-muted-foreground"
        role="status"
        aria-label={label}
        data-palot-synthetic-update={group.id}
        data-palot-notice={notice}
      >
        <Icon
          className={cn("size-3.5 shrink-0", failed && "text-destructive")}
          aria-hidden="true"
        />
        <span className="min-w-0 truncate text-foreground/75">{label}</span>
      </div>
    );
  }

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="my-2 min-w-0 text-muted-foreground"
      data-palot-synthetic-update={group.id}
      data-palot-notice={notice}
    >
      <CollapsibleTrigger
        disabled={!detail}
        render={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 max-w-full justify-start px-0 text-xs font-normal hover:bg-transparent hover:text-foreground aria-expanded:bg-transparent"
          />
        }
      >
        <Icon
          data-icon="inline-start"
          className={cn(failed && "text-destructive")}
          aria-hidden="true"
        />
        <span className="min-w-0 truncate text-left text-foreground/75">{label}</span>
        {detail ? (
          open ? (
            <ChevronDown data-icon="inline-end" aria-hidden="true" />
          ) : (
            <ChevronRight data-icon="inline-end" aria-hidden="true" />
          )
        ) : null}
      </CollapsibleTrigger>
      {detail ? (
        <CollapsibleContent className="ml-5 max-w-3xl">
          <BoundedScroll
            className="rounded-lg border border-border/50 bg-muted/15"
            viewportClassName="max-h-[32rem] px-3 py-2.5"
          >
            <MarkdownContent value={detail} className="text-xs/relaxed text-foreground/75" />
          </BoundedScroll>
        </CollapsibleContent>
      ) : null}
    </Collapsible>
  );
}

/**
 * Background work that reported back after the turn that started it: one row per run of reports
 * with the same kind and outcome, expanding to the list.
 */
function BackgroundReportRow({
  group,
  reports,
}: {
  group: TurnActivityGroup;
  reports: BackgroundReport[];
}) {
  const [open, setOpen] = useState(false);
  const first = reports[0]!;
  const failed = first.outcome === "failed";
  const label = backgroundReportTitle(reports);
  const Icon = first.kind === "subagent" ? BrainCircuit : Terminal;
  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="my-2 min-w-0 text-muted-foreground"
      data-palot-background-report={first.kind}
    >
      <CollapsibleTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 max-w-full justify-start px-0 text-xs font-normal hover:bg-transparent hover:text-foreground aria-expanded:bg-transparent"
          />
        }
      >
        <Icon
          data-icon="inline-start"
          className={cn(failed && "text-destructive")}
          aria-hidden="true"
        />
        <span className="min-w-0 truncate text-left">
          <span className={failed ? "text-destructive" : "text-foreground/75"}>{label}</span>
          {distinctBackgroundReports(reports).length === 1 ? (
            <span className="text-muted-foreground"> · {first.description}</span>
          ) : null}
        </span>
        {open ? (
          <ChevronDown data-icon="inline-end" aria-hidden="true" />
        ) : (
          <ChevronRight data-icon="inline-end" aria-hidden="true" />
        )}
      </CollapsibleTrigger>
      <CollapsibleContent className="ml-5 max-w-3xl">
        <ul className="m-0 flex list-none flex-col gap-0.5 p-0 py-1">
          {distinctBackgroundReports(reports).map((report, index) => (
            <li
              key={
                report.childID ?? (group.entries[index] ? entryKey(group.entries[index]) : index)
              }
            >
              {report.kind === "subagent" ? (
                <SubagentReportItem report={report} />
              ) : (
                <ShellReportItem report={report} />
              )}
            </li>
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
}

function entryKey(entry: TurnPart): string {
  return entry.part.id ?? `${entry.message.id}:${entry.index}`;
}

function agentName(value: string | null): string {
  if (!value) return "Subagent";
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function SubagentReportItem({ report }: { report: BackgroundReport }) {
  const { openSession } = usePalotNavigation();
  const agent = agentName(report.agent);
  const childID = report.childID;
  return (
    <button
      type="button"
      disabled={!childID}
      onClick={() => {
        if (childID) void openSession(childID);
      }}
      aria-label={`Open ${agent} subagent task: ${report.description}`}
      className="flex h-7 w-full min-w-0 items-center gap-2 rounded-md px-1.5 text-left text-xs outline-none transition-colors hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default"
    >
      <span className="min-w-0 flex-1 truncate">
        <span className="font-medium text-foreground/85">{agent}</span>
        <span className="text-muted-foreground"> · {report.description}</span>
      </span>
      {childID ? <ArrowRight className="size-3.5 shrink-0" aria-hidden="true" /> : null}
    </button>
  );
}

function ShellReportItem({ report }: { report: BackgroundReport }) {
  return (
    <div className="flex h-7 min-w-0 items-center gap-2 px-1.5 text-xs">
      <code className="min-w-0 flex-1 truncate font-mono text-code-compact text-foreground/80">
        {report.description}
      </code>
      {report.exit !== null && report.exit !== 0 ? (
        <span className="shrink-0 tabular-nums text-muted-foreground/70">exit {report.exit}</span>
      ) : null}
    </div>
  );
}

export function ThoughtDisclosure({
  entry,
  live,
  defaultOpen = false,
}: {
  entry: TurnPart;
  live: boolean;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const interacted = useRef(false);
  const [animate, setAnimate] = useState(false);
  const text = messageText(entry.message, entry.part).trim();
  const content = useMemo(() => splitReasoningContent(text), [text]);
  const completedAt = entry.part.time?.completed;
  const duration =
    completedAt === undefined || entry.part.time?.created === undefined
      ? null
      : formatDurationPrecise(completedAt - entry.part.time.created);
  const done = completedAt !== undefined || !live;
  const presentationLabel =
    entry.part.presentation === "preamble"
      ? "Update"
      : entry.part.presentation === "recap"
        ? "Recap"
        : "Reasoning";
  const label = `${presentationLabel}${content.title ? `: ${content.title}` : ""}`;
  const compact = !text.includes("\n") || Boolean(content.title && !content.body);
  useEffect(() => {
    if (!interacted.current) setOpen(defaultOpen);
  }, [defaultOpen]);
  if (!text) return null;
  if (compact) {
    const compactLabel = content.title ?? createReasoningTitle(text);
    return (
      <div className="my-0.5 flex h-7 min-w-0 items-center gap-1 text-xs text-muted-foreground">
        <Brain className="size-3 shrink-0" aria-hidden="true" />
        {done ? (
          <span className="min-w-0 flex-1 truncate text-foreground/80">
            {presentationLabel}: {compactLabel}
          </span>
        ) : (
          <ThinkingShimmer className="min-w-0 flex-1 truncate">
            {presentationLabel}: {compactLabel}
          </ThinkingShimmer>
        )}
        {duration ? <span className="shrink-0 tabular-nums opacity-65">{duration}</span> : null}
      </div>
    );
  }

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
            className="h-7 w-full justify-start px-0! text-xs font-normal hover:bg-transparent! hover:text-foreground aria-expanded:bg-transparent!"
          />
        }
      >
        <Brain data-icon="inline-start" aria-hidden="true" />
        {done ? (
          <span className="min-w-0 flex-1 truncate text-left text-foreground/80 transition-colors group-hover/button:text-foreground">
            {label}
          </span>
        ) : (
          <ThinkingShimmer className="min-w-0 flex-1 truncate text-left transition-colors group-hover/button:text-foreground">
            {label}
          </ThinkingShimmer>
        )}
        {duration ? (
          <span className="shrink-0 tabular-nums text-muted-foreground/65 transition-colors group-hover/button:text-foreground/80">
            {duration}
          </span>
        ) : null}
        {open ? (
          <ChevronDown data-icon="inline-end" aria-hidden="true" />
        ) : (
          <ChevronRight data-icon="inline-end" aria-hidden="true" />
        )}
      </CollapsibleTrigger>
      <CollapsibleContent smooth animate={animate} className="min-w-0 pt-1">
        <div className="my-1">
          {content.title && !content.body ? (
            <div className="border-l border-border/70 pl-3 text-xs/relaxed text-muted-foreground">
              {content.title}
            </div>
          ) : null}
          {content.body ? (
            <BoundedScroll label="Reasoning" follow={!done} viewportClassName="max-h-80">
              <MarkdownContent
                value={content.body}
                className="pr-3 text-xs/relaxed text-muted-foreground"
              />
            </BoundedScroll>
          ) : null}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
