import { useAtomValue } from "jotai";
import { useMemo } from "react";
import type { PalotSession } from "../../shared";
import { inboxClockAtom, sessionTriageSnapshotAtom } from "../atoms/inbox";
import { projectSessionInbox } from "../lib/session-inbox";
import type { SessionActivityData } from "../lib/session-activity-query";
import { useSessionActivity } from "./use-session-activity";
import { useSessionRequestMap } from "./use-session-requests";
import { useProjectCatalog, useSessionCatalogSelector } from "./use-session-catalog";

const EMPTY_ACTIVE_IDS = new Set<string>();
const EMPTY_RUNNING_SINCE = new Map<string, number | null>();

interface InboxActivityProjection {
  activeIDs: Set<string>;
  runningSinceBySession: Map<string, number | null>;
}

export function createInboxActivitySelector() {
  let previous: InboxActivityProjection | undefined;
  return (data: SessionActivityData): InboxActivityProjection => {
    const entries = [...data.execution].flatMap(([sessionID, execution]) =>
      execution.status === "running" ? ([[sessionID, execution.startedAt]] as const) : [],
    );
    const activeIDs = new Set(entries.map(([sessionID]) => sessionID));
    const previousRunningSince = previous?.runningSinceBySession;
    const runningSinceBySession =
      previousRunningSince &&
      previousRunningSince.size === entries.length &&
      entries.every(([sessionID, startedAt]) =>
        Object.is(previousRunningSince.get(sessionID), startedAt),
      )
        ? previousRunningSince
        : new Map(entries);
    if (
      previous &&
      previous.activeIDs.size === activeIDs.size &&
      [...previous.activeIDs].every((sessionID) => activeIDs.has(sessionID)) &&
      previous.runningSinceBySession === runningSinceBySession
    ) {
      return previous;
    }
    previous = { activeIDs, runningSinceBySession };
    return previous;
  };
}

function createInboxSessionSelector(activeIDs: ReadonlySet<string>) {
  let previous: PalotSession[] | undefined;
  return (sessions: PalotSession[]) => {
    const next = selectSessions(sessions);
    const previousByID = new Map(previous?.map((session) => [session.id, session]));
    const reused = next.map((session) => {
      const current = previousByID.get(session.id);
      return current && sameInboxCatalogSession(current, session, activeIDs) ? current : session;
    });
    if (
      previous?.length === reused.length &&
      reused.every((session, index) => previous?.[index] === session)
    ) {
      return previous;
    }
    previous = reused;
    return previous;
  };
}

function selectSessions(sessions: PalotSession[]) {
  return sessions.toSorted((left, right) => left.id.localeCompare(right.id));
}

function sameInboxCatalogSession(
  left: PalotSession,
  right: PalotSession,
  activeIDs: ReadonlySet<string>,
): boolean {
  return (
    left.id === right.id &&
    left.parentID === right.parentID &&
    left.projectID === right.projectID &&
    left.title === right.title &&
    left.location.directory === right.location.directory &&
    left.location.workspaceID === right.location.workspaceID &&
    left.viewedAt === right.viewedAt &&
    left.archivedAt === right.archivedAt &&
    left.outcome === right.outcome &&
    (activeIDs.has(left.id) || (left.updatedAt === right.updatedAt && left.idleAt === right.idleAt))
  );
}

export function useSessionInbox(additionalSessions: PalotSession[] = []) {
  const selectActivity = useMemo(() => createInboxActivitySelector(), []);
  const activity = useSessionActivity({ select: selectActivity }).data;
  const activeIDs = activity?.activeIDs ?? EMPTY_ACTIVE_IDS;
  const runningSinceBySession = activity?.runningSinceBySession ?? EMPTY_RUNNING_SINCE;
  const selectInboxSessions = useMemo(() => createInboxSessionSelector(activeIDs), [activeIDs]);
  const catalogSessions = useSessionCatalogSelector(selectInboxSessions);
  const sessions = useMemo(() => {
    if (additionalSessions.length === 0) return catalogSessions;
    const merged = new Map(catalogSessions.map((session) => [session.id, session]));
    for (const session of additionalSessions) merged.set(session.id, session);
    return [...merged.values()];
  }, [additionalSessions, catalogSessions]);
  const sessionIDs = useMemo(() => sessions.map((session) => session.id), [sessions]);
  const requests = useSessionRequestMap(sessionIDs);
  const projects = useProjectCatalog();
  const triage = useAtomValue(sessionTriageSnapshotAtom);
  const now = useAtomValue(inboxClockAtom);
  return useMemo(
    () =>
      projectSessionInbox({
        sessions,
        projects,
        requests,
        activeIDs,
        runningSinceBySession,
        triage,
        now,
      }),
    [activeIDs, now, projects, requests, runningSinceBySession, sessions, triage],
  );
}
