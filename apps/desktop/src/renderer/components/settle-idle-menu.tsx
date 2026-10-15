import { CheckCheck } from "lucide-react";
import { useState } from "react";
import { idleInboxTasks, type InboxSessionView } from "../lib/session-inbox";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { toast } from "./ui/toast";

const DAY_MS = 24 * 60 * 60 * 1_000;
const IDLE_CHOICES = [
  { label: "Idle for 1 day", idleForMs: DAY_MS },
  { label: "Idle for 3 days", idleForMs: 3 * DAY_MS },
  { label: "Idle for 1 week", idleForMs: 7 * DAY_MS },
] as const;

/**
 * Inbox section action: settle every listed task that can settle and has been idle for a
 * chosen time. Callers pass the rows the section shows, so filters narrow the batch.
 */
export function SettleIdleMenu<T extends InboxSessionView>({
  items,
  disabled = false,
  onSettle,
}: {
  items: readonly T[];
  disabled?: boolean;
  onSettle(items: T[]): void;
}) {
  const [now, setNow] = useState(() => Date.now());
  const choices = [
    ...IDLE_CHOICES.map((choice) => ({
      label: choice.label,
      items: idleInboxTasks(items, now, choice.idleForMs),
    })),
    { label: "All idle tasks", items: idleInboxTasks(items, now, 0) },
  ];
  return (
    <DropdownMenu onOpenChange={(open) => open && setNow(Date.now())}>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Settle idle tasks"
            title="Settle idle tasks"
            disabled={disabled}
          />
        }
      >
        <CheckCheck aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Settle idle tasks</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {choices.map((choice) => (
            <DropdownMenuItem
              key={choice.label}
              disabled={choice.items.length === 0}
              onClick={() => onSettle(choice.items)}
            >
              {choice.label}
              <span className="ml-auto text-meta text-muted-foreground tabular-nums">
                {choice.items.length}
              </span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** One toast for a batch of settled tasks, with Undo for the whole batch. */
export function announceSettledBatch(input: {
  count: number;
  title?: string;
  description?: string;
  undo(): Promise<unknown>;
}): void {
  const tasks = input.count === 1 ? "1 task" : `${input.count} tasks`;
  toast.add({
    type: "success",
    title: input.title ?? `Settled ${tasks}`,
    ...(input.description ? { description: input.description } : {}),
    actionProps: {
      children: "Undo",
      onClick: () =>
        void input.undo().catch((error: unknown) =>
          toast.add({
            type: "error",
            title: "Could not move tasks back to Inbox",
            description: error instanceof Error ? error.message : undefined,
          }),
        ),
    },
  });
}
