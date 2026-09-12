import type { LocationRef, PersistentPtyInfo } from "@opencode/client";
import { useQueries } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import { useEffect, useMemo, useState } from "react";
import type { PalotRunningShell, PalotSession } from "../../shared";
import { runtimeAtom } from "../atoms/workspace";
import { openCodeKeys } from "../lib/opencode-query";
import { openCodeClient } from "../services/opencode-client";
import { runningShellsQueryOptions } from "./use-running-shells";
import { useSessionCatalog } from "./use-session-catalog";

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
export type SessionProcess = SessionCommand | SessionTerminal;
const RECENT_MS = 30_000;
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

export function useSessionProcesses(
  session: PalotSession,
  sessionIDs: ReadonlySet<string>,
  open: boolean,
) {
  const runtime = useAtomValue(runtimeAtom);
  const catalog = useSessionCatalog();
  const connectionID = runtime?.connectionID ?? "disconnected";
  const enabled = Boolean(runtime?.connected && connectionID !== "preview");
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
  const shells = useQueries({
    queries: locations.map((location) => ({
      ...runningShellsQueryOptions(connectionID, location, enabled),
      notifyOnChangeProps: undefined,
      refetchOnMount: true,
      refetchInterval: enabled ? 2_000 : false,
      retry: false,
    })),
  });
  const terminalsSupported = runtime?.capabilities?.pty === "persistent";
  const terminals = useQueries({
    queries: [...owners.keys()].map((sessionID) => ({
      queryKey: [...openCodeKeys.all(connectionID), "session-process-terminals", sessionID],
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        openCodeClient().experimental.persistentPty.list({ sessionID }, { signal }),
      enabled: enabled && terminalsSupported,
      retry: false,
      refetchOnWindowFocus: false,
      refetchOnMount: false,
      refetchInterval: (query: { state: { error: unknown } }) =>
        enabled && !query.state.error ? 3_000 : false,
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
          openCodeClient().shell.get(
            {
              id: row.id,
              location: { directory: row.location.directory, workspace: row.location.workspaceID },
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
        [...shells, ...(terminalsSupported ? terminals : [])]
          .filter((query) => query.isError)
          .map((query) => query.refetch()),
      );
    },
    rows: resolved,
    commands: current.filter((row) => row.kind === "command" && row.active).length,
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
