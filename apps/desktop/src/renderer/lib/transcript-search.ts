/**
 * Find in task: data-side match computation over projected transcript turns.
 *
 * Matches come from turn data rather than the DOM so virtualized, off-screen turns
 * still count. The DOM side (`transcript-search-dom.ts`) maps a match back to rendered
 * text through the `data-transcript-find-part` key on each rendered text part.
 */
import type { PalotMessage, PalotMessageContent } from "../../shared";
import type { TranscriptProjectionRow, TranscriptTurn } from "./turn-projection";
import { isTool, messageText } from "./view-models";

/** Upper bound for counted matches; very short queries in long tasks stop here. */
export const MAX_TRANSCRIPT_FIND_MATCHES = 5_000;

/** Where a searchable part renders. Activity text sits inside the turn's disclosure. */
export type TranscriptFindLocation = "user" | "activity" | "final";

export interface TranscriptFindSegment {
  partKey: string;
  location: TranscriptFindLocation;
  lower: string;
}

export interface TranscriptFindMatch {
  turnIndex: number;
  turnID: string;
  partKey: string;
  location: TranscriptFindLocation;
  /** Zero-based occurrence within all rendered text that shares `partKey`. */
  occurrence: number;
}

export interface TranscriptFindResult {
  matches: TranscriptFindMatch[];
  truncated: boolean;
}

/**
 * Markdown text rendered for a message part, or null for parts rendered as tools,
 * reasoning, compaction, or boundaries. Shared with the transcript renderer so search
 * and display agree on which parts show text.
 */
export function transcriptPartText(
  message: PalotMessage,
  part: PalotMessageContent,
): string | null {
  if (
    isTool(part) ||
    part.type === "compaction" ||
    part.type === "timeline-boundary" ||
    part.type === "reasoning"
  )
    return null;
  return messageText(message, part) || null;
}

/** Stable key that ties a searchable part to its rendered element. */
export function transcriptFindPartKey(message: PalotMessage, part: PalotMessageContent): string {
  return `${message.id}:${part.id ?? message.content.indexOf(part)}`;
}

function messageParts(message: PalotMessage): PalotMessageContent[] {
  return message.content.length > 0
    ? message.content
    : [{ type: "text", text: message.text ?? "" }];
}

function pushPart(
  segments: TranscriptFindSegment[],
  message: PalotMessage,
  part: PalotMessageContent,
  location: TranscriptFindLocation,
) {
  const text = transcriptPartText(message, part);
  if (!text) return;
  segments.push({
    partKey: transcriptFindPartKey(message, part),
    location,
    lower: text.toLowerCase(),
  });
}

const segmentCache = new WeakMap<TranscriptTurn, TranscriptFindSegment[]>();

/**
 * Searchable text of one turn in render order: the user prompt, assistant text and
 * queued user input inside the turn's activity, then the final response. Tool calls,
 * tool output, reasoning, shell results, and subagent responses are not searched.
 * Cached by turn identity so streaming only re-reads the turn that changed.
 */
export function transcriptTurnSegments(turn: TranscriptTurn): TranscriptFindSegment[] {
  const cached = segmentCache.get(turn);
  if (cached) return cached;
  const segments: TranscriptFindSegment[] = [];
  if (turn.kind !== "shell") {
    if (turn.user) {
      for (const part of messageParts(turn.user)) pushPart(segments, turn.user, part, "user");
    }
    for (const group of turn.activity) {
      if (group.kind === "content") {
        for (const entry of group.entries) {
          pushPart(segments, entry.message, entry.part, "activity");
        }
      } else if (group.kind === "input") {
        for (const message of group.messages ?? []) {
          for (const part of messageParts(message)) pushPart(segments, message, part, "activity");
        }
      }
    }
    if (turn.final) pushPart(segments, turn.final.message, turn.final.part, "final");
  }
  segmentCache.set(turn, segments);
  return segments;
}

/** Normalized search query, or an empty string when nothing should be searched. */
export function normalizeTranscriptQuery(query: string): string {
  return query.trim().toLowerCase();
}

/**
 * Non-overlapping, case-insensitive substring matches in transcript order:
 * turn order, then render order inside a turn, then position inside the part.
 */
export function findTranscriptMatches(
  rows: readonly TranscriptProjectionRow[],
  query: string,
  limit = MAX_TRANSCRIPT_FIND_MATCHES,
): TranscriptFindResult {
  const needle = normalizeTranscriptQuery(query);
  const matches: TranscriptFindMatch[] = [];
  if (!needle) return { matches, truncated: false };
  for (let turnIndex = 0; turnIndex < rows.length; turnIndex += 1) {
    const row = rows[turnIndex]!;
    const occurrences = new Map<string, number>();
    for (const segment of transcriptTurnSegments(row.turn)) {
      let at = segment.lower.indexOf(needle);
      while (at !== -1) {
        const occurrence = occurrences.get(segment.partKey) ?? 0;
        occurrences.set(segment.partKey, occurrence + 1);
        if (matches.length >= limit) return { matches, truncated: true };
        matches.push({
          turnIndex,
          turnID: row.id,
          partKey: segment.partKey,
          location: segment.location,
          occurrence,
        });
        at = segment.lower.indexOf(needle, at + needle.length);
      }
    }
  }
  return { matches, truncated: false };
}

/** Wrapping step through matches, like browser find. */
export function stepTranscriptMatch(
  current: number,
  count: number,
  direction: "next" | "previous",
): number {
  if (count <= 0) return -1;
  if (current < 0 || current >= count) return direction === "next" ? 0 : count - 1;
  return (current + (direction === "next" ? 1 : -1) + count) % count;
}

/**
 * First match at or after `anchorTurnIndex` (the turn being read), wrapping to the
 * first match. Typing therefore searches forward from where the reader is.
 */
export function initialTranscriptMatch(
  matches: readonly TranscriptFindMatch[],
  anchorTurnIndex: number | null,
): number {
  if (matches.length === 0) return -1;
  if (anchorTurnIndex === null) return 0;
  const index = matches.findIndex((match) => match.turnIndex >= anchorTurnIndex);
  return index === -1 ? 0 : index;
}

export function sameTranscriptMatch(
  left: TranscriptFindMatch | null | undefined,
  right: TranscriptFindMatch | null | undefined,
): boolean {
  return Boolean(
    left &&
    right &&
    left.turnID === right.turnID &&
    left.partKey === right.partKey &&
    left.occurrence === right.occurrence,
  );
}

/** Keeps the same match selected while streaming or history loads change the list. */
export function preservedTranscriptMatch(
  matches: readonly TranscriptFindMatch[],
  previous: TranscriptFindMatch | null,
  previousIndex: number,
): number {
  if (matches.length === 0) return -1;
  if (previous) {
    const index = matches.findIndex((match) => sameTranscriptMatch(match, previous));
    if (index !== -1) return index;
  }
  return Math.min(Math.max(previousIndex, 0), matches.length - 1);
}
