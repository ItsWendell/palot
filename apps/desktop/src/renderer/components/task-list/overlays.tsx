/**
 * Popups anchored to a row: the snooze menu (S, the row's clock, the bulk bar) and quick look
 * (Space). One instance each for the whole list; they find their row by key.
 */

import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import { MessageCircle } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { popupMotionClassName } from "@/components/ui/fluid-list";
import { Kbd } from "@/components/ui/kbd";
import { SurfaceBackdrop } from "@/components/ui/surface-backdrop";
import { formatSnoozeMenuTime, sessionSnoozeChoices } from "@/lib/session-snooze";
import { formatDuration, plural } from "@/lib/task-list/model/format";
import type { Task } from "@/lib/task-list/types";
import { useController, useTaskList } from "./context";
import { PullRequestMark, StatusMark, StatusSentence } from "./marks";

function rowElement(key: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-row-key="${CSS.escape(key)}"]`);
}

export function SnoozeMenu() {
  const controller = useController();
  const menu = useTaskList((state) => state.snoozeMenu);
  const now = Date.now();
  return (
    <DropdownMenu
      open={menu !== null}
      onOpenChange={(open) => {
        if (!open) controller.closeSnoozeMenu();
      }}
    >
      <DropdownMenuContent
        anchor={() =>
          menu
            ? (document.querySelector(`[data-snooze-anchor="${CSS.escape(menu.anchor)}"]`) ??
              rowElement(menu.anchor))
            : null
        }
        side="right"
        align="start"
        sideOffset={6}
        className="w-56"
      >
        <DropdownMenuGroup>
          <DropdownMenuLabel>
            {menu && menu.keys.length > 1
              ? `Snooze ${menu.keys.length} tasks until`
              : "Snooze until"}
          </DropdownMenuLabel>
          {sessionSnoozeChoices.map(([label, resolve]) => (
            <DropdownMenuItem
              key={label}
              onClick={() => menu && void controller.snooze(menu.keys, resolve(Date.now()))}
            >
              <span>{label}</span>
              <span className="ml-auto text-muted-foreground tabular-nums">
                {formatSnoozeMenuTime(resolve(now))}
              </span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Space on a row: title, state, branch and pull request, the turn summary, and the last
 * answer when Palot has it in memory. Never fetches.
 */
export function QuickLook() {
  const controller = useController();
  const key = useTaskList((state) => state.quickLook);
  const task = useTaskList((state) => (key ? state.tasks[key] : undefined));
  const status = useTaskList((state) => (key ? state.statuses[key] : undefined));
  const project = useTaskList((state) =>
    task ? state.projects.find((item) => item.id === task.projectID) : undefined,
  );
  const open = Boolean(key && task && status);
  return (
    <PopoverPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) controller.setQuickLook(null);
      }}
    >
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Positioner
          anchor={() => (key ? rowElement(key) : null)}
          side="right"
          align="start"
          sideOffset={10}
          className="palot-glass-positioner isolate z-50 rounded-lg"
        >
          <PopoverPrimitive.Popup
            data-slot="quick-look-content"
            initialFocus={false}
            finalFocus={false}
            className={`isolate z-50 flex w-80 origin-(--transform-origin) flex-col gap-2.5 rounded-lg bg-popover p-3 text-sm text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-hidden ${popupMotionClassName}`}
          >
            <SurfaceBackdrop />
            {task && status ? (
              <>
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <PopoverPrimitive.Title className="m-0 text-compact font-medium">
                      {task.title}
                    </PopoverPrimitive.Title>
                    <p className="m-0 mt-0.5 flex items-center gap-1 truncate text-meta text-muted-foreground">
                      {task.projectID === null ? (
                        <>
                          <MessageCircle className="size-3" aria-hidden="true" />
                          Chat
                        </>
                      ) : (
                        <>
                          <span className="truncate">
                            {[project?.name, task.branch].filter(Boolean).join(" · ")}
                          </span>
                          {task.pr ? <PullRequestMark pr={task.pr} /> : null}
                        </>
                      )}
                    </p>
                  </div>
                  <StatusMark kind={status.kind} className="mt-0.5" />
                </div>
                {status.text ? (
                  <p className="m-0 text-meta text-foreground/80">
                    <StatusSentence status={status} />
                  </p>
                ) : null}
                {task.lastAnswer ? (
                  <div className="rounded-md bg-muted/50 px-2.5 py-2">
                    <p className="m-0 text-micro font-medium text-muted-foreground">Last answer</p>
                    <p className="m-0 mt-1 line-clamp-6 text-compact leading-snug">
                      {task.lastAnswer}
                    </p>
                  </div>
                ) : null}
                {/* An unseen task's sentence is its summary already. */}
                {task.summary && status.kind !== "unseen" ? (
                  <p className="m-0 text-meta text-muted-foreground">{summaryText(task.summary)}</p>
                ) : null}
                <p className="m-0 flex items-center gap-1.5 text-micro text-muted-foreground">
                  <Kbd>Space</Kbd> close <Kbd>↩</Kbd> open
                </p>
              </>
            ) : null}
          </PopoverPrimitive.Popup>
        </PopoverPrimitive.Positioner>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

function summaryText(summary: NonNullable<Task["summary"]>): string {
  const parts = [`Worked for ${formatDuration(summary.durationMs)}`];
  if (summary.filesChanged > 0) parts.push(`changed ${plural(summary.filesChanged, "file")}`);
  if (summary.commands > 0) parts.push(`ran ${plural(summary.commands, "command")}`);
  return parts.join(" · ");
}
