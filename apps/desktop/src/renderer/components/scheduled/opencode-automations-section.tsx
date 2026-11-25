import { CircleCheck, Circle, Pause, Play, Trash2 } from "lucide-react";
import { useState } from "react";
import { useOpenCodeAutomations } from "../../hooks/use-opencode-automations";
import { usePalotNavigation } from "../../hooks/use-navigation";
import {
  openCodeActionSummary,
  openCodeAutomationStatusLabel,
  openCodeRunLabel,
  openCodeTriggerLabel,
  type OpenCodeAutomationEntry,
} from "../../lib/opencode-automations";
import { showErrorToast } from "../../lib/toast-error";
import { useArmedConfirm } from "../pull-requests/use-armed-confirm";
import { Button } from "../ui/button";

type Filter = "all" | "active" | "paused";

/**
 * OpenCode's own automations, read-only beside Palot's scheduled tasks. Hidden when no
 * connected server reports any (automations off, an older server, or none created).
 */
export function OpenCodeAutomationsSection({ filter, query }: { filter: Filter; query: string }) {
  const { entries, failedServers, multipleServers, taskTitle, act } = useOpenCodeAutomations();
  const { openSession } = usePalotNavigation();
  if (entries.length === 0) return null;
  const text = query.trim().toLowerCase();
  const visible = entries.filter(({ automation }) => {
    if (filter !== "all" && automation.status !== filter) return false;
    if (!text) return true;
    const action = automation.action;
    const detail =
      action.type === "prompt" ? action.prompt : action.type === "shell" ? action.command : "";
    return `${automation.name}\n${detail}\n${openCodeTriggerLabel(automation.trigger, automation.tz)}`
      .toLowerCase()
      .includes(text);
  });
  return (
    <OpenCodeAutomationList
      entries={visible}
      total={entries.length}
      failedServers={failedServers}
      showServer={multipleServers}
      taskTitle={taskTitle}
      onOpenTask={(profileID, sessionID) => void openSession(sessionID, { profileID })}
      onAction={act}
    />
  );
}

export interface OpenCodeAutomationListProps {
  entries: readonly OpenCodeAutomationEntry[];
  total: number;
  failedServers: readonly string[];
  showServer: boolean;
  taskTitle: (profileID: string, sessionID: string) => string | undefined;
  onOpenTask: (profileID: string, sessionID: string) => void;
  onAction: (entry: OpenCodeAutomationEntry, type: "pause" | "resume" | "delete") => Promise<void>;
}

export function OpenCodeAutomationList({
  entries,
  total,
  failedServers,
  showServer,
  taskTitle,
  onOpenTask,
  onAction,
}: OpenCodeAutomationListProps) {
  return (
    <section className="mt-8 border-t pt-4" aria-labelledby="opencode-automations-heading">
      <h2 id="opencode-automations-heading" className="px-2 text-sm font-medium">
        OpenCode automations
      </h2>
      <p className="mt-0.5 mb-2 px-2 text-meta text-muted-foreground">
        These run inside OpenCode, even when Palot is closed. Agents create them; you can pause or
        delete them here.
      </p>
      {failedServers.length ? (
        <p className="mb-2 px-2 text-meta text-muted-foreground">
          Couldn't load automations from {failedServers.join(", ")}.
        </p>
      ) : null}
      {entries.length === 0 ? (
        <p className="px-3 py-4 text-sm text-muted-foreground">
          {total} OpenCode {total === 1 ? "automation is" : "automations are"} hidden by this view.
        </p>
      ) : (
        <ul className="space-y-1">
          {entries.map((entry) => (
            <OpenCodeAutomationRow
              key={entry.key}
              entry={entry}
              showServer={showServer}
              taskTitle={taskTitle}
              onOpenTask={onOpenTask}
              onAction={onAction}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function OpenCodeAutomationRow({
  entry,
  showServer,
  taskTitle,
  onOpenTask,
  onAction,
}: Omit<OpenCodeAutomationListProps, "entries" | "total" | "failedServers"> & {
  entry: OpenCodeAutomationEntry;
}) {
  const { automation, profileID } = entry;
  const [pending, setPending] = useState(false);
  const run = (type: "pause" | "resume" | "delete") => {
    setPending(true);
    onAction(entry, type)
      .catch((cause: unknown) =>
        showErrorToast(
          type === "delete"
            ? "Couldn't delete the automation"
            : type === "pause"
              ? "Couldn't pause the automation"
              : "Couldn't resume the automation",
          cause,
        ),
      )
      .finally(() => setPending(false));
  };
  const remove = useArmedConfirm(() => run("delete"));
  const action = openCodeActionSummary(automation.action);
  const runLabel = openCodeRunLabel(automation);
  const status = openCodeAutomationStatusLabel(automation.status);
  const taskLink = (sessionID: string) => (
    <button
      type="button"
      className="max-w-full truncate rounded-sm text-foreground underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
      onClick={() => onOpenTask(profileID, sessionID)}
    >
      {taskTitle(profileID, sessionID) ?? "Open task"}
    </button>
  );
  return (
    <li
      className="group flex items-start gap-3 rounded-xl px-3 py-3 transition-colors hover:bg-muted/55 focus-within:bg-muted/55"
      data-opencode-automation={automation.id}
    >
      <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center">
        {automation.status === "paused" ? (
          <Pause className="size-4 text-muted-foreground" aria-label="Paused" />
        ) : automation.status === "done" ? (
          <CircleCheck className="size-4 text-muted-foreground" aria-label="Finished" />
        ) : (
          <Circle className="size-4 text-muted-foreground" aria-label="Active" />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="truncate text-sm font-medium">{automation.name}</span>
          {automation.status !== "active" ? (
            <span className="shrink-0 text-meta text-muted-foreground">{status}</span>
          ) : null}
          {showServer ? (
            <span className="ml-auto shrink-0 truncate text-meta text-muted-foreground">
              {entry.serverName}
            </span>
          ) : null}
        </div>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {openCodeTriggerLabel(automation.trigger, automation.tz)}
          {runLabel ? (
            <>
              <span aria-hidden="true"> · </span>
              {runLabel}
            </>
          ) : null}
        </p>
        <p className="mt-0.5 flex min-w-0 items-baseline gap-1 text-meta text-muted-foreground">
          {action.type === "session" ? (
            <>
              <span className="shrink-0">Prompts</span>
              {taskLink(action.sessionID)}
            </>
          ) : action.type === "subagent" ? (
            <span className="truncate">Starts a {action.agent} subagent run</span>
          ) : action.type === "code" ? (
            <span className="truncate">Runs a script, no model</span>
          ) : (
            <span className="truncate">
              Runs <code className="text-code-compact">{action.command}</code>
            </span>
          )}
          {automation.sessionID &&
          !(action.type === "session" && action.sessionID === automation.sessionID) ? (
            <>
              <span aria-hidden="true" className="shrink-0">
                ·
              </span>
              <span className="shrink-0">From</span>
              {taskLink(automation.sessionID)}
            </>
          ) : null}
        </p>
        {action.type === "session" || action.type === "subagent" ? (
          <p className="mt-0.5 line-clamp-2 text-meta text-muted-foreground/80">{action.prompt}</p>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
        {automation.status !== "done" ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={pending}
            aria-label={`${automation.status === "active" ? "Pause" : "Resume"} ${automation.name}`}
            onClick={() => run(automation.status === "active" ? "pause" : "resume")}
          >
            {automation.status === "active" ? (
              <Pause aria-hidden="true" />
            ) : (
              <Play aria-hidden="true" />
            )}
          </Button>
        ) : null}
        <Button
          type="button"
          variant={remove.armed ? "destructive" : "ghost"}
          size={remove.armed ? "sm" : "icon-sm"}
          disabled={pending}
          aria-label={
            remove.armed ? `Confirm delete ${automation.name}` : `Delete ${automation.name}`
          }
          {...remove.buttonProps}
        >
          <Trash2 aria-hidden="true" />
          {remove.armed ? "Delete?" : null}
        </Button>
      </div>
    </li>
  );
}
