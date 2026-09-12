import type { SessionInfo } from "@opencode/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import { useEffect, useEffectEvent } from "react";
import { runtimeAtom } from "../atoms/workspace";
import { markSessionViewed, sessionQueryOptions } from "../lib/session-catalog-query";
import { viewSession } from "../services/opencode-catalog";
import type { PalotSession } from "../../shared";
import { useOpenCodeRecords } from "./use-open-code-records";

export function sessionIsUnread(session: SessionInfo | null | undefined): boolean {
  const idle = session?.time.idle;
  if (idle === undefined) return false;
  const viewed = session?.time.viewed;
  return viewed === undefined || viewed < idle;
}

export function catalogSessionIsUnread(session: PalotSession | null | undefined): boolean {
  if (session?.idleAt === undefined) return false;
  return session.viewedAt === undefined || session.viewedAt < session.idleAt;
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

export function useAcknowledgeSessionView(sessionID: string): void {
  const runtime = useAtomValue(runtimeAtom);
  const queryClient = useQueryClient();
  const session = useSessionInfo(sessionID).data;
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
  }, [sessionID, session?.time.idle, session?.time.viewed]);
}
