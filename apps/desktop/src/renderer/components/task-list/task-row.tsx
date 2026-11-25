/**
 * The one row. One line for idle, read tasks; two when there is something to say; three in
 * "Needs you", where the third line acts. The trailing slot shows exactly one thing: the
 * status mark, else the time, replaced on hover or focus by the row's actions.
 */

import { CalendarClock, MessageCircle } from "lucide-react";
import { memo, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { cn } from "@/lib/cn";
import { formatSnoozeWakeTime } from "@/lib/session-snooze";
import { prefersReducedMotion } from "@/hooks/use-reduced-motion";
import { plural } from "@/lib/task-list/model/format";
import { rowFields, type RowFields } from "@/lib/task-list/model/row";
import type { RowLines } from "@/lib/task-list/model/sections";
import {
  currentRequest,
  needsYou,
  rowActions,
  STATUS_RANK,
  statusSentence,
  type Placement,
  type TaskStatus,
} from "@/lib/task-list/model/status";
import { lastInputWasKeyboard, useController, useRenderRowMenu, useTaskList } from "./context";
import type { Task } from "@/lib/task-list/types";
import { countRowRender } from "./debug";
import {
  DRAFT_LABEL,
  DraftMark,
  PullRequestMark,
  RelativeTime,
  StatusMark,
  StatusSentence,
} from "./marks";
import { RequestLine, RequestPager } from "./request-line";
import { RowActions } from "./row-actions";
import { DefaultRowMenu, useRowMenuContext } from "./row-menu";

export interface TaskRowProps {
  rowKey: string;
  placement: Placement;
  lines: RowLines;
  size: number;
  /** Set for the virtualised main list; shelf rows flow. */
  top: number | null;
  level: number;
}

export const TaskRow = memo(function TaskRow({
  rowKey,
  placement,
  lines,
  size,
  top,
  level,
}: TaskRowProps) {
  const controller = useController();
  const task = useTaskList((state) => state.tasks[rowKey]);
  const status = useTaskList((state) => state.statuses[rowKey]);
  const open = useTaskList((state) => state.openTaskID === rowKey);
  const tabbable = useTaskList((state) => state.focusKey === rowKey);
  const selected = useTaskList((state) => state.selection.keys.includes(rowKey));
  const number = useTaskList((state) =>
    state.numbersShown ? state.jumpKeys.indexOf(rowKey) + 1 || null : null,
  );
  const renaming = useTaskList((state) => state.renaming === rowKey);
  const menuOpen = useTaskList((state) => state.menuKey === rowKey);
  const projectName = useTaskList((state) => {
    const projectID = state.tasks[rowKey]?.projectID;
    return projectID ? state.projects.find((item) => item.id === projectID)?.name : undefined;
  });
  const surfaceRef = useRef<HTMLDivElement>(null);
  const renderRowMenu = useRenderRowMenu();

  // Each commit of this row, for the render-count tests.
  useEffect(() => countRowRender(rowKey));
  usePulse(surfaceRef, task?.attentionAt ?? null);

  if (!task || !status) return null;
  const style: CSSProperties =
    top === null
      ? { height: size }
      : { position: "absolute", top, height: size, left: 0, right: 0 };
  const sentence = statusSentence(status, Date.now());
  // Project and branch are always in the name, whatever the row shows.
  const where = task.projectID ? [projectName, task.branch].filter(Boolean).join(" · ") : "Chat";
  // The open task's draft is in front of you; the mark is for tasks you left.
  const draft = Boolean(task.draft) && !open;
  const label = [task.title, where, sentence, draft ? DRAFT_LABEL : null]
    .filter(Boolean)
    .join(", ");

  const row = (
    <div
      role="treeitem"
      aria-level={level}
      aria-selected={selected}
      aria-current={open ? "page" : undefined}
      aria-label={label}
      tabIndex={tabbable ? 0 : -1}
      data-palot-task-row={rowKey}
      data-sidebar-fluid-row=""
      data-row-key={rowKey}
      data-focus-key={rowKey}
      data-entry-key={rowKey}
      data-inbox-sweep-key={rowKey}
      data-open={open || undefined}
      data-menu-open={menuOpen || undefined}
      data-lines={lines}
      data-placement={placement}
      data-status={status.kind}
      className={cn(
        "group/row @container/row outline-none select-none",
        // What the row's surface looks like now, so the overlaid actions fade into it exactly.
        "[--row-surface:var(--sidebar)] hover:[--row-surface:color-mix(in_oklch,var(--sidebar-accent)_72%,var(--sidebar))] focus-visible:[--row-surface:color-mix(in_oklch,var(--sidebar-accent)_72%,var(--sidebar))] data-menu-open:[--row-surface:color-mix(in_oklch,var(--sidebar-accent)_72%,var(--sidebar))]",
        "aria-selected:[--row-surface:var(--sidebar-accent)] data-open:[--row-surface:var(--sidebar-accent)] data-[inbox-sweep=true]:[--row-surface:var(--accent)]",
        top !== null && "px-2",
      )}
      style={style}
      onFocus={(event) => {
        if (event.target === event.currentTarget) controller.focus(rowKey, lastInputWasKeyboard());
      }}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey) controller.toggleSelect(rowKey);
        else if (event.shiftKey) controller.selectTo(rowKey);
        else {
          controller.focus(rowKey, false);
          controller.open(rowKey);
        }
      }}
      onDoubleClick={() => controller.startRename(rowKey)}
      // Middle-click opens the task in a new window behind this one, like a background tab.
      onMouseDown={(event) => {
        if (event.button === 1) event.preventDefault();
      }}
      onAuxClick={(event) => {
        if (event.button !== 1) return;
        event.preventDefault();
        controller.open(rowKey, { newWindow: true, background: true });
      }}
    >
      <div
        ref={surfaceRef}
        data-slot="row-surface"
        className={cn(
          "relative flex h-[calc(100%-2px)] translate-y-px flex-col justify-center rounded-md px-2 text-sidebar-foreground",
          "group-focus-visible/row:ring-2 group-focus-visible/row:ring-sidebar-ring group-focus-visible/row:ring-inset",
          "group-data-open/row:bg-(--palot-sidebar-selected)",
          "group-aria-selected/row:bg-sidebar-accent group-aria-selected/row:ring-1 group-aria-selected/row:ring-sidebar-ring/40 group-aria-selected/row:ring-inset",
          "group-data-[inbox-sweep=true]/row:bg-accent group-data-[inbox-sweep=true]/row:ring-1 group-data-[inbox-sweep=true]/row:ring-ring group-data-[inbox-sweep=true]/row:ring-inset",
        )}
      >
        <RowBody
          task={task}
          status={status}
          placement={placement}
          lines={lines}
          number={number}
          renaming={renaming}
          draft={draft}
        />
      </div>
    </div>
  );
  return renderRowMenu ? (
    <AppRowMenu task={task} row={row} render={renderRowMenu} />
  ) : (
    <DefaultRowMenu task={task} row={row} />
  );
});

function AppRowMenu({
  task,
  row,
  render,
}: {
  task: Task;
  row: React.ReactElement;
  render: NonNullable<ReturnType<typeof useRenderRowMenu>>;
}) {
  return <>{render(task, row, useRowMenuContext(task))}</>;
}

function RowBody({
  task,
  status,
  placement,
  lines,
  number,
  renaming,
  draft,
}: {
  task: Task;
  status: TaskStatus;
  placement: Placement;
  lines: RowLines;
  number: number | null;
  renaming: boolean;
  draft: boolean;
}) {
  const server = useTaskList((state) => state.servers.find((item) => item.id === task.serverID));
  const offline = server ? !server.online : false;
  const muted =
    offline ||
    placement === "snoozed" ||
    placement === "settled" ||
    status.kind === "stale" ||
    status.kind === "stopped";
  const strong = STATUS_RANK[status.kind] <= 4 && placement !== "settled";
  const actions = rowActions(task, status.kind, placement);
  const grouping = useTaskList((state) => state.options.grouping);
  const idleRows = useTaskList((state) => state.options.idleRows);
  const project = useTaskList((state) => state.projects.find((item) => item.id === task.projectID));
  const fields = rowFields({ status, placement, lines, grouping, idleRows });
  const inline = fields.trailing === "project-time" && !number;

  return (
    <>
      <div className="flex h-5 min-w-0 items-center gap-2">
        {renaming ? (
          <RenameField taskID={task.id} title={task.title} />
        ) : (
          <span
            className={cn(
              "flex min-w-0 flex-1 items-center gap-1 text-compact",
              // Project inline: the title truncates first, the project name second.
              inline && "min-w-[45%]",
              strong ? "font-semibold text-sidebar-foreground" : "text-sidebar-foreground/88",
              muted && "font-normal text-sidebar-foreground/55",
            )}
          >
            <span className="truncate">{task.title}</span>
            {task.schedule ? (
              <CalendarClock
                className="size-3 shrink-0 text-sidebar-foreground/45"
                aria-label={`Scheduled · ${task.schedule}`}
              />
            ) : null}
            {draft ? <DraftMark /> : null}
          </span>
        )}
        <span
          data-slot="trailing"
          className={cn(
            "flex h-5 min-w-4 items-center justify-end gap-2 text-meta text-sidebar-foreground/45",
            inline ? "min-w-0 shrink" : "shrink-0",
            // The row's actions replace the whole trailing area, never share it.
            actions.length > 0 &&
              "group-hover/row:opacity-0 group-focus-visible/row:opacity-0 group-data-[menu-open]/row:opacity-0",
          )}
        >
          {inline ? (
            <span className="flex max-w-20 min-w-0 items-center text-sidebar-foreground/40 @max-[230px]/row:max-w-12">
              <Where name={project?.name ?? null} />
            </span>
          ) : null}
          {number ? (
            <Kbd className="h-4 min-w-4 px-1 text-micro">{number}</Kbd>
          ) : fields.trailing === "snoozed" ? (
            <StatusMark kind="snoozed" />
          ) : fields.trailing === "status" ? (
            <StatusMark kind={status.kind} />
          ) : (
            <span className="shrink-0">
              <RelativeTime
                at={placement === "settled" ? (task.settledAt ?? task.activityAt) : task.activityAt}
              />
            </span>
          )}
        </span>
      </div>
      <div className="flex min-w-0 flex-col">
        {lines >= 2 ? (
          <SecondLine task={task} status={status} fields={fields} lines={lines} />
        ) : null}
        {lines >= 3 ? (
          <RequestLine task={task} kind={status.kind} disabled={offline} lines={lines} />
        ) : null}
      </div>
      {renaming ? null : <RowActions rowKey={task.id} actions={actions} disabled={offline} />}
    </>
  );
}

function SecondLine({
  task,
  status,
  fields,
  lines,
}: {
  task: Task;
  status: TaskStatus;
  fields: RowFields;
  lines: RowLines;
}) {
  const grouping = useTaskList((state) => state.options.grouping);
  const multiServer = useTaskList((state) => state.servers.length > 1);
  const project = useTaskList((state) => state.projects.find((item) => item.id === task.projectID));
  const server = useTaskList((state) => state.servers.find((item) => item.id === task.serverID));
  const attention = STATUS_RANK[status.kind] <= 4;
  // A chat (no project) never shows a branch, a worktree or a pull request.
  const chat = task.projectID === null;
  const branch = chat ? null : task.branch;
  const projectBranch = <Where name={project?.name ?? null} branch={branch} />;
  // Only the context the grouping does not already give.
  const where =
    fields.context === "project-branch" ? (
      projectBranch
    ) : branch ? (
      <span className="truncate">{branch}</span>
    ) : null;
  const pager = needsYou(status.kind) && task.requests.length > 1;
  // Two-line idle rows: where the task belongs, and nothing else.
  if (fields.second === "project-branch" || fields.second === "branch") {
    const idleWhere =
      fields.second === "branch" ? (
        chat ? (
          <Where name={null} />
        ) : (
          <span className="truncate">{branch ?? "Project folder"}</span>
        )
      ) : (
        projectBranch
      );
    return (
      <div className="mt-0.5 flex h-4 min-w-0 items-center text-meta text-sidebar-foreground/45">
        {idleWhere}
      </div>
    );
  }
  return (
    <div className="mt-0.5 flex h-4 min-w-0 items-center gap-2 text-meta">
      <span
        className={cn(
          "min-w-0 shrink truncate",
          attention ? "text-sidebar-foreground/72" : "text-sidebar-foreground/50",
        )}
      >
        {fields.second === "until" && task.snoozedUntil ? (
          `Until ${formatSnoozeWakeTime(task.snoozedUntil)}`
        ) : (
          // A permission row's third line shows the full command where it fits; a subagent
          // note always stays.
          <StatusSentence
            status={status}
            detailClassName={
              status.kind === "approval" && (currentRequest(task)?.from ?? null) === null
                ? lines === 4
                  ? "hidden"
                  : "@min-[251px]/row:hidden"
                : undefined
            }
          />
        )}
        {task.subagents > 0 && fields.second === "status" ? (
          <span className="text-sidebar-foreground/50"> · {plural(task.subagents, "agent")}</span>
        ) : null}
      </span>
      {pager ? (
        <span className="text-sidebar-foreground/55">
          <RequestPager task={task} />
        </span>
      ) : (
        <span className="ml-auto flex max-w-[45%] min-w-0 shrink-[10] items-center justify-end gap-1.5 overflow-hidden text-sidebar-foreground/40">
          {where ? (
            <span className="flex min-w-0 items-center @max-[250px]/row:hidden">{where}</span>
          ) : null}
          {multiServer && grouping !== "server" && server ? (
            <span className="shrink-0 rounded-sm border border-sidebar-border px-1 text-micro leading-3.5 @max-[250px]/row:hidden">
              {server.name}
            </span>
          ) : null}
          {task.pr && !chat ? <PullRequestMark pr={task.pr} /> : null}
        </span>
      )}
    </div>
  );
}

function RenameField({ taskID, title }: { taskID: string; title: string }) {
  const controller = useController();
  const [draft, setDraft] = useState(title);
  const inputRef = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);
  return (
    <Input
      ref={inputRef}
      aria-label="Task title"
      value={draft}
      className="-mx-1 h-6 flex-1 px-1 text-compact"
      onChange={(event) => setDraft(event.target.value)}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onBlur={() => void controller.rename(taskID, draft)}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Enter") {
          event.preventDefault();
          void controller.rename(taskID, draft);
          controller.focusRow(taskID);
        }
        if (event.key === "Escape") {
          event.preventDefault();
          controller.startRename(null);
          controller.focusRow(taskID);
        }
      }}
    />
  );
}

/** A task that starts needing you pulses its outline once. */
function usePulse(ref: React.RefObject<HTMLDivElement | null>, attentionAt: number | null) {
  useEffect(() => {
    const element = ref.current;
    if (!element || attentionAt === null || Date.now() - attentionAt > 1_500) return;
    if (prefersReducedMotion()) return;
    element.animate(
      [
        { boxShadow: "inset 0 0 0 1.5px var(--warning)" },
        { boxShadow: "inset 0 0 0 1.5px transparent" },
      ],
      { duration: 900, easing: "cubic-bezier(0.4, 0, 0.2, 1)" },
    );
  }, [ref, attentionAt]);
}

/** Where a task belongs, as a row shows it: "palot · feature/turns", or "Chat" for a chat. */
function Where({ name, branch = null }: { name: string | null; branch?: string | null }) {
  if (name === null)
    return (
      <span className="flex min-w-0 items-center gap-1" title="Chat, no project">
        <MessageCircle className="size-3 shrink-0" aria-hidden="true" />
        <span className="truncate">Chat</span>
      </span>
    );
  return <span className="min-w-0 truncate">{branch ? `${name} · ${branch}` : name}</span>;
}
