import { BrainCircuit, ChevronDown, ChevronRight, Square, Terminal } from "lucide-react";
import { useAtomValue, useStore } from "jotai";
import { useRef, useState } from "react";
import type { PalotSession } from "../../shared";
import { runtimeAtom } from "../atoms/workspace";
import { useWorkbenchCommands } from "../atoms/workbench";
import { usePalotNavigation } from "../hooks/use-navigation";
import { useChildSessions } from "../hooks/use-session-catalog";
import { useSessionProcesses, type SessionProcess } from "../hooks/use-session-processes";
import { useSessionFamilyRequestViews } from "../hooks/use-session-requests";
import { openCodeClient } from "../services/opencode-client";
import type { BackgroundWorkItem, SubagentWorkItem } from "./subagent-activity";
import { processCountLabel, processStatus } from "./process-footer-control";
import { Button } from "./ui/button";
import { Popover, PopoverContent, PopoverHeader, PopoverTitle, PopoverTrigger } from "./ui/popover";

interface Owner {
  profileID: string;
  connectionID: string;
}

export function RunningWorkControl(
  props: Owner & {
    session: PalotSession;
    sessionIDs: ReadonlySet<string>;
    items: BackgroundWorkItem[];
  },
) {
  return <ScopedRunningWorkControl key={`${props.connectionID}:${props.session.id}`} {...props} />;
}

function ScopedRunningWorkControl({
  session,
  sessionIDs,
  items,
  profileID,
  connectionID,
}: Parameters<typeof RunningWorkControl>[0]) {
  const [open, setOpen] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);
  const runtime = useAtomValue(runtimeAtom);
  const available =
    runtime?.connected && runtime.profileID === profileID && runtime.connectionID === connectionID;
  useChildSessions(available ? session.id : null);
  const owner = { profileID, connectionID };
  const processes = useSessionProcesses(session, sessionIDs, open, owner);
  const workbench = useWorkbenchCommands({ profileID, sessionID: session.id });
  const { openSession } = usePalotNavigation();
  const agents = items.filter((item): item is SubagentWorkItem => item.kind === "subagent");
  const active = agents.length + processes.commands;
  const label = active
    ? `${active} running${processes.terminals ? ` · ${processCountLabel(0, processes.terminals)}` : ""}`
    : processes.terminals
      ? processCountLabel(0, processes.terminals)
      : processes.rows.length
        ? "Recently finished"
        : "Running work";
  if (!open && agents.length === 0 && processes.rows.length === 0 && !processes.error) return null;
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
            aria-label={`Running work: ${label}`}
          />
        }
      >
        <Terminal className="size-3" aria-hidden="true" />
        <span>{label}</span>
        <ChevronDown className="size-3" aria-hidden="true" />
      </PopoverTrigger>
      <PopoverContent side="top" align="end" className="w-[340px] gap-1 p-1.5">
        <PopoverHeader className="px-2 py-1">
          <PopoverTitle>Running work</PopoverTitle>
        </PopoverHeader>
        {processes.error || openError ? (
          <div className="px-2 py-1">
            <p role="alert" className="text-meta text-destructive">
              {openError ?? processes.error}
            </p>
            {processes.error ? (
              <Button variant="ghost" size="sm" onClick={() => void processes.retry()}>
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
        <div className="flex max-h-72 flex-col overflow-y-auto">
          {agents.length ? (
            <section aria-label="Active subagents">
              <h3 className="px-2 pb-1 pt-2 text-micro font-medium text-muted-foreground">
                Agents
              </h3>
              {agents.map((item) => (
                <RunningAgentRow
                  key={item.id}
                  item={item}
                  owner={owner}
                  available={Boolean(available)}
                  onOpen={() => {
                    void openSession(item.id, { profileID });
                    setOpen(false);
                  }}
                />
              ))}
            </section>
          ) : null}
          {groups
            .filter((group) => group.rows.length)
            .map((group) => (
              <section key={group.title} aria-label={group.title}>
                <h3 className="px-2 pb-1 pt-2 text-micro font-medium text-muted-foreground">
                  {group.title}
                </h3>
                {group.rows.map((row) => (
                  <RunningWorkRow
                    key={`${row.kind}:${row.id}`}
                    title={row.kind === "command" ? row.command : row.title || row.command}
                    detail={`${row.sessionID === session.id ? "This conversation" : processes.owners.get(row.sessionID ?? "")?.title || "Child task"} · ${processStatus(row)}`}
                    available={Boolean(available)}
                    owner={owner}
                    process={row}
                    onOpen={() => {
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
                  />
                ))}
              </section>
            ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function RunningAgentRow({
  item,
  ...props
}: {
  item: SubagentWorkItem;
  owner: Owner;
  available: boolean;
  onOpen(): void;
}) {
  const needsInput = useSessionFamilyRequestViews(props.available ? item.id : null).length > 0;
  return (
    <RunningWorkRow
      {...props}
      title={item.description}
      detail={`${item.agent} · ${needsInput ? "Needs input" : item.background ? "Background" : "Running"}`}
      childID={item.id}
    />
  );
}

function RunningWorkRow({
  title,
  detail,
  owner,
  available,
  onOpen,
  childID,
  process,
}: {
  title: string;
  detail: string;
  owner: Owner;
  available: boolean;
  onOpen(): void;
  childID?: string;
  process?: SessionProcess;
}) {
  const store = useStore();
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = () => {
    const runtime = store.get(runtimeAtom);
    return (
      runtime?.connected &&
      runtime.profileID === owner.profileID &&
      runtime.connectionID === owner.connectionID
    );
  };
  const stop = async () => {
    if (!current() || pending.current) return;
    if (
      process?.kind === "command" &&
      !window.confirm("Stop and remove this command? This also deletes its stored output.")
    )
      return;
    if (!current()) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      const client = openCodeClient(owner.connectionID);
      if (childID) await client.session.interrupt({ sessionID: childID });
      else if (process?.kind === "command")
        await client.shell.remove({
          id: process.id,
          location: { directory: process.location.directory },
        });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not stop work.");
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  return (
    <div className="min-w-0">
      <div className="flex min-w-0 items-center">
        <button
          type="button"
          disabled={!available}
          onClick={() => {
            if (current()) onOpen();
          }}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-2 text-left outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
        >
          {childID ? (
            <BrainCircuit className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          ) : (
            <Terminal className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          )}
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium text-foreground" title={title}>
              {title}
            </span>
            <span className="mt-0.5 block truncate text-micro text-muted-foreground">{detail}</span>
          </span>
          <ChevronRight className="size-3.5 shrink-0" aria-hidden="true" />
        </button>
        {childID || (process?.kind === "command" && process.active) ? (
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={`Stop ${title}`}
            disabled={!available || busy}
            onClick={() => void stop()}
          >
            <Square aria-hidden="true" />
          </Button>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="px-2 pb-1 text-meta text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
