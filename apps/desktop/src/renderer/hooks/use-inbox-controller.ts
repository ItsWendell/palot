import { useQueryClient } from "@tanstack/react-query";
import { useAtomValue, useSetAtom } from "jotai";
import { useEffect, useEffectEvent } from "react";
import type { PalotSession } from "../../shared";
import type { SourceControlChangedEvent } from "../../shared/source-control-contract";
import {
  dispatchSessionTriageAtom,
  inboxClockAtom,
  sessionCatalogReadyAtom,
  sessionTriageErrorAtom,
  sessionTriageLoadingAtom,
  sessionTriageSnapshotAtom,
} from "../atoms/inbox";
import { sidebarModeAtom } from "../atoms/ui";
import { phaseAtom, runtimeAtom, selectedSessionIDAtom } from "../atoms/workspace";
import { connectionOverview } from "../lib/connection-overview";
import { latestSessionWatermark, rootSessionID } from "../lib/session-inbox";
import { toast } from "../components/ui/toast";
import { sourceControl, useSourceControlEvent } from "./use-source-control";
import { useSessionInbox } from "./use-session-inbox";
import { palot } from "../services/palot";
import { useCacheSession, useSessionCatalog } from "./use-session-catalog";

export function useInboxController(): void {
  const runtime = useAtomValue(runtimeAtom);
  const phase = useAtomValue(phaseAtom);
  const selectedSessionID = useAtomValue(selectedSessionIDAtom);
  const sidebarMode = useAtomValue(sidebarModeAtom);
  const sessions = useSessionCatalog();
  const catalogReady = useAtomValue(sessionCatalogReadyAtom);
  const snapshot = useAtomValue(sessionTriageSnapshotAtom);
  const inbox = useSessionInbox();
  const setSnapshot = useSetAtom(sessionTriageSnapshotAtom);
  const setLoading = useSetAtom(sessionTriageLoadingAtom);
  const setError = useSetAtom(sessionTriageErrorAtom);
  const dispatch = useSetAtom(dispatchSessionTriageAtom);
  const setClock = useSetAtom(inboxClockAtom);
  const cacheSession = useCacheSession();
  const getSelectedSessionID = useEffectEvent(() => selectedSessionID);
  const getSessions = useEffectEvent(() => sessions);
  const getSnapshot = useEffectEvent(() => snapshot);
  const queryClient = useQueryClient();

  // Palot settles a task when its watched PR merges or closes; reload that profile's
  // triage so the task moves to Settled without a restart.
  useSourceControlEvent((event) => {
    if (event.type !== "pull-requests" || event.reason !== "settled") return;
    const focused = runtime?.profileID === event.profileID;
    void palot
      .loadSessionTriage(event.profileID)
      .then((next) => {
        if (focused) setSnapshot(next);
        else connectionOverview(queryClient).acceptTriage(next);
      })
      .catch(() => undefined);
    void announceSettled(event, (sessionID) =>
      focused
        ? sessions.find((session) => session.id === sessionID)
        : connectionOverview(queryClient)
            .getSnapshot()
            .find((entry) => entry.profile.id === event.profileID)
            ?.sessions.find((session) => session.id === sessionID),
    );
  });

  // An agent tool can pin, settle or snooze a task; show it without a reload.
  useEffect(
    () =>
      palot.onSessionTriageChanged((next) => {
        if (runtime?.profileID === next.profileID) setSnapshot(next);
        else connectionOverview(queryClient).acceptTriage(next);
      }),
    [queryClient, runtime?.profileID, setSnapshot],
  );

  useEffect(() => {
    if (sidebarMode !== "inbox" || phase !== "ready" || !catalogReady || !runtime?.profileID) {
      return;
    }
    let active = true;
    setLoading(true);
    setError(null);
    if (getSnapshot()?.profileID !== runtime.profileID) setSnapshot(null);
    void palot
      .loadSessionTriage(runtime.profileID)
      .then(async (value) => {
        if (!active) return;
        let next = value;
        if (value.bootstrapThrough === null) {
          const knownSessions = getSessions();
          next = await palot.dispatchSessionTriage({
            type: "bootstrap",
            profileID: runtime.profileID,
            at: Date.now(),
            through: latestSessionWatermark(knownSessions),
          });
          const selected = getSelectedSessionID();
          if (selected) {
            next = await palot.dispatchSessionTriage({
              type: "inbox",
              profileID: runtime.profileID,
              sessionID: rootSessionID(selected, knownSessions),
              at: Date.now(),
            });
          }
        }
        const knownIDs = new Set(getSessions().map((session) => session.id));
        const missing = next.sessions.filter(
          (record) =>
            (record.pinnedAt !== null || record.snoozedUntil !== null) &&
            !knownIDs.has(record.sessionID),
        );
        const hydrated = await Promise.all(
          missing.map((record) => palot.getSession(record.sessionID)),
        );
        if (active) {
          setSnapshot(next);
          for (const session of hydrated) if (session) cacheSession(session);
        }
      })
      .catch((error) => {
        if (active) setError(error instanceof Error ? error.message : "Could not load inbox state");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [
    phase,
    catalogReady,
    runtime?.profileID,
    setError,
    setLoading,
    cacheSession,
    setSnapshot,
    sidebarMode,
  ]);

  useEffect(() => {
    if (inbox.nextSnoozeDeadline === null) return;
    const delay = Math.max(0, inbox.nextSnoozeDeadline - Date.now());
    const timer = window.setTimeout(
      () => setClock(Date.now()),
      Math.min(delay + 10, 2_147_483_647),
    );
    return () => window.clearTimeout(timer);
  }, [inbox.nextSnoozeDeadline, setClock]);

  useEffect(() => {
    if (!snapshot) return;
    const records = new Map(snapshot.sessions.map((record) => [record.sessionID, record]));
    for (const item of [...inbox.inbox, ...inbox.pinned]) {
      if (!item.attention || !records.get(item.session.id)?.snoozedUntil) continue;
      void dispatch({ type: "wake", sessionID: item.session.id, at: Date.now() });
    }
  }, [dispatch, inbox.inbox, inbox.pinned, snapshot]);
}

/** A quiet toast per settled task, e.g. "Settled Fix login after #12 merged". */
async function announceSettled(
  event: Extract<SourceControlChangedEvent, { type: "pull-requests" }>,
  findSession: (sessionID: string) => Pick<PalotSession, "title"> | undefined,
): Promise<void> {
  for (const sessionID of event.sessionIDs) {
    try {
      const links = await sourceControl.listPullRequestLinks({
        profileID: event.profileID,
        sessionID,
      });
      const link = links
        .filter((candidate) => candidate.settledAt !== null)
        .toSorted((left, right) => (right.settledAt ?? 0) - (left.settledAt ?? 0))[0];
      if (!link) continue;
      const title = findSession(sessionID)?.title?.trim() || "task";
      const outcome = link.pullRequest.state === "merged" ? "merged" : "closed";
      toast.add({
        type: "info",
        title: `Settled ${title} after #${link.pullRequest.number} ${outcome}`,
      });
    } catch {
      // The inbox already moved; a missing toast is not worth an error.
    }
  }
}
