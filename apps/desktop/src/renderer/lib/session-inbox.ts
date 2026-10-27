import type {
  ActivityWatermark,
  PalotProject,
  PalotSession,
  SessionRequestSnapshot,
  SessionTriageSnapshot,
} from "../../shared";
import { isChatSession } from "./chats";
import {
  actionableRequestViews,
  projectForSession,
  projectName,
  sessionActivityAt,
} from "./view-models";

export type InboxSection = "pinned" | "inbox" | "snoozed" | "settled";
export type InboxOrdering = "newest" | "oldest" | "attention";
export const CHATS_PROJECT_FILTER = "@chats";

export interface InboxSessionView {
  session: PalotSession;
  kind: "task" | "chat";
  project: PalotProject | null;
  projectName: string;
  section: InboxSection;
  attention: boolean;
  attentionCount: number;
  running: boolean;
  runningSince: number | null;
  failed: boolean;
  canSettle: boolean;
  pinnedAt: number | null;
  snoozedUntil: number | null;
  /** When a person last moved the task to Inbox (unsettle, undo, pin), if it stayed there. */
  keptInInboxAt: number | null;
  activityThrough: ActivityWatermark;
}

export function sameInboxSessionView(left: InboxSessionView, right: InboxSessionView): boolean {
  return (
    left.session === right.session &&
    left.kind === right.kind &&
    left.project === right.project &&
    left.projectName === right.projectName &&
    left.section === right.section &&
    left.attention === right.attention &&
    left.attentionCount === right.attentionCount &&
    left.running === right.running &&
    left.runningSince === right.runningSince &&
    left.failed === right.failed &&
    left.canSettle === right.canSettle &&
    left.pinnedAt === right.pinnedAt &&
    left.snoozedUntil === right.snoozedUntil &&
    left.keptInInboxAt === right.keptInInboxAt &&
    left.activityThrough.updatedAt === right.activityThrough.updatedAt &&
    left.activityThrough.sessionID === right.activityThrough.sessionID
  );
}

export function inboxMatchesProject(item: InboxSessionView, projectID: string | null): boolean {
  if (projectID === null) return true;
  if (projectID === CHATS_PROJECT_FILTER) return item.kind === "chat";
  return item.kind !== "chat" && item.project?.id === projectID;
}

export type InboxSessionState = "attention" | "failed" | "running" | "unread" | null;

export function inboxSessionState(
  item: Pick<InboxSessionView, "attention" | "failed" | "running">,
  unread: boolean,
): InboxSessionState {
  if (item.attention) return "attention";
  if (item.running) return "running";
  if (item.failed) return "failed";
  return unread ? "unread" : null;
}

export interface SessionInboxSnapshot {
  pinned: InboxSessionView[];
  inbox: InboxSessionView[];
  snoozed: InboxSessionView[];
  settled: InboxSessionView[];
  nextSnoozeDeadline: number | null;
}

export interface InboxOrderingPreferences {
  ordering: InboxOrdering;
  unreadFirst: boolean;
}

/**
 * The time of a task's last meaningful event, used as the inbox sort key.
 *
 * A running task keys on when its run started, so streamed output and
 * sub-agent activity never reorder it. An idle task keys on when its root
 * session's last turn finished. The key therefore changes once when a run
 * starts and once when it finishes.
 */
export function inboxOrderingAt(
  item: Pick<InboxSessionView, "running" | "runningSince" | "session">,
): number {
  if (item.running) return item.runningSince ?? item.session.idleAt ?? item.session.createdAt;
  return sessionActivityAt(item.session);
}

/**
 * Orders Inbox and Settled tasks by the view preference. "Needs input first"
 * puts tasks needing input, then failed tasks, ahead of the newest-first key.
 */
export function orderInboxSessions<T extends InboxSessionView>(
  items: readonly T[],
  preferences: InboxOrderingPreferences,
): T[] {
  return items.toSorted((left, right) => {
    if (preferences.unreadFirst) {
      const unread = Number(catalogViewIsUnread(right)) - Number(catalogViewIsUnread(left));
      if (unread !== 0) return unread;
    }
    if (preferences.ordering === "attention") {
      const attention =
        Number(right.attention) - Number(left.attention) ||
        Number(right.failed) - Number(left.failed);
      if (attention !== 0) return attention;
    }
    const activity =
      preferences.ordering === "oldest"
        ? inboxOrderingAt(left) - inboxOrderingAt(right)
        : inboxOrderingAt(right) - inboxOrderingAt(left);
    return activity || left.session.id.localeCompare(right.session.id);
  });
}

/**
 * Orders one inbox section. Pinned keeps the most recently pinned first and
 * Snoozed keeps the next wake first, whatever the view ordering.
 */
export function orderInboxSection<T extends InboxSessionView>(
  section: InboxSection,
  items: readonly T[],
  preferences: InboxOrderingPreferences,
): T[] {
  if (section === "pinned") return items.toSorted(comparePinned);
  if (section === "snoozed") return items.toSorted(compareSnoozed);
  return orderInboxSessions(items, preferences);
}

/** Splits an ordered task list into its sections, preserving the order. */
export function groupInboxSections<T extends InboxSessionView>(
  items: readonly T[],
): Record<InboxSection, T[]> {
  const result: Record<InboxSection, T[]> = { pinned: [], inbox: [], snoozed: [], settled: [] };
  for (const item of items) result[item.section].push(item);
  return result;
}

function comparePinned(left: InboxSessionView, right: InboxSessionView): number {
  return (
    (right.pinnedAt ?? 0) - (left.pinnedAt ?? 0) || left.session.id.localeCompare(right.session.id)
  );
}

function compareSnoozed(left: InboxSessionView, right: InboxSessionView): number {
  return (
    (left.snoozedUntil ?? 0) - (right.snoozedUntil ?? 0) ||
    left.session.id.localeCompare(right.session.id)
  );
}

function catalogViewIsUnread(item: InboxSessionView): boolean {
  const idleAt = item.session.idleAt;
  return (
    idleAt !== undefined && (item.session.viewedAt === undefined || item.session.viewedAt < idleAt)
  );
}

export function projectSessionInbox(input: {
  sessions: PalotSession[];
  projects: PalotProject[];
  requests: Map<string, SessionRequestSnapshot>;
  activeIDs: ReadonlySet<string>;
  runningSinceBySession: ReadonlyMap<string, number | null>;
  triage: SessionTriageSnapshot | null;
  now: number;
}): SessionInboxSnapshot {
  const result: SessionInboxSnapshot = {
    pinned: [],
    inbox: [],
    snoozed: [],
    settled: [],
    nextSnoozeDeadline: null,
  };
  const records = new Map(input.triage?.sessions.map((record) => [record.sessionID, record]));
  const children = new Map<string, PalotSession[]>();
  for (const session of input.sessions) {
    if (!session.parentID) continue;
    const current = children.get(session.parentID);
    if (current) current.push(session);
    else children.set(session.parentID, [session]);
  }

  for (const session of input.sessions) {
    if (session.parentID || session.archivedAt) continue;
    const family = sessionFamily(session, children);
    const blockers = family.flatMap((candidate) =>
      actionableRequestViews(
        input.requests.get(candidate.id) ?? {
          permissions: [],
          forms: [],
          inbox: [],
          errors: [],
        },
      ),
    );
    const activityThrough = latestSessionWatermark(family);
    const runningSessions = family.filter((candidate) => input.activeIDs.has(candidate.id));
    const running = runningSessions.length > 0;
    const runningSince = runningSessions.reduce<number | null>((earliest, candidate) => {
      const startedAt = input.runningSinceBySession.get(candidate.id);
      return startedAt === null || startedAt === undefined
        ? earliest
        : earliest === null
          ? startedAt
          : Math.min(earliest, startedAt);
    }, null);
    const failed = !running && session.outcome === "failed";
    const attention = blockers.length > 0;
    const record = records.get(session.id);
    const chat = isChatSession(session);
    const project = chat ? null : (projectForSession(input.projects, session) ?? null);
    const section = effectiveSection({
      session,
      activityThrough,
      bootstrapThrough: input.triage?.bootstrapThrough ?? null,
      disposition: record?.disposition ?? null,
      settledThrough: record?.settledThrough ?? null,
      pinnedAt: record?.pinnedAt ?? null,
      snoozedUntil: record?.snoozedUntil ?? null,
      attention,
      running,
      failed,
      now: input.now,
    });
    const view: InboxSessionView = {
      session,
      kind: chat ? "chat" : "task",
      project,
      projectName: chat ? "Chat" : project ? projectName(project) : "Unknown project",
      section,
      attention,
      attentionCount: blockers.length,
      running,
      runningSince,
      failed,
      canSettle: !running && !attention,
      pinnedAt: record?.pinnedAt ?? null,
      snoozedUntil: record?.snoozedUntil ?? null,
      keptInInboxAt: record?.disposition === "inbox" ? record.updatedAt : null,
      activityThrough,
    };
    result[section].push(view);
    if (
      section === "snoozed" &&
      view.snoozedUntil !== null &&
      (result.nextSnoozeDeadline === null || view.snoozedUntil < result.nextSnoozeDeadline)
    ) {
      result.nextSnoozeDeadline = view.snoozedUntil;
    }
  }

  result.pinned.sort(comparePinned);
  result.inbox.sort((left, right) => {
    const priority = inboxPriority(left) - inboxPriority(right);
    if (priority !== 0) return priority;
    if (left.running && right.running) {
      return (
        (left.runningSince ?? Number.POSITIVE_INFINITY) -
          (right.runningSince ?? Number.POSITIVE_INFINITY) ||
        left.session.id.localeCompare(right.session.id)
      );
    }
    return (
      sessionActivityAt(right.session) - sessionActivityAt(left.session) ||
      left.session.id.localeCompare(right.session.id)
    );
  });
  result.snoozed.sort(compareSnoozed);
  result.settled.sort(
    (left, right) =>
      sessionActivityAt(right.session) - sessionActivityAt(left.session) ||
      left.session.id.localeCompare(right.session.id),
  );
  return result;
}

const DAY_MS = 24 * 60 * 60 * 1_000;

/**
 * When a task was last active: its newest family activity, or a snooze wake that has
 * passed, which restarts the idle clock.
 */
export function inboxIdleSince(
  item: Pick<InboxSessionView, "session" | "activityThrough" | "snoozedUntil">,
  now: number,
): number {
  const activity = Math.max(sessionActivityAt(item.session), item.activityThrough.updatedAt);
  const woke = item.snoozedUntil !== null && item.snoozedUntil <= now ? item.snoozedUntil : 0;
  return Math.max(activity, woke);
}

/** Inbox tasks that can settle now and have been idle for at least `idleForMs`. */
export function idleInboxTasks<T extends InboxSessionView>(
  items: readonly T[],
  now: number,
  idleForMs: number,
): T[] {
  return items.filter(
    (item) =>
      item.section === "inbox" && item.canSettle && now - inboxIdleSince(item, now) >= idleForMs,
  );
}

/**
 * Inbox tasks the inactivity sweep settles. Beyond the idle check, failed tasks stay for a
 * look, and a task a person moved back to Inbox stays until it has new activity.
 */
export function autoSettleCandidates<T extends InboxSessionView>(
  items: readonly T[],
  now: number,
  afterDays: number,
): T[] {
  return idleInboxTasks(items, now, afterDays * DAY_MS).filter(
    (item) =>
      !item.failed &&
      (item.keptInInboxAt === null || item.keptInInboxAt < inboxIdleSince(item, now)),
  );
}

function inboxPriority(item: InboxSessionView): number {
  if (item.attention) return 0;
  if (item.failed) return 1;
  if (item.running) return 2;
  return 3;
}

function effectiveSection(input: {
  session: PalotSession;
  activityThrough: ActivityWatermark;
  bootstrapThrough: ActivityWatermark | null;
  disposition: "inbox" | "settled" | null;
  settledThrough: ActivityWatermark | null;
  pinnedAt: number | null;
  snoozedUntil: number | null;
  attention: boolean;
  running: boolean;
  failed: boolean;
  now: number;
}): InboxSection {
  if (input.attention && input.pinnedAt !== null) return "pinned";
  if (!input.attention && input.snoozedUntil !== null && input.snoozedUntil > input.now) {
    return "snoozed";
  }
  if (input.pinnedAt !== null) return "pinned";
  if (input.attention || input.running) return "inbox";
  if (input.disposition === "inbox") return "inbox";
  if (
    input.disposition === "settled" &&
    input.settledThrough !== null &&
    watermarkCovers(input.settledThrough, input.activityThrough)
  ) {
    return "settled";
  }
  if (input.failed) return "inbox";
  if (
    input.disposition === null &&
    input.bootstrapThrough !== null &&
    watermarkCovers(input.bootstrapThrough, input.activityThrough)
  ) {
    return "settled";
  }
  return "inbox";
}

/**
 * A task's last real activity. OpenCode also bumps `updatedAt` for permission, title and
 * metadata writes, such as its browser plugin's attach and detach when Palot starts or quits,
 * so cap it at the latest turn end (or creation). A turn's last write lands a few milliseconds
 * before its idle stamp, so the cap keeps marks saved under the plain `updatedAt` rule valid.
 * A new prompt moves a task back to the Inbox through its inbox event.
 */
export function sessionWatermark(
  session: Pick<PalotSession, "id" | "createdAt" | "updatedAt" | "idleAt">,
): ActivityWatermark {
  return { updatedAt: sessionTriageActivity(session), sessionID: session.id };
}

export function sessionTriageActivity(
  session: Pick<PalotSession, "createdAt" | "updatedAt" | "idleAt">,
): number {
  return Math.min(session.updatedAt, Math.max(session.idleAt ?? 0, session.createdAt));
}

export function latestSessionWatermark(
  sessions: Array<Pick<PalotSession, "id" | "createdAt" | "updatedAt" | "idleAt">>,
): ActivityWatermark {
  return sessions.reduce<ActivityWatermark>(
    (latest, session) => {
      const candidate = sessionWatermark(session);
      return watermarkCovers(latest, candidate) ? latest : candidate;
    },
    { updatedAt: 0, sessionID: "" },
  );
}

export function rootSessionID(sessionID: string, sessions: PalotSession[]): string {
  const byID = new Map(sessions.map((session) => [session.id, session]));
  let current = byID.get(sessionID);
  const seen = new Set([sessionID]);
  while (current?.parentID && !seen.has(current.parentID)) {
    const parent = byID.get(current.parentID);
    if (!parent) break;
    seen.add(parent.id);
    current = parent;
  }
  return current?.id ?? sessionID;
}

/**
 * The latest activity across a root task and every descendant loaded in `sessions`, or
 * null when the root is not loaded.
 */
export function sessionFamilyWatermark(
  sessions: readonly PalotSession[],
  rootID: string,
): ActivityWatermark | null {
  const root = sessions.find((session) => session.id === rootID);
  if (!root) return null;
  const children = new Map<string, PalotSession[]>();
  for (const session of sessions) {
    if (!session.parentID) continue;
    const current = children.get(session.parentID);
    if (current) current.push(session);
    else children.set(session.parentID, [session]);
  }
  return latestSessionWatermark(sessionFamily(root, children));
}

export function watermarkCovers(through: ActivityWatermark, activity: ActivityWatermark): boolean {
  return (
    activity.updatedAt < through.updatedAt ||
    (activity.updatedAt === through.updatedAt && activity.sessionID <= through.sessionID)
  );
}

function sessionFamily(root: PalotSession, children: Map<string, PalotSession[]>): PalotSession[] {
  const family: PalotSession[] = [];
  const pending = [root];
  const seen = new Set<string>();
  while (pending.length) {
    const session = pending.pop()!;
    if (seen.has(session.id)) continue;
    seen.add(session.id);
    family.push(session);
    pending.push(...(children.get(session.id) ?? []));
  }
  return family;
}
