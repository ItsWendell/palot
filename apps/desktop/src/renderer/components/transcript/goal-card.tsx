import { ChevronDown, ChevronRight, Pause, Play, Target, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { LocationRef } from "@opencode/client";
import { useAtomValue } from "jotai";
import { runtimeAtom } from "../../atoms/workspace";
import { useSessionGoal } from "../../hooks/use-session-goal";
import { cn } from "../../lib/cn";
import type { SessionGoal, SessionGoalStatus } from "../../lib/session-goal";
import { showErrorToast } from "../../lib/toast-error";
import { formatRelativeTime } from "../../lib/view-models";
import { palot } from "../../services/palot";
import { BoundedScroll } from "./bounded-scroll";
import { Button } from "../ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../ui/collapsible";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";

const STATUS_LABEL: Record<SessionGoalStatus, string> = {
  active: "Pursuing goal",
  paused: "Goal paused",
  complete: "Goal met",
};

const STATUS_TONE: Record<SessionGoalStatus, string> = {
  active: "text-muted-foreground",
  paused: "text-warning",
  complete: "text-success",
};

/** What the reviewer or pause said, labelled for the goal's state. */
export function goalReasonLabel(goal: SessionGoal): string | null {
  if (!goal.reason) return null;
  return goal.status === "paused" ? `Paused: ${goal.reason}` : `Reviewer: ${goal.reason}`;
}

type GoalAction = "pause" | "resume" | "clear";

const FAILURE: Record<GoalAction, string> = {
  pause: "Could not pause the goal",
  resume: "Could not resume the goal",
  clear: "Could not clear the goal",
};

/**
 * The task's `/goal`, pinned above the composer like the plan. One line names the state, the
 * round while it runs, and the objective (or, when paused, why); the reviewer's latest reason
 * opens below. OpenCode runs the loop: these controls send `/goal pause|resume|clear`.
 */
export function GoalCard({ sessionID, location }: { sessionID: string; location: LocationRef }) {
  const goal = useSessionGoal(sessionID, location);
  const runtime = useAtomValue(runtimeAtom);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<GoalAction | null>(null);
  if (!goal) return null;

  const run = async (action: GoalAction) => {
    setPending(action);
    try {
      await palot.runCommand(
        { sessionID, command: "goal", arguments: action },
        runtime?.connectionID,
      );
    } catch (error) {
      showErrorToast(FAILURE[action], error);
    } finally {
      setPending(null);
    }
  };

  const reason = goalReasonLabel(goal);
  const round =
    goal.status === "active" && goal.rounds > 0
      ? `round ${goal.rounds} of ${goal.maxRounds}`
      : null;
  // Paused: why matters more than what. Otherwise the objective.
  const summary = goal.status === "paused" && goal.reason ? goal.reason : goal.objective;

  return (
    <section
      aria-label="Goal"
      data-palot-goal-card={goal.status}
      className="mx-auto mb-2 w-[calc(100%-32px)] max-w-[860px] overflow-hidden rounded-xl border border-border/70 bg-card/96 shadow-lg backdrop-blur-sm max-[720px]:w-[calc(100%-20px)]"
    >
      <span role="status" className="sr-only">
        {STATUS_LABEL[goal.status]}
      </span>
      <Collapsible open={open} onOpenChange={setOpen}>
        <div className="flex h-8 min-w-0 items-center pr-1.5">
          <CollapsibleTrigger
            render={
              <button
                type="button"
                className="flex h-full min-w-0 flex-1 items-center gap-2 pl-3 text-left text-xs outline-none transition-colors hover:bg-muted/30 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              />
            }
          >
            <Target
              className={cn("size-3.5 shrink-0", STATUS_TONE[goal.status])}
              aria-hidden="true"
            />
            <span className="shrink-0 font-medium text-foreground/85">
              {STATUS_LABEL[goal.status]}
            </span>
            {round ? (
              <span className="shrink-0 tabular-nums text-muted-foreground">· {round}</span>
            ) : null}
            {open ? (
              <span className="flex-1" />
            ) : (
              <span className="min-w-0 flex-1 truncate text-muted-foreground">· {summary}</span>
            )}
            {open ? (
              <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            ) : (
              <ChevronRight
                className="size-3.5 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
            )}
          </CollapsibleTrigger>
          {goal.status === "active" ? (
            <GoalButton
              label="Pause goal"
              disabled={pending !== null}
              onClick={() => void run("pause")}
            >
              <Pause />
            </GoalButton>
          ) : goal.status === "paused" ? (
            <GoalButton
              label="Resume goal"
              disabled={pending !== null}
              onClick={() => void run("resume")}
            >
              <Play />
            </GoalButton>
          ) : null}
          <GoalButton
            label={goal.status === "complete" ? "Dismiss" : "Clear goal"}
            disabled={pending !== null}
            onClick={() => void run("clear")}
          >
            <X />
          </GoalButton>
        </div>
        <CollapsibleContent smooth>
          <BoundedScroll className="border-t border-border/50" viewportClassName="max-h-56">
            <div className="flex flex-col gap-1.5 px-3 py-2 text-xs/relaxed">
              <p className="m-0 break-words whitespace-pre-wrap text-foreground/85">
                {goal.objective}
              </p>
              {reason ? <p className="m-0 break-words text-muted-foreground">{reason}</p> : null}
              <p className="m-0 text-micro text-muted-foreground/80 tabular-nums">
                {goal.rounds} of {goal.maxRounds} rounds · Updated{" "}
                {formatRelativeTime(goal.updatedAt)}
              </p>
            </div>
          </BoundedScroll>
        </CollapsibleContent>
      </Collapsible>
    </section>
  );
}

function GoalButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick(): void;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={label}
            disabled={disabled}
            onClick={onClick}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
