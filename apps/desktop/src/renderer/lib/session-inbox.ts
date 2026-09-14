import type {
  ActivityWatermark,
  PalotProject,
  PalotSession,
  SessionRequestSnapshot,
  SessionTriageSnapshot,
} from "../../shared";
import {
  actionableRequestViews,
  projectForSession,
  projectName,
  sessionActivityAt,
} from "./view-models";

export type InboxSection = "pinned" | "inbox" | "snoozed" | "settled";
export type InboxOrdering = "newest" | "oldest" | "attention";

export interface InboxSessionView {
  session: PalotSession;
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
  activityThrough: ActivityWatermark;
}

export function sameInboxSessionView(left: InboxSessionView, right: InboxSessionView): boolean {
  return (
    left.session === right.session &&
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
    left.activityThrough.updatedAt === right.activityThrough.updatedAt &&
    left.activityThrough.sessionID === right.activityThrough.sessionID
  );
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

export function orderInboxSessions(
  items: InboxSessionView[],
  preferences: { ordering: InboxOrdering; unreadFirst: boolean },
): InboxSessionView[] {
  return items.toSorted((left, right) => {
    if (preferences.unreadFirst) {
      const unread = Number(catalogViewIsUnread(right)) - Number(catalogViewIsUnread(left));
      if (unread !== 0) return unread;
    }
    if (preferences.ordering === "attention") {
      const attention = Number(right.attention) - Number(left.attention);
      if (attention !== 0) return attention;
    }
    const activity =
      preferences.ordering === "oldest"
        ? left.activityThrough.updatedAt - right.activityThrough.updatedAt
        : right.activityThrough.updatedAt - left.activityThrough.updatedAt;
    return activity || left.session.id.localeCompare(right.session.id);
  });
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
    const project = projectForSession(input.projects, session) ?? null;
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
      project,
      projectName: project ? projectName(project) : "Unknown project",
      section,
      attention,
      attentionCount: blockers.length,
      running,
      runningSince,
      failed,
      canSettle: !running && !attention,
      pinnedAt: record?.pinnedAt ?? null,
      snoozedUntil: record?.snoozedUntil ?? null,
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

  result.pinned.sort(
    (left, right) =>
      (right.pinnedAt ?? 0) - (left.pinnedAt ?? 0) ||
      left.session.id.localeCompare(right.session.id),
  );
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
  result.snoozed.sort(
    (left, right) =>
      (left.snoozedUntil ?? 0) - (right.snoozedUntil ?? 0) ||
      left.session.id.localeCompare(right.session.id),
  );
  result.settled.sort(
    (left, right) =>
      sessionActivityAt(right.session) - sessionActivityAt(left.session) ||
      left.session.id.localeCompare(right.session.id),
  );
  return result;
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

export function sessionWatermark(
  session: Pick<PalotSession, "id" | "updatedAt">,
): ActivityWatermark {
  return { updatedAt: session.updatedAt, sessionID: session.id };
}

export function latestSessionWatermark(
  sessions: Array<Pick<PalotSession, "id" | "updatedAt">>,
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
