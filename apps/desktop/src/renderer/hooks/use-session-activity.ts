import { useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import { useEffect, useMemo, useRef } from "react";
import {
  belongsToSession,
  phaseAtom,
  runtimeAtom,
  selectedSessionIDAtom,
  type SessionExecutionState,
  type SessionRuntimeStatus,
} from "../atoms/workspace";
import { openCodeKeys } from "../lib/opencode-query";
import {
  hydrateSelectedSessionActivity,
  type SessionActivityData,
  sessionActivityQueryOptions,
} from "../lib/session-activity-query";
import { palot } from "../services/palot";
import { useOpenCodeRecords } from "./use-open-code-records";

interface SessionActivityOptions<T> {
  synchronize?: boolean;
  select?: (data: SessionActivityData) => T;
}

type SessionActivityResult<T> = Omit<UseQueryResult<SessionActivityData>, "data"> & { data: T };

export interface SessionActivityView {
  active: boolean;
  execution: Map<string, SessionExecutionState>;
  status: SessionRuntimeStatus | null;
}

export function useSessionActivity<T>(
  options: SessionActivityOptions<T> & { select: (data: SessionActivityData) => T },
): SessionActivityResult<T>;
export function useSessionActivity(
  options?: SessionActivityOptions<SessionActivityData>,
): SessionActivityResult<SessionActivityData>;
export function useSessionActivity<T>({
  synchronize = false,
  select,
}: SessionActivityOptions<T> = {}) {
  const runtime = useAtomValue(runtimeAtom);
  const phase = useAtomValue(phaseAtom);
  const selectedSessionID = useAtomValue(selectedSessionIDAtom);
  const queryClient = useQueryClient();
  const connectionID = runtime?.connectionID ?? "disconnected";
  const previousSelectedSessionID = useRef(selectedSessionID);
  const query = useQuery<
    SessionActivityData,
    Error,
    SessionActivityData,
    ReturnType<typeof openCodeKeys.sessionActivity>
  >({
    ...sessionActivityQueryOptions(queryClient, connectionID, synchronize, selectedSessionID),
    staleTime: Number.POSITIVE_INFINITY,
    notifyOnChangeProps: ["data"],
    enabled: Boolean(synchronize && phase === "ready" && runtime?.connected && !palot.isPreview()),
  });
  const records = useOpenCodeRecords(connectionID, "session-runtime");
  const activity = useMemo<SessionActivityData>(() => {
    const activeIDs = new Set<string>();
    const execution = new Map<string, SessionExecutionState>();
    const statuses = new Map<string, SessionRuntimeStatus>();
    for (const record of records) {
      if (record.value.active) activeIDs.add(record.sessionID);
      if (record.value.execution) execution.set(record.sessionID, record.value.execution);
      if (record.value.status) statuses.set(record.sessionID, record.value.status);
    }
    return { activeIDs, execution, statuses };
  }, [records]);
  const selected = useMemo(() => (select ? select(activity) : activity), [activity, select]);
  useEffect(() => {
    if (!synchronize) return;
    if (previousSelectedSessionID.current === selectedSessionID) return;
    previousSelectedSessionID.current = selectedSessionID;
    if (phase !== "ready" || !runtime?.connected || palot.isPreview()) return;
    if (selectedSessionID) {
      void hydrateSelectedSessionActivity(queryClient, connectionID, selectedSessionID);
    }
  }, [connectionID, phase, queryClient, runtime?.connected, selectedSessionID, synchronize]);
  return { ...query, data: selected };
}

export function useSessionActivityForSession(sessionID: string) {
  const select = useMemo(() => createSessionActivitySelector(sessionID), [sessionID]);
  return useSessionActivity({ select });
}

export function createSessionActivitySelector(sessionID: string) {
  let previous: SessionActivityView | undefined;
  return (data: SessionActivityData): SessionActivityView => {
    const entries = [...data.execution].filter(([candidateID]) =>
      belongsToSession(data.execution, candidateID, sessionID),
    );
    const execution =
      previous && sameExecutionEntries(previous.execution, entries)
        ? previous.execution
        : new Map(entries);
    const active = [...data.activeIDs].some((candidateID) =>
      belongsToSession(data.execution, candidateID, sessionID),
    );
    const status = data.statuses.get(sessionID) ?? null;
    if (
      previous &&
      previous.active === active &&
      previous.execution === execution &&
      previous.status === status
    ) {
      return previous;
    }
    previous = { active, execution, status };
    return previous;
  };
}

function sameExecutionEntries(
  current: Map<string, SessionExecutionState>,
  entries: Array<[string, SessionExecutionState]>,
): boolean {
  return (
    current.size === entries.length && entries.every(([id, state]) => current.get(id) === state)
  );
}
