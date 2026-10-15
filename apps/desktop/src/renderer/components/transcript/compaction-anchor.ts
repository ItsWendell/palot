import type { TranscriptProjectionRow } from "../../lib/turn-projection";

/**
 * Compaction rows carry `data-palot-compaction="<compaction message ID>"`.
 * Rows are virtualized, so other surfaces jump to one through
 * `transcriptJumpTargetAtom` with the compaction message ID instead of
 * querying the DOM directly.
 */
export function compactionAnchorSelector(messageID: string): string {
  return `[data-palot-compaction="${CSS.escape(messageID)}"]`;
}

/** Index of the turn whose activity contains `messageID`, or -1 when it is not loaded. */
export function turnIndexForMessage(rows: TranscriptProjectionRow[], messageID: string): number {
  return rows.findIndex(
    ({ turn }) =>
      turn.rootBoundary?.entries.some((entry) => entry.message.id === messageID) ||
      turn.activity.some((group) => group.entries.some((entry) => entry.message.id === messageID)),
  );
}
