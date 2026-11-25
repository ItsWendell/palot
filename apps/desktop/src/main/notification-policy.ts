import type { OpenCodeEvent } from "@opencode/client";
import type {
  AttentionNotificationInput,
  DesktopNotificationSettings,
} from "../shared/opencode-contract";

export function attentionCandidate(event: OpenCodeEvent): AttentionNotificationInput | null {
  if (event.type === "permission.asked") {
    return { sessionID: event.data.sessionID, requestID: event.data.id, type: "permission" };
  }
  if (event.type === "form.created") {
    // Location-wide MCP elicitations have no task to open; Palot shows them in the task view.
    if (event.data.form.sessionID === "global") return null;
    return {
      sessionID: event.data.form.sessionID,
      requestID: event.data.form.id,
      type: event.data.form.metadata?.kind === "question" ? "question" : "form",
    };
  }
  return null;
}

export function shouldShowCompletionNotification(
  settings: DesktopNotificationSettings,
  appFocused: boolean,
): boolean {
  return (
    settings.turnCompletion === "always" || (settings.turnCompletion === "unfocused" && !appFocused)
  );
}
