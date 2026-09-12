import { describe, expect, it } from "vitest";
import type { PalotSession, SessionRequestSnapshot } from "../../shared";
import { attentionInventory } from "./attention-inventory";

const session: PalotSession = {
  id: "session-1",
  parentID: null,
  projectID: "project-1",
  title: "Release verification",
  agent: null,
  model: null,
  location: { directory: "/repo" },
  createdAt: 1,
  updatedAt: 20,
  archivedAt: null,
  cost: null,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
};

describe("attentionInventory", () => {
  it("normalizes and orders blockers within a session", () => {
    const requests: SessionRequestSnapshot = {
      permissions: [
        {
          id: "permission-1",
          sessionID: session.id,
          action: "Run a command",
          resources: [],
        },
      ],
      forms: [
        {
          id: "question-1",
          sessionID: session.id,
          title: "Question",
          metadata: { kind: "question" },
          fields: [{ key: "answer", type: "string", title: "Answer" }],
        },
      ],
      inbox: [],
      errors: [],
    };

    expect(attentionInventory([], [session], new Map([[session.id, requests]]))).toMatchObject([
      {
        id: "permission-1",
        sessionID: "session-1",
        type: "permission",
        createdAt: 20,
        count: 2,
        types: ["permission", "question"],
      },
    ]);
  });

  it("uses authoritative request creation timestamps when events supplied them", () => {
    const requests: SessionRequestSnapshot = {
      permissions: [{ id: "permission-1", sessionID: session.id, action: "shell", resources: [] }],
      forms: [
        {
          id: "form-1",
          sessionID: session.id,
          title: "Details",
          fields: [{ key: "details", type: "string", title: "Details" }],
        },
      ],
      inbox: [],
      errors: [],
      requestCreatedAtByID: { "permission-1": 15, "form-1": 10 },
    };

    expect(attentionInventory([], [session], new Map([[session.id, requests]]))[0]).toMatchObject({
      id: "form-1",
      createdAt: 10,
      requests: [
        { id: "form-1", createdAt: 10 },
        { id: "permission-1", createdAt: 15 },
      ],
    });
  });

  it("removes requests that disappear from the projection", () => {
    expect(
      attentionInventory(
        [],
        [session],
        new Map([[session.id, { permissions: [], forms: [], inbox: [], errors: [] }]]),
      ),
    ).toEqual([]);
  });

  it("does not treat queued or steered user messages as attention blockers", () => {
    const requests: SessionRequestSnapshot = {
      permissions: [],
      forms: [],
      inbox: [
        {
          id: "steer",
          sessionID: session.id,
          type: "user",
          timeCreated: 12,
          payload: { text: "Steer" },
          delivery: "steer",
        },
        {
          id: "queue",
          sessionID: session.id,
          type: "user",
          timeCreated: 13,
          payload: { text: "Queue" },
          delivery: "queue",
        },
      ],
      errors: [],
    };

    expect(attentionInventory([], [session], new Map([[session.id, requests]]))).toEqual([]);
  });

  it("groups multiple blockers into one session-level attention item", () => {
    const requests: SessionRequestSnapshot = {
      permissions: [{ id: "permission-1", sessionID: session.id, action: "shell", resources: [] }],
      forms: [
        {
          id: "form-1",
          sessionID: session.id,
          title: "Deployment details",
          fields: [{ key: "details", type: "string", title: "Details" }],
        },
        {
          id: "question-1",
          sessionID: session.id,
          title: "Question",
          metadata: { kind: "question" },
          fields: [{ key: "answer", type: "string", title: "Answer" }],
        },
      ],
      inbox: [],
      errors: [],
    };

    expect(attentionInventory([], [session], new Map([[session.id, requests]]))).toMatchObject([
      {
        sessionID: session.id,
        id: "form-1",
        type: "form",
        count: 3,
        types: ["form", "permission", "question"],
        title: "3 requests need attention",
      },
    ]);
  });

  it("deduplicates the same blocker returned more than once", () => {
    const requests: SessionRequestSnapshot = {
      permissions: [
        { id: "permission-1", sessionID: session.id, action: "shell", resources: [] },
        { id: "permission-1", sessionID: session.id, action: "shell", resources: [] },
      ],
      forms: [],
      inbox: [],
      errors: [],
    };

    expect(attentionInventory([], [session], new Map([[session.id, requests]]))).toMatchObject([
      { id: "permission-1", count: 1, types: ["permission"] },
    ]);
  });

  it("rolls descendant blockers into the root task", () => {
    const child: PalotSession = {
      ...session,
      id: "child-1",
      parentID: session.id,
      title: "Explore",
      updatedAt: 30,
    };
    const requests: SessionRequestSnapshot = {
      permissions: [
        { id: "permission-child", sessionID: child.id, action: "shell", resources: [] },
      ],
      forms: [],
      inbox: [],
      errors: [],
    };

    expect(attentionInventory([], [session, child], new Map([[child.id, requests]]))).toMatchObject(
      [
        {
          key: session.id,
          sessionID: child.id,
          sessionTitle: session.title,
          requests: [{ sessionID: child.id, id: "permission-child" }],
        },
      ],
    );
  });
});
