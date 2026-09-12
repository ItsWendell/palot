import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import { useCallback, useMemo } from "react";
import { runtimeAtom } from "../atoms/workspace";
import { sessionRequestsQueryOptions } from "../lib/session-request-query";
import { useOpenCodeRecords } from "./use-open-code-records";
import { useSessionCatalogSelector } from "./use-session-catalog";
import {
  familyRequestViews,
  requestSessionFamily,
  type RequestSession,
} from "../lib/session-family-requests";
import type { PalotSession } from "../../shared";

function sameRequestFamily(left: RequestSession[], right: RequestSession[]) {
  return (
    left.length === right.length &&
    left.every((session, index) => {
      const other = right[index];
      return (
        session.id === other?.id &&
        session.parentID === other.parentID &&
        session.title === other.title
      );
    })
  );
}

// Attention hydration already discovers request owners and their ancestors.
// Subscribe to that cache, not one network request or transcript per child.
export function useSessionFamilyRequestViews(sessionID: string | null) {
  const select = useCallback(
    (sessions: PalotSession[]) => requestSessionFamily(sessions, sessionID),
    [sessionID],
  );
  const family = useSessionCatalogSelector(select, sameRequestFamily);
  const ids = useMemo(() => family.map((session) => session.id), [family]);
  const requests = useSessionRequestMap(ids);
  return useMemo(() => familyRequestViews(family, requests), [family, requests]);
}

export function useSessionRequests(sessionID: string | null) {
  const runtime = useAtomValue(runtimeAtom);
  const queryClient = useQueryClient();
  const connectionID = runtime?.connectionID ?? "disconnected";
  const query = useQuery({
    ...sessionRequestsQueryOptions(
      queryClient,
      connectionID,
      sessionID ?? "",
      Boolean(runtime?.connected),
    ),
    staleTime: 0,
  });
  const records = useOpenCodeRecords(connectionID, "session-request", sessionID ?? "");
  return { ...query, data: records[0]?.value ?? query.data };
}

export function useSessionRequestMap(sessionIDs: readonly string[]) {
  const runtime = useAtomValue(runtimeAtom);
  const connectionID = runtime?.connectionID ?? "disconnected";
  const records = useOpenCodeRecords(connectionID, "session-request");
  return useMemo(() => {
    const included = new Set(sessionIDs);
    return new Map(
      records.flatMap((record) =>
        included.has(record.sessionID) ? [[record.sessionID, record.value] as const] : [],
      ),
    );
  }, [records, sessionIDs]);
}
