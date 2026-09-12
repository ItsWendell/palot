import { queryOptions, type QueryClient } from "@tanstack/react-query";
import type { PalotEvent, SessionRequestSnapshot } from "../../shared";
import { openCodeKeys } from "./opencode-query";
import { palot } from "../services/palot";
import {
  EMPTY_SESSION_REQUEST_SNAPSHOT,
  mergeSessionRequestSnapshot,
  sessionRequestEventSessionID,
  updateSessionRequests,
} from "./session-request-reducer";
import { openCodeReconciler, type OpenCodeSnapshotToken } from "./open-code-reconciler";

export {
  EMPTY_SESSION_REQUEST_SNAPSHOT,
  mergeAttentionRequests,
  mergeSessionRequestSnapshot,
  sessionRequestEventSessionID,
} from "./session-request-reducer";

export function sessionRequestsQueryOptions(
  queryClient: QueryClient,
  connectionID: string,
  sessionID: string,
  enabled = true,
) {
  return queryOptions({
    queryKey: openCodeKeys.sessionRequests(connectionID, sessionID),
    queryFn: async ({ signal }) => {
      const reconciler = openCodeReconciler(queryClient);
      const token = reconciler.beginSnapshot(connectionID);
      const current =
        reconciler.requests(connectionID, sessionID) ?? EMPTY_SESSION_REQUEST_SNAPSHOT;
      const inbox = await palot.loadSessionInbox(sessionID, signal, connectionID);
      const value = { ...current, inbox };
      reconciler.setRequests(connectionID, sessionID, value, token);
      return value;
    },
    enabled: enabled && Boolean(sessionID),
    staleTime: Number.POSITIVE_INFINITY,
    structuralSharing: (previous, next) =>
      mergeSessionRequestSnapshot(
        previous as SessionRequestSnapshot | undefined,
        next as SessionRequestSnapshot,
      ),
  });
}

export function setSessionRequestSnapshot(
  queryClient: QueryClient,
  connectionID: string,
  sessionID: string,
  value: SessionRequestSnapshot,
  token?: OpenCodeSnapshotToken,
): void {
  openCodeReconciler(queryClient).setRequests(connectionID, sessionID, value, token);
  queryClient.setQueryData<SessionRequestSnapshot>(
    openCodeKeys.sessionRequests(connectionID, sessionID),
    (current) => mergeSessionRequestSnapshot(current, value),
  );
}

export function applySessionRequestEvent(
  queryClient: QueryClient,
  connectionID: string,
  event: PalotEvent,
): void {
  const sessionID = sessionRequestEventSessionID(event);
  if (!sessionID) {
    if (event.type === "session.deleted") {
      queryClient.removeQueries({
        queryKey: openCodeKeys.sessionRequests(connectionID, event.data.sessionID),
        exact: true,
      });
    }
    return;
  }
  queryClient.setQueryData<SessionRequestSnapshot>(
    openCodeKeys.sessionRequests(connectionID, sessionID),
    (value) => updateSessionRequests(value ?? EMPTY_SESSION_REQUEST_SNAPSHOT, event),
  );
}
