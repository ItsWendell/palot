import { ChevronDown, ChevronRight, Terminal } from "lucide-react";
import { useAtomValue } from "jotai";
import { useState } from "react";
import type { PalotSession } from "../../shared";
import { runtimeAtom } from "../atoms/workspace";
import { useWorkbenchCommands } from "../atoms/workbench";
import { useSessionProcesses, type SessionProcess } from "../hooks/use-session-processes";
import { Button } from "./ui/button";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "./ui/popover";

export function processCountLabel(commands: number, terminals: number): string {
  const count = commands + terminals;
  const noun = commands && terminals ? "process" : terminals ? "terminal" : "command";
  return `${count} ${noun}${count === 1 ? "" : noun === "process" ? "es" : "s"}`;
}

export function processStatus(row: SessionProcess): string {
  if (row.kind === "terminal") {
    if (!row.active)
      return row.status === "exited" ? "Terminal exited" : "Terminal no longer listed";
    return row.foregroundProcess ? `Foreground: ${row.foregroundProcess}` : "Terminal open";
  }
  if (row.active) return "Running";
  if (row.status === "running") return "No longer listed · final status unavailable";
  if (row.status === "timeout") return "Timed out";
  if (row.status === "killed") return "Stopped";
  return row.exit === undefined ? "Exited" : `Exited · code ${row.exit}`;
}

function elapsed(startedAt: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1_000));
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

export function ProcessFooterControl({
  session,
  sessionIDs,
}: {
  session: PalotSession;
  sessionIDs: ReadonlySet<string>;
}) {
  const runtime = useAtomValue(runtimeAtom);
  return (
    <ScopedProcessFooter
      key={`${runtime?.connectionID}:${session.id}`}
      session={session}
      sessionIDs={sessionIDs}
    />
  );
}

function ScopedProcessFooter({
  session,
  sessionIDs,
}: {
  session: PalotSession;
  sessionIDs: ReadonlySet<string>;
}) {
  const [open, setOpen] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);
  const runtime = useAtomValue(runtimeAtom);
  const workbench = useWorkbenchCommands(
    runtime ? { profileID: runtime.profileID, sessionID: session.id } : null,
  );
  const processes = useSessionProcesses(session, sessionIDs, open);
  const label =
    processes.commands + processes.terminals > 0
      ? processCountLabel(processes.commands, processes.terminals)
      : processes.rows.length > 0
        ? "Recently finished"
        : "Commands & terminals";
  if (!open && processes.rows.length === 0 && !processes.error && !openError) return null;
  const groups = [
    {
      title: "Running commands",
      rows: processes.rows.filter((row) => row.kind === "command" && row.active),
    },
    {
      title: "Terminals",
      rows: processes.rows.filter((row) => row.kind === "terminal" && row.active),
    },
    { title: "Recently finished", rows: processes.rows.filter((row) => !row.active) },
  ];
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            className="flex h-6 shrink-0 items-center gap-1 rounded-md px-1.5 outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={label === "Commands & terminals" ? label : `Commands & terminals: ${label}`}
          />
        }
      >
        <Terminal className="size-3" aria-hidden="true" />
        <span>{label}</span>
        <ChevronDown className="size-3" aria-hidden="true" />
      </PopoverTrigger>
      <PopoverContent side="top" align="end" className="w-[340px] gap-1 p-1.5">
        <PopoverHeader className="px-2 py-1">
          <PopoverTitle>Commands &amp; terminals</PopoverTitle>
          <PopoverDescription>
            Inspect processes from this conversation and its child tasks.
          </PopoverDescription>
        </PopoverHeader>
        {processes.error || openError ? (
          <div className="px-2 py-1">
            <p role="alert" className="text-meta text-destructive">
              {openError ?? processes.error}
            </p>
            {processes.error ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  void processes.retry();
                }}
              >
                Retry
              </Button>
            ) : null}
          </div>
        ) : null}
        {!processes.terminalsSupported ? (
          <p className="px-2 py-1 text-meta text-muted-foreground">
            Terminal discovery is unavailable on this runtime.
          </p>
        ) : null}
        {processes.rows.length === 0 ? (
          <p className="px-2 py-2 text-meta text-muted-foreground">
            {processes.loading ? "Loading processes…" : "No commands or terminals found."}
          </p>
        ) : null}
        <div className="flex max-h-72 flex-col overflow-y-auto">
          {groups
            .filter((group) => group.rows.length > 0)
            .map((group) => (
              <section key={group.title} aria-label={group.title} className="flex flex-col">
                <h3 className="px-2 pb-1 pt-2 text-micro font-medium text-muted-foreground">
                  {group.title}
                </h3>
                {group.rows.map((row) => {
                  const owner =
                    row.sessionID === session.id
                      ? "This conversation"
                      : processes.owners.get(row.sessionID ?? "")?.title || "Child task";
                  const title = row.kind === "command" ? row.command : row.title || row.command;
                  return (
                    <button
                      key={`${row.kind}:${row.id}`}
                      type="button"
                      className="flex min-w-0 items-center gap-2 rounded-md px-2 py-2 text-left outline-none hover:bg-muted focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={() => {
                        if (!row.sessionID) return;
                        const result = workbench.openTab(
                          row.kind === "command"
                            ? {
                                kind: "command",
                                location: row.location,
                                shellID: row.id,
                                sessionID: row.sessionID,
                                command: row.command,
                              }
                            : {
                                kind: "terminal",
                                location: row.location,
                                ptyID: row.id,
                                sessionID: row.sessionID,
                                transport: "persistent",
                                readOnly: true,
                              },
                          { pane: "bottom" },
                        );
                        if (!result?.ok) {
                          setOpenError("Close a workbench tab before opening another process.");
                          return;
                        }
                        setOpenError(null);
                        setOpen(false);
                      }}
                    >
                      <Terminal
                        className="size-3.5 shrink-0 text-muted-foreground"
                        aria-hidden="true"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium text-foreground" title={title}>
                          {title}
                        </span>
                        <span className="mt-0.5 block truncate text-micro text-muted-foreground">
                          {owner} · {processStatus(row)}
                        </span>
                        {row.kind === "command" ? (
                          <span
                            className="block truncate text-micro text-muted-foreground"
                            title={row.cwd}
                          >
                            {row.cwd} · Started {new Date(row.startedAt).toLocaleTimeString()}
                          </span>
                        ) : null}
                      </span>
                      <span className="flex shrink-0 items-center gap-1 tabular-nums text-muted-foreground">
                        {row.kind === "command" && row.active ? (
                          <span className="text-micro">
                            {elapsed(row.startedAt, processes.now ?? row.startedAt)}
                          </span>
                        ) : null}
                        <ChevronRight className="size-3.5" aria-hidden="true" />
                      </span>
                    </button>
                  );
                })}
              </section>
            ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
