import { describe, expect, it } from "vitest";
import type { OpenCodeEvent } from "@opencode/client";
import { DEFAULT_DESKTOP_NOTIFICATION_SETTINGS } from "../shared/opencode-contract";
import {
  attentionCandidate,
  completionCandidate,
  shouldShowCompletionNotification,
} from "./notification-policy";

const event = (type: OpenCodeEvent["type"], data: Record<string, unknown>) =>
  ({ id: `${type}-1`, created: 1, type, data }) as OpenCodeEvent;

describe("desktop notification policy", () => {
  it("extracts permission, form, and question requests", () => {
    expect(attentionCandidate(event("permission.asked", { id: "p1", sessionID: "s1" }))).toEqual({
      sessionID: "s1",
      requestID: "p1",
      type: "permission",
    });
    expect(
      attentionCandidate(event("form.created", { form: { id: "f1", sessionID: "s1" } })),
    ).toEqual({ sessionID: "s1", requestID: "f1", type: "form" });
    expect(
      attentionCandidate(
        event("form.created", {
          form: {
            id: "q1",
            sessionID: "s1",
            title: "Question",
            metadata: { kind: "question" },
            fields: [{ key: "answer", type: "string" }],
          },
        }),
      ),
    ).toEqual({ sessionID: "s1", requestID: "q1", type: "question" });
  });

  it("extracts terminal execution outcomes and ignores user aborts", () => {
    expect(completionCandidate(event("session.execution.succeeded", { sessionID: "s1" }))).toEqual({
      eventID: "session.execution.succeeded-1",
      sessionID: "s1",
      outcome: "succeeded",
      error: null,
    });
    expect(
      completionCandidate(
        event("session.execution.failed", {
          sessionID: "s1",
          error: { type: "MessageAbortedError", message: "Stopped" },
        }),
      ),
    ).toBeNull();
  });

  it("honors completion focus preferences", () => {
    expect(shouldShowCompletionNotification(DEFAULT_DESKTOP_NOTIFICATION_SETTINGS, true)).toBe(
      true,
    );
    expect(
      shouldShowCompletionNotification(
        { ...DEFAULT_DESKTOP_NOTIFICATION_SETTINGS, turnCompletion: "unfocused" },
        true,
      ),
    ).toBe(false);
    expect(
      shouldShowCompletionNotification(
        { ...DEFAULT_DESKTOP_NOTIFICATION_SETTINGS, turnCompletion: "never" },
        false,
      ),
    ).toBe(false);
  });
});
