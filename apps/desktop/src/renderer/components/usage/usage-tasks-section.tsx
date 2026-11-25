import { useNavigate } from "@tanstack/react-router";
import { useAtomValue } from "jotai";
import { useMemo } from "react";
import { automationSnapshotAtom } from "../../atoms/automations";
import { useAutomations } from "../../hooks/use-automations";
import {
  automationShare,
  mostExpensiveTasks,
  rollUpTasks,
  type UsageTask,
} from "../../lib/usage-analytics";
import { Button } from "../ui/button";
import { Skeleton } from "../ui/skeleton";
import { CURRENCY, NUMBER, PERCENT, formatModelTokens, formatShare } from "./usage-format";
import { useSeenInView } from "./use-in-view";
import { USAGE_TASK_LIMIT, USAGE_TASK_MAX_SESSIONS, useUsageTasks } from "./use-usage-tasks";

/**
 * Most expensive tasks and the automation share of spend. Loads once scrolled near: it pages
 * through `session.list` for every session active in the range, then stays current from
 * `session.usage.updated`.
 */
export function UsageTasksSection({
  from,
  projectID,
  projectNames,
}: {
  from: number;
  projectID: string | null;
  projectNames: ReadonlyMap<string, string>;
}) {
  const [ref, seen] = useSeenInView<HTMLElement>();
  const tasks = useUsageTasks({ from, project: projectID }, seen);
  useAutomations(seen);
  const snapshot = useAtomValue(automationSnapshotAtom);
  const palotRunSessionIDs = useMemo(() => {
    const standalone = new Set(
      snapshot?.automations
        .filter((automation) => automation.destination.type === "standalone")
        .map((automation) => automation.id),
    );
    return new Set(
      snapshot?.runs.flatMap((run) =>
        run.rootSessionID && standalone.has(run.automationID) ? [run.rootSessionID] : [],
      ),
    );
  }, [snapshot]);
  const sessions = tasks.data?.sessions;
  const top = useMemo(
    () => (sessions ? mostExpensiveTasks(rollUpTasks(sessions), USAGE_TASK_LIMIT) : []),
    [sessions],
  );
  const share = useMemo(
    () => (sessions ? automationShare(sessions, palotRunSessionIDs) : null),
    [sessions, palotRunSessionIDs],
  );
  const navigate = useNavigate();
  const openTask = (sessionID: string) =>
    void navigate({ to: "/sessions/$sessionID", params: { sessionID } });

  return (
    <section
      ref={ref}
      aria-label="Tasks and automations"
      aria-busy={tasks.isFetching}
      className="grid gap-5 @min-[52rem]/usage:grid-cols-[minmax(0,1.4fr)_minmax(15rem,0.72fr)]"
    >
      <div className="min-w-0 rounded-xl border border-border/75 p-5">
        <div className="mb-4 grid gap-0.5">
          <h2 className="text-sm font-medium">Most expensive tasks</h2>
          <p className="text-xs text-muted-foreground">
            Lifetime cost of tasks active in this range, subagents included
          </p>
        </div>
        {tasks.data ? (
          top.length ? (
            <ol className="flex flex-col gap-1" aria-label="Most expensive tasks">
              {top.map((task) => (
                <UsageTaskRow
                  key={task.id}
                  task={task}
                  topCost={top[0]?.cost ?? 0}
                  projectName={
                    !projectID && task.projectID ? projectNames.get(task.projectID) : undefined
                  }
                  onOpen={() => openTask(task.id)}
                />
              ))}
            </ol>
          ) : (
            <p className="text-sm text-muted-foreground">No task usage in this range.</p>
          )
        ) : tasks.error ? (
          <div className="flex flex-wrap items-center gap-3 text-sm text-destructive">
            <span>Could not load tasks.</span>
            <Button type="button" variant="outline" size="sm" onClick={() => void tasks.refetch()}>
              Retry
            </Button>
          </div>
        ) : seen ? (
          <Skeleton className="h-40 w-full" />
        ) : (
          <div className="h-40" />
        )}
        {tasks.data?.truncated ? (
          <p className="mt-3 text-meta text-muted-foreground">
            From the {NUMBER.format(USAGE_TASK_MAX_SESSIONS)} most recently active sessions.
          </p>
        ) : null}
      </div>
      <div className="min-w-0 rounded-xl border border-border/75 p-5">
        <div className="mb-4 grid gap-0.5">
          <h2 className="text-sm font-medium">Automations</h2>
          <p className="text-xs text-muted-foreground">Share of task spend they started</p>
        </div>
        {share ? (
          <div>
            <div className="text-2xl font-semibold tracking-tight tabular-nums">
              {share.share === null ? "–" : PERCENT.format(share.share)}
            </div>
            <p className="mt-1 text-meta text-muted-foreground tabular-nums">
              {CURRENCY.format(share.automationCost)} of {CURRENCY.format(share.totalCost)}
            </p>
            <dl className="mt-4 grid gap-2 text-sm">
              <div className="flex items-baseline justify-between gap-3">
                <dt className="min-w-0 truncate text-muted-foreground">Palot scheduled tasks</dt>
                <dd className="shrink-0 tabular-nums">{CURRENCY.format(share.palotCost)}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="min-w-0 truncate text-muted-foreground">OpenCode automations</dt>
                <dd className="shrink-0 tabular-nums">{CURRENCY.format(share.openCodeCost)}</dd>
              </div>
            </dl>
            <p className="mt-4 text-meta text-muted-foreground">
              Counts tasks and subagents an automation started. Prompts an automation sends into an
              existing task count with that task.
            </p>
          </div>
        ) : tasks.error ? (
          <p className="text-sm text-muted-foreground">Unavailable until tasks load.</p>
        ) : seen ? (
          <Skeleton className="h-28 w-full" />
        ) : (
          <div className="h-28" />
        )}
      </div>
    </section>
  );
}

function UsageTaskRow({
  task,
  topCost,
  projectName,
  onOpen,
}: {
  task: UsageTask;
  topCost: number;
  projectName: string | undefined;
  onOpen(): void;
}) {
  const details = [
    projectName,
    task.subagents
      ? `${NUMBER.format(task.subagents)} ${task.subagents === 1 ? "subagent" : "subagents"} · ${formatShare(task.subagentCost, task.cost)} of cost`
      : null,
    `${formatModelTokens(task.tokens)} tokens`,
  ].filter(Boolean);
  return (
    <li className="min-w-0">
      <button
        type="button"
        onClick={onOpen}
        className="group/task w-full min-w-0 rounded-lg px-2 py-1.5 text-left outline-none transition-colors hover:bg-muted/55 focus-visible:ring-2 focus-visible:ring-ring"
        data-usage-task={task.id}
      >
        <span className="flex items-baseline justify-between gap-4">
          <span className="min-w-0 truncate text-sm font-medium">
            {task.title ?? "Untitled task"}
          </span>
          <span className="shrink-0 text-sm font-medium tabular-nums">
            {CURRENCY.format(task.cost)}
          </span>
        </span>
        <span className="mt-1 block h-1 overflow-hidden rounded-full bg-muted" aria-hidden="true">
          <span
            className="block h-full rounded-full bg-primary"
            style={{ width: `${topCost > 0 ? (task.cost / topCost) * 100 : 0}%` }}
          />
        </span>
        <span className="mt-1 block truncate text-meta text-muted-foreground">
          {details.join(" · ")}
        </span>
      </button>
    </li>
  );
}
