/**
 * The third line of a "Needs you" row: act without opening the task. Permissions get Allow
 * once and Deny, questions up to three option chips and Answer…, failures Retry. A request
 * younger than the guard does not take clicks yet, so a row that just rose under the pointer
 * cannot be approved by accident. Its buttons keep their normal look meanwhile: greyed out for a
 * second and a half they read as broken.
 */

import { ChevronLeft, ChevronRight, Ellipsis } from "lucide-react";
import { useEffect, useState, type MouseEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/cn";
import type { RowLines } from "@/lib/task-list/model/sections";
import { currentRequest, type StatusKind } from "@/lib/task-list/model/status";

import { useController, useTaskList } from "./context";
import type { QuestionRequest, Task } from "@/lib/task-list/types";
import { splitTail } from "../../../shared/text-cut";

const stop = (event: MouseEvent) => event.stopPropagation();

/** False until the guard has passed (`armedAt`); re-renders once when it arms. */
function useArmed(armedAt: number | null): boolean {
  const [now, setNow] = useState(() => Date.now());
  const armed = armedAt === null || now >= armedAt;
  useEffect(() => {
    if (armed || armedAt === null) return;
    const timer = window.setTimeout(() => setNow(Date.now()), armedAt - now);
    return () => window.clearTimeout(timer);
  }, [armed, armedAt, now]);
  return armed;
}

function Line({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      data-slot="request-line"
      data-clip=""
      className={cn("relative z-10 mt-1.5 flex h-6 min-w-0 items-center gap-1", className)}
      onClick={stop}
      onDoubleClick={stop}
    >
      {children}
    </div>
  );
}

export function RequestLine({
  task,
  kind,
  disabled,
  lines,
}: {
  task: Task;
  kind: StatusKind;
  disabled: boolean;
  /** 4: the command gets its own full-width line and the buttons move below it. */
  lines: RowLines;
}) {
  const controller = useController();
  const request = currentRequest(task);
  const armed = useArmed(request ? controller.armedAt(request.id, request.arrivedAt) : null);
  const guarded = useTaskList((state) => state.guarded?.key === task.id);

  if (kind === "failed") {
    return (
      <Line>
        <Button
          size="sm"
          variant="secondary"
          tabIndex={-1}
          className="h-6 px-1.5 text-meta"
          disabled={disabled}
          onClick={() => void controller.retry(task.id)}
        >
          Retry
        </Button>
        <Button
          size="sm"
          variant="ghost"
          tabIndex={-1}
          className="h-6 px-1.5 text-meta"
          onClick={() => controller.open(task.id)}
        >
          Open task
        </Button>
      </Line>
    );
  }
  if (!request) return null;
  const inactive = disabled || !armed;

  if (request.kind === "permission") {
    const notice = (
      <span className="min-w-0 flex-1 truncate text-meta text-sidebar-foreground/70">
        Just arrived · wait a moment
      </span>
    );
    const buttons = (
      <>
        <Button
          size="sm"
          variant="secondary"
          tabIndex={-1}
          className="h-6 px-1.5 text-meta"
          disabled={disabled}
          aria-disabled={!armed || undefined}
          aria-keyshortcuts="A"
          onClick={() => {
            if (armed) void controller.allow(task.id);
          }}
        >
          Allow once
        </Button>
        <Button
          size="sm"
          variant="ghost"
          tabIndex={-1}
          className="h-6 px-1.5 text-meta"
          disabled={disabled}
          aria-disabled={!armed || undefined}
          aria-keyshortcuts="D"
          onClick={() => {
            if (armed) void controller.deny(task.id);
          }}
        >
          Deny
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                size="icon-sm"
                variant="ghost"
                tabIndex={-1}
                aria-label="More request actions"
                className="text-sidebar-foreground/60"
              />
            }
          >
            <Ellipsis aria-hidden="true" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-auto min-w-52">
            {/* OpenCode offers no rule for some requests; then there is nothing to always allow. */}
            {request.rule ? (
              <DropdownMenuItem
                disabled={inactive}
                onClick={() => void controller.allow(task.id, { always: true })}
              >
                Always allow <code className="font-mono text-code-compact">{request.rule}</code>
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem onClick={() => controller.open(task.id)}>Open task</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </>
    );
    if (lines === 4) {
      return (
        <>
          <Line className="h-5">
            {guarded ? (
              notice
            ) : (
              <code
                title={request.detail}
                className="flex h-5 min-w-0 flex-1 items-center rounded-sm bg-sidebar-accent/70 px-1.5 font-mono text-code-compact text-sidebar-foreground/80"
              >
                <MiddleTruncate text={request.detail} />
              </code>
            )}
          </Line>
          <Line className="mt-1 justify-end">{buttons}</Line>
        </>
      );
    }
    return (
      <Line>
        {guarded ? (
          notice
        ) : (
          <code
            title={request.detail}
            className="min-w-0 flex-1 truncate rounded-sm bg-sidebar-accent/70 px-1.5 font-mono text-code-compact leading-6 text-sidebar-foreground/80 @max-[250px]/row:hidden"
          >
            {request.detail}
          </code>
        )}
        <span className="flex-1 @min-[251px]/row:hidden" aria-hidden="true" />
        {buttons}
      </Line>
    );
  }
  // A form the row cannot answer (several fields) comes as a question without options.
  if (request.options.length === 0) {
    return (
      <Line>
        <span className="min-w-0 flex-1 truncate text-meta text-sidebar-foreground/60">
          Answer in the task
        </span>
        <Button
          size="sm"
          variant="secondary"
          tabIndex={-1}
          className="h-6 px-1.5 text-meta"
          onClick={() => controller.open(task.id)}
        >
          Open task
        </Button>
      </Line>
    );
  }
  return (
    <Line>
      {guarded ? (
        <span className="min-w-0 flex-1 truncate text-meta text-sidebar-foreground/70">
          Just arrived · wait a moment
        </span>
      ) : (
        // Chips that do not fit wrap onto a hidden second line instead of truncating to "m…".
        <span data-clip="" className="flex h-6 min-w-0 flex-1 flex-wrap gap-1 overflow-hidden">
          {request.options.slice(0, 3).map((option) => (
            <Button
              key={option}
              size="sm"
              variant="outline"
              tabIndex={-1}
              title={option}
              className="h-6 max-w-28 px-1.5 text-meta"
              disabled={disabled}
              aria-disabled={!armed || undefined}
              onClick={() => {
                if (armed) void controller.answer(task.id, option);
              }}
            >
              <span className="truncate">{option}</span>
            </Button>
          ))}
        </span>
      )}
      <AnswerPopover taskID={task.id} request={request} disabled={inactive} />
    </Line>
  );
}

function AnswerPopover({
  taskID,
  request,
  disabled,
}: {
  taskID: string;
  request: QuestionRequest;
  disabled: boolean;
}) {
  const controller = useController();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const submit = (value: string) => {
    if (!value.trim()) return;
    setOpen(false);
    void controller.answer(taskID, value.trim());
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            size="sm"
            variant="ghost"
            tabIndex={-1}
            className="h-6 shrink-0 px-1.5 text-meta"
            disabled={disabled}
          />
        }
      >
        Answer…
      </PopoverTrigger>
      <PopoverContent side="right" align="start" sideOffset={10} className="w-72 gap-2.5 p-3">
        <p className="m-0 text-compact font-medium">{request.question}</p>
        <div className="flex flex-col gap-1" role="group" aria-label="Options">
          {request.options.map((option, index) => (
            <Button
              key={option}
              variant="ghost"
              className="justify-start gap-2 text-compact font-normal"
              onClick={() => submit(option)}
            >
              <span className="w-3 text-meta text-muted-foreground tabular-nums">{index + 1}</span>
              {option}
            </Button>
          ))}
        </div>
        <form
          className="flex items-center gap-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            submit(text);
          }}
        >
          <Input
            value={text}
            placeholder="Or type an answer"
            aria-label="Your answer"
            className="h-7 text-compact"
            onChange={(event) => setText(event.target.value)}
          />
          <Button type="submit" size="sm" disabled={!text.trim()}>
            Submit
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}

/** "1 of 3" with previous and next, for a task with several pending requests. */
export function RequestPager({ task }: { task: Task }) {
  const controller = useController();
  if (task.requests.length < 2) return null;
  return (
    <span
      className="relative z-10 flex shrink-0 items-center whitespace-nowrap tabular-nums"
      onClick={stop}
    >
      <Button
        variant="ghost"
        size="icon-xs"
        tabIndex={-1}
        aria-label="Previous request"
        className={ROW_PAGER}
        onClick={() => controller.pageRequest(task.id, -1)}
      >
        <ChevronLeft aria-hidden="true" />
      </Button>
      {Math.min(task.requestIndex, task.requests.length - 1) + 1} of {task.requests.length}
      <Button
        variant="ghost"
        size="icon-xs"
        tabIndex={-1}
        aria-label="Next request"
        className={ROW_PAGER}
        onClick={() => controller.pageRequest(task.id, 1)}
      >
        <ChevronRight aria-hidden="true" />
      </Button>
    </span>
  );
}

const ROW_PAGER = "size-4 text-sidebar-foreground/55 hover:text-sidebar-foreground";

/**
 * Truncates in the middle: the end of a command or path (the file, the flag) usually says
 * more than its middle. The head truncates with an ellipsis; the tail always shows.
 */
function MiddleTruncate({ text }: { text: string }) {
  if (text.length <= 16) return <span className="truncate">{text}</span>;
  const { head, tail } = splitTail(text, Math.min(18, Math.floor(text.length * 0.45)));
  return (
    <>
      <span className="min-w-0 truncate">{head}</span>
      <span className="shrink-0 whitespace-pre">{tail}</span>
    </>
  );
}
