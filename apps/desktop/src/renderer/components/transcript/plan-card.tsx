import {
  ChevronDown,
  ChevronRight,
  Circle,
  CircleCheck,
  CircleSlash,
  ListChecks,
} from "lucide-react";
import { useMemo, useState } from "react";
import type { PalotMessage } from "../../../shared";
import { cn } from "../../lib/cn";
import { BoundedScroll } from "./bounded-scroll";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../ui/collapsible";
import { Progress } from "../ui/progress";
import { PulseDot } from "../ui/pulse-dot";
import { latestPlan, type PlanItem, type PlanItemStatus } from "./plan";

interface PlanDisclosure {
  open: boolean;
  /** Completion state when the choice was made; a change restores the default. */
  complete: boolean;
}

// Per task, for this window's lifetime only.
const planDisclosures = new Map<string, PlanDisclosure>();

export function resetPlanDisclosuresForTest(): void {
  planDisclosures.clear();
}

const STATUS_LABEL: Record<PlanItemStatus, string> = {
  pending: "Pending",
  in_progress: "In progress",
  completed: "Done",
  cancelled: "Cancelled",
};

function PlanStatusIcon({ status }: { status: PlanItemStatus }) {
  if (status === "completed") {
    return <CircleCheck className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />;
  }
  if (status === "in_progress") {
    return <PulseDot className="size-3.5 [&>span]:bg-foreground/80" aria-hidden="true" />;
  }
  if (status === "cancelled") {
    return (
      <CircleSlash className="size-3.5 shrink-0 text-muted-foreground/60" aria-hidden="true" />
    );
  }
  return <Circle className="size-3.5 shrink-0 text-muted-foreground/60" aria-hidden="true" />;
}

function PlanRow({ item }: { item: PlanItem }) {
  return (
    <li
      className="flex min-w-0 items-start gap-2 py-1 text-xs/relaxed"
      data-palot-plan-item={item.status}
    >
      <span className="flex h-[1.625em] shrink-0 items-center">
        <PlanStatusIcon status={item.status} />
      </span>
      <span
        className={cn(
          "min-w-0 flex-1 break-words",
          item.status === "in_progress" && "font-medium text-foreground",
          item.status === "pending" && "text-foreground/80",
          item.status === "completed" && "text-muted-foreground",
          item.status === "cancelled" && "text-muted-foreground/60 line-through",
        )}
      >
        {item.content}
      </span>
      <span className="sr-only">{STATUS_LABEL[item.status]}</span>
    </li>
  );
}

/**
 * The agent's current plan, pinned above the composer. Hidden without a plan;
 * collapses once every item is done unless the person reopens it.
 */
export function PlanCard({ sessionID, messages }: { sessionID: string; messages: PalotMessage[] }) {
  const plan = useMemo(() => latestPlan(messages), [messages]);
  const [disclosure, setDisclosure] = useState(() => planDisclosures.get(sessionID) ?? null);
  const [interacted, setInteracted] = useState(false);
  if (!plan) return null;
  const open =
    disclosure && disclosure.complete === plan.complete ? disclosure.open : !plan.complete;
  const progress = plan.total === 0 ? 100 : Math.round((plan.done / plan.total) * 100);
  const summary = `${plan.done}/${plan.total} done`;

  return (
    <section
      aria-label="Plan"
      data-palot-plan-card={plan.complete ? "complete" : "active"}
      className="mx-auto mb-2 w-[calc(100%-32px)] max-w-[860px] overflow-hidden rounded-xl border border-border/70 bg-card/96 shadow-lg backdrop-blur-sm max-[720px]:w-[calc(100%-20px)]"
    >
      <Collapsible
        open={open}
        onOpenChange={(value) => {
          const next = { open: value, complete: plan.complete };
          planDisclosures.set(sessionID, next);
          setDisclosure(next);
          setInteracted(true);
        }}
      >
        <CollapsibleTrigger
          render={
            <button
              type="button"
              className="flex h-8 w-full min-w-0 items-center gap-2 px-3 text-left text-xs outline-none transition-colors hover:bg-muted/30 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            />
          }
        >
          <ListChecks className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="shrink-0 font-medium text-foreground/85">Plan</span>
          <span className="shrink-0 tabular-nums text-muted-foreground">· {summary}</span>
          {!open && plan.inProgress ? (
            <span className="min-w-0 flex-1 truncate text-muted-foreground">
              · {plan.inProgress.content}
            </span>
          ) : (
            <span className="flex-1" />
          )}
          {open ? (
            <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          ) : (
            <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          )}
        </CollapsibleTrigger>
        <Progress
          value={progress}
          aria-label={`Plan progress, ${summary}`}
          className="px-3 pb-1.5 [&_[data-slot=progress-track]]:h-0.5"
        />
        <CollapsibleContent smooth animate={interacted}>
          <BoundedScroll className="border-t border-border/50" viewportClassName="max-h-56">
            <ol className="m-0 list-none px-3 py-1.5">
              {plan.items.map((item, index) => (
                <PlanRow key={`${index}:${item.id}`} item={item} />
              ))}
            </ol>
          </BoundedScroll>
        </CollapsibleContent>
      </Collapsible>
    </section>
  );
}
