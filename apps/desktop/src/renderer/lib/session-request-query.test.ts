import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import type { PalotEvent, SessionRequestSnapshot } from "../../shared";
import { openCodeKeys } from "./opencode-query";
import {
  applySessionRequestEvent,
  mergeAttentionRequests,
  mergeSessionRequestSnapshot,
  setSessionRequestSnapshot,
} from "./session-request-query";

const empty: SessionRequestSnapshot = {
  permissions: [],
  forms: [],
  inbox: [],
  errors: [],
};

describe("session request timestamps", () => {
  it("keeps known pending requests on partial attention reads and accepts authoritative clearing", () => {
    const previous: SessionRequestSnapshot = {
      ...empty,
      permissions: [{ id: "permission", sessionID: "session", action: "read", resources: ["old"] }],
      forms: [
        {
          id: "form",
          sessionID: "session",
          title: "Question",
          fields: [{ key: "answer", type: "string" }],
        },
      ],
      inbox: [
        {
          id: "queued",
          sessionID: "session",
          time: { created: 1 },
          type: "user",
          payload: { text: "Continue" },
          delivery: "queue",
        },
      ],
    };
    const next: SessionRequestSnapshot = {
      ...empty,
      permissions: [{ id: "permission", sessionID: "session", action: "read", resources: ["new"] }],
    };
    const partial = mergeAttentionRequests(previous, next, false);
    expect(partial.permissions).toEqual(next.permissions);
    expect(partial.forms).toEqual(previous.forms);
    expect(partial.inbox).toEqual(previous.inbox);
    const complete = mergeAttentionRequests(partial, empty, true);
    expect(complete.permissions).toEqual([]);
    expect(complete.forms).toEqual([]);
    expect(complete.inbox).toEqual(previous.inbox);
  });

  it("preserves event creation metadata across request-list replacement", () => {
    expect(
      mergeSessionRequestSnapshot(
        { ...empty, requestCreatedAtByID: { permission: 10 } },
        {
          ...empty,
          permissions: [{ id: "permission", sessionID: "session", action: "shell", resources: [] }],
        },
      ),
    ).toMatchObject({ requestCreatedAtByID: { permission: 10 } });
  });

  it("records permission and form event timestamps by request ID", () => {
    const queryClient = new QueryClient();
    const connectionID = "connection";
    applySessionRequestEvent(
      queryClient,
      connectionID,
      event("permission.asked", 10, {
        id: "permission",
        sessionID: "session",
        action: "shell",
        resources: [],
      }),
    );
    applySessionRequestEvent(
      queryClient,
      connectionID,
      event("form.created", 20, {
        form: { id: "form", sessionID: "session", title: "Details", fields: [] },
      }),
    );
    setSessionRequestSnapshot(queryClient, connectionID, "session", empty);

    expect(
      queryClient.getQueryData<SessionRequestSnapshot>(
        openCodeKeys.sessionRequests(connectionID, "session"),
      )?.requestCreatedAtByID,
    ).toEqual({ permission: 10, form: 20 });
  });

  it("applies request lifecycle events without waiting for a session query", () => {
    const queryClient = new QueryClient();
    const connectionID = "connection";
    applySessionRequestEvent(
      queryClient,
      connectionID,
      event("session.inbox.enqueued", 10, {
        sessionID: "session",
        inboxID: "input",
        item: { type: "user", payload: { text: "Continue" }, delivery: "queue" },
      }),
    );
    applySessionRequestEvent(
      queryClient,
      connectionID,
      event("permission.asked", 20, {
        id: "permission",
        sessionID: "session",
        action: "shell",
        resources: [],
      }),
    );
    applySessionRequestEvent(
      queryClient,
      connectionID,
      event("permission.replied", 30, {
        requestID: "permission",
        sessionID: "session",
        reply: "once",
      }),
    );

    expect(
      queryClient.getQueryData<SessionRequestSnapshot>(
        openCodeKeys.sessionRequests(connectionID, "session"),
      ),
    ).toMatchObject({
      permissions: [],
      inbox: [
        {
          id: "input",
          sessionID: "session",
          time: { created: 10 },
          delivery: "queue",
        },
      ],
    });
  });
});

function event(type: PalotEvent["type"], createdAt: number, data: unknown): PalotEvent {
  return {
    id: `${type}-${createdAt}`,
    type,
    created: createdAt,
    createdAt,
    receiveSequence: createdAt,
    data,
  } as PalotEvent;
}
