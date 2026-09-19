import { describe, expect, it } from "vitest";
import type { PalotSession, SessionRequestSnapshot, SessionTriageSnapshot } from "../../shared";
import { inboxSessionState, orderInboxSessions, projectSessionInbox } from "./session-inbox";

describe("inboxSessionState", () => {
  it("prioritizes attention, running, and failure over unread", () => {
    expect(inboxSessionState({ attention: true, failed: true, running: true }, true)).toBe(
      "attention",
    );
    expect(inboxSessionState({ attention: false, failed: true, running: true }, true)).toBe(
      "running",
    );
    expect(inboxSessionState({ attention: false, failed: false, running: true }, true)).toBe(
      "running",
    );
  });

  it("shows unread only for idle tasks", () => {
    expect(inboxSessionState({ attention: false, failed: false, running: false }, true)).toBe(
      "unread",
    );
    expect(
      inboxSessionState({ attention: false, failed: false, running: false }, false),
    ).toBeNull();
  });
});

const root: PalotSession = {
  id: "root",
  parentID: null,
  projectID: "project",
  title: "Root task",
  agent: null,
  model: null,
  location: { directory: "/repo" },
  createdAt: 10,
  updatedAt: 10,
  archivedAt: null,
  cost: null,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
};
const emptyRequests: SessionRequestSnapshot = {
  permissions: [],
  forms: [],
  inbox: [],
  errors: [],
};
const inactive = {
  status: "inactive",
  startedAt: null,
  completedAt: null,
};
type TestExecutionState =
  | typeof inactive
  | { status: "running"; startedAt: number; completedAt: null };

function project(
  triage: SessionTriageSnapshot | null,
  requests: SessionRequestSnapshot = emptyRequests,
  execution: TestExecutionState = inactive,
  session: PalotSession = root,
) {
  return projectSessionInbox({
    sessions: [session],
    projects: [],
    requests: new Map([[session.id, requests]]),
    activeIDs: execution.status === "running" ? new Set([session.id]) : new Set(),
    runningSinceBySession: new Map([[session.id, execution.startedAt]]),
    triage,
    now: 500,
  });
}

describe("projectSessionInbox", () => {
  it("restores persisted failure state after live execution state is gone", () => {
    const result = project(null, emptyRequests, inactive, { ...root, outcome: "failed" });

    expect(result.inbox[0]?.failed).toBe(true);
  });

  it("keeps failed history in the inbox until explicitly settled", () => {
    const session = { ...root, outcome: "failed" as const };
    const triage: SessionTriageSnapshot = {
      profileID: "local",
      bootstrapThrough: { updatedAt: 100, sessionID: "z" },
      sessions: [],
    };
    const before = project(triage, emptyRequests, inactive, session);
    expect(before.inbox[0]).toMatchObject({ failed: true, canSettle: true });

    triage.sessions.push({
      sessionID: root.id,
      disposition: "settled",
      settledThrough: before.inbox[0]!.activityThrough,
      pinnedAt: null,
      snoozedUntil: null,
      snoozedThrough: null,
      updatedAt: 500,
    });

    const after = project(triage, emptyRequests, inactive, session);
    expect(after.inbox).toHaveLength(0);
    expect(after.settled[0]).toMatchObject({ failed: true, section: "settled" });

    const updated = project(triage, emptyRequests, inactive, { ...session, updatedAt: 20 });
    expect(updated.settled).toHaveLength(0);
    expect(updated.inbox[0]).toMatchObject({ failed: true });

    const running = project(
      triage,
      emptyRequests,
      { status: "running", startedAt: 100, completedAt: null },
      session,
    );
    expect(running.settled).toHaveLength(0);
    expect(running.inbox[0]).toMatchObject({ running: true, canSettle: false });

    const blocked = project(
      triage,
      {
        ...emptyRequests,
        permissions: [{ id: "permission", sessionID: root.id, action: "shell", resources: [] }],
      },
      inactive,
      session,
    );
    expect(blocked.settled).toHaveLength(0);
    expect(blocked.inbox[0]).toMatchObject({ attention: true, canSettle: false });
  });

  it("lets a repaired running snapshot override an old persisted failure", () => {
    const result = project(
      null,
      emptyRequests,
      { status: "running", startedAt: 100, completedAt: null },
      { ...root, outcome: "failed" },
    );

    expect(result.inbox[0]).toMatchObject({ failed: false, running: true });
  });

  it("does not mark the root failed when only a descendant failed", () => {
    const child = {
      ...root,
      id: "child-failed",
      parentID: root.id,
      outcome: "failed" as const,
      updatedAt: 20,
    };
    const result = projectSessionInbox({
      sessions: [{ ...root, outcome: "succeeded" }, child],
      projects: [],
      requests: new Map(),
      activeIDs: new Set(),
      runningSinceBySession: new Map(),
      triage: null,
      now: 500,
    });

    expect(result.inbox[0]).toMatchObject({ session: { id: root.id }, failed: false });
  });

  it("implicitly settles history behind the profile bootstrap", () => {
    expect(
      project({
        profileID: "local",
        bootstrapThrough: { updatedAt: 100, sessionID: "z" },
        sessions: [],
      }).settled,
    ).toHaveLength(1);
  });

  it("reopens conservatively when OpenCode updated after settlement", () => {
    expect(
      project({
        profileID: "local",
        bootstrapThrough: { updatedAt: 1, sessionID: "z" },
        sessions: [
          {
            sessionID: root.id,
            disposition: "settled",
            settledThrough: { updatedAt: 5, sessionID: root.id },
            pinnedAt: null,
            snoozedUntil: null,
            snoozedThrough: null,
            updatedAt: 5,
          },
        ],
      }).inbox,
    ).toHaveLength(1);
  });

  it("reopens legacy settled rows without a complete activity watermark", () => {
    expect(
      project({
        profileID: "local",
        bootstrapThrough: { updatedAt: 100, sessionID: "z" },
        sessions: [
          {
            sessionID: root.id,
            disposition: "settled",
            settledThrough: null,
            pinnedAt: null,
            snoozedUntil: null,
            snoozedThrough: null,
            updatedAt: 5,
          },
        ],
      }).inbox,
    ).toHaveLength(1);
  });

  it("keeps pinned tasks pinned when they need attention", () => {
    const snapshot = project(
      {
        profileID: "local",
        bootstrapThrough: { updatedAt: 100, sessionID: "z" },
        sessions: [
          {
            sessionID: root.id,
            disposition: "inbox",
            settledThrough: null,
            pinnedAt: 110,
            snoozedUntil: null,
            snoozedThrough: null,
            updatedAt: 110,
          },
        ],
      },
      {
        ...emptyRequests,
        permissions: [{ id: "permission", sessionID: root.id, action: "shell", resources: [] }],
      },
    );
    expect(snapshot.pinned[0]).toMatchObject({ attention: true, canSettle: false });
  });

  it("does not treat queued user messages as attention requests", () => {
    const snapshot = project(
      {
        profileID: "local",
        bootstrapThrough: { updatedAt: 100, sessionID: "z" },
        sessions: [
          {
            sessionID: root.id,
            disposition: "inbox",
            settledThrough: null,
            pinnedAt: null,
            snoozedUntil: 1_000,
            snoozedThrough: { updatedAt: 10, sessionID: root.id },
            updatedAt: 100,
          },
        ],
      },
      {
        ...emptyRequests,
        inbox: [
          {
            id: "input",
            sessionID: root.id,
            time: { created: 10 },
            type: "user",
            payload: { text: "continue" },
            delivery: "queue",
          },
        ],
      },
    );
    expect(snapshot.snoozed[0]).toMatchObject({ attention: false, attentionCount: 0 });
  });

  it("does not allow running work to settle", () => {
    const snapshot = project(
      null,
      { ...emptyRequests },
      {
        ...inactive,
        status: "running",
        startedAt: 250,
      },
    );
    expect(snapshot.inbox[0]).toMatchObject({
      running: true,
      runningSince: 250,
      canSettle: false,
    });
  });

  it("keeps running tasks in start order while their activity timestamps change", () => {
    const first = { ...root, id: "first", updatedAt: 300 };
    const second = { ...root, id: "second", updatedAt: 400 };
    const snapshot = projectSessionInbox({
      sessions: [second, first],
      projects: [],
      requests: new Map(),
      activeIDs: new Set([first.id, second.id]),
      runningSinceBySession: new Map([
        [first.id, 100],
        [second.id, 200],
      ]),
      triage: null,
      now: 500,
    });

    expect(snapshot.inbox.map((item) => item.session.id)).toEqual([first.id, second.id]);
  });

  it("uses the idle transition for settled-session recency", () => {
    const recentlyIdle = { ...root, id: "recent-idle", updatedAt: 100, idleAt: 90 };
    const metadataUpdated = { ...root, id: "metadata-updated", updatedAt: 200, idleAt: 80 };
    const snapshot = projectSessionInbox({
      sessions: [metadataUpdated, recentlyIdle],
      projects: [],
      requests: new Map(),
      activeIDs: new Set(),
      runningSinceBySession: new Map(),
      triage: {
        profileID: "local",
        bootstrapThrough: { updatedAt: 1_000, sessionID: "z" },
        sessions: [],
      },
      now: 500,
    });

    expect(snapshot.settled.map((item) => item.session.id)).toEqual([
      recentlyIdle.id,
      metadataUpdated.id,
    ]);
  });

  it("projects recursive descendant activity onto the root task", () => {
    const child = { ...root, id: "child", parentID: root.id, updatedAt: 20 };
    const grandchild = { ...root, id: "grandchild", parentID: child.id, updatedAt: 30 };
    const snapshot = projectSessionInbox({
      sessions: [root, child, grandchild],
      projects: [],
      requests: new Map([
        [
          grandchild.id,
          {
            ...emptyRequests,
            permissions: [
              { id: "permission", sessionID: grandchild.id, action: "shell", resources: [] },
            ],
          },
        ],
      ]),
      activeIDs: new Set([child.id]),
      runningSinceBySession: new Map([[child.id, 200]]),
      triage: {
        profileID: "local",
        bootstrapThrough: { updatedAt: 100, sessionID: "z" },
        sessions: [],
      },
      now: 500,
    });

    expect(snapshot.inbox[0]).toMatchObject({
      session: { id: root.id },
      attention: true,
      running: true,
      runningSince: 200,
      canSettle: false,
      activityThrough: { updatedAt: 30, sessionID: grandchild.id },
    });
  });

  it("uses the session ID to order equal-timestamp activity watermarks", () => {
    const child = { ...root, id: "z-child", parentID: root.id };
    const snapshot = projectSessionInbox({
      sessions: [root, child],
      projects: [],
      requests: new Map(),
      activeIDs: new Set(),
      runningSinceBySession: new Map(),
      triage: {
        profileID: "local",
        bootstrapThrough: { updatedAt: root.updatedAt, sessionID: root.id },
        sessions: [],
      },
      now: 500,
    });

    expect(snapshot.inbox).toHaveLength(1);
    expect(snapshot.inbox[0]?.activityThrough.sessionID).toBe(child.id);
  });
});

describe("orderInboxSessions", () => {
  const oldSession = {
    ...root,
    id: "old",
    updatedAt: 10,
    idleAt: 10,
  };
  const newSession = {
    ...root,
    id: "new",
    updatedAt: 20,
    idleAt: 20,
    viewedAt: 20,
  };
  const items = projectSessionInbox({
    sessions: [oldSession, newSession],
    projects: [],
    requests: new Map([
      [
        oldSession.id,
        {
          ...emptyRequests,
          permissions: [
            { id: "permission", sessionID: oldSession.id, action: "shell", resources: [] },
          ],
        },
      ],
    ]),
    activeIDs: new Set(),
    runningSinceBySession: new Map(),
    triage: null,
    now: 500,
  }).inbox;

  it("orders by activity or attention without mutating the source shelf", () => {
    expect(orderInboxSessions(items, { ordering: "newest", unreadFirst: false })).toMatchObject([
      { session: { id: "new" } },
      { session: { id: "old" } },
    ]);
    expect(orderInboxSessions(items, { ordering: "oldest", unreadFirst: false })).toMatchObject([
      { session: { id: "old" } },
      { session: { id: "new" } },
    ]);
    expect(orderInboxSessions(items, { ordering: "attention", unreadFirst: false })).toMatchObject([
      { session: { id: "old" } },
      { session: { id: "new" } },
    ]);
    expect(items).toMatchObject([{ session: { id: "old" } }, { session: { id: "new" } }]);
  });

  it("can promote unread tasks ahead of the selected activity ordering", () => {
    expect(orderInboxSessions(items, { ordering: "newest", unreadFirst: true })).toMatchObject([
      { session: { id: "old" } },
      { session: { id: "new" } },
    ]);
  });
});
