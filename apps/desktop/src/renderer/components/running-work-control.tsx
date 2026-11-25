import { Braces, BrainCircuit, ChevronRight, Square, Terminal } from "lucide-react";
import { useAtomValue, useStore } from "jotai";
import { useMemo, useRef, useState } from "react";
import type { PalotSession } from "../../shared";
import { runtimeAtom } from "../atoms/workspace";
import { useWorkbenchCommands } from "../atoms/workbench";
import { usePalotNavigation } from "../hooks/use-navigation";
import { useChildSessions } from "../hooks/use-session-catalog";
import { useSessionProcesses, type SessionProcess } from "../hooks/use-session-processes";
import { useSessionFamilyRequestViews } from "../hooks/use-session-requests";
import { terminalDisplayName } from "../lib/terminal-query";
import { cn } from "../lib/cn";
import { subagentShowsBackgroundChip } from "../lib/subagent-background";
import { openCodeClient } from "../services/opencode-client";
import type { BackgroundWorkItem, SubagentWorkItem } from "./subagent-activity";
import { processCountLabel, processStatus } from "./process-footer-control";
import { Button } from "./ui/button";
import { ComposerPanelBody } from "./ui/composer";

interface Owner {
  profileID: string;
  connectionID: string;
}

/** Interrupts a delegated child session through the same call as the running-work menu. */
export async function interruptChildSession(connectionID: string, childID: string) {
  await openCodeClient(connectionID).session.interrupt({ sessionID: childID });
}

export interface RunningWorkScope extends Owner {
  session: PalotSession;
  sessionIDs: ReadonlySet<string>;
  items: BackgroundWorkItem[];
  /** The panel listing the work is open, so recently finished rows stay put. */
  open: boolean;
}

/**
 * The task's running work: its subagents and the commands and terminals of the task and its
 * children. `visible` is false when there is nothing to show; `label` names the count.
 */
export function useRunningWork({
  session,
  sessionIDs,
  items,
  profileID,
  connectionID,
  open,
}: RunningWorkScope) {
  const runtime = useAtomValue(runtimeAtom);
  const available = Boolean(
    runtime?.connected && runtime.profileID === profileID && runtime.connectionID === connectionID,
  );
  useChildSessions(available ? session.id : null);
  const owner = useMemo(() => ({ profileID, connectionID }), [connectionID, profileID]);
  const processes = useSessionProcesses(session, sessionIDs, open, owner);
  const agents = useMemo(
    () => items.filter((item): item is SubagentWorkItem => item.kind === "subagent"),
    [items],
  );
  const active = agents.length + processes.commands + processes.scripts;
  const label = active
    ? `${active} running${processes.terminals ? ` · ${processCountLabel(0, processes.terminals)}` : ""}`
    : processes.terminals
      ? processCountLabel(0, processes.terminals)
      : processes.rows.length
        ? "Recently finished"
        : "Running work";
  const visible =
    open || agents.length > 0 || processes.rows.length > 0 || Boolean(processes.error);
  return { session, owner, available, processes, agents, active, label, visible };
}

export type RunningWork = ReturnType<typeof useRunningWork>;

/** The running work's rows, grouped, each with Open and Stop. `onClose` leaves the panel. */
export function RunningWorkPanel({ work, onClose }: { work: RunningWork; onClose(): void }) {
  return (
    <ScopedRunningWorkPanel
      key={`${work.owner.connectionID}:${work.session.id}`}
      work={work}
      onClose={onClose}
    />
  );
}

function ScopedRunningWorkPanel({ work, onClose }: { work: RunningWork; onClose(): void }) {
  const { session, owner, available, processes, agents } = work;
  const [openError, setOpenError] = useState<string | null>(null);
  const workbench = useWorkbenchCommands({ profileID: owner.profileID, sessionID: session.id });
  const { openSession } = usePalotNavigation();
  const groups = [
    {
      title: "Running commands",
      rows: processes.rows.filter((row) => row.kind === "command" && row.active),
    },
    {
      title: "Background scripts",
      rows: processes.rows.filter((row) => row.kind === "script" && row.active),
    },
    {
      title: "Terminals",
      rows: processes.rows.filter((row) => row.kind === "terminal" && row.active),
    },
    { title: "Recently finished", rows: processes.rows.filter((row) => !row.active) },
  ];
  return (
    <div data-slot="running-work-panel" className="flex min-h-0 flex-col px-1.5 pt-1 pb-1.5">
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
      <ComposerPanelBody>
        {agents.length === 0 && processes.rows.length === 0 && !processes.error ? (
          <p className="m-0 px-2 py-2 text-compact text-muted-foreground">Nothing is running.</p>
        ) : null}
        {agents.length ? (
          <section aria-label="Active subagents">
            <h3 className="m-0 px-2 pt-1.5 pb-1 text-micro font-medium text-muted-foreground">
              Agents
            </h3>
            {agents.map((item) => (
              <RunningAgentRow
                key={item.id}
                item={item}
                owner={owner}
                available={available}
                onOpen={() => {
                  void openSession(item.id, { profileID: owner.profileID });
                  onClose();
                }}
              />
            ))}
          </section>
        ) : null}
        {groups
          .filter((group) => group.rows.length)
          .map((group) => (
            <section key={group.title} aria-label={group.title}>
              <h3 className="m-0 px-2 pt-1.5 pb-1 text-micro font-medium text-muted-foreground">
                {group.title}
              </h3>
              {group.rows.map((row) => (
                <RunningWorkRow
                  key={`${row.kind}:${row.id}`}
                  title={
                    row.kind === "script"
                      ? row.title
                      : row.kind === "command"
                        ? row.command
                        : terminalDisplayName(row, row.command)
                  }
                  detail={`${row.sessionID === session.id ? "This conversation" : processes.owners.get(row.sessionID ?? "")?.title || "Child task"} · ${processStatus(row)}`}
                  available={available}
                  owner={owner}
                  process={row}
                  onOpen={() => {
                    if (!row.sessionID) return;
                    if (row.kind === "script") {
                      // A script has no output to follow; its task shows its calls.
                      if (row.sessionID !== session.id) {
                        void openSession(row.sessionID, { profileID: owner.profileID });
                      }
                      onClose();
                      return;
                    }
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
                    onClose();
                  }}
                />
              ))}
            </section>
          ))}
      </ComposerPanelBody>
    </div>
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
  const version = useAtomValue(runtimeAtom)?.version;
  const background = subagentShowsBackgroundChip(item, version);
  return (
    <RunningWorkRow
      {...props}
      title={item.description}
      detail={`${item.agent} · ${needsInput ? "Needs input" : background ? "Background" : "Running"}`}
      childID={item.id}
      depth={item.depth ?? 0}
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
  depth = 0,
}: {
  title: string;
  detail: string;
  /** Nesting under the subagent that started it. */
  depth?: number;
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
      if (childID) await interruptChildSession(owner.connectionID, childID);
      // OpenCode 2.4.0 stops a background script with its job.
      else if (process?.kind === "script")
        await openCodeClient(owner.connectionID).experimental.job.cancel({ id: process.id });
      else if (process?.kind === "command")
        await openCodeClient(owner.connectionID).shell.remove({
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
    <div
      className={cn("min-w-0", depth > 0 && "border-l border-border/60")}
      style={depth > 0 ? { marginInlineStart: `${depth * 0.75}rem` } : undefined}
    >
      <div className="flex min-w-0 items-center">
        <button
          type="button"
          disabled={!available}
          onClick={() => {
            if (current()) onOpen();
          }}
          className="flex min-w-0 flex-1 items-start gap-2 rounded-md px-2 py-2 text-left outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
        >
          {childID ? (
            <span className="flex h-[1lh] shrink-0 items-center">
              <BrainCircuit className="size-3.5 text-muted-foreground" aria-hidden="true" />
            </span>
          ) : process?.kind === "script" ? (
            <span className="flex h-[1lh] shrink-0 items-center">
              <Braces className="size-3.5 text-muted-foreground" aria-hidden="true" />
            </span>
          ) : (
            <span className="flex h-[1lh] shrink-0 items-center">
              <Terminal className="size-3.5 text-muted-foreground" aria-hidden="true" />
            </span>
          )}
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium text-foreground" title={title}>
              {title}
            </span>
            <span className="mt-0.5 block truncate text-micro text-muted-foreground">{detail}</span>
          </span>
          <ChevronRight className="size-3.5 shrink-0 self-center" aria-hidden="true" />
        </button>
        {childID || (process && process.kind !== "terminal" && process.active) ? (
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
