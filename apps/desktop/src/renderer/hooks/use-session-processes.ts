import {
  isLocationNotFoundError,
  type LocationRef,
  type PersistentPtyInfo,
} from "@opencode/client";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import { useEffect, useMemo, useRef, useState } from "react";
import type { PalotRunningShell, PalotSession } from "../../shared";
import { runtimeAtom } from "../atoms/workspace";
import {
  isScriptJob,
  recordScriptJobEvent,
  runningScriptJobs,
  scriptJobTitle,
  type ScriptJobEvent,
  type ScriptJobList,
} from "../lib/background-scripts";
import { openCodeKeys } from "../lib/opencode-query";
import { openCodeClient } from "../services/opencode-client";
import { palot } from "../services/palot";
import {
  transcriptMessages,
  transcriptQueryKey,
  type TranscriptData,
} from "./use-session-transcript";
import { runningShellsQueryOptions } from "./use-running-shells";
import { useSessionCatalog } from "./use-session-catalog";
import { useLoadedLocations } from "./use-loaded-locations";
import { sessionTerminalsQueryOptions } from "./use-session-terminals";

export interface SessionCommand extends PalotRunningShell {
  kind: "command";
  location: LocationRef;
  active: boolean;
  missingSince?: number;
}
export interface SessionTerminal extends PersistentPtyInfo {
  kind: "terminal";
  location: LocationRef;
  active: boolean;
  missingSince?: number;
}
/** A Code Mode script running in the background (OpenCode 2.4 lists these as `codemode` jobs). */
export interface SessionScript {
  kind: "script";
  id: string;
  sessionID: string;
  title: string;
  startedAt: number;
  location: LocationRef;
  active: boolean;
  missingSince?: number;
}
export type SessionProcess = SessionCommand | SessionTerminal | SessionScript;
const RECENT_MS = 30_000;
export const SHELL_POLL_MS = 2_000;
export const TERMINAL_POLL_MS = 3_000;
const MAX_RECENT = 20;

interface ProcessHistory {
  rows: SessionProcess[];
  inactiveSince: ReadonlyMap<string, number>;
}

function emptyHistory(): ProcessHistory {
  return { rows: [], inactiveSince: new Map() };
}

export function reconcileProcesses(
  previous: ProcessHistory,
  current: SessionProcess[],
  now: number,
  open: boolean,
): ProcessHistory {
  const remaining = new Map(current.map((row) => [`${row.kind}:${row.id}`, row]));
  const listed = new Set(remaining.keys());
  const visible = new Set(previous.rows.map((row) => `${row.kind}:${row.id}`));
  const rows: SessionProcess[] = [];
  const inactiveSince = new Map<string, number>();
  let recent = 0;
  const candidates = previous.rows.map((old) => {
    const key = `${old.kind}:${old.id}`;
    const next = remaining.get(key);
    remaining.delete(key);
    return next ?? { ...old, active: false };
  });
  for (const row of [...candidates, ...remaining.values()]) {
    const key = `${row.kind}:${row.id}`;
    if (row.active) {
      rows.push(row);
      continue;
    }
    const since = previous.inactiveSince.get(key) ?? now;
    const pinned = open && (visible.has(key) || !previous.inactiveSince.has(key));
    const retain = pinned || (now - since < RECENT_MS && (open || recent++ < MAX_RECENT));
    // Listed exited processes need a tombstone after their visible row expires.
    // Removed processes need no tombstone once their recent row is gone.
    if (listed.has(key) || retain) inactiveSince.set(key, since);
    if (retain) {
      rows.push({ ...row, missingSince: since });
    }
  }
  return { rows, inactiveSince };
}

/** OpenCode 2.4.0 sends `experimental.job.updated`, so job lists follow events instead of polling. */
export function sendsJobEvents(version: string | null | undefined): boolean {
  const match = version?.trim().match(/^v?(\d+)\.(\d+)\.\d+$/);
  if (!match) return false;
  const [major, minor] = [Number(match[1]), Number(match[2])];
  return major > 2 || (major === 2 && minor >= 4);
}

export function useSessionProcesses(
  session: PalotSession,
  sessionIDs: ReadonlySet<string>,
  open: boolean,
  target?: { profileID: string; connectionID: string },
) {
  const runtime = useAtomValue(runtimeAtom);
  const catalog = useSessionCatalog();
  const connectionID = target?.connectionID ?? runtime?.connectionID ?? "disconnected";
  const followsJobEvents = sendsJobEvents(runtime?.version);
  const enabled = Boolean(
    runtime?.connected &&
    connectionID !== "preview" &&
    (!target ||
      (runtime.profileID === target.profileID && runtime.connectionID === target.connectionID)),
  );
  const owners = useMemo(() => {
    const result = new Map<string, PalotSession>([[session.id, session]]);
    const byID = new Map(catalog.map((candidate) => [candidate.id, candidate]));
    for (const child of catalog) {
      if (child.id === session.id) continue;
      if (sessionIDs.has(child.id)) {
        result.set(child.id, child);
        continue;
      }
      const visited = new Set([child.id]);
      let parentID = child.parentID;
      while (parentID && !visited.has(parentID)) {
        if (parentID === session.id) {
          result.set(child.id, child);
          break;
        }
        visited.add(parentID);
        parentID = byID.get(parentID)?.parentID ?? null;
      }
    }
    return result;
  }, [catalog, session, sessionIDs]);
  const locations = useMemo(
    () => [
      ...new Map(
        [...owners.values()].map((owner) => [JSON.stringify(owner.location), owner.location]),
      ).values(),
    ],
    [owners],
  );
  const scope = JSON.stringify([connectionID, session.id, [...owners.keys()].sort(), locations]);
  // Shell lists are location-scoped: reading one boots its directory on the server. Subagents
  // often run in other worktrees, so while the list is closed only the task's own directory
  // and directories the server already has loaded are read. Live work there (shell.created,
  // session.status) marks the directory loaded, which enables its read without booting it.
  // Opening the list is an explicit request and reads every family directory.
  const ownDirectory = session.location.directory;
  const loaded = useLoadedLocations(
    connectionID,
    enabled && locations.some((location) => location.directory !== ownDirectory),
  );
  // OpenCode 2.2.6+ lists the family's background jobs server-wide without loading any
  // location. A directory with a live job of a family session is worth reading even when the
  // list is open; idle subagent worktrees are then never booted. Older servers (no job list)
  // fall back to reading every family directory while the list is open.
  const jobs = useQuery({
    queryKey: openCodeKeys.backgroundJobs(connectionID, session.id),
    queryFn: ({ signal }) =>
      openCodeClient(connectionID).experimental.job.list(
        { sessionID: session.id, descendants: true, kind: "shell", status: "running" },
        { signal },
      ),
    enabled: enabled && locations.some((location) => location.directory !== ownDirectory),
    staleTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    refetchInterval: (query) =>
      enabled && open && !followsJobEvents && !query.state.error ? SHELL_POLL_MS : false,
  });
  // Background Code Mode scripts (2.4.0). The list is read once; `experimental.job.updated`
  // events keep it current, including those that arrive while it loads. Servers without the
  // `codemode` kind answer with an error, and then there are no script rows.
  const scriptList = useQuery({
    queryKey: openCodeKeys.backgroundScripts(connectionID, session.id),
    queryFn: async ({ signal }): Promise<ScriptJobList> => {
      const requestedAt = Date.now();
      const jobs = await openCodeClient(connectionID).experimental.job.list(
        { sessionID: session.id, descendants: true, kind: "codemode", status: "running" },
        { signal },
      );
      return { jobs: jobs.filter(isScriptJob), requestedAt };
    },
    enabled,
    staleTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    refetchInterval: (query) =>
      enabled && open && !followsJobEvents && !query.state.error ? SHELL_POLL_MS : false,
  });
  const [scriptEvents, setScriptEvents] = useState<{
    scope: string;
    events: ReadonlyMap<string, ScriptJobEvent>;
  }>({ scope: "", events: new Map() });
  useEffect(() => {
    if (!enabled) return;
    return palot.subscribe((batch) => {
      if (batch.connectionID !== connectionID) return;
      const updates = batch.events.flatMap((event) =>
        event.type === "experimental.job.updated" && isScriptJob(event.data.info)
          ? [event.data.info]
          : [],
      );
      if (updates.length === 0) return;
      const receivedAt = Date.now();
      setScriptEvents((previous) => ({
        scope: connectionID,
        events: updates.reduce(
          (events, info) => recordScriptJobEvent(events, info, receivedAt),
          previous.scope === connectionID ? previous.events : new Map(),
        ),
      }));
    });
  }, [connectionID, enabled]);
  const runningScripts = scriptList.isError
    ? []
    : runningScriptJobs(
        scriptList.data,
        scriptEvents.scope === connectionID ? scriptEvents.events : new Map(),
      );
  const jobDirectories = useMemo(() => {
    if (!jobs.data) return null;
    return new Set(
      jobs.data.flatMap((job) => {
        const owner = owners.get(job.sessionID);
        return owner ? [owner.location.directory] : [];
      }),
    );
  }, [jobs.data, owners]);
  const readable = (location: LocationRef) =>
    location.directory === ownDirectory ||
    loaded?.has(location.directory) === true ||
    jobDirectories?.has(location.directory) === true ||
    (open && jobDirectories === null);
  // Closed, the counts follow shell and terminal events after one read on mount. Only the open
  // list polls, for output-free changes such as a terminal's foreground process. A deleted
  // directory stops polling until it is read again.
  const shells = useQueries({
    queries: locations.map((location) => ({
      ...runningShellsQueryOptions(connectionID, location, enabled && readable(location)),
      notifyOnChangeProps: undefined,
      refetchOnMount: true,
      refetchInterval: (query: { state: { error: unknown } }) =>
        enabled && open && !isLocationNotFoundError(query.state.error) ? SHELL_POLL_MS : false,
      retry: false,
    })),
  });
  const terminalsSupported = runtime?.capabilities?.pty === "persistent";
  const queryClient = useQueryClient();
  const refreshKeys = useMemo(
    () => [
      ...locations.map((location) => openCodeKeys.runningShells(connectionID, location)),
      ...[...owners.keys()].map((sessionID) =>
        openCodeKeys.sessionTerminals(connectionID, sessionID),
      ),
    ],
    [connectionID, locations, owners],
  );
  const latestRefreshKeys = useRef(refreshKeys);
  latestRefreshKeys.current = refreshKeys;
  useEffect(() => {
    // Opening shows current detail at once instead of after the first poll interval.
    if (!open || !enabled) return;
    for (const queryKey of latestRefreshKeys.current)
      void queryClient.invalidateQueries({ queryKey, exact: true }, { cancelRefetch: false });
  }, [enabled, open, queryClient]);
  const terminals = useQueries({
    queries: [...owners.keys()].map((sessionID) => ({
      ...sessionTerminalsQueryOptions(connectionID, sessionID, enabled && terminalsSupported),
      refetchOnMount: false,
      refetchInterval: (query: { state: { error: unknown } }) =>
        enabled && open && !query.state.error ? TERMINAL_POLL_MS : false,
    })),
  });
  const current: SessionProcess[] = enabled
    ? [
        ...shells.flatMap((query, index) =>
          (query.data ?? []).flatMap((shell) =>
            shell.sessionID && owners.has(shell.sessionID)
              ? [
                  {
                    ...shell,
                    kind: "command" as const,
                    location: locations[index]!,
                    active: shell.status === "running",
                  },
                ]
              : [],
          ),
        ),
        ...terminals.flatMap((query) =>
          (terminalsSupported ? (query.data ?? []) : []).flatMap((pty) => {
            const owner = owners.get(pty.sessionID);
            return owner
              ? [
                  {
                    ...pty,
                    kind: "terminal" as const,
                    location: owner.location,
                    active: pty.status === "running",
                  },
                ]
              : [];
          }),
        ),
        ...runningScripts.flatMap((job): SessionScript[] => {
          const owner = owners.get(job.sessionID);
          if (!owner) return [];
          const transcript = queryClient.getQueryData<TranscriptData>(
            transcriptQueryKey(connectionID, job.sessionID),
          );
          return [
            {
              kind: "script",
              id: job.id,
              sessionID: job.sessionID,
              title:
                scriptJobTitle(job.id, transcriptMessages(transcript)) ??
                job.title ??
                "Code Mode script",
              startedAt: job.time.started,
              location: owner.location,
              active: true,
            },
          ];
        }),
      ]
    : [];
  const [history, setHistory] = useState<ProcessHistory & { scope: string; now: number }>({
    ...emptyHistory(),
    scope,
    now: 0,
  });
  const signature = JSON.stringify(current);
  useEffect(() => {
    const update = () =>
      setHistory((previous) => ({
        scope,
        now: Date.now(),
        ...(enabled
          ? reconcileProcesses(
              previous.scope === scope ? previous : emptyHistory(),
              JSON.parse(signature) as SessionProcess[],
              Date.now(),
              open,
            )
          : emptyHistory()),
      }));
    update();
    const timer = window.setInterval(update, 1_000);
    return () => window.clearInterval(timer);
  }, [scope, signature, open, enabled]);
  const rows = history.scope === scope && enabled ? history.rows : [];
  const finished = useQueries({
    queries: rows
      .filter(
        (row): row is SessionCommand =>
          row.kind === "command" && !row.active && row.status === "running",
      )
      .map((row) => ({
        queryKey: [
          ...openCodeKeys.all(connectionID),
          "session-process-finished",
          row.location,
          row.id,
        ],
        queryFn: ({ signal }: { signal: AbortSignal }) =>
          openCodeClient(connectionID).shell.get(
            {
              id: row.id,
              location: { directory: row.location.directory },
            },
            { signal },
          ),
        enabled,
        retry: false,
        staleTime: Infinity,
        refetchOnWindowFocus: false,
      })),
  });
  const resolved = rows.map((row) => {
    if (row.kind !== "command" || row.active) return row;
    const shell = finished.find((query) => query.data?.data.id === row.id)?.data?.data;
    return shell && shell.metadata.sessionID === row.sessionID
      ? { ...row, status: shell.status, exit: shell.exit }
      : row;
  });
  return {
    now: history.now,
    retry: async () => {
      if (!enabled) return;
      await Promise.all(
        [
          ...shells.filter((_, index) => readable(locations[index]!)),
          ...(terminalsSupported ? terminals : []),
        ]
          .filter((query) => query.isError)
          .map((query) => query.refetch()),
      );
    },
    rows: resolved,
    commands: current.filter((row) => row.kind === "command" && row.active).length,
    scripts: current.filter((row) => row.kind === "script" && row.active).length,
    terminals: current.filter((row) => row.kind === "terminal" && row.active).length,
    loading: shells.some((query) => query.isLoading) || terminals.some((query) => query.isLoading),
    error: shells.some((query) => query.isError)
      ? "Commands could not be refreshed."
      : terminals.some((query) => query.isError)
        ? "Terminals could not be refreshed."
        : null,
    terminalsSupported,
    owners,
  };
}
