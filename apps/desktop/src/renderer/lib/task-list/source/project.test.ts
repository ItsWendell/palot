import { describe, expect, it } from "vitest";
import type { FormInfo, PermissionRequest } from "@opencode/client";
import { taskStatus, type StatusKind } from "../model/status";
import type { Task } from "../types";
import { projectKey, taskID } from "./ids";
import { LAST_UPDATE_STEP_MS, TaskListProjector, type ServerData } from "./project";
import { NOW, requests, serverData, session } from "./fixtures.test-support";
import { formatLimitReset } from "../../../../shared/provider-limit";

function statusOf(task: Task, server: Pick<ServerData, "online" | "lastSeenAt">): StatusKind {
  return taskStatus(task, {
    now: NOW,
    liveDetail: true,
    serverOnline: server.online,
    serverLastSeenAt: server.lastSeenAt,
  }).kind;
}

function permission(id: string, sessionID: string, partial: Partial<PermissionRequest> = {}) {
  return {
    id,
    sessionID,
    action: "bash",
    resources: ["bun test"],
    ...partial,
  } as PermissionRequest;
}

function question(id: string, sessionID: string, partial: Partial<FormInfo> = {}): FormInfo {
  return {
    id,
    sessionID,
    title: "Which branch?",
    metadata: { kind: "question" },
    fields: [
      {
        key: "q0",
        type: "string",
        title: "Branch",
        description: "Which branch?",
        options: [
          { label: "main", value: "main" },
          { label: "dev", value: "dev" },
        ],
      },
    ],
    ...partial,
  } as FormInfo;
}

const project1 = (sessions: Parameters<typeof serverData>[0]) => {
  const projector = new TaskListProjector();
  const server = serverData(sessions);
  const snapshot = projector.project({ servers: [server], openTask: null, now: NOW });
  const byID = new Map(snapshot.tasks.map((task) => [task.id, task]));
  return {
    projector,
    server,
    snapshot,
    task: (id: string) => byID.get(taskID(server.serverID, id))!,
  };
};

describe("task projection", () => {
  it("gives every status rank from the data Palot has", () => {
    const { server, task } = project1({
      sessions: [
        session({ id: "approval" }),
        session({ id: "question" }),
        session({ id: "failed", outcome: "failed" }),
        session({ id: "unseen", idleAt: NOW - 60_000, viewedAt: NOW - 120_000 }),
        session({ id: "working", updatedAt: NOW - 1_000 }),
        session({ id: "stale", updatedAt: NOW - 20 * 60_000 }),
        session({ id: "stopped", outcome: "interrupted" }),
        session({ id: "idle" }),
      ],
      requests: {
        approval: requests({ permissions: [permission("p1", "approval")] }),
        question: requests({ forms: [question("f1", "question")] }),
      },
      running: { working: NOW - 42_000, stale: NOW - 30 * 60_000 },
      execution: {
        failed: {
          status: "failed",
          startedAt: NOW - 120_000,
          completedAt: NOW - 60_000,
          error: { type: null, message: "Provider overloaded" },
        },
      },
    });
    const kinds = [
      "approval",
      "question",
      "failed",
      "unseen",
      "working",
      "stale",
      "stopped",
      "idle",
    ] as const;
    expect(kinds.map((id) => statusOf(task(id), server))).toEqual(kinds);
    expect(task("failed").failure).toBe("Provider overloaded");
    expect(task("failed").attentionAt).toBe(NOW - 60_000);
    expect(task("working").run).toEqual({
      startedAt: NOW - 42_000,
      lastUpdateAt: NOW - 1_000,
      detail: null,
    });
    expect(task("working").activityAt).toBe(NOW - 42_000);
    expect(task("idle").runEndedAt).toBe(NOW - 600_000);
  });

  it("names a provider limit that failed the task as the turn row does, with its reset", () => {
    const resetsAt = NOW + 3_600_000;
    const { task } = project1({
      sessions: [session({ id: "failed", outcome: "failed" })],
      execution: {
        failed: {
          status: "failed",
          startedAt: NOW - 120_000,
          completedAt: NOW,
          error: {
            type: "provider.go-limit",
            message: "OpenCode Go weekly usage limit reached. Switch to a free model…",
            status: 429,
            retryAfterMs: resetsAt - NOW,
            body: JSON.stringify({ metadata: { limitName: "weekly" } }),
          },
        },
      },
    });
    const time = formatLimitReset(resetsAt, NOW);
    expect(task("failed").failure).toBe(`OpenCode Go weekly limit reached · resets ${time}`);
  });

  it("says Failed when OpenCode gave no reason, and keeps a settled failure out of Needs you", () => {
    const { task } = project1({
      sessions: [
        session({ id: "failed", outcome: "failed" }),
        session({ id: "settled", outcome: "failed" }),
      ],
      triage: [
        {
          sessionID: "settled",
          disposition: "settled",
          settledThrough: { updatedAt: NOW, sessionID: "settled" },
          pinnedAt: null,
          snoozedUntil: null,
          snoozedThrough: null,
          updatedAt: NOW,
        },
      ],
    });
    expect(task("failed").failure).toBe("Failed");
    expect(task("settled").failure).toBeNull();
    expect(task("settled").settledAt).toBe(NOW - 600_000);
  });

  it("maps each request kind to what the row can answer", () => {
    const { projector, task } = project1({
      sessions: [
        session({ id: "rule" }),
        session({ id: "no-rule" }),
        session({ id: "choice" }),
        session({ id: "multi" }),
        session({ id: "form" }),
      ],
      requests: {
        rule: requests({
          permissions: [
            permission("p1", "rule", {
              resources: ["bun test --watch\nsecond line"],
              save: ["bun test *"],
            }),
          ],
        }),
        "no-rule": requests({
          permissions: [permission("p2", "no-rule", { action: "edit", resources: ["/repo/a.ts"] })],
        }),
        choice: requests({ forms: [question("f1", "choice")] }),
        multi: requests({
          forms: [
            question("f2", "multi", {
              fields: [
                {
                  key: "q0",
                  type: "multiselect",
                  title: "Files",
                  options: [
                    { label: "a", value: "a" },
                    { label: "b", value: "b" },
                  ],
                },
              ],
            } as Partial<FormInfo>),
          ],
        }),
        form: requests({
          forms: [
            {
              id: "f3",
              sessionID: "form",
              title: "Sign in",
              fields: [
                { key: "user", type: "string", title: "User" },
                { key: "token", type: "string", title: "Token" },
              ],
            } as FormInfo,
          ],
        }),
      },
    });
    expect(task("rule").requests[0]).toMatchObject({
      kind: "permission",
      summary: "bun test --watch",
      detail: "bun test --watch\nsecond line",
      rule: "bun test *",
      from: null,
    });
    expect(task("no-rule").requests[0]).toMatchObject({
      summary: "/repo/a.ts",
      detail: "/repo/a.ts",
      rule: "",
    });
    expect(task("choice").requests[0]).toMatchObject({
      kind: "question",
      question: "Which branch?",
      options: ["main", "dev"],
    });
    expect(task("multi").requests[0]).toMatchObject({ kind: "question", options: [] });
    expect(task("form").requests[0]).toMatchObject({
      kind: "question",
      question: "Sign in",
      options: [],
    });
    expect(task("choice").attentionAt).toBe(NOW);
    expect(projector.meta(taskID("local", "rule"))?.requestOwners.get("p1")).toBe("rule");
  });

  it("names the subagent that asked and answers it there", () => {
    const { projector, task } = project1({
      sessions: [
        session({ id: "root" }),
        session({ id: "child", parentID: "root", agent: "explore", updatedAt: NOW - 2_000 }),
        session({ id: "other-child", parentID: "root", agent: "general" }),
      ],
      requests: {
        child: requests({
          permissions: [permission("p1", "child")],
          requestCreatedAtByID: { p1: NOW - 5_000 },
        }),
      },
      running: { root: NOW - 60_000, child: NOW - 30_000, "other-child": NOW - 30_000 },
    });
    const root = task("root");
    expect(root.requests).toEqual([
      expect.objectContaining({ id: "p1", from: "explore", arrivedAt: NOW - 5_000 }),
    ]);
    expect(root.subagents).toBe(2);
    expect(root.attentionAt).toBe(NOW - 5_000);
    expect(root.run?.lastUpdateAt).toBe(NOW - 2_000);
    expect(projector.meta(root.id)?.requestOwners.get("p1")).toBe("child");
    // Subagents are part of their task, never rows of their own.
    expect(task("child")).toBeUndefined();
  });

  it("marks a request from a subagent without an agent name as from a subagent", () => {
    const { task } = project1({
      sessions: [session({ id: "root" }), session({ id: "child", parentID: "root", agent: null })],
      requests: { child: requests({ permissions: [permission("p1", "child")] }) },
      running: { root: NOW - 60_000, child: NOW - 30_000 },
    });
    expect(task("root").requests[0]?.from).toBe("");
  });

  it("projects chats without a project, unknown projects by name, and offline servers", () => {
    const projector = new TaskListProjector();
    const local = serverData({
      sessions: [
        session({ id: "chat", location: { directory: "/home/me/.palot/chats/2026-x" } }),
        session({ id: "lost", projectID: "gone", location: { directory: "/elsewhere" } }),
        session({ id: "task" }),
      ],
    });
    const remote = serverData({
      serverID: "remote",
      online: false,
      sessions: [session({ id: "task" }), session({ id: "busy", updatedAt: NOW - 1_000 })],
      running: { busy: NOW - 60_000 },
    });
    const snapshot = projector.project({ servers: [local, remote], openTask: null, now: NOW });
    const byID = new Map(snapshot.tasks.map((task) => [task.id, task]));
    expect(byID.get(taskID("local", "chat"))?.projectID).toBeNull();
    expect(byID.get(taskID("local", "task"))?.projectID).toBe(projectKey("local", "project"));
    expect(snapshot.projects).toEqual([
      { id: projectKey("local", "project"), name: "Palot", serverID: "local" },
      { id: projectKey("local", "gone"), name: "Unknown project", serverID: "local" },
      { id: projectKey("remote", "project"), name: "Palot", serverID: "remote" },
    ]);
    // The same OpenCode id on two servers is two tasks.
    expect(byID.has(taskID("remote", "task"))).toBe(true);
    expect(snapshot.servers).toEqual([
      { id: "local", name: "local", online: true, lastSeenAt: null },
      { id: "remote", name: "remote", online: false, lastSeenAt: NOW - 120_000 },
    ]);
    expect(statusOf(byID.get(taskID("remote", "busy"))!, snapshot.servers[1]!)).toBe("stale");
  });

  it("carries triage, unread marks, branches, PR marks and schedules", () => {
    const { task } = project1({
      sessions: [
        session({ id: "pinned" }),
        session({ id: "snoozed" }),
        session({ id: "marked" }),
        session({ id: "open", idleAt: NOW - 60_000, viewedAt: NOW - 120_000 }),
      ],
      marked: ["marked"],
      triage: [
        {
          sessionID: "pinned",
          disposition: null,
          settledThrough: null,
          pinnedAt: NOW - 1_000,
          snoozedUntil: null,
          snoozedThrough: null,
          updatedAt: NOW - 1_000,
        },
        {
          sessionID: "snoozed",
          disposition: null,
          settledThrough: null,
          pinnedAt: null,
          snoozedUntil: NOW + 3_600_000,
          snoozedThrough: { updatedAt: NOW, sessionID: "snoozed" },
          updatedAt: NOW - 1_000,
        },
      ],
      extra: {
        branchOf: (item) => (item.id === "pinned" ? "feature/x" : null),
        pullRequestOf: (id) =>
          id === "pinned"
            ? { number: 12, state: "open", checks: "passing", readiness: null }
            : null,
        schedules: new Map([["snoozed", "Daily at 9:00 AM"]]),
      },
    });
    expect(task("pinned")).toMatchObject({
      pinnedAt: NOW - 1_000,
      branch: "feature/x",
      pr: { number: 12, state: "open", checks: "passing", readiness: null },
    });
    expect(task("snoozed")).toMatchObject({
      snoozedUntil: NOW + 3_600_000,
      schedule: "Daily at 9:00 AM",
    });
    expect(task("marked").unread).toBe(true);
    expect(task("open").unread).toBe(true);
    const projector = new TaskListProjector();
    const server = serverData({
      sessions: [session({ id: "open", idleAt: NOW - 60_000, viewedAt: NOW - 120_000 })],
    });
    const snapshot = projector.project({
      servers: [server],
      openTask: { serverID: "local", sessionID: "open" },
      now: NOW,
    });
    // OpenCode's unread state does not show for the open task.
    expect(snapshot.tasks[0]?.unread).toBe(false);
    expect(snapshot.openTaskID).toBe(taskID("local", "open"));
  });

  it("opens, and reads as open, the task a subagent session belongs to", () => {
    const projector = new TaskListProjector();
    const server = serverData({
      sessions: [
        session({ id: "root", idleAt: NOW - 60_000, viewedAt: NOW - 120_000 }),
        session({ id: "child", parentID: "root" }),
        session({ id: "grandchild", parentID: "child" }),
        session({ id: "other", idleAt: NOW - 60_000, viewedAt: NOW - 120_000 }),
      ],
    });
    const snapshot = projector.project({
      servers: [server],
      openTask: { serverID: "local", sessionID: "grandchild" },
      now: NOW,
    });
    expect(snapshot.openTaskID).toBe(taskID("local", "root"));
    const byID = new Map(snapshot.tasks.map((task) => [task.id, task]));
    expect(byID.get(taskID("local", "root"))?.unread).toBe(false);
    expect(byID.get(taskID("local", "other"))?.unread).toBe(true);
  });

  it("hides standalone scheduled runs unless they need you", () => {
    const { snapshot } = project1({
      sessions: [session({ id: "run" }), session({ id: "asking-run" })],
      requests: { "asking-run": requests({ permissions: [permission("p1", "asking-run")] }) },
      extra: { groupedSessionIDs: new Set(["run", "asking-run"]) },
    });
    expect(snapshot.tasks.map((task) => task.id)).toEqual([taskID("local", "asking-run")]);
  });
});

describe("task identity", () => {
  const base = () => ({
    sessions: [
      session({ id: "a" }),
      session({ id: "b", updatedAt: NOW - 1_000 }),
      session({ id: "c" }),
    ],
    running: { b: NOW - 60_000 },
  });

  it("reuses every object while nothing changed", () => {
    const projector = new TaskListProjector();
    const first = projector.project({ servers: [serverData(base())], openTask: null, now: NOW });
    const second = projector.project({
      servers: [serverData(base())],
      openTask: null,
      now: NOW + 1_000,
    });
    expect(second).toBe(first);
    expect(second.tasks).toBe(first.tasks);
  });

  it("gives a new object only to the task that changed", () => {
    const projector = new TaskListProjector();
    const first = projector.project({ servers: [serverData(base())], openTask: null, now: NOW });
    const changed = base();
    changed.sessions[0] = session({ id: "a", title: "Renamed" });
    const second = projector.project({
      servers: [serverData(changed)],
      openTask: null,
      now: NOW,
    });
    expect(second.tasks).not.toBe(first.tasks);
    expect(second.tasks[0]).not.toBe(first.tasks[0]);
    expect(second.tasks[0]?.title).toBe("Renamed");
    expect(second.tasks[1]).toBe(first.tasks[1]);
    expect(second.tasks[2]).toBe(first.tasks[2]);
    expect(second.projects).toBe(first.projects);
    expect(second.servers).toBe(first.servers);
  });

  it("keeps a streaming task's object until its status sentence could change", () => {
    const projector = new TaskListProjector();
    const first = projector.project({ servers: [serverData(base())], openTask: null, now: NOW });
    const streamed = (updatedAt: number) => {
      const next = base();
      next.sessions[1] = session({ id: "b", updatedAt });
      return projector.project({ servers: [serverData(next)], openTask: null, now: updatedAt });
    };
    // Every streamed event bumps `updatedAt`; the stale clock does not need each one.
    for (let at = NOW; at < NOW - 1_000 + LAST_UPDATE_STEP_MS; at += 5_000)
      expect(streamed(at)).toBe(first);
    const later = streamed(NOW - 1_000 + LAST_UPDATE_STEP_MS);
    expect(later.tasks[1]).not.toBe(first.tasks[1]);
    expect(later.tasks[0]).toBe(first.tasks[0]);
  });

  it("keeps the array while tasks only reorder, and replaces it when one is added", () => {
    const projector = new TaskListProjector();
    const first = projector.project({ servers: [serverData(base())], openTask: null, now: NOW });
    const reordered = base();
    // The catalog's and the Inbox's order move as tasks run; the list orders tasks itself.
    reordered.sessions.reverse();
    expect(
      projector.project({ servers: [serverData(reordered)], openTask: null, now: NOW }).tasks,
    ).toBe(first.tasks);
    const added = base();
    added.sessions.push(session({ id: "d" }));
    const next = projector.project({ servers: [serverData(added)], openTask: null, now: NOW });
    expect(next.tasks).not.toBe(first.tasks);
    expect(next.tasks.slice(0, 3)).toEqual(first.tasks);
    expect(next.tasks[1]).toBe(first.tasks[1]);
  });

  it("keeps a request's arrival and the task's attention time while it still needs you", () => {
    const projector = new TaskListProjector();
    const asking = (ids: string[]) =>
      serverData({
        sessions: [session({ id: "a" })],
        requests: { a: requests({ permissions: ids.map((id) => permission(id, "a")) }) },
      });
    const first = projector.project({ servers: [asking(["p1"])], openTask: null, now: NOW });
    const second = projector.project({
      servers: [asking(["p1", "p2"])],
      openTask: null,
      now: NOW + 10_000,
    });
    expect(second.tasks[0]?.requests.map((request) => request.arrivedAt)).toEqual([
      NOW,
      NOW + 10_000,
    ]);
    expect(second.tasks[0]?.attentionAt).toBe(first.tasks[0]?.attentionAt);
    const answered = projector.project({
      servers: [asking([])],
      openTask: null,
      now: NOW + 20_000,
    });
    expect(answered.tasks[0]?.attentionAt).toBeNull();
    const again = projector.project({
      servers: [asking(["p3"])],
      openTask: null,
      now: NOW + 30_000,
    });
    expect(again.tasks[0]?.attentionAt).toBe(NOW + 30_000);
  });
});

describe("loaded transcripts", () => {
  it("reads the live detail of a running task at most every half second", () => {
    const projector = new TaskListProjector();
    let reads = 0;
    const transcripts = {
      messages: () => {
        reads += 1;
        return [];
      },
    };
    const server = serverData({
      sessions: [session({ id: "a", updatedAt: NOW })],
      running: { a: NOW - 1_000 },
    });
    projector.project({ servers: [server], openTask: null, now: NOW, transcripts });
    projector.project({ servers: [server], openTask: null, now: NOW + 100, transcripts });
    expect(reads).toBe(1);
    projector.project({ servers: [server], openTask: null, now: NOW + 600, transcripts });
    expect(reads).toBe(2);
  });

  it("never reads a transcript for a task that is not loaded", () => {
    const { task } = project1({
      sessions: [session({ id: "done", idleAt: NOW - 60_000, viewedAt: NOW - 120_000 })],
    });
    expect(task("done")).toMatchObject({ summary: null, lastAnswer: "" });
  });
});
