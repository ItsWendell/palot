/**
 * The hover/focus actions over a row's trailing slot. They are overlaid, never laid out, so
 * nothing in the row moves; they are not tab stops (the row's keys reach the same actions).
 */

import { BellRing, Check, Clock3, PinOff, Square, Undo2 } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import type { RowAction } from "@/lib/task-list/model/status";
import { useController } from "./context";

/** Palot's row action look (`INBOX_CARD_ACTION_BUTTON_CLASS`, copied). */
export const ROW_ACTION_CLASS =
  "text-sidebar-foreground/60 hover:bg-transparent! hover:text-sidebar-foreground! focus-visible:ring-1 focus-visible:ring-sidebar-ring";

const ACTIONS: Record<RowAction, { label: string; hint?: string; icon: ReactNode }> = {
  settle: { label: "Settle", hint: "E", icon: <Check aria-hidden="true" /> },
  snooze: { label: "Snooze", hint: "S", icon: <Clock3 aria-hidden="true" /> },
  stop: { label: "Stop", icon: <Square className="size-2.5! fill-current" aria-hidden="true" /> },
  wake: { label: "Wake", icon: <BellRing aria-hidden="true" /> },
  unsettle: { label: "Move back", icon: <Undo2 aria-hidden="true" /> },
  unpin: { label: "Unpin", hint: "P", icon: <PinOff aria-hidden="true" /> },
};

export function RowActions({
  rowKey,
  actions,
  disabled,
}: {
  rowKey: string;
  actions: readonly RowAction[];
  disabled: boolean;
}) {
  const controller = useController();
  if (actions.length === 0) return null;
  const run = (action: RowAction) => {
    if (action === "settle") void controller.settle([rowKey]);
    else if (action === "snooze") controller.openSnoozeMenu([rowKey], rowKey);
    else if (action === "stop") void controller.stop(rowKey);
    else if (action === "wake") void controller.wake(rowKey);
    else if (action === "unsettle") void controller.unsettle(rowKey);
    else void controller.togglePin(rowKey);
  };
  return (
    <div
      data-slot="row-actions"
      className={cn(
        "pointer-events-none absolute top-1 right-1 z-10 flex h-6 items-center pl-5 opacity-0 transition-opacity duration-100",
        "group-hover/row:pointer-events-auto group-hover/row:opacity-100 group-focus-visible/row:pointer-events-auto group-focus-visible/row:opacity-100 group-data-[menu-open]/row:opacity-100",
      )}
      style={{ background: "linear-gradient(to right, transparent, var(--row-surface) 18px)" }}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      {actions.map((action) => {
        const definition = ACTIONS[action];
        return (
          <Tooltip key={action}>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  tabIndex={-1}
                  disabled={disabled}
                  aria-label={definition.label}
                  data-inbox-settle={action === "settle" ? "" : undefined}
                  data-snooze-anchor={action === "snooze" ? rowKey : undefined}
                  className={ROW_ACTION_CLASS}
                  onClick={() => run(action)}
                />
              }
            >
              {definition.icon}
            </TooltipTrigger>
            <TooltipContent>
              {definition.label}
              {definition.hint ? (
                <span className="text-background/60">{definition.hint}</span>
              ) : null}
            </TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}
