/**
 * The panels behind the composer's tabs: plan, goal, background work, undo staged and voice.
 * Props in, callbacks out; the caller formats times and owns every action.
 */

import {
  Bot,
  Check,
  Circle,
  Mic,
  MicOff,
  Pause,
  Pencil,
  PhoneOff,
  Play,
  RotateCcw,
  SquareTerminal,
  Target,
  Terminal,
  Undo2,
  Volume2,
  VolumeX,
  X,
  type LucideIcon,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import type * as React from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ComposerPanelBody } from "@/components/ui/composer";
import { Progress } from "@/components/ui/progress";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { cn } from "@/lib/cn";
import { spring } from "@/lib/springs";
import type { BackgroundItemView, GoalView, PlanItemView, VoiceView } from "./types";

type PanelProps = Omit<React.ComponentProps<"div">, "children">;

/** The plan: a progress bar and its steps, the running one in its active wording. */
export function PlanPanel({
  items,
  className,
  ...props
}: PanelProps & { items: readonly PlanItemView[] }) {
  const reduceMotion = useReducedMotion();
  const done = items.filter((item) => item.status === "done").length;
  return (
    <div
      data-slot="plan-panel"
      className={cn("flex min-h-0 flex-col gap-2 pt-3 pb-2", className)}
      {...props}
    >
      <div className="flex items-center gap-3 px-4">
        <span className="text-compact font-medium">Plan</span>
        <Progress
          aria-label="Plan progress"
          value={done}
          max={items.length || 1}
          className="h-1 flex-1"
        />
        <span className="text-meta text-muted-foreground tabular-nums">
          {done === items.length ? "All done" : `${done} of ${items.length} done`}
        </span>
      </div>
      <ComposerPanelBody>
        <ol className="m-0 flex list-none flex-col px-4 py-0">
          {items.map((item, index) => (
            <li
              // Plan steps have no identity beyond their place.
              key={index}
              className={cn(
                "flex min-h-7 items-center gap-2.5 text-compact transition-colors duration-300",
                item.status === "running"
                  ? "text-foreground"
                  : item.status === "pending"
                    ? "text-foreground/75"
                    : "text-muted-foreground",
              )}
            >
              <span className="flex size-3.5 shrink-0 items-center justify-center">
                <AnimatePresence initial={false} mode="wait">
                  <motion.span
                    key={item.status}
                    className="flex"
                    initial={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.5 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, transition: spring.fast.exit }}
                    transition={reduceMotion ? spring.moderate : spring.slow}
                  >
                    <PlanStatusIcon status={item.status} />
                  </motion.span>
                </AnimatePresence>
              </span>
              <span
                className={cn(
                  "truncate",
                  (item.status === "done" || item.status === "cancelled") &&
                    "line-through decoration-foreground/25",
                )}
              >
                {item.status === "running" ? (item.active ?? item.text) : item.text}
              </span>
            </li>
          ))}
        </ol>
      </ComposerPanelBody>
    </div>
  );
}

function PlanStatusIcon({ status }: { status: PlanItemView["status"] }) {
  switch (status) {
    case "done":
      return <Check role="img" aria-label="Done" className="size-3.5 text-success" />;
    case "running":
      return (
        <span
          role="img"
          aria-label="In progress"
          className="size-2 rounded-full bg-foreground motion-safe:animate-pulse"
        />
      );
    case "cancelled":
      return <X role="img" aria-label="Cancelled" className="size-3.5 text-muted-foreground" />;
    case "pending":
      return (
        <Circle role="img" aria-label="Pending" className="size-3.5 text-muted-foreground/60" />
      );
  }
}

const GOAL_STATUS: Record<GoalView["status"], string> = {
  active: "Pursuing goal",
  paused: "Goal paused",
  complete: "Goal met",
};

/** The goal: objective, state and round, with Pause or Resume and Clear (Dismiss once met). */
/** OpenCode's own limit on a goal objective. */
export const MAX_GOAL_OBJECTIVE = 4_000;
/** Words `/goal` reads as a control, not an objective. */
const GOAL_CONTROLS = new Set(["pause", "resume", "clear"]);

/** Why an edited objective can't be saved, or null when it can. */
export function goalObjectiveProblem(text: string): string | null {
  const objective = text.trim();
  if (!objective) return "Enter an objective.";
  if (GOAL_CONTROLS.has(objective.toLowerCase()))
    return `"${objective}" is a /goal control word, not an objective.`;
  if (objective.length > MAX_GOAL_OBJECTIVE)
    return `Objectives are limited to ${MAX_GOAL_OBJECTIVE.toLocaleString()} characters.`;
  return null;
}

export function GoalPanel({
  goal,
  busy = false,
  onPause,
  onResume,
  onClear,
  onEdit,
  className,
  ...props
}: PanelProps & {
  goal: GoalView;
  busy?: boolean;
  onPause?: () => void;
  onResume?: () => void;
  onClear?: () => void;
  /** Sets the goal again with a new objective; resolves true once OpenCode accepted it. */
  onEdit?: (objective: string) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  if (draft !== null && onEdit) {
    return (
      <GoalEditor
        className={className}
        {...props}
        initial={draft}
        busy={busy}
        onCancel={() => setDraft(null)}
        onSave={async (objective) => {
          if (await onEdit(objective)) setDraft(null);
        }}
      />
    );
  }
  const detail =
    goal.status === "active" && goal.round > 0
      ? `${GOAL_STATUS.active} · round ${goal.round} of ${goal.rounds}`
      : GOAL_STATUS[goal.status];
  return (
    <div
      data-slot="goal-panel"
      className={cn("flex items-start gap-3 px-4 py-3", className)}
      {...props}
    >
      <Target
        aria-hidden="true"
        className={cn(
          "mt-0.5 size-4 shrink-0",
          goal.status === "paused"
            ? "text-warning"
            : goal.status === "complete"
              ? "text-success"
              : "text-muted-foreground",
        )}
      />
      <div className="min-w-0 flex-1">
        <p className="m-0 text-sm leading-snug break-words whitespace-pre-wrap">{goal.objective}</p>
        <p className="m-0 mt-1 text-meta text-muted-foreground">
          {detail}
          {goal.reason ? ` · ${goal.reason}` : null}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {onEdit && goal.status !== "complete" ? (
          <Button
            size="sm"
            variant="ghost"
            aria-label="Edit goal"
            disabled={busy}
            onClick={() => setDraft(goal.objective)}
          >
            <Pencil aria-hidden="true" />
            Edit
          </Button>
        ) : null}
        {goal.status === "active" ? (
          <Button
            size="sm"
            variant="outline"
            aria-label="Pause goal"
            disabled={busy}
            onClick={onPause}
          >
            <Pause aria-hidden="true" />
            Pause
          </Button>
        ) : goal.status === "paused" ? (
          <Button
            size="sm"
            variant="outline"
            aria-label="Resume goal"
            disabled={busy}
            onClick={onResume}
          >
            <Play aria-hidden="true" />
            Resume
          </Button>
        ) : null}
        <Button
          size="sm"
          variant="ghost"
          aria-label={goal.status === "complete" ? "Dismiss goal" : "Clear goal"}
          disabled={busy}
          onClick={onClear}
        >
          <X aria-hidden="true" />
          {goal.status === "complete" ? "Dismiss" : "Clear"}
        </Button>
      </div>
    </div>
  );
}

/**
 * The objective in place, editable. OpenCode has no way to change a goal's objective, so saving
 * sets the goal again: it restarts from round 1 and starts working, and the task keeps its history.
 */
function GoalEditor({
  initial,
  busy,
  onSave,
  onCancel,
  className,
  ...props
}: PanelProps & {
  initial: string;
  busy: boolean;
  onSave: (objective: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const problem = goalObjectiveProblem(value);
  const unchanged = value.trim() === initial.trim();
  const save = () => {
    if (problem || unchanged || busy) return;
    void onSave(value.trim());
  };
  return (
    <div
      data-slot="goal-panel"
      data-editing=""
      className={cn("flex items-start gap-3 px-4 py-3", className)}
      {...props}
    >
      <Target aria-hidden="true" className="mt-2 size-4 shrink-0 text-muted-foreground" />
      <form
        className="flex min-w-0 flex-1 flex-col gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        <Textarea
          aria-label="Goal objective"
          aria-invalid={problem !== null && !unchanged ? true : undefined}
          autoFocus
          rows={3}
          value={value}
          disabled={busy}
          className="max-h-40 min-h-16 text-sm"
          onFocus={(event) => {
            const end = event.currentTarget.value.length;
            event.currentTarget.setSelectionRange(end, end);
          }}
          onChange={(event) => setValue(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              onCancel();
            } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              save();
            }
          }}
        />
        <div className="flex flex-wrap items-center gap-2">
          <p className="m-0 min-w-0 flex-1 text-meta text-muted-foreground" aria-live="polite">
            {problem && !unchanged
              ? problem
              : "Saving sets the goal again: it restarts from round 1 and starts working."}
          </p>
          <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={busy || unchanged || problem !== null}>
            Save goal
          </Button>
        </div>
      </form>
    </div>
  );
}

const BACKGROUND_ICON: Record<BackgroundItemView["kind"], LucideIcon> = {
  agent: Bot,
  command: SquareTerminal,
  terminal: Terminal,
};

/** Work running beside the turn: subagents, commands and terminals, each with Stop. */
export function BackgroundWorkPanel({
  items,
  onStop,
  onStopAll,
  className,
  ...props
}: PanelProps & {
  items: readonly BackgroundItemView[];
  onStop?: (id: string) => void;
  onStopAll?: () => void;
}) {
  const running = items.filter((item) => !item.finished).length;
  return (
    <div
      data-slot="background-work-panel"
      className={cn("flex min-h-0 flex-col px-1.5 pt-1.5 pb-1", className)}
      {...props}
    >
      <ComposerPanelBody>
        <ul aria-label="Running work" className="m-0 flex list-none flex-col p-0">
          {items.map((item) => {
            const Icon = BACKGROUND_ICON[item.kind];
            return (
              <li
                key={item.id}
                className="flex h-8 items-center gap-2.5 rounded-md px-2.5 text-compact"
              >
                <Icon aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
                <span
                  className={cn(
                    "min-w-0 flex-1 truncate",
                    item.kind !== "agent" && "font-mono text-code",
                  )}
                >
                  {item.label}
                </span>
                {item.finished ? (
                  <span className="flex shrink-0 items-center gap-1 text-meta text-success">
                    <Check aria-hidden="true" className="size-3" />
                    Finished
                  </span>
                ) : (
                  <>
                    {item.elapsed ? (
                      <span className="shrink-0 text-meta text-muted-foreground tabular-nums">
                        {item.elapsed}
                      </span>
                    ) : null}
                    <Button
                      size="xs"
                      variant="ghost"
                      aria-label={`Stop ${item.label}`}
                      className="text-meta!"
                      onClick={() => onStop?.(item.id)}
                    >
                      Stop
                    </Button>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      </ComposerPanelBody>
      {running > 1 && onStopAll ? (
        <div className="flex justify-end px-1 pt-0.5">
          <Button
            size="xs"
            variant="ghost"
            className="text-meta! text-muted-foreground"
            onClick={onStopAll}
          >
            Stop all
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/** The last turn's changes staged for undo: the files, Restore and Finalize undo. */
export function UndoStagedPanel({
  files,
  description = "The last turn's changes are staged for undo.",
  busy = false,
  onRestore,
  onFinalize,
  className,
  ...props
}: PanelProps & {
  files: readonly string[];
  /** What is staged ("2 messages and 3 changed files"). */
  description?: React.ReactNode;
  busy?: boolean;
  onRestore?: () => void;
  onFinalize?: () => void;
}) {
  return (
    <div
      data-slot="undo-staged-panel"
      className={cn("flex items-center gap-3 px-4 py-3", className)}
      {...props}
    >
      <Undo2 aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <p className="m-0 text-compact">{description}</p>
        {files.length ? (
          <ul aria-label="Staged files" className="m-0 flex list-none flex-wrap gap-1 p-0">
            {files.map((file) => (
              <li
                key={file}
                title={file}
                className="max-w-48 truncate rounded-md border border-border bg-muted/50 px-1.5 font-mono text-code-compact"
              >
                {file}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button size="sm" variant="ghost" disabled={busy} onClick={onRestore}>
          <RotateCcw aria-hidden="true" />
          Restore
        </Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={onFinalize}>
          Finalize undo
        </Button>
      </div>
    </div>
  );
}

const VOICE_PHASE: Record<VoiceView["phase"], string> = {
  connecting: "Connecting…",
  listening: "Listening",
  thinking: "Working on it",
  speaking: "Speaking",
};

/**
 * A live voice chat: its orb, phase, time and latest caption, with mute for the microphone and
 * the voice, and End. The caller renders the orb; without one a quiet dot stands in.
 */
export function VoicePanel({
  voice,
  orb,
  onToggleMute,
  onToggleOutput,
  onEnd,
  className,
  ...props
}: PanelProps & {
  voice: VoiceView;
  orb?: React.ReactNode;
  onToggleMute?: () => void;
  onToggleOutput?: () => void;
  onEnd?: () => void;
}) {
  const live = !voice.micMuted && voice.phase !== "connecting";
  const status = voice.status ?? (voice.micMuted ? "Muted" : VOICE_PHASE[voice.phase]);
  return (
    <div
      data-slot="voice-panel"
      className={cn("flex items-center gap-3 px-4 py-3", className)}
      {...props}
    >
      <span
        aria-hidden={orb ? undefined : true}
        className="relative flex size-8 shrink-0 items-center justify-center"
      >
        {orb ?? (
          <>
            {live ? (
              <span className="absolute inset-0 rounded-full bg-info/25 motion-safe:animate-ping [animation-duration:2s]" />
            ) : null}
            <span
              className={cn(
                "relative size-6 rounded-full",
                live ? "bg-linear-to-br from-info to-chart-4" : "bg-muted-foreground/40",
              )}
            />
          </>
        )}
      </span>
      <div className="min-w-0 flex-1">
        <p className="m-0 truncate text-compact font-medium" aria-live="polite">
          {status}
          {voice.elapsed ? (
            <span className="font-normal text-muted-foreground tabular-nums">
              {" "}
              · {voice.elapsed}
            </span>
          ) : null}
        </p>
        {voice.caption ? (
          <p
            className={cn(
              "m-0 text-meta text-muted-foreground",
              voice.outputMuted ? "line-clamp-3 text-foreground" : "truncate",
            )}
          >
            “{voice.caption}”
          </p>
        ) : null}
      </div>
      <div
        className="flex shrink-0 items-center gap-1"
        role="group"
        aria-label="Voice chat controls"
      >
        <Button
          size="icon-sm"
          variant="ghost"
          aria-pressed={voice.micMuted}
          aria-label={voice.micMuted ? "Unmute microphone" : "Mute microphone"}
          title={voice.micMuted ? "Unmute microphone" : "Mute microphone"}
          disabled={voice.starting}
          onClick={onToggleMute}
        >
          {voice.micMuted ? <MicOff aria-hidden="true" /> : <Mic aria-hidden="true" />}
        </Button>
        {onToggleOutput ? (
          <Button
            size="icon-sm"
            variant="ghost"
            aria-pressed={voice.outputMuted ?? false}
            aria-label={voice.outputMuted ? "Unmute voice" : "Mute voice and show captions"}
            title={voice.outputMuted ? "Unmute voice" : "Mute voice and show captions"}
            disabled={voice.starting}
            onClick={onToggleOutput}
          >
            {voice.outputMuted ? <VolumeX aria-hidden="true" /> : <Volume2 aria-hidden="true" />}
          </Button>
        ) : null}
        {onEnd ? (
          <Button size="sm" variant="destructive" disabled={voice.ending} onClick={onEnd}>
            <PhoneOff aria-hidden="true" data-icon="inline-start" />
            {voice.starting ? "Cancel" : voice.ending ? "Ending…" : "End"}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
