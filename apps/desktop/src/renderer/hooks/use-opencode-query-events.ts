import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import {
  openCodeInvalidationKeys,
  sessionStatsShouldRevalidate,
  sessionTranscriptShouldRevalidate,
} from "../lib/opencode-query-events";
import { openCodeKeys } from "../lib/opencode-query";
import {
  applySessionActivityEvents,
  hydrateSessionLineage,
  sessionActivityCompletionHint,
} from "../lib/session-activity-query";
import { sessionRequestEventSessionID } from "../lib/session-request-query";
import { palot } from "../services/palot";
import { openCodeReconciler } from "../lib/open-code-reconciler";
import { createQueryInvalidationQueue } from "../lib/query-invalidation-queue";
import { batchProcessingProbe } from "../lib/batch-processing-probe";

export function useOpenCodeQueryEvents(): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    const confirmTimers = new Map<string, ReturnType<typeof setTimeout>>();
    const sessionStatsTimers = new Map<string, ReturnType<typeof setTimeout>>();
    const invalidations = createQueryInvalidationQueue(queryClient);
    const invalidate = invalidations.invalidate;
    const confirmActivity = (connectionID: string, delay = 0) => {
      const current = confirmTimers.get(connectionID);
      if (current) clearTimeout(current);
      confirmTimers.set(
        connectionID,
        setTimeout(() => {
          confirmTimers.delete(connectionID);
          void queryClient.invalidateQueries({
            queryKey: openCodeKeys.sessionActivity(connectionID),
            exact: true,
            refetchType: "active",
          });
        }, delay),
      );
    };
    const revalidateSessionStats = (connectionID: string) => {
      const current = sessionStatsTimers.get(connectionID);
      if (current) clearTimeout(current);
      sessionStatsTimers.set(
        connectionID,
        setTimeout(() => {
          sessionStatsTimers.delete(connectionID);
          void queryClient.invalidateQueries(
            {
              queryKey: openCodeKeys.sessionStatsRoot(connectionID),
              refetchType: "active",
            },
            { cancelRefetch: false },
          );
        }, 60_000),
      );
    };
    const unsubscribe = palot.subscribe((batch) => {
      const timing = __PALOT_PERFORMANCE_HARNESS__ ? batchProcessingProbe?.begin(batch) : undefined;
      // Includes reconciler subscribers and synchronous activity/invalidation enqueue work.
      // Async request completion and React render/commit remain outside this callback scope.
      try {
        const admitted = openCodeReconciler(queryClient).applyBatch(batch);
        if (admitted.events.length === 0 && !admitted.gap && !admitted.streamChanged) return;
        applySessionActivityEvents(queryClient, batch.connectionID, admitted.events);
        let confirmTerminal = false;
        let usageChanged = false;
        const terminalSessionIDs = new Set<string>();
        const requestSessionIDs = new Set<string>();
        for (const event of admitted.events) {
          usageChanged ||= sessionStatsShouldRevalidate(event);
          const requestSessionID = sessionRequestEventSessionID(event);
          if (requestSessionID && requestSessionID !== "global") {
            requestSessionIDs.add(requestSessionID);
          }
          confirmTerminal ||=
            sessionActivityCompletionHint(event) ||
            event.type === "session.idle" ||
            (event.type === "session.status" && event.data.status.type === "idle") ||
            event.type === "session.execution.succeeded" ||
            event.type === "session.execution.failed" ||
            event.type === "session.execution.interrupted";
          if (
            event.type === "session.idle" ||
            (event.type === "session.status" && event.data.status.type === "idle") ||
            event.type === "session.execution.succeeded" ||
            event.type === "session.execution.failed" ||
            event.type === "session.execution.interrupted"
          ) {
            terminalSessionIDs.add(event.data.sessionID);
            if (
              sessionTranscriptShouldRevalidate(
                event,
                openCodeReconciler(queryClient).messages(batch.connectionID, event.data.sessionID),
              )
            ) {
              const queryKey = openCodeKeys.transcript(batch.connectionID, event.data.sessionID);
              const pending = queryClient.getQueryCache().find({ queryKey, exact: true })?.promise;
              // The queue reuses in-flight reads. A pre-settlement read can still
              // return running tools, so enqueue the repair only after it settles.
              if (pending) {
                void pending.then(
                  () => invalidate(queryKey),
                  () => invalidate(queryKey),
                );
              } else invalidate(queryKey);
            }
          }
          for (const queryKey of openCodeInvalidationKeys(batch.connectionID, event)) {
            invalidate(queryKey);
          }
        }
        if (usageChanged) revalidateSessionStats(batch.connectionID);
        if (terminalSessionIDs.size > 0) {
          void hydrateSessionLineage(queryClient, batch.connectionID, [...terminalSessionIDs]);
        }
        if (requestSessionIDs.size > 0) {
          const sessionIDs = [...requestSessionIDs];
          void hydrateSessionLineage(queryClient, batch.connectionID, sessionIDs);
        }
        const initialConnectedOnly =
          batch.streamEpoch === 1 &&
          admitted.events.length > 0 &&
          admitted.events.every((event) => event.type === "server.connected");
        if (admitted.gap || (admitted.streamChanged && !initialConnectedOnly)) {
          confirmActivity(batch.connectionID);
          revalidateSessionStats(batch.connectionID);
          invalidate(openCodeKeys.runningShellsRoot(batch.connectionID));
          invalidate(openCodeKeys.requests(batch.connectionID));
          invalidate(openCodeKeys.settings(batch.connectionID));
          invalidate(openCodeKeys.models(batch.connectionID));
          invalidate(openCodeKeys.composerCatalogs(batch.connectionID));
          invalidate(openCodeKeys.promptIndexes(batch.connectionID));
          invalidate(openCodeKeys.vcs(batch.connectionID));
        } else if (confirmTerminal) confirmActivity(batch.connectionID, 750);
      } finally {
        if (timing) batchProcessingProbe?.end(timing);
      }
    });
    return () => {
      unsubscribe();
      for (const timer of confirmTimers.values()) clearTimeout(timer);
      confirmTimers.clear();
      for (const timer of sessionStatsTimers.values()) clearTimeout(timer);
      sessionStatsTimers.clear();
      invalidations.dispose();
    };
  }, [queryClient]);
}
