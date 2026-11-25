/**
 * Projects Palot's task data, for every connected server, into the list's plain `Task` values.
 * One core serves the focused server (jotai and the workspace's live queries) and every other
 * server (`ConnectionOverview`); callers hand both in as `ServerData`.
 *
 * Identity: a task object is reused while nothing it shows changed, and the arrays are reused
 * while no element changed, so a row re-renders only for its own task. Values that move on
 * every streamed event are coarsened before they reach a task: the stale clock's
 * `lastUpdateAt` advances in steps of `LAST_UPDATE_STEP_MS`, and a running task's live detail
 * is re-read at most every `DETAIL_REFRESH_MS`.
 */

import type {
  ActivityWatermark,
  PalotMessage,
  PalotProject,
  PalotSession,
  SessionRequestSnapshot,
} from "../../../../shared";
import type { SessionExecutionState, SessionRuntimeStatus } from "../../../atoms/workspace";
import {
  inboxOrderingAt,
  rootSessionID,
  sessionFamily,
  type InboxSection,
  type InboxSessionView,
  type SessionInboxSnapshot,
} from "../../session-inbox";
import { providerLimit, providerLimitSummary } from "../../../../shared/provider-limit";
import { taskIsUnread } from "../../task-unread";
import { orderProjects, projectName, sessionActivityAt } from "../../view-models";
import type { TaskListSnapshot } from "../source";
import type { Project, Server, Task, TaskPullRequest, TaskRun } from "../types";
import { projectKey, taskID, type TaskOwnerRef } from "./ids";
import { sameTaskRequest, taskRequests } from "./requests";
import { finishedTurnInsight, runningTurnDetail, turnInsightCache } from "./transcript";

/** The stale clock does not need every streamed event; it moves in steps this long. */
export const LAST_UPDATE_STEP_MS = 60_000;
/** A running task's transcript detail is re-read at most this often. */
export const DETAIL_REFRESH_MS = 500;

export interface ServerData {
  /** The OpenCode profile id; the list's server id. */
  serverID: string;
  name: string;
  /** Null while the server has no runtime; such a server's tasks cannot change. */
  connectionID: string | null;
  online: boolean;
  /** When the server was last heard from. Only shown while it is offline. */
  lastSeenAt: number | null;
  /** The focused server's tasks open in place; others open through their profile. */
  focused: boolean;
  /** Triage (settle, snooze, pin) can be saved for this server now. */
  canTriage: boolean;
  inbox: SessionInboxSnapshot;
  /** Every loaded session, subagents included, with current timestamps. */
  sessions: readonly PalotSession[];
  projects: readonly PalotProject[];
  requests: ReadonlyMap<string, SessionRequestSnapshot>;
  activeIDs: ReadonlySet<string>;
  execution: ReadonlyMap<string, SessionExecutionState>;
  statuses?: ReadonlyMap<string, SessionRuntimeStatus>;
  isMarkedUnread(sessionID: string): boolean;
  /** A task's pull request mark; only local servers have them. */
  pullRequestOf?(sessionID: string): TaskPullRequest | null;
  /** The branch label for a task's checkout, when Palot knows it without a fetch. */
  branchOf?(session: PalotSession): string | null;
  /** Scheduled cadences ("Daily at 9:00 AM") by session id. */
  schedules?: ReadonlyMap<string, string>;
  /**
   * Runs of standalone schedules, grouped under Scheduled. Hidden here unless they need you,
   * as the Inbox hides them today.
   */
  groupedSessionIDs?: ReadonlySet<string>;
  hasOlder: boolean;
  loadingOlder: boolean;
}

/** Transcripts Palot already holds; never fetched for the list. */
export interface TranscriptReader {
  messages(connectionID: string, sessionID: string): PalotMessage[];
}

export interface ProjectionInput {
  servers: readonly ServerData[];
  openTask: TaskOwnerRef | null;
  now: number;
  transcripts?: TranscriptReader;
  /** Whether a task's composer holds an unsent draft; flips, never per keystroke. */
  hasDraft?(task: TaskOwnerRef): boolean;
}

/** What actions need to know about a task that the list does not show. */
export interface TaskMeta {
  id: string;
  serverID: string;
  sessionID: string;
  connectionID: string | null;
  focused: boolean;
  online: boolean;
  canTriage: boolean;
  title: string;
  /** OpenCode's project id, for starting a task in the same project. */
  projectID: string;
  chat: boolean;
  section: InboxSection;
  running: boolean;
  canSettle: boolean;
  needsInput: boolean;
  activityThrough: ActivityWatermark;
  pinnedAt: number | null;
  snoozedUntil: number | null;
  idleAt: number | null;
  serverUnread: boolean;
  /** Which session owns each pending request; a subagent's request is answered there. */
  requestOwners: ReadonlyMap<string, string>;
  /** The root session and its project, for the app's task menu. */
  session: PalotSession;
  project: PalotProject | null;
}

const EMPTY_TASKS: readonly Task[] = [];

/** Why a task failed, in one line: a limit by its name and reset (as the turn row says it), else OpenCode's message. */
function failureSummary(execution: SessionExecutionState | null, now: number): string {
  const error = execution?.error;
  const limit = error ? providerLimit(error, execution.completedAt ?? Number.NaN) : null;
  return limit ? providerLimitSummary(limit, now) : error?.message.trim() || "Failed";
}
const UNKNOWN_PROJECT = "Unknown project";

interface DetailEntry {
  at: number;
  count: number;
  last: PalotMessage | undefined;
  detail: string | null;
}

export class TaskListProjector {
  #tasks = new Map<string, Task>();
  #meta = new Map<string, TaskMeta>();
  #attentionAt = new Map<string, number>();
  #firstSeen = new Map<string, number>();
  #lastUpdate = new Map<string, number>();
  #details = new Map<string, DetailEntry>();
  #insightKeys = new Map<string, string>();
  #fallbackOrder: readonly string[] = [];
  #snapshot: TaskListSnapshot = {
    tasks: EMPTY_TASKS,
    projects: [],
    servers: [],
    openTaskID: null,
    hasOlder: false,
    loadingOlder: false,
  };

  get snapshot(): TaskListSnapshot {
    return this.#snapshot;
  }

  meta(id: string): TaskMeta | undefined {
    return this.#meta.get(id);
  }

  /** Today's Inbox order (inbox, then pinned, focused server first), for "open the next". */
  get fallbackOrder(): readonly string[] {
    return this.#fallbackOrder;
  }

  project(input: ProjectionInput): TaskListSnapshot {
    const tasks: Task[] = [];
    const meta = new Map<string, TaskMeta>();
    const projects: Project[] = [];
    const servers: Server[] = [];
    const fallback: string[] = [];
    const seenRequests = new Set<string>();
    // Only tasks have rows: an open subagent session opens, and selects, the task it belongs to.
    let openTask: TaskOwnerRef | null = null;
    for (const server of input.servers) {
      servers.push({
        id: server.serverID,
        name: server.name,
        online: server.online,
        lastSeenAt: server.online ? null : server.lastSeenAt,
      });
      const roots = server.sessions.filter((session) => !session.parentID);
      for (const project of orderProjects([...server.projects], roots))
        projects.push({
          id: projectKey(server.serverID, project.id),
          name: projectName(project),
          serverID: server.serverID,
        });
      const knownProjects = new Set(projects.map((project) => project.id));
      const byID = new Map(server.sessions.map((session) => [session.id, session]));
      const children = new Map<string, PalotSession[]>();
      for (const session of server.sessions) {
        if (!session.parentID) continue;
        const list = children.get(session.parentID);
        if (list) list.push(session);
        else children.set(session.parentID, [session]);
      }
      if (input.openTask?.serverID === server.serverID)
        openTask = {
          serverID: server.serverID,
          sessionID: rootSessionID(input.openTask.sessionID, server.sessions),
        };
      const views = [
        ...server.inbox.pinned,
        ...server.inbox.inbox,
        ...server.inbox.snoozed,
        ...server.inbox.settled,
      ].toSorted((left, right) => left.session.id.localeCompare(right.session.id));
      const shown = new Set<string>();
      for (const view of views) {
        const projected = this.#projectTask(
          input,
          openTask,
          server,
          view,
          byID,
          children,
          seenRequests,
        );
        if (!projected) continue;
        const { task, info } = projected;
        if (task.projectID !== null && !knownProjects.has(task.projectID)) {
          projects.push({ id: task.projectID, name: UNKNOWN_PROJECT, serverID: server.serverID });
          knownProjects.add(task.projectID);
        }
        tasks.push(task);
        meta.set(task.id, info);
        shown.add(view.session.id);
      }
      for (const view of [...server.inbox.inbox, ...server.inbox.pinned])
        if (shown.has(view.session.id)) fallback.push(taskID(server.serverID, view.session.id));
    }

    for (const id of this.#tasks.keys()) {
      if (meta.has(id)) continue;
      this.#attentionAt.delete(id);
      this.#lastUpdate.delete(id);
      this.#details.delete(id);
      this.#insightKeys.delete(id);
    }
    for (const key of this.#firstSeen.keys())
      if (!seenRequests.has(key)) this.#firstSeen.delete(key);
    this.#tasks = new Map(tasks.map((task) => [task.id, task]));
    this.#meta = meta;
    this.#fallbackOrder = sameStrings(this.#fallbackOrder, fallback)
      ? this.#fallbackOrder
      : fallback;

    const previous = this.#snapshot;
    // A server not in the input leaves the open task as the route names it.
    const open = openTask ?? input.openTask;
    const openTaskID = open ? taskID(open.serverID, open.sessionID) : null;
    const next: TaskListSnapshot = {
      tasks: sameItems(previous.tasks, tasks) ? previous.tasks : tasks,
      projects: sameItems(previous.projects, projects, sameProject) ? previous.projects : projects,
      servers: sameItems(previous.servers, servers, sameServer) ? previous.servers : servers,
      openTaskID,
      hasOlder: input.servers.some((server) => server.online && server.hasOlder),
      loadingOlder: input.servers.some((server) => server.loadingOlder),
    };
    if (
      next.tasks === previous.tasks &&
      next.projects === previous.projects &&
      next.servers === previous.servers &&
      next.openTaskID === previous.openTaskID &&
      next.hasOlder === previous.hasOlder &&
      next.loadingOlder === previous.loadingOlder
    )
      return previous;
    this.#snapshot = next;
    return next;
  }

  #projectTask(
    input: ProjectionInput,
    openTask: TaskOwnerRef | null,
    server: ServerData,
    view: InboxSessionView,
    byID: ReadonlyMap<string, PalotSession>,
    children: ReadonlyMap<string, readonly PalotSession[]>,
    seenRequests: Set<string>,
  ): { task: Task; info: TaskMeta } | null {
    const id = taskID(server.serverID, view.session.id);
    // The Inbox's catalog keeps a running task's session object while it streams; the raw
    // catalog has its current timestamps.
    const root = byID.get(view.session.id) ?? view.session;
    const family = sessionFamily(root, children);
    const owned = taskRequests({
      rootID: root.id,
      family,
      requests: server.requests,
      firstSeen: (key) => {
        const scoped = `${server.serverID}:${key}`;
        seenRequests.add(scoped);
        let at = this.#firstSeen.get(scoped);
        if (at === undefined) {
          at = input.now;
          this.#firstSeen.set(scoped, at);
        }
        return at;
      },
    });
    if (owned.length === 0 && server.groupedSessionIDs?.has(root.id)) return null;

    const chat = view.kind === "chat";
    const open = openTask?.serverID === server.serverID && openTask.sessionID === root.id;
    const execution = server.execution.get(root.id) ?? null;
    const running = view.running;
    const run = running ? this.#run(id, input, server, view, root, family, execution) : null;
    if (!running) {
      this.#lastUpdate.delete(id);
      this.#details.delete(id);
    }
    const settled = view.section === "settled";
    const failure = view.failed && !settled ? failureSummary(execution, input.now) : null;
    const requests = owned.map((entry) => entry.request);
    const insight = running ? null : this.#insight(id, input, server, root, execution);
    const needsYou = requests.length > 0 || failure !== null;
    let attentionAt: number | null = null;
    if (needsYou) {
      attentionAt =
        this.#attentionAt.get(id) ??
        (requests.length > 0
          ? Math.min(...requests.map((request) => request.arrivedAt))
          : (execution?.completedAt ?? root.idleAt ?? input.now));
      this.#attentionAt.set(id, attentionAt);
    } else this.#attentionAt.delete(id);

    const pr = chat ? null : (server.pullRequestOf?.(root.id) ?? null);
    const projectID = chat ? null : projectKey(server.serverID, view.project?.id ?? root.projectID);
    const candidate: Task = {
      id,
      title: root.title?.trim() || "Untitled task",
      projectID,
      serverID: server.serverID,
      branch: chat ? null : (server.branchOf?.(root) ?? null),
      createdAt: root.createdAt,
      activityAt: inboxOrderingAt(view),
      run,
      runEndedAt: running ? null : (root.idleAt ?? null),
      requests,
      requestIndex: 0,
      failure,
      stopped: !running && root.outcome === "interrupted",
      unread: taskIsUnread(root, { marked: server.isMarkedUnread(root.id), selected: open }),
      summary: insight?.summary ?? null,
      pinnedAt: view.pinnedAt,
      snoozedUntil: view.snoozedUntil,
      // Palot keeps no settle time; the Settled shelf's order today is the last activity.
      settledAt: settled ? sessionActivityAt(view.session) : null,
      pr,
      subagents: family.filter(
        (session) => session.id !== root.id && server.activeIDs.has(session.id),
      ).length,
      schedule: server.schedules?.get(root.id) ?? null,
      lastAnswer: insight?.lastAnswer ?? "",
      attentionAt,
      lingerUntil: null,
      draft: input.hasDraft?.({ serverID: server.serverID, sessionID: root.id }) ?? false,
    };
    const previous = this.#tasks.get(id);
    const task = previous && sameTask(previous, candidate) ? previous : candidate;
    return {
      task,
      info: {
        id,
        serverID: server.serverID,
        sessionID: root.id,
        connectionID: server.connectionID,
        focused: server.focused,
        online: server.online,
        canTriage: server.canTriage && server.online,
        title: task.title,
        projectID: root.projectID,
        chat,
        section: view.section,
        running,
        canSettle: view.canSettle,
        needsInput: view.attention,
        activityThrough: view.activityThrough,
        pinnedAt: view.pinnedAt,
        snoozedUntil: view.snoozedUntil,
        idleAt: root.idleAt ?? null,
        serverUnread: taskIsUnread(root),
        requestOwners: new Map(owned.map((entry) => [entry.request.id, entry.ownerSessionID])),
        session: root,
        project: view.project ?? null,
      },
    };
  }

  #run(
    id: string,
    input: ProjectionInput,
    server: ServerData,
    view: InboxSessionView,
    root: PalotSession,
    family: readonly PalotSession[],
    execution: SessionExecutionState | null,
  ): TaskRun {
    const startedAt = view.runningSince ?? root.idleAt ?? root.createdAt;
    // Any running member's write counts as news from the agent.
    const latest = family.reduce(
      (value, session) =>
        server.activeIDs.has(session.id) || session.id === root.id
          ? Math.max(value, session.updatedAt)
          : value,
      startedAt,
    );
    const previous = this.#lastUpdate.get(id);
    const lastUpdateAt =
      previous !== undefined && latest >= previous && latest - previous < LAST_UPDATE_STEP_MS
        ? previous
        : latest;
    this.#lastUpdate.set(id, lastUpdateAt);
    return { startedAt, lastUpdateAt, detail: this.#detail(id, input, server, root, execution) };
  }

  /** "Running 'bun test'" while the transcript is in memory; null (just "Working") otherwise. */
  #detail(
    id: string,
    input: ProjectionInput,
    server: ServerData,
    root: PalotSession,
    execution: SessionExecutionState | null,
  ): string | null {
    if (!input.transcripts || !server.connectionID) return null;
    const previous = this.#details.get(id);
    if (previous && input.now - previous.at < DETAIL_REFRESH_MS) return previous.detail;
    const messages = input.transcripts.messages(server.connectionID, root.id);
    if (previous && previous.count === messages.length && previous.last === messages.at(-1)) {
      previous.at = input.now;
      return previous.detail;
    }
    const detail = runningTurnDetail(
      id,
      messages,
      execution,
      server.statuses?.get(root.id) ?? null,
    );
    this.#details.set(id, { at: input.now, count: messages.length, last: messages.at(-1), detail });
    return detail;
  }

  /**
   * The last turn's summary: from a loaded transcript, or remembered from one seen this
   * session. The answer only while the transcript is in memory.
   */
  #insight(
    id: string,
    input: ProjectionInput,
    server: ServerData,
    root: PalotSession,
    execution: SessionExecutionState | null,
  ) {
    const idleAt = root.idleAt;
    if (idleAt === undefined) return null;
    const messages =
      input.transcripts && server.connectionID
        ? input.transcripts.messages(server.connectionID, root.id)
        : [];
    if (messages.length > 0) {
      const key = `${idleAt}:${messages.length}:${messages.at(-1)!.id}`;
      if (this.#insightKeys.get(id) !== key) {
        this.#insightKeys.set(id, key);
        const insight = finishedTurnInsight(messages, execution, idleAt);
        if (insight) turnInsightCache.set(id, insight);
      }
    }
    const cached = turnInsightCache.get(id);
    if (!cached || cached.idleAt !== idleAt) return null;
    return { summary: cached.summary, lastAnswer: messages.length > 0 ? cached.lastAnswer : "" };
  }
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sameItems<T>(
  left: readonly T[],
  right: readonly T[],
  equal: (left: T, right: T) => boolean = Object.is,
): boolean {
  return left.length === right.length && left.every((value, index) => equal(value, right[index]!));
}

function sameProject(left: Project, right: Project): boolean {
  return left.id === right.id && left.name === right.name && left.serverID === right.serverID;
}

function sameServer(left: Server, right: Server): boolean {
  return (
    left.id === right.id &&
    left.name === right.name &&
    left.online === right.online &&
    left.lastSeenAt === right.lastSeenAt
  );
}

function sameRun(left: TaskRun | null, right: TaskRun | null): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  return (
    left.startedAt === right.startedAt &&
    left.lastUpdateAt === right.lastUpdateAt &&
    left.detail === right.detail
  );
}

/** Every field the list reads; a task that compares equal keeps its object. */
export function sameTask(left: Task, right: Task): boolean {
  return (
    left.id === right.id &&
    left.title === right.title &&
    left.projectID === right.projectID &&
    left.serverID === right.serverID &&
    left.branch === right.branch &&
    left.createdAt === right.createdAt &&
    left.activityAt === right.activityAt &&
    sameRun(left.run, right.run) &&
    left.runEndedAt === right.runEndedAt &&
    sameItems(left.requests, right.requests, sameTaskRequest) &&
    left.requestIndex === right.requestIndex &&
    left.failure === right.failure &&
    left.stopped === right.stopped &&
    left.unread === right.unread &&
    (left.summary === right.summary ||
      (left.summary !== null &&
        right.summary !== null &&
        left.summary.durationMs === right.summary.durationMs &&
        left.summary.filesChanged === right.summary.filesChanged &&
        left.summary.commands === right.summary.commands)) &&
    left.pinnedAt === right.pinnedAt &&
    left.snoozedUntil === right.snoozedUntil &&
    left.settledAt === right.settledAt &&
    (left.pr === right.pr ||
      (left.pr !== null &&
        right.pr !== null &&
        left.pr.number === right.pr.number &&
        left.pr.state === right.pr.state &&
        left.pr.checks === right.pr.checks &&
        left.pr.readiness?.text === right.pr.readiness?.text)) &&
    left.subagents === right.subagents &&
    left.schedule === right.schedule &&
    left.lastAnswer === right.lastAnswer &&
    left.attentionAt === right.attentionAt &&
    left.lingerUntil === right.lingerUntil &&
    Boolean(left.draft) === Boolean(right.draft)
  );
}
