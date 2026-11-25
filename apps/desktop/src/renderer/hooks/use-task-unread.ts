import { useQueryClient } from "@tanstack/react-query";
import { atom, useAtomValue, useStore } from "jotai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { OpenCodeRuntimeStatus, PalotSession } from "../../shared";
import { loadPersistedValue, persistedAtom, persistedStorageKey } from "../atoms/persisted";
import { runtimeAtom } from "../atoms/workspace";
import { markSessionViewed } from "../lib/session-catalog-query";
import {
  addUnreadMark,
  hasUnreadMark,
  removeUnreadMark,
  serverSessionIsUnread,
  taskIsUnread,
  unreadMarkKey,
  validUnreadMarks,
  type UnreadMarks,
} from "../lib/task-unread";
import { showErrorToast } from "../lib/toast-error";
import { viewSession } from "../services/opencode-catalog";

const UNREAD_MARKS_KEY = "tasks.unread-marks";

function loadUnreadMarks(): UnreadMarks {
  return loadPersistedValue<UnreadMarks>({
    key: UNREAD_MARKS_KEY,
    initialValue: {},
    validate: validUnreadMarks,
  });
}

/** Tasks marked unread in Palot, keyed by connection profile and task. */
export const unreadMarksAtom = persistedAtom<UnreadMarks>({
  key: UNREAD_MARKS_KEY,
  initialValue: {},
  validate: validUnreadMarks,
});

// Other windows share the marks through localStorage.
unreadMarksAtom.onMount = (set) => {
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== persistedStorageKey(UNREAD_MARKS_KEY)) return;
    set(loadUnreadMarks());
  };
  window.addEventListener("storage", onStorage);
  return () => window.removeEventListener("storage", onStorage);
};

/** Whether a task is marked unread. Without `profileID` it uses the focused connection. */
export function useTaskMarkedUnread(sessionID: string, profileID?: string): boolean {
  const runtimeProfileID = useAtomValue(runtimeAtom)?.profileID;
  const profile = profileID ?? runtimeProfileID;
  const key = profile ? unreadMarkKey(profile, sessionID) : null;
  const markedAtom = useMemo(
    () => atom((get) => key !== null && hasUnreadMark(get(unreadMarksAtom), key)),
    [key],
  );
  return useAtomValue(markedAtom);
}

/** For lists: whether a task is marked. Without `profileID` it uses the focused connection. */
export function useUnreadMarkLookup(): (sessionID: string, profileID?: string) => boolean {
  const marks = useAtomValue(unreadMarksAtom);
  const runtimeProfileID = useAtomValue(runtimeAtom)?.profileID;
  return useCallback(
    (sessionID: string, profileID?: string) => {
      const profile = profileID ?? runtimeProfileID;
      return profile !== undefined && hasUnreadMark(marks, unreadMarkKey(profile, sessionID));
    },
    [marks, runtimeProfileID],
  );
}

export function useSetUnreadMark(): (
  profileID: string,
  sessionID: string,
  marked: boolean,
) => void {
  const store = useStore();
  return useCallback(
    (profileID: string, sessionID: string, marked: boolean) => {
      const key = unreadMarkKey(profileID, sessionID);
      const current = store.get(unreadMarksAtom);
      if (hasUnreadMark(current, key) === marked) return;
      store.set(
        unreadMarksAtom,
        marked ? addUnreadMark(current, key) : removeUnreadMark(current, key),
      );
    },
    [store],
  );
}

/**
 * Clears a task's mark when the person navigates to it. Mount once, above the task route, with
 * the task the location names (or null). It follows the location, not the task view's mount:
 * the view remounts while its task stays open, which must not count as opening it again. So
 * marking the open task keeps it unread until they leave and come back.
 */
export function useClearUnreadMarkOnOpen(sessionID: string | null): void {
  const profileID = useAtomValue(runtimeAtom)?.profileID;
  const setMark = useSetUnreadMark();
  const opened = useRef<string | null>(null);
  useEffect(() => {
    if (!sessionID) {
      opened.current = null;
      return;
    }
    if (!profileID) return;
    const key = unreadMarkKey(profileID, sessionID);
    if (opened.current === key) return;
    opened.current = key;
    setMark(profileID, sessionID, false);
  }, [profileID, sessionID, setMark]);
}

/**
 * Read state and its toggle for task menus. Marking unread is local; marking read clears the
 * mark and, when OpenCode still has the task unread, records the view there too.
 */
export function useTaskReadToggle(
  session: PalotSession,
  runtime: OpenCodeRuntimeStatus | null | undefined,
) {
  const queryClient = useQueryClient();
  const profileID = runtime?.profileID;
  const marked = useTaskMarkedUnread(session.id, profileID);
  const setMark = useSetUnreadMark();
  const [pending, setPending] = useState(false);
  const unread = taskIsUnread(session, { marked });
  const serverUnread = serverSessionIsUnread(session);
  const toggle = useCallback(async () => {
    if (!unread) {
      if (profileID) setMark(profileID, session.id, true);
      return;
    }
    if (profileID) setMark(profileID, session.id, false);
    const idle = session.idleAt;
    const connectionID = runtime?.connectionID;
    if (!serverUnread || idle === undefined || !connectionID) return;
    setPending(true);
    try {
      await viewSession(session.id, idle, undefined, connectionID);
      markSessionViewed(queryClient, connectionID, session.id, idle);
    } catch (error) {
      showErrorToast("Could not mark task as read", error);
    } finally {
      setPending(false);
    }
  }, [
    profileID,
    queryClient,
    runtime?.connectionID,
    serverUnread,
    session.id,
    session.idleAt,
    setMark,
    unread,
  ]);
  return {
    unread,
    pending,
    /** Marking needs a profile to key the mark; marking read may only need the server. */
    available: unread
      ? Boolean(profileID) || (serverUnread && Boolean(runtime?.connectionID))
      : Boolean(profileID),
    label: unread ? "Mark as read" : "Mark as unread",
    toggle,
  };
}
