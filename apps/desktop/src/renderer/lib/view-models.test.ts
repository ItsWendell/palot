import { describe, expect, it } from "vitest";
import type { PalotProject, PalotSession, SessionRequestSnapshot } from "../../shared";
import {
  groupSessions,
  orderProjects,
  pendingRequestViews,
  projectForSession,
  selectRecentSessions,
  sessionIsAdditionalCheckout,
  visibleProjects,
} from "./view-models";

const projects: PalotProject[] = [
  { id: "p1", canonical: "/p1", name: "One", sandboxes: [], vcs: null, updatedAt: 1 },
  { id: "p2", canonical: "/p2", name: "Two", sandboxes: [], vcs: null, updatedAt: 1 },
];

function session(id: string, projectID: string, updatedAt: number): PalotSession {
  return {
    id,
    projectID,
    parentID: null,
    title: id,
    agent: null,
    model: null,
    location: { directory: "/same" },
    createdAt: updatedAt,
    updatedAt,
    archivedAt: null,
    cost: null,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  };
}

describe("groupSessions", () => {
  it("uses project identity and sorts current work first", () => {
    const groups = groupSessions(projects, [session("old", "p1", 1), session("new", "p1", 2)]);
    expect(groups[0]?.sessions.map((value) => value.id)).toEqual(["new", "old"]);
  });

  it("orders projects by their latest task activity", () => {
    const groups = groupSessions(projects, [session("older", "p1", 1), session("newer", "p2", 3)]);

    expect(groups.map((group) => group.project.id)).toEqual(["p2", "p1"]);
  });

  it("does not infer project identity from directory", () => {
    expect(groupSessions(projects, [session("orphan", "missing", 1)])[0]?.sessions).toEqual([]);
  });

  it("merges historical project identities for the same canonical directory", () => {
    const duplicates: PalotProject[] = [
      { ...projects[0]!, id: "old", updatedAt: 1 },
      { ...projects[0]!, id: "current", updatedAt: 3 },
    ];
    const groups = groupSessions(duplicates, [
      session("old-task", "old", 1),
      session("current-task", "current", 2),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.project.id).toBe("current");
    expect(groups[0]?.sessions.map((value) => value.id)).toEqual(["current-task", "old-task"]);
  });
});

describe("orderProjects", () => {
  it("uses the same activity-first order as the project sidebar", () => {
    expect(
      orderProjects(projects, [session("older", "p1", 1), session("newer", "p2", 3)]).map(
        (project) => project.id,
      ),
    ).toEqual(["p2", "p1"]);
  });
});

describe("visibleProjects", () => {
  it("keeps the latest OpenCode project identity per canonical directory", () => {
    const old = { ...projects[0]!, id: "old", updatedAt: 1 };
    const current = { ...projects[0]!, id: "current", updatedAt: 2 };
    const values = visibleProjects([old, projects[1]!, current]);

    expect(values.map((project) => project.id)).toEqual(["current", "p2"]);
    expect(projectForSession([old, projects[1]!, current], session("x", "old", 1))?.id).toBe(
      "current",
    );
  });

  it("does not replace a repository project with the synthetic global project", () => {
    const repository = { ...projects[0]!, id: "repository", updatedAt: 1 };
    const global = { ...projects[0]!, id: "global", updatedAt: 2 };

    expect(projectForSession([repository, global], session("x", "repository", 1))?.id).toBe(
      "repository",
    );
    expect(projectForSession([global, repository], session("x", "repository", 1))?.id).toBe(
      "repository",
    );
  });

  it("resolves a global session to the discovered repository at its location", () => {
    const global = {
      id: "global",
      canonical: "/",
      name: null,
      sandboxes: [],
      vcs: null,
      updatedAt: 2,
    } satisfies PalotProject;
    const repository = { ...projects[0]!, canonical: "/same", id: "repository" };

    const nested = session("x", "global", 1);
    nested.location.directory = "/same/packages/app";

    expect(projectForSession([global, repository], nested)?.id).toBe("repository");
  });
});

describe("selectRecentSessions", () => {
  it("sorts recent sessions by latest activity", () => {
    const sessions = [
      session("old", "p1", 1),
      session("newest", "p1", 3),
      session("newer", "p2", 2),
    ];

    expect(selectRecentSessions(sessions, new Set(), 2).map((value) => value.id)).toEqual([
      "newest",
      "newer",
    ]);
  });

  it("sorts completed sessions by their idle transition instead of metadata updates", () => {
    const metadataUpdated = { ...session("metadata", "p1", 3), idleAt: 1 };
    const recentlyIdle = { ...session("idle", "p1", 2), idleAt: 4 };

    expect(
      selectRecentSessions([metadataUpdated, recentlyIdle], new Set(), 2).map((value) => value.id),
    ).toEqual(["idle", "metadata"]);
  });

  it("pins all active sessions before filling the recent limit", () => {
    const sessions = [
      session("active-old", "p1", 1),
      session("recent", "p1", 4),
      session("active-new", "p2", 3),
      session("older", "p2", 2),
    ];

    expect(
      selectRecentSessions(sessions, new Set(["active-old", "active-new"]), 3).map(
        (value) => value.id,
      ),
    ).toEqual(["active-new", "active-old", "recent"]);
  });

  it("does not hide active sessions when they exceed the recent limit", () => {
    const sessions = [
      session("active-1", "p1", 1),
      session("active-2", "p1", 2),
      session("recent", "p1", 3),
    ];

    expect(
      selectRecentSessions(sessions, new Set(["active-1", "active-2"]), 1).map((value) => value.id),
    ).toEqual(["active-2", "active-1"]);
  });
});

describe("sessionIsAdditionalCheckout", () => {
  it("compares the session directory with the project checkout", () => {
    expect(
      sessionIsAdditionalCheckout(
        { ...session("current", "p1", 1), location: { directory: "/p1" } },
        projects[0],
      ),
    ).toBe(false);
    expect(sessionIsAdditionalCheckout(session("worktree", "p1", 1), projects[0])).toBe(true);
  });

  it("falls back to workspace identity when the project is unavailable", () => {
    expect(
      sessionIsAdditionalCheckout({
        ...session("worktree", "missing", 1),
        location: { directory: "/worktree", workspaceID: "wrk_1" },
      }),
    ).toBe(true);
  });
});

describe("pendingRequestViews", () => {
  it("keeps permission resources and durable save patterns separate", () => {
    const requests: SessionRequestSnapshot = {
      permissions: [
        {
          id: "per_1",
          sessionID: "ses_1",
          action: "shell",
          message: "Run the project test suite",
          resources: ["bun run test"],
          save: ["bun run *"],
        },
      ],
      forms: [],
      inbox: [],
      errors: [],
    };

    expect(pendingRequestViews(requests)).toMatchObject([
      {
        id: "per_1",
        type: "permission",
        title: "shell",
        detail: "Run the project test suite",
        resources: ["bun run test"],
        savePatterns: ["bun run *"],
        questions: [],
        fields: [],
        delivery: undefined,
        ownerMessageID: undefined,
      },
    ]);
  });

  it("preserves actionable question and pending input details", () => {
    const requests: SessionRequestSnapshot = {
      permissions: [],
      forms: [
        {
          id: "que_1",
          sessionID: "ses_1",
          title: "Approach",
          metadata: { kind: "question" },
          fields: [
            {
              key: "q0",
              type: "string",
              title: "Approach",
              description: "Which approach should I use?",
              options: [
                {
                  value: "Minimal",
                  label: "Minimal",
                  description: "Change only the broken path",
                },
              ],
              custom: true,
            },
          ],
        },
      ],
      inbox: [
        {
          id: "msg_1",
          sessionID: "ses_1",
          timeCreated: 123,
          type: "user",
          delivery: "queue",
          payload: { text: "Run the full test suite after this change" },
        },
      ],
      errors: [],
    };

    expect(pendingRequestViews(requests)).toMatchObject([
      {
        id: "que_1",
        type: "question",
        title: "Approach",
        detail: undefined,
        resources: [],
        savePatterns: [],
        questions: [
          {
            header: "Approach",
            question: "Which approach should I use?",
            multiple: false,
            custom: true,
            options: [{ label: "Minimal", description: "Change only the broken path" }],
          },
        ],
        delivery: undefined,
        ownerMessageID: undefined,
      },
      {
        id: "msg_1",
        type: "input",
        title: "Pending input",
        detail: "Run the full test suite after this change",
        resources: [],
        savePatterns: [],
        questions: [],
        fields: [],
        delivery: "queue",
        ownerMessageID: undefined,
      },
    ]);
  });

  it("renders beta question forms with the question-specific controls", () => {
    const requests: SessionRequestSnapshot = {
      permissions: [],
      forms: [
        {
          id: "form_1",
          sessionID: "ses_1",
          title: "Questions",
          metadata: {
            kind: "question",
            tool: { messageID: "msg_1", id: "tool_1" },
          },
          fields: [
            {
              key: "q0",
              type: "string",
              title: "Approach",
              description: "Which approach should I use?",
              options: [{ value: "Minimal", label: "Minimal", description: "Smallest change" }],
              custom: true,
            },
            {
              key: "q1",
              type: "multiselect",
              title: "Checks",
              description: "Which checks should I run?",
              options: [{ value: "Tests", label: "Tests" }],
              custom: true,
            },
          ],
        },
      ],
      inbox: [],
      errors: [],
    };

    expect(pendingRequestViews(requests)[0]).toMatchObject({
      id: "form_1",
      type: "question",
      title: "Questions",
      ownerMessageID: "msg_1",
      questions: [
        {
          header: "Approach",
          question: "Which approach should I use?",
          multiple: false,
          custom: true,
          options: [{ label: "Minimal", description: "Smallest change" }],
        },
        {
          header: "Checks",
          question: "Which checks should I run?",
          multiple: true,
          custom: true,
          options: [{ label: "Tests" }],
        },
      ],
    });
  });

  it("reads hydrated pending input text from the inbox payload", () => {
    const requests: SessionRequestSnapshot = {
      permissions: [],
      forms: [],
      inbox: [
        {
          id: "msg_1",
          sessionID: "ses_1",
          type: "user",
          delivery: "queue",
          timeCreated: 123,
          payload: { text: "Run the full test suite after this change" },
        },
      ],
      errors: [],
    };

    expect(pendingRequestViews(requests)[0]).toMatchObject({
      id: "msg_1",
      type: "input",
      detail: "Run the full test suite after this change",
      delivery: "queue",
    });
  });

  it("preserves the assistant message that owns a blocking request", () => {
    const requests: SessionRequestSnapshot = {
      permissions: [
        {
          id: "permission",
          sessionID: "ses_1",
          action: "shell",
          resources: ["bun test"],
          source: { type: "tool", messageID: "assistant", id: "call" },
        },
      ],
      forms: [
        {
          id: "question",
          sessionID: "ses_1",
          title: "Question",
          metadata: {
            kind: "question",
            tool: { messageID: "assistant", callID: "question-call" },
          },
          fields: [{ key: "answer", type: "string", title: "Answer" }],
        },
      ],
      inbox: [],
      errors: [],
    };

    expect(pendingRequestViews(requests).map((request) => request.ownerMessageID)).toEqual([
      "assistant",
      "assistant",
    ]);
  });

  it("does not present compaction barriers as user inputs", () => {
    const requests: SessionRequestSnapshot = {
      permissions: [],
      forms: [],
      inbox: [
        {
          id: "cmp_1",
          sessionID: "ses_1",
          timeCreated: 1,
          type: "compaction",
          payload: {},
          delivery: "queue",
        },
      ],
      errors: [],
    };

    expect(pendingRequestViews(requests)).toEqual([]);
  });

  it("does not present synthetic or move inbox records as user inputs", () => {
    const requests: SessionRequestSnapshot = {
      permissions: [],
      forms: [],
      inbox: [
        {
          id: "synthetic",
          sessionID: "ses_1",
          timeCreated: 1,
          type: "synthetic",
          payload: { text: "Internal" },
          delivery: "queue",
        },
        {
          id: "move",
          sessionID: "ses_1",
          timeCreated: 2,
          type: "move",
          payload: { location: { directory: "/tmp" }, projectID: "project" },
          delivery: "queue",
        },
      ],
      errors: [],
    };

    expect(pendingRequestViews(requests)).toEqual([]);
  });

  it("deduplicates repeated request records by type and ID", () => {
    const requests: SessionRequestSnapshot = {
      permissions: [
        { id: "permission", sessionID: "ses_1", action: "shell", resources: ["bun test"] },
        { id: "permission", sessionID: "ses_1", action: "shell", resources: ["bun test"] },
      ],
      forms: [],
      inbox: [],
      errors: [],
    };

    expect(pendingRequestViews(requests)).toHaveLength(1);
  });
});
