import { useAtomValue, useSetAtom } from "jotai";
import { useEffect, useEffectEvent } from "react";
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
import { latestSessionWatermark, rootSessionID } from "../lib/session-inbox";
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
