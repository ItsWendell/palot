import { useAtomValue } from "jotai";
import { useEffect, useRef, useState } from "react";
import { runtimeAtom } from "../atoms/workspace";
import { useSessionInbox } from "../hooks/use-session-inbox";
import { useConnectionOverview } from "../hooks/use-connection-overview";
import { rootSessionID } from "../lib/session-inbox";
import { taskAnnouncement, taskAnnouncementState } from "../lib/task-announcements";

export function TaskActivityAnnouncer({ sessionID }: { sessionID: string | null }) {
  const inbox = useSessionInbox();
  const runtime = useAtomValue(runtimeAtom);
  const overview = useConnectionOverview();
  const focused = overview.connections.find(
    (connection) => connection.profile.id === runtime?.profileID,
  );
  const openTaskID = sessionID ? rootSessionID(sessionID, focused?.sessions ?? []) : null;
  const selectedKey = JSON.stringify([runtime?.profileID, openTaskID]);
  const memory = useRef({ connection: runtime?.connectionID, states: new Map<string, string>() });
  const pending = useRef(new Map<string, string>());
  const previousSelected = useRef(selectedKey);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [announcement, setAnnouncement] = useState("");
  useEffect(() => {
    if (previousSelected.current !== selectedKey) {
      if (previousSelected.current) pending.current.delete(previousSelected.current);
      pending.current.delete(selectedKey);
      previousSelected.current = selectedKey;
    }
    if (memory.current.connection !== runtime?.connectionID) {
      memory.current = { connection: runtime?.connectionID, states: new Map() };
      pending.current.clear();
      clearTimeout(timer.current);
      timer.current = undefined;
    }
    const states = new Map<string, string>();
    const tasks = [
      ...[...inbox.pinned, ...inbox.inbox, ...inbox.snoozed, ...inbox.settled].map((item) => ({
        ...item,
        id: JSON.stringify([runtime?.profileID, item.session.id]),
        title: item.session.title || "Background task",
      })),
      ...overview.connections
        .filter(
          (connection) =>
            connection.profile.id !== runtime?.profileID &&
            connection.phase === "ready" &&
            overview.includedProfileIDs.includes(connection.profile.id),
        )
        .flatMap((connection) =>
          [
            ...connection.inbox.pinned,
            ...connection.inbox.inbox,
            ...connection.inbox.snoozed,
            ...connection.inbox.settled,
          ].map((item) => ({
            ...item,
            id: JSON.stringify([connection.profile.id, item.session.id]),
            title: `${item.session.title || "Background task"} (${connection.profile.name})`,
          })),
        ),
    ];
    for (const task of tasks) {
      const next = taskAnnouncementState(task);
      const previous = memory.current.states.get(task.id);
      states.set(task.id, next);
      const text = taskAnnouncement(previous, task, task.id === selectedKey);
      if (text) pending.current.set(task.id, text);
      else if (previous !== next) pending.current.delete(task.id);
    }
    for (const id of pending.current.keys()) if (!states.has(id)) pending.current.delete(id);
    memory.current.states = states;
    if (pending.current.size && timer.current === undefined) {
      // Coalesce rapid lifecycle events, not streaming tokens, into one polite update.
      setAnnouncement("");
      timer.current = setTimeout(() => {
        const texts = [...pending.current.values()];
        setAnnouncement(
          texts.length > 3
            ? `${texts.slice(0, 3).join(" ")} ${texts.length - 3} other tasks need attention.`
            : texts.join(" "),
        );
        pending.current.clear();
        timer.current = undefined;
      }, 350);
    }
  }, [
    inbox,
    overview.connections,
    overview.includedProfileIDs,
    runtime?.connectionID,
    runtime?.profileID,
    selectedKey,
  ]);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
      {announcement}
    </div>
  );
}
