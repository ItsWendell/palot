import { describe, expect, it } from "vitest";
import type { SessionRequestSnapshot } from "../../shared";
import { familyRequestViews, requestSessionFamily } from "./session-family-requests";

const sessions = [
  { id: "root", parentID: null, title: "Parent" },
  { id: "child", parentID: "root", title: "Capture cover" },
  { id: "nested", parentID: "child", title: "Check permissions" },
  { id: "other", parentID: null, title: "Unrelated" },
];
const snapshot = (sessionID: string): SessionRequestSnapshot => ({
  permissions: [{ id: "shared-id", sessionID, action: "shell", resources: [] }],
  forms: [
    {
      id: "shared-id",
      sessionID,
      title: "Continue?",
      metadata: { kind: "question" },
      fields: [{ key: "q0", type: "string", title: "Continue?" }],
    },
  ],
  inbox: [
    {
      id: "queued",
      sessionID,
      type: "user",
      timeCreated: 1,
      payload: { text: "Later" },
      delivery: "queue",
    },
  ],
  errors: [],
});

describe("session family requests", () => {
  it("includes descendants but not ancestors or unrelated sessions", () => {
    expect(requestSessionFamily(sessions, "root").map((s) => s.id)).toEqual([
      "root",
      "child",
      "nested",
    ]);
    expect(requestSessionFamily(sessions, "child").map((s) => s.id)).toEqual(["child", "nested"]);
    expect(requestSessionFamily(sessions, null)).toEqual([]);
  });

  it("handles missing roots and cyclic lineage without duplicates", () => {
    expect(requestSessionFamily(sessions.slice(1), "root").map((s) => s.id)).toEqual([
      "child",
      "nested",
    ]);
    const cyclic = sessions.map((s) => (s.id === "root" ? { ...s, parentID: "nested" } : s));
    expect(requestSessionFamily(cyclic, "root").map((s) => s.id)).toEqual([
      "root",
      "child",
      "nested",
    ]);
  });

  it("preserves owners and request types, excludes pending messages, and orders by request time", () => {
    const child = { ...snapshot("child"), requestCreatedAtByID: { "shared-id": 20 } };
    const nested = { ...snapshot("nested"), requestCreatedAtByID: { "shared-id": 10 } };
    const views = familyRequestViews(
      requestSessionFamily(sessions, "root"),
      new Map([
        ["child", child],
        ["nested", nested],
        ["other", snapshot("other")],
      ]),
    );
    expect(
      views.map(({ sessionID, type, sessionTitle }) => ({ sessionID, type, sessionTitle })),
    ).toEqual([
      { sessionID: "nested", type: "permission", sessionTitle: "Check permissions" },
      { sessionID: "nested", type: "question", sessionTitle: "Check permissions" },
      { sessionID: "child", type: "permission", sessionTitle: "Capture cover" },
      { sessionID: "child", type: "question", sessionTitle: "Capture cover" },
    ]);
    expect(familyRequestViews(requestSessionFamily(sessions, "root"), new Map())).toEqual([]);
  });
});
