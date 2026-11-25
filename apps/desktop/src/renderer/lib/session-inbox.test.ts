import { describe, expect, it } from "vitest";
import type { PalotSession, SessionRequestSnapshot, SessionTriageSnapshot } from "../../shared";
import {
  autoSettleCandidates,
  idleInboxTasks,
  inboxOrderingAt,
  type InboxSessionView,
  projectSessionInbox,
} from "./session-inbox";

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
  it("marks chats by their directory, without exposing their backing project", () => {
    const chat = {
      ...root,
      location: { directory: "/home/user/.palot/chats/2026-10-27-question-abc" },
    };
    const result = projectSessionInbox({
      sessions: [chat],
      projects: [
        {
          id: chat.projectID,
          canonical: chat.location.directory,
          name: "Backing folder",
          sandboxes: [],
          vcs: null,
          updatedAt: 1,
        },
      ],
      requests: new Map(),
      activeIDs: new Set(),
      runningSinceBySession: new Map(),
      triage: null,
      now: 500,
    });
    const item = result.inbox[0]!;
    expect(item).toMatchObject({ kind: "chat", projectName: "Chat", project: null });

    const moved = project(null, emptyRequests, inactive, {
      ...chat,
      location: { directory: "/repo" },
    }).inbox[0]!;
    expect(moved.kind).toBe("task");
  });

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

    // A permission, title or metadata write is not activity: OpenCode's browser plugin edits
    // permissions whenever Palot starts or quits, which used to unsettle every attached task.
    const rewritten = project(triage, emptyRequests, inactive, { ...session, updatedAt: 20 });
    expect(rewritten.inbox).toHaveLength(0);
    expect(rewritten.settled).toHaveLength(1);

    const updated = project(triage, emptyRequests, inactive, {
      ...session,
      updatedAt: 20,
      idleAt: 20,
    });
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
    expect(blocked.inbox[0]).toMatchObject({
      attention: true,
      canSettle: false,
      attentionStatus: { kind: "approval", requestID: "permission", detail: "shell" },
    });
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

  it("keeps a task running while a subagent's report waits to wake it", () => {
    const report = {
      ...emptyRequests,
      inbox: [
        {
          id: "report",
          sessionID: root.id,
          time: { created: 20 },
          type: "synthetic" as const,
          payload: {
            text: '<subagent sessionID="child" state="completed">Done.</subagent>',
            metadata: { source: "subagent", childID: "child", state: "completed" },
          },
          delivery: "steer" as const,
        },
      ],
    };
    expect(project(null, report).inbox[0]).toMatchObject({ running: true, canSettle: false });
    expect(project(null).inbox[0]).toMatchObject({ running: false });
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

  it("orders running tasks by the server's run start, which survives reloads", () => {
    // After a reload Palot knows neither start; OpenCode's time.busy still does.
    const first = { ...root, id: "first", updatedAt: 300, busyAt: 100, idleAt: 50 };
    const second = { ...root, id: "second", updatedAt: 400, busyAt: 200, idleAt: 50 };
    // A stale busy time from a finished run is not a start.
    const third = { ...root, id: "third", updatedAt: 450, busyAt: 10, idleAt: 40 };
    const snapshot = projectSessionInbox({
      sessions: [third, second, first],
      projects: [],
      requests: new Map(),
      activeIDs: new Set([first.id, second.id, third.id]),
      runningSinceBySession: new Map([
        [first.id, null],
        [second.id, null],
        [third.id, 150],
      ]),
      triage: null,
      now: 500,
    });

    expect(snapshot.inbox.map((item) => [item.session.id, item.runningSince])).toEqual([
      [first.id, 100],
      [third.id, 150],
      [second.id, 200],
    ]);
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
    const child = { ...root, id: "child", parentID: root.id, updatedAt: 20, idleAt: 20 };
    const grandchild = {
      ...root,
      id: "grandchild",
      parentID: child.id,
      updatedAt: 30,
      idleAt: 30,
    };
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

describe("stable inbox ordering", () => {
  // The task list orders by this key (newest first); streaming never moves it.
  const newest = (items: readonly InboxSessionView[]) =>
    items.toSorted(
      (left, right) =>
        inboxOrderingAt(right) - inboxOrderingAt(left) ||
        left.session.id.localeCompare(right.session.id),
    );
  const task = (id: string, times: Partial<PalotSession> = {}): PalotSession => ({
    ...root,
    id,
    createdAt: 10,
    updatedAt: 10,
    ...times,
  });
  const inbox = (input: {
    sessions: PalotSession[];
    running?: Record<string, number>;
    requests?: Map<string, SessionRequestSnapshot>;
    triage?: SessionTriageSnapshot | null;
  }) =>
    projectSessionInbox({
      sessions: input.sessions,
      projects: [],
      requests: input.requests ?? new Map(),
      activeIDs: new Set(Object.keys(input.running ?? {})),
      runningSinceBySession: new Map(Object.entries(input.running ?? {})),
      triage: input.triage ?? null,
      now: 500,
    });
  const ids = (items: Array<{ session: { id: string } }>) => items.map((item) => item.session.id);

  it("keeps running tasks in place while they stream and their sub-agents work", () => {
    const early = task("early", { idleAt: 50, updatedAt: 50 });
    const late = task("late", { idleAt: 40, updatedAt: 40 });
    const child = task("child", { parentID: early.id, updatedAt: 60 });
    const running = { early: 100, late: 200, child: 150 };
    const before = inbox({ sessions: [early, late, child], running });
    expect(ids(newest(before.inbox))).toEqual(["late", "early"]);

    const streamed = inbox({
      sessions: [{ ...early, updatedAt: 900 }, late, { ...child, updatedAt: 950 }],
      running,
    });
    expect(ids(newest(streamed.inbox))).toEqual(["late", "early"]);
  });

  it("moves a task once when its turn finishes", () => {
    const finished = task("finished", { idleAt: 50, updatedAt: 50 });
    const working = task("working", { idleAt: 40, updatedAt: 40 });
    const idle = task("idle", { idleAt: 300, updatedAt: 300 });
    const during = inbox({
      sessions: [finished, working, idle],
      running: { finished: 100, working: 200 },
    });
    expect(ids(newest(during.inbox))).toEqual(["idle", "working", "finished"]);

    const after = inbox({
      sessions: [{ ...finished, idleAt: 400, updatedAt: 400 }, working, idle],
      running: { working: 200 },
    });
    expect(ids(newest(after.inbox))).toEqual(["finished", "idle", "working"]);
  });
});

describe("autoSettleCandidates", () => {
  const DAY = 24 * 60 * 60 * 1_000;
  const now = 20 * DAY;
  const idleFor = (days: number) => now - days * DAY;
  const view = (id: string, overrides: Partial<InboxSessionView> = {}): InboxSessionView => ({
    session: { ...root, id, updatedAt: idleFor(4) },
    kind: "task",
    project: null,
    projectName: "Palot",
    section: "inbox",
    attention: false,
    attentionCount: 0,
    running: false,
    runningSince: null,
    failed: false,
    canSettle: true,
    pinnedAt: null,
    snoozedUntil: null,
    keptInInboxAt: null,
    activityThrough: { updatedAt: idleFor(4), sessionID: id },
    ...overrides,
  });
  const ids = (items: InboxSessionView[]) => items.map((item) => item.session.id);

  it("settles Inbox tasks idle for the configured days, counting sub-task activity", () => {
    const recentChild = view("recent-child", {
      activityThrough: { updatedAt: idleFor(1), sessionID: "child" },
    });
    expect(ids(autoSettleCandidates([view("idle"), recentChild], now, 3))).toEqual(["idle"]);
    expect(ids(autoSettleCandidates([view("idle")], now, 7))).toEqual([]);
  });

  it("leaves running, blocked, failed, and other-shelf tasks alone", () => {
    const items = [
      view("running", { running: true, canSettle: false }),
      view("blocked", { attention: true, canSettle: false }),
      view("failed", { failed: true }),
      view("pinned", { section: "pinned" }),
      view("snoozed", { section: "snoozed", snoozedUntil: now + DAY }),
    ];
    expect(autoSettleCandidates(items, now, 1)).toEqual([]);
    // A person settling in bulk can still choose failed tasks.
    expect(ids(idleInboxTasks(items, now, DAY))).toEqual(["failed"]);
  });

  it("keeps a task moved back to Inbox until it has new activity", () => {
    const kept = view("kept", { keptInInboxAt: idleFor(2) });
    expect(autoSettleCandidates([kept], now, 3)).toEqual([]);
    const active = view("kept", {
      keptInInboxAt: idleFor(10),
      session: { ...root, id: "kept", updatedAt: idleFor(5) },
      activityThrough: { updatedAt: idleFor(5), sessionID: "kept" },
    });
    expect(ids(autoSettleCandidates([active], now, 3))).toEqual(["kept"]);
  });

  it("restarts the idle clock when a snooze wakes", () => {
    expect(autoSettleCandidates([view("woke", { snoozedUntil: idleFor(1) })], now, 3)).toEqual([]);
  });
});
