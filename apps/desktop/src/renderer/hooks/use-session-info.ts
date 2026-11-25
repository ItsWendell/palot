import type { SessionInfo } from "@opencode/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import { useEffect, useEffectEvent, useState } from "react";
import type { PalotSession } from "../../shared";
import { runtimeAtom } from "../atoms/workspace";
import { markSessionViewed, sessionQueryOptions } from "../lib/session-catalog-query";
import { viewSession } from "../services/opencode-catalog";
import { useOpenCodeRecords } from "./use-open-code-records";

export function sessionIsUnread(session: SessionInfo | null | undefined): boolean {
  const idle = session?.time.idle;
  if (idle === undefined) return false;
  const viewed = session?.time.viewed;
  return viewed === undefined || viewed < idle;
}

export function useSessionInfo(sessionID: string | null) {
  const runtime = useAtomValue(runtimeAtom);
  const queryClient = useQueryClient();
  const connectionID = runtime?.connectionID ?? "disconnected";
  const query = useQuery({
    ...sessionQueryOptions(queryClient, connectionID, sessionID ?? ""),
    enabled: Boolean(sessionID && runtime?.connected),
    staleTime: Number.POSITIVE_INFINITY,
  });
  const records = useOpenCodeRecords(connectionID, "session", sessionID ?? "");
  return { ...query, data: records[0]?.value ?? query.data };
}

/** The task's read state when it was opened, before opening it marked it viewed. */
export type OpenedSessionView = Pick<PalotSession, "idleAt" | "viewedAt">;

/**
 * Marks the focused task viewed, and returns its read state from just before that: null until
 * OpenCode has answered a fresh read of the session, so a stale cached copy decides neither what
 * counts as unseen nor what is marked viewed. Without a connection, or when that read fails, the
 * cached copy stands in.
 */
export function useAcknowledgeSessionView(sessionID: string): OpenedSessionView | null {
  const runtime = useAtomValue(runtimeAtom);
  const queryClient = useQueryClient();
  const connectionID = runtime?.connectionID ?? "disconnected";
  const enabled = Boolean(sessionID && runtime?.connected);
  const query = useQuery({
    ...sessionQueryOptions(queryClient, connectionID, sessionID),
    enabled,
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnMount: "always",
  });
  const records = useOpenCodeRecords(connectionID, "session", sessionID);
  const session = records[0]?.value ?? query.data;
  const fresh = query.isFetchedAfterMount && !query.isFetching && query.isSuccess;
  const settled = fresh || !enabled || (query.isError && !query.isFetching);
  const [opened, setOpened] = useState<OpenedSessionView | null>(null);
  if (opened === null && settled) {
    // The fresh read itself, not the record merged with this view's acknowledgement.
    const time = (fresh ? query.data : session)?.time;
    setOpened({
      ...(time?.idle === undefined ? {} : { idleAt: time.idle }),
      ...(time?.viewed === undefined ? {} : { viewedAt: time.viewed }),
    });
  }
  const mutation = useMutation({
    mutationFn: ({ idle }: { idle: number }) => viewSession(sessionID, idle),
    onSuccess: (_value, { idle }) => {
      if (!runtime?.connectionID) return;
      markSessionViewed(queryClient, runtime.connectionID, sessionID, idle);
    },
  });
  const acknowledge = useEffectEvent(() => {
    const idle = session?.time.idle;
    if (
      opened === null ||
      idle === undefined ||
      !sessionIsUnread(session) ||
      mutation.isPending ||
      document.visibilityState !== "visible" ||
      !document.hasFocus()
    ) {
      return;
    }
    mutation.mutate({ idle });
  });

  useEffect(() => {
    acknowledge();
    const onFocus = () => acknowledge();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [sessionID, opened, session?.time.idle, session?.time.viewed]);

  return opened;
}
