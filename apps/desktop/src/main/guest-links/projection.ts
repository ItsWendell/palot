import type { SessionMessageInfo } from "@opencode/client";
import type { GuestTranscript } from "../../shared/guest-links-contract";

/** Explicit allowlist: never serialize native metadata, files, reasoning, or tool output. */
export function guestRows(messages: SessionMessageInfo[]): GuestTranscript["rows"] {
  const rows: GuestTranscript["rows"] = [];
  let remaining = 200000;
  for (const message of [...messages].sort((a, b) => a.time.created - b.time.created)) {
    if (remaining <= 0 || rows.length >= 600) break;
    if (message.type === "user") {
      const text = message.text.slice(0, Math.min(32000, remaining));
      rows.push({ id: message.id, role: "user", text });
      remaining -= text.length;
    }
    if (message.type !== "assistant") continue;
    for (const [index, part] of message.content.entries()) {
      if (remaining <= 0 || rows.length >= 600) break;
      if (part.type !== "text" && part.type !== "tool") continue;
      const text = (part.type === "text" ? part.text : `${part.name} · ${part.state.status}`).slice(
        0,
        Math.min(32000, remaining),
      );
      rows.push({
        id: `${message.id}:${index}`,
        role: part.type === "text" ? "assistant" : "tool",
        text,
      });
      remaining -= text.length;
    }
  }
  return rows;
}
