/**
 * The task list's data: every task on every enabled server as plain `Task` values, kept live,
 * with actions that work for a task on any server. The focused server comes from the
 * workspace's live queries (as today's Inbox); every other server from the connection
 * overview (as today's multi-connection sidebar).
 *
 * Mount it once, in a thin component: it subscribes to the whole catalog, so its host
 * re-renders as tasks stream. Rows do not; they read the source through `subscribe`.
 *
 * The side effects today's sidebars rely on keep running where they are: the snooze clock,
 * auto-wake on attention and settle on PR merge in `useInboxController`, the inactivity
 * sweep in `useAutoSettle`, the overview's own clock in `useConnectionOverviewController`.
 */

import { useQueryClient } from "@tanstack/react-query";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useAtomValue, useStore } from "jotai";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { AutomationSnapshot, PalotSession } from "../../shared";
import type { PullRequestLink } from "../../shared/source-control-contract";
import { automationSnapshotsAtom } from "../atoms/automations";
import { composerDraftPresenceAtom, hasComposerDraft } from "../atoms/composer-draft-presence";
import {
  sessionTriageErrorAtom,
  sessionTriageLoadingAtom,
  sessionTriageSnapshotAtom,
} from "../atoms/inbox";
import { phaseAtom, runtimeAtom, workspaceRecoveryAtom } from "../atoms/workspace";
import {
  primaryPullRequestLink,
  snapshotReadiness,
} from "../components/pull-requests/pull-request-presentation";
import { readinessText } from "../../shared/pull-request-readiness";
import { useOwnedPullRequestLinks } from "../components/pull-requests/use-owned-pull-request-links";
import { automationScheduleLabel } from "../lib/automation-view";
import { isChatSession } from "../lib/chats";
import { composerScope } from "../lib/composer-scope";
import { openCodeReconciler } from "../lib/open-code-reconciler";
import { markSessionViewed, patchSession, removeSession } from "../lib/session-catalog-query";
import type { TaskListAppDeps, TaskListDataSource } from "../lib/task-list/source/data-source";
import { createTaskListDataSource } from "../lib/task-list/source/data-source";
import { taskID } from "../lib/task-list/source/ids";
import type {
  ProjectionInput,
  ServerData,
  TranscriptReader,
} from "../lib/task-list/source/project";
import { DETAIL_REFRESH_MS } from "../lib/task-list/source/project";
import { useStoreSelector } from "../lib/task-list/store";
import type { TaskPullRequest } from "../lib/task-list/types";
import { hasUnreadMark, unreadMarkKey } from "../lib/task-unread";
import { showErrorToast } from "../lib/toast-error";
import { viewSession } from "../services/opencode-catalog";
import { palot } from "../services/palot";
import { useTriageDispatcher } from "./use-auto-settle";
import { useConnectionOverview, type ConnectionOverview } from "./use-connection-overview";
import { inboxBranchOwnerKey, useInboxBranches, type InboxBranchOwner } from "./use-inbox-branches";
import { usePalotNavigation } from "./use-navigation";
import {
  useProjectCatalog,
  useRootSessionPagination,
  useSessionCatalog,
} from "./use-session-catalog";
import { useSessionActivity } from "./use-session-activity";
import { useSessionInbox } from "./use-session-inbox";
import { useSessionRequestMap } from "./use-session-requests";
import { unreadMarksAtom, useSetUnreadMark } from "./use-task-unread";

const EMPTY_LINKS = new Map<string, TaskPullRequest>();

/** Schedule marks and the standalone runs the Inbox groups under Scheduled, by session. */
function automationIndex(snapshot: AutomationSnapshot | undefined) {
  const schedules = new Map<string, string>();
  const grouped = new Set<string>();
  if (!snapshot) return { schedules, grouped };
  const byID = new Map(snapshot.automations.map((automation) => [automation.id, automation]));
  for (const automation of snapshot.automations)
    if (automation.destination.type === "session")
      schedules.set(automation.destination.sessionID, automationScheduleLabel(automation.trigger));
  for (const run of snapshot.runs) {
    const automation = byID.get(run.automationID);
    if (!run.rootSessionID || !automation) continue;
    if (!schedules.has(run.rootSessionID))
      schedules.set(run.rootSessionID, automationScheduleLabel(automation.trigger));
    if (automation.destination.type === "standalone" && run.state !== "needs-attention")
      grouped.add(run.rootSessionID);
  }
  return { schedules, grouped };
}

function pullRequestMarks(
  links: ReadonlyMap<string, PullRequestLink[]> | undefined,
): ReadonlyMap<string, TaskPullRequest> {
  if (!links?.size) return EMPTY_LINKS;
  const marks = new Map<string, TaskPullRequest>();
  for (const [sessionID, sessionLinks] of links) {
    const primary = primaryPullRequestLink(sessionLinks);
    if (!primary) continue;
    const readiness = snapshotReadiness(primary.pullRequest);
    marks.set(sessionID, {
      number: primary.pullRequest.number,
      state: primary.pullRequest.state,
      checks: primary.pullRequest.checks,
      // Rows say what they know; an unreadable verdict adds nothing to the mark.
      readiness:
        readiness && readiness.status !== "unknown"
          ? { ready: readiness.status === "ready", text: readinessText(readiness) }
          : null,
    });
  }
  return marks;
}

function branchOwners(
  connectionID: string | null,
  online: boolean,
  views: SessionInboxViews,
): InboxBranchOwner[] {
  if (!connectionID || !online) return [];
  // Settled tasks stay quiet, as today: no branch reads for the archive.
  return [...views.pinned, ...views.inbox, ...views.snoozed].flatMap((item) =>
    item.kind === "chat" ? [] : [{ connectionID, location: item.session.location }],
  );
}

type SessionInboxViews = ReturnType<typeof useSessionInbox>;

/** Requests and activity of a server the overview owns, read once per overview update. */
function overviewServerData(
  entry: ConnectionOverview,
  reconciler: ReturnType<typeof openCodeReconciler>,
) {
  const connectionID = entry.runtime?.connectionID ?? null;
  const activity = connectionID ? reconciler.activity(connectionID) : null;
  return {
    connectionID,
    requests: connectionID ? reconciler.requestMap(connectionID) : new Map<string, never>(),
    activeIDs: activity?.activeIDs ?? new Set<string>(),
    execution: activity?.execution ?? new Map(),
    statuses: activity?.statuses ?? new Map(),
  };
}

export function useTaskListSource(): TaskListDataSource {
  const queryClient = useQueryClient();
  const store = useStore();
  const navigate = useNavigate();
  const navigation = usePalotNavigation();
  const dispatch = useTriageDispatcher();
  const setUnreadMark = useSetUnreadMark();
  const reconciler = openCodeReconciler(queryClient);

  // The focused server, from the workspace's live queries.
  const runtime = useAtomValue(runtimeAtom);
  const phase = useAtomValue(phaseAtom);
  const focusedID = runtime?.profileID ?? null;
  const focusedConnectionID = runtime?.connectionID ?? null;
  const focusedInbox = useSessionInbox();
  const focusedActivity = useSessionActivity().data;
  const focusedSessions = useSessionCatalog();
  const focusedSessionIDs = useMemo(
    () => focusedSessions.map((session) => session.id),
    [focusedSessions],
  );
  const focusedRequests = useSessionRequestMap(focusedSessionIDs);
  const focusedProjects = useProjectCatalog();
  const triage = useAtomValue(sessionTriageSnapshotAtom);
  const triageLoading = useAtomValue(sessionTriageLoadingAtom);
  const triageError = useAtomValue(sessionTriageErrorAtom);
  const pagination = useRootSessionPagination();

  // Every other enabled server, from the connection overview.
  const overview = useConnectionOverview();
  const included = overview.includedProfileIDs;
  const others = useMemo(
    () =>
      overview.connections.filter(
        (entry) => included.includes(entry.profile.id) && entry.profile.id !== focusedID,
      ),
    [focusedID, included, overview.connections],
  );
  const focusedEntry = overview.connections.find((entry) => entry.profile.id === focusedID);
  // Without a registry (preview, or before it loads) the focused server is all there is.
  const focusedShown =
    focusedID !== null && (overview.connections.length === 0 || included.includes(focusedID));

  const marks = useAtomValue(unreadMarksAtom);
  // Changes only when a draft goes from empty to unsent or back, never per keystroke.
  const drafts = useAtomValue(composerDraftPresenceAtom);
  const automations = useAtomValue(automationSnapshotsAtom);
  const selectedSessionID = useRouterState({
    select: (state) =>
      state.matches
        .map((match) => (match.params as { sessionID?: string }).sessionID)
        .find(Boolean) ?? null,
  });

  // Source control is local-only; the focused profile is asked as today's Inbox asks it.
  const pullRequestProfiles = useMemo(
    () => [
      ...(focusedShown && focusedID ? [focusedID] : []),
      ...others.filter((entry) => entry.profile.kind === "local").map((entry) => entry.profile.id),
    ],
    [focusedID, focusedShown, others],
  );
  const linksByProfile = useOwnedPullRequestLinks(pullRequestProfiles);
  const prMarks = useMemo(
    () =>
      new Map(
        pullRequestProfiles.map((profileID) => [
          profileID,
          pullRequestMarks(
            linksByProfile.get(profileID) as ReadonlyMap<string, PullRequestLink[]> | undefined,
          ),
        ]),
      ),
    [linksByProfile, pullRequestProfiles],
  );

  const focusedOnline = Boolean(runtime?.connected) && phase === "ready";
  const owners = useMemo(
    () => [
      ...(focusedShown ? branchOwners(focusedConnectionID, focusedOnline, focusedInbox) : []),
      ...others.flatMap((entry) =>
        branchOwners(
          entry.runtime?.connectionID ?? null,
          entry.runtime?.connected === true && entry.phase === "ready",
          entry.inbox,
        ),
      ),
    ],
    [focusedConnectionID, focusedInbox, focusedOnline, focusedShown, others],
  );
  const branches = useInboxBranches(owners);

  const otherData = useMemo(
    () => new Map(others.map((entry) => [entry.profile.id, overviewServerData(entry, reconciler)])),
    // The overview re-projects on every request and activity event, so its entries are the
    // signal to re-read requests and activity.
    [others, reconciler],
  );

  const servers = useMemo((): ServerData[] => {
    const isMarked = (profileID: string) => (sessionID: string) =>
      hasUnreadMark(marks, unreadMarkKey(profileID, sessionID));
    const branchOf = (connectionID: string | null) => (session: PalotSession) => {
      if (!connectionID || isChatSession(session)) return null;
      return (
        branches.get(inboxBranchOwnerKey({ connectionID, location: session.location }))?.vcs
          .currentBranch ?? null
      );
    };
    const prOf = (profileID: string) => {
      const map = prMarks.get(profileID) ?? EMPTY_LINKS;
      return (sessionID: string) => map.get(sessionID) ?? null;
    };
    const focused: ServerData | null =
      focusedShown && focusedID
        ? (() => {
            const index = automationIndex(automations[focusedID]);
            return {
              serverID: focusedID,
              name: focusedEntry?.profile.name ?? "OpenCode",
              connectionID: focusedConnectionID,
              online: focusedOnline,
              lastSeenAt: focusedEntry?.lastSyncedAt ?? runtime?.lastConnectedAt ?? null,
              focused: true,
              canTriage: triage?.profileID === focusedID && !triageLoading && triageError === null,
              inbox: focusedInbox,
              sessions: focusedSessions,
              projects: focusedProjects,
              requests: focusedRequests,
              activeIDs: focusedActivity.activeIDs,
              execution: focusedActivity.execution,
              statuses: focusedActivity.statuses,
              isMarkedUnread: isMarked(focusedID),
              pullRequestOf: prOf(focusedID),
              branchOf: branchOf(focusedConnectionID),
              schedules: index.schedules,
              groupedSessionIDs: index.grouped,
              hasOlder: Boolean(pagination.hasNextPage),
              loadingOlder: pagination.isFetchingNextPage,
            };
          })()
        : null;
    const rest = others.map((entry): ServerData => {
      const data = otherData.get(entry.profile.id)!;
      const index = automationIndex(automations[entry.profile.id]);
      const online = entry.runtime?.connected === true && entry.phase === "ready";
      return {
        serverID: entry.profile.id,
        name: entry.profile.name,
        connectionID: data.connectionID,
        online,
        lastSeenAt: entry.lastSyncedAt ?? entry.runtime?.lastConnectedAt ?? null,
        focused: false,
        canTriage: entry.triageReady,
        inbox: entry.inbox,
        sessions: entry.sessions,
        projects: entry.projects,
        requests: data.requests,
        activeIDs: data.activeIDs,
        execution: data.execution,
        statuses: data.statuses,
        isMarkedUnread: isMarked(entry.profile.id),
        pullRequestOf: prOf(entry.profile.id),
        branchOf: branchOf(data.connectionID),
        schedules: index.schedules,
        groupedSessionIDs: index.grouped,
        hasOlder: entry.hasMore,
        loadingOlder: entry.loadingMore,
      };
    });
    if (!focused) return rest;
    // Keep the registry's order, so changing focus never reorders servers.
    const at = overview.connections.findIndex((entry) => entry.profile.id === focusedID);
    const ordered = [...rest];
    const before = overview.connections
      .slice(0, Math.max(0, at))
      .filter((entry) => rest.some((server) => server.serverID === entry.profile.id)).length;
    ordered.splice(at === -1 ? 0 : before, 0, focused);
    return ordered;
  }, [
    automations,
    branches,
    focusedActivity,
    focusedConnectionID,
    focusedEntry?.lastSyncedAt,
    focusedEntry?.profile.name,
    focusedID,
    focusedInbox,
    focusedOnline,
    focusedProjects,
    focusedRequests,
    focusedSessions,
    focusedShown,
    marks,
    otherData,
    others,
    overview.connections,
    pagination.hasNextPage,
    pagination.isFetchingNextPage,
    prMarks,
    runtime?.lastConnectedAt,
    triage?.profileID,
    triageError,
    triageLoading,
  ]);

  const transcripts = useMemo<TranscriptReader>(
    () => ({ messages: (connectionID, sessionID) => reconciler.messages(connectionID, sessionID) }),
    [reconciler],
  );
  const input = useMemo(
    (): Omit<ProjectionInput, "now"> => ({
      servers,
      openTask:
        focusedID && selectedSessionID
          ? { serverID: focusedID, sessionID: selectedSessionID }
          : null,
      transcripts,
      hasDraft: (task) =>
        hasComposerDraft(drafts, composerScope(task.serverID, `session:${task.sessionID}`)),
    }),
    [drafts, focusedID, selectedSessionID, servers, transcripts],
  );

  const appDeps: TaskListAppDeps = {
    now: Date.now,
    dispatch,
    openSession: (meta) => navigation.openSession(meta.sessionID, { profileID: meta.serverID }),
    openWindow: (meta, options) =>
      palot.openSessionWindow(meta.sessionID, meta.connectionID ?? undefined, options),
    reportError: showErrorToast,
    setUnreadMark,
    markViewed: async (meta, idleAt) => {
      if (!meta.connectionID) return;
      await viewSession(meta.sessionID, idleAt, undefined, meta.connectionID);
      markSessionViewed(queryClient, meta.connectionID, meta.sessionID, idleAt);
    },
    interrupt: (meta) => palot.interrupt(meta.sessionID, meta.connectionID),
    replyPermission: (request) => palot.replyPermission(request),
    replyQuestion: (request) => palot.replyQuestion(request),
    rename: async (meta, title) => {
      const previous = meta.title;
      const patch = (value: string) =>
        patchSession(queryClient, meta.connectionID, meta.sessionID, (item) => ({
          ...item,
          title: value,
        }));
      patch(title);
      try {
        const entry = overview.connections.find((item) => item.profile.id === meta.serverID);
        if (entry?.runtime?.connected) await overview.rename(meta.serverID, meta.sessionID, title);
        else await palot.renameSession(meta.sessionID, title);
      } catch (error) {
        patch(previous);
        throw error;
      }
    },
    loadOlder: () => {
      if (focusedShown && pagination.hasNextPage)
        void pagination
          .loadMore()
          .catch((error: unknown) => showErrorToast("Could not load older tasks", error));
      for (const entry of others)
        if (entry.hasMore && entry.runtime?.connected)
          void overview
            .loadMore(entry.profile.id)
            .catch((error: unknown) =>
              showErrorToast(`Could not load older tasks on ${entry.profile.name}`, error),
            );
    },
    startTask: (target) => {
      if (target === undefined) void navigation.openNewTask();
      else if (target) void navigation.openNewTask(target.projectID, target.serverID);
      else void navigate({ to: "/new", search: { chat: true } });
    },
    reconnect: (serverID) => {
      const run = (entry: ConnectionOverview) =>
        entry.runtime?.connected
          ? overview.refresh(entry.profile.id)
          : overview.connect(entry.profile.id);
      const report = (error: unknown) => showErrorToast("Could not reconnect", error);
      if (serverID) {
        const entry = overview.connections.find((item) => item.profile.id === serverID);
        if (entry) void run(entry)?.catch(report);
        else if (serverID === focusedID) void store.get(workspaceRecoveryAtom)?.run().catch(report);
        return;
      }
      void overview.refresh().catch(report);
    },
  };

  const [source] = useState(() => createTaskListDataSource(appDeps));
  const latest = useRef(input);
  useLayoutEffect(() => {
    source.setDeps(appDeps);
  });
  useLayoutEffect(() => {
    latest.current = input;
    source.update({ ...input, now: Date.now() });
  }, [input, source]);

  // A loaded transcript streams without touching the catalog; re-read running tasks' live
  // detail on a trailing timer, at most as often as the projector would take it.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = reconciler.subscribe(() => {
      if (timer || !source.getSnapshot().tasks.some((task) => task.run)) return;
      timer = setTimeout(() => {
        timer = null;
        source.update({ ...latest.current, now: Date.now() });
      }, DETAIL_REFRESH_MS);
    });
    return () => {
      unsubscribe();
      if (timer) clearTimeout(timer);
    };
  }, [reconciler, source]);

  return source;
}

/**
 * The delete confirmation `requestDelete` asks for. The app renders the dialog from
 * `pending`; `confirm` deletes the task on its own server, as the task menu does today.
 */
export function useTaskDeleteRequest(source: TaskListDataSource) {
  const queryClient = useQueryClient();
  const store = useStore();
  const navigation = usePalotNavigation();
  const setUnreadMark = useSetUnreadMark();
  const pending = useStoreSelector(source.deleteRequest, (state) => state.pending);
  const [deleting, setDeleting] = useState(false);
  const cancel = useCallback(() => {
    if (!deleting) source.deleteRequest.set({ pending: null });
  }, [deleting, source]);
  const confirm = useCallback(async () => {
    const request = source.deleteRequest.get().pending;
    if (!request || deleting) return;
    const meta = source.meta(request.taskID);
    if (!meta?.connectionID || !meta.online) {
      showErrorToast("Could not delete task", new Error("This connection is offline."));
      return;
    }
    setDeleting(true);
    try {
      await palot.removeSession(meta.sessionID, meta.connectionID);
      removeSession(queryClient, meta.connectionID, meta.sessionID);
      setUnreadMark(meta.serverID, meta.sessionID, false);
      source.deleteRequest.set({ pending: null });
      const runtime = store.get(runtimeAtom);
      if (
        source.getSnapshot().openTaskID === taskID(meta.serverID, meta.sessionID) &&
        runtime?.connectionID === meta.connectionID
      )
        await navigation.openNewTask(meta.projectID, meta.serverID);
    } catch (error) {
      showErrorToast("Could not delete task", error);
    } finally {
      setDeleting(false);
    }
  }, [deleting, navigation, queryClient, setUnreadMark, source, store]);
  return { pending, deleting, confirm, cancel };
}
