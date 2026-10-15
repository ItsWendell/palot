import { useQueryClient } from "@tanstack/react-query";
import { useAtomValue, useSetAtom, useStore } from "jotai";
import { useCallback, useEffect, useEffectEvent, useRef } from "react";
import { SESSION_TRIAGE_BATCH_LIMIT } from "../../shared";
import { dispatchSessionTriageAtom, sessionTriageLoadingAtom } from "../atoms/inbox";
import { autoSettleAfterDaysAtom } from "../atoms/ui";
import { runtimeAtom } from "../atoms/workspace";
import { announceSettledBatch } from "../components/settle-idle-menu";
import {
  connectionOverview,
  type ConnectionOverview,
  type OverviewTriageCommand,
} from "../lib/connection-overview";
import { openCodeKeys } from "../lib/opencode-query";
import { autoSettleCandidates } from "../lib/session-inbox";

const SWEEP_INTERVAL_MS = 60_000;

/**
 * Dispatch a triage command for any profile. The focused profile goes through the workspace
 * triage atom so its Inbox updates; other profiles go through the connection overview.
 */
export function useTriageDispatcher() {
  const store = useStore();
  const controller = connectionOverview(useQueryClient());
  const dispatchFocused = useSetAtom(dispatchSessionTriageAtom);
  return useCallback(
    async (profileID: string, command: OverviewTriageCommand) => {
      if (store.get(runtimeAtom)?.profileID === profileID) await dispatchFocused(command);
      else await controller.dispatch(profileID, command);
    },
    [controller, dispatchFocused, store],
  );
}

/**
 * Settle Inbox tasks idle for the configured number of days, on every loaded connection
 * whose triage, request status, and running state are known. Sweeps when a connection becomes ready and
 * then every minute while Palot is open; only loaded tasks are considered.
 */
export function useAutoSettle(): void {
  const afterDays = useAtomValue(autoSettleAfterDaysAtom);
  const store = useStore();
  const queryClient = useQueryClient();
  const controller = connectionOverview(queryClient);
  const dispatch = useTriageDispatcher();
  const inFlight = useRef(new Set<string>());
  const sweep = useEffectEvent(() => {
    if (afterDays === null) return;
    const now = Date.now();
    const snapshot = controller.getSnapshot();
    for (const connection of snapshot) {
      const profileID = connection.profile.id;
      if (!isSweepable(connection) || inFlight.current.has(profileID)) continue;
      // Running state comes from the activity query; without it every task looks idle.
      const activity = queryClient.getQueryState(
        openCodeKeys.sessionActivity(connection.runtime!.connectionID),
      );
      if (activity?.status !== "success") continue;
      // The Inbox may still be loading this profile's triage and would overwrite the result.
      if (store.get(runtimeAtom)?.profileID === profileID && store.get(sessionTriageLoadingAtom))
        continue;
      const candidates = autoSettleCandidates(connection.inbox.inbox, now, afterDays).slice(
        0,
        SESSION_TRIAGE_BATCH_LIMIT,
      );
      if (candidates.length === 0) continue;
      const sessionIDs = candidates.map((item) => item.session.id);
      inFlight.current.add(profileID);
      void dispatch(profileID, {
        type: "settle-many",
        at: now,
        trigger: "auto",
        sessions: candidates.map((item) => ({
          sessionID: item.session.id,
          through: item.activityThrough,
        })),
      })
        .then(() => {
          const tasks = candidates.length === 1 ? "1 idle task" : `${candidates.length} idle tasks`;
          const where = snapshot.length > 1 ? ` on ${connection.profile.name}` : "";
          announceSettledBatch({
            count: candidates.length,
            title: `Auto-settled ${tasks}${where}`,
            description: `No activity for ${afterDays === 1 ? "a day" : `${afterDays} days`}. Change this in Settings.`,
            undo: () => dispatch(profileID, { type: "inbox-many", at: Date.now(), sessionIDs }),
          });
        })
        // The next sweep retries; a failed background settle is not worth an error.
        .catch(() => undefined)
        .finally(() => inFlight.current.delete(profileID));
    }
  });

  useEffect(() => {
    if (afterDays === null) return;
    // Sweep as soon as another connection becomes ready, without re-rendering on updates.
    let readyKey: string | null = null;
    const onChange = () => {
      const next = readyConnectionsKey(controller.getSnapshot());
      if (next === readyKey) return;
      readyKey = next;
      if (next) sweep();
    };
    onChange();
    const unsubscribe = controller.subscribe(onChange);
    const timer = window.setInterval(sweep, SWEEP_INTERVAL_MS);
    return () => {
      unsubscribe();
      window.clearInterval(timer);
    };
  }, [afterDays, controller]);
}

function isSweepable(connection: ConnectionOverview): boolean {
  return (
    connection.phase === "ready" &&
    connection.runtime?.connected === true &&
    connection.triageReady &&
    connection.attentionState === "ready"
  );
}

function readyConnectionsKey(connections: readonly ConnectionOverview[]): string {
  return connections
    .filter(isSweepable)
    .map((connection) => connection.profile.id)
    .join("\0");
}
