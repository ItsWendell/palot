import type { OpenCodeEvent } from "@opencode/client";

/** Only settled tool/shell output, never prompts or partial streamed text. */
export function pullRequestOutput(
  event: OpenCodeEvent,
): { sessionID: string; text: string } | null {
  if (event.type === "session.tool.success") {
    const text = event.data.content
      .flatMap((part) => (part.type === "text" ? [part.text] : []))
      .join("\n");
    return text.includes("/pull/") ? { sessionID: event.data.sessionID, text } : null;
  }
  if (event.type === "session.shell.ended") {
    const text = event.data.output.output;
    return text.includes("/pull/") ? { sessionID: event.data.sessionID, text } : null;
  }
  return null;
}
