import type { OpenCodeEvent } from "@opencode/client";
import type {
  AttentionNotificationInput,
  DesktopNotificationSettings,
} from "../shared/opencode-contract";

export interface CompletionNotificationCandidate {
  eventID: string;
  sessionID: string;
  outcome: "succeeded" | "failed";
  error: string | null;
}

export function attentionCandidate(event: OpenCodeEvent): AttentionNotificationInput | null {
  if (event.type === "permission.asked") {
    return { sessionID: event.data.sessionID, requestID: event.data.id, type: "permission" };
  }
  if (event.type === "form.created") {
    return {
      sessionID: event.data.form.sessionID,
      requestID: event.data.form.id,
      type: event.data.form.metadata?.kind === "question" ? "question" : "form",
    };
  }
  return null;
}

export function completionCandidate(event: OpenCodeEvent): CompletionNotificationCandidate | null {
  if (event.type !== "session.execution.succeeded" && event.type !== "session.execution.failed") {
    return null;
  }
  if (
    event.type === "session.execution.failed" &&
    event.data.error.type === "MessageAbortedError"
  ) {
    return null;
  }
  return {
    eventID: event.id,
    sessionID: event.data.sessionID,
    outcome: event.type === "session.execution.succeeded" ? "succeeded" : "failed",
    error: event.type === "session.execution.failed" ? event.data.error.message : null,
  };
}

export function shouldShowCompletionNotification(
  settings: DesktopNotificationSettings,
  appFocused: boolean,
): boolean {
  return (
    settings.turnCompletion === "always" || (settings.turnCompletion === "unfocused" && !appFocused)
  );
}
