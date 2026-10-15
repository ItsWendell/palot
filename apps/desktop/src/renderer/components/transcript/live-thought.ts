import { createReasoningTitle, type TranscriptTurn } from "../../lib/turn-projection";
import { messageText } from "../../lib/view-models";

const MAX_THOUGHT_LENGTH = 160;

/**
 * The agent's newest reasoning snippet for the running status line. Returns
 * null when the turn is idle, has no streamed reasoning, or the projection
 * policy hides reasoning summaries.
 */
export function latestTurnThought(turn: TranscriptTurn): string | null {
  if (turn.status !== "working") return null;
  for (let groupIndex = turn.activity.length - 1; groupIndex >= 0; groupIndex -= 1) {
    const group = turn.activity[groupIndex]!;
    for (let entryIndex = group.entries.length - 1; entryIndex >= 0; entryIndex -= 1) {
      const entry = group.entries[entryIndex]!;
      if (entry.part.type !== "reasoning") continue;
      if (group.showReasoningSummaries === false) return null;
      const text = messageText(entry.message, entry.part).trim();
      if (!text) continue;
      const line = createReasoningTitle(text)
        .replace(/`+|\*\*|~~/g, "")
        .replace(/\s+/g, " ")
        .trim();
      if (!line) continue;
      return line.length > MAX_THOUGHT_LENGTH ? `${line.slice(0, MAX_THOUGHT_LENGTH - 1)}…` : line;
    }
  }
  return null;
}
