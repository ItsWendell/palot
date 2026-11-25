/**
 * The row's context menu. The app passes its real task menu through `renderRowMenu` (plan
 * 103: `SessionContextMenu`), with the list's own entries as its first group; without one,
 * the list shows a small menu of its own entries, for the showcase and tests.
 */

import type { ReactElement } from "react";
import { useState } from "react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { formatSnoozeMenuTime, sessionSnoozeChoices } from "@/lib/session-snooze";
import { canSettle } from "@/lib/task-list/model/status";
import type { Task } from "@/lib/task-list/types";
import { useController, type RowMenuContext } from "./context";

/** Pin, read or unread, Settle or Move back: what only the list knows how to do. */
export function RowMenuItems({ task }: { task: Task }) {
  const controller = useController();
  const settled = task.settledAt !== null;
  return (
    <>
      <ContextMenuItem onClick={() => void controller.togglePin(task.id)}>
        {task.pinnedAt !== null ? "Unpin" : "Pin"}
        <ContextMenuShortcut>P</ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuItem onClick={() => void controller.toggleUnread(task.id)}>
        {task.unread ? "Mark as read" : "Mark as unread"}
        <ContextMenuShortcut>U</ContextMenuShortcut>
      </ContextMenuItem>
      {settled ? (
        <ContextMenuItem onClick={() => void controller.unsettle(task.id)}>
          Move back
        </ContextMenuItem>
      ) : (
        <ContextMenuItem
          disabled={!canSettle(task)}
          onClick={() => void controller.settle([task.id])}
        >
          Settle
          <ContextMenuShortcut>E</ContextMenuShortcut>
        </ContextMenuItem>
      )}
    </>
  );
}

export function useRowMenuContext(task: Task): RowMenuContext {
  const controller = useController();
  return {
    items: <RowMenuItems task={task} />,
    snooze: (until) => void controller.snooze([task.id], until),
    rename: () => controller.startRename(task.id),
  };
}

/** The list's own menu, used when the app passes no `renderRowMenu`. */
export function DefaultRowMenu({ task, row }: { task: Task; row: ReactElement }) {
  const controller = useController();
  const [now, setNow] = useState(() => Date.now());
  return (
    <ContextMenu onOpenChange={(open) => open && setNow(Date.now())}>
      <ContextMenuTrigger render={row} />
      <ContextMenuContent className="w-60">
        <ContextMenuGroup>
          <ContextMenuItem onClick={() => controller.open(task.id, { newWindow: true })}>
            Open in new window
          </ContextMenuItem>
          <ContextMenuItem
            onClick={() => controller.open(task.id, { newWindow: true, background: true })}
          >
            Open in background
          </ContextMenuItem>
          <RowMenuItems task={task} />
          <ContextMenuSub>
            <ContextMenuSubTrigger>Snooze</ContextMenuSubTrigger>
            <ContextMenuSubContent className="w-52">
              {sessionSnoozeChoices.map(([label, resolve]) => (
                <ContextMenuItem
                  key={label}
                  onClick={() => void controller.snooze([task.id], resolve(Date.now()))}
                >
                  {label}
                  <span className="ml-auto text-muted-foreground tabular-nums">
                    {formatSnoozeMenuTime(resolve(now))}
                  </span>
                </ContextMenuItem>
              ))}
            </ContextMenuSubContent>
          </ContextMenuSub>
          <ContextMenuItem onClick={() => controller.startRename(task.id)}>
            Rename
            <ContextMenuShortcut>F2</ContextMenuShortcut>
          </ContextMenuItem>
        </ContextMenuGroup>
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive" onClick={() => controller.requestDelete(task.id)}>
          Delete task…
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
