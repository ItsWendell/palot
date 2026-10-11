import { describe, expect, it } from "vitest";
import type { PalotMessage, PalotMessageContent } from "../../shared";
import {
  findTranscriptMatches,
  initialTranscriptMatch,
  preservedTranscriptMatch,
  stepTranscriptMatch,
  transcriptFindPartKey,
} from "./transcript-search";
import type { TranscriptProjectionRow, TranscriptTurn, TurnActivityGroup } from "./turn-projection";

function message(id: string, type: string, content: PalotMessageContent[]): PalotMessage {
  return {
    id,
    type,
    createdAt: 1,
    completedAt: 2,
    text: null,
    agent: null,
    model: null,
    tokens: null,
    finish: null,
    content,
  } as PalotMessage;
}

function text(id: string, value: string): PalotMessageContent {
  return { id, type: "text", text: value };
}

function row(
  id: string,
  {
    user,
    activity = [],
    final,
    kind = "conversation",
  }: {
    user?: PalotMessage;
    activity?: TurnActivityGroup[];
    final?: PalotMessage;
    kind?: TranscriptTurn["kind"];
  },
): TranscriptProjectionRow {
  const turn = {
    id,
    kind,
    user: user ?? null,
    users: user ? [user] : [],
    activity,
    blockingRequests: [],
    final: final ? { message: final, part: final.content[0]!, index: 0 } : null,
    postFinal: [],
    tokensPerSecond: null,
    status: "completed",
    startedAt: 1,
    finalStartedAt: null,
    workCompletedAt: null,
    completedAt: 2,
    canCollapse: true,
    shouldAutoCollapse: true,
  } satisfies TranscriptTurn;
  return { id, turn };
}

function contentGroup(source: PalotMessage): TurnActivityGroup {
  return {
    id: `${source.id}:content`,
    kind: "content",
    title: "",
    status: "completed",
    entries: source.content.map((part, index) => ({ message: source, part, index })),
  };
}

function toolGroup(source: PalotMessage): TurnActivityGroup {
  return {
    id: `${source.id}:tools`,
    kind: "tools",
    title: "Ran tools",
    status: "completed",
    entries: source.content.map((part, index) => ({ message: source, part, index })),
  };
}

describe("findTranscriptMatches", () => {
  const rows = [
    row("turn-1", {
      user: message("u1", "user", [text("u1-p", "Fix the Parser bug")]),
      final: message("a1", "assistant", [text("a1-p", "The parser now handles PARSER input.")]),
    }),
    row("turn-2", {
      user: message("u2", "user", [text("u2-p", "Unrelated")]),
      activity: [
        contentGroup(message("a2", "assistant", [text("a2-p", "Checking parser tests")])),
        toolGroup(
          message("a3", "assistant", [
            { id: "tool", type: "tool", text: "parser output in a tool" },
            { id: "thinking", type: "reasoning", text: "parser reasoning" },
          ]),
        ),
      ],
      final: message("a4", "assistant", [text("a4-p", "Done.")]),
    }),
    row("turn-3", {
      kind: "shell",
      user: message("u3", "user", [text("u3-p", "parser in a shell turn")]),
    }),
  ];

  it("finds case-insensitive matches in transcript order across user, activity, and final text", () => {
    const { matches, truncated } = findTranscriptMatches(rows, "  PaRsEr ");
    expect(truncated).toBe(false);
    expect(
      matches.map((match) => [match.turnID, match.partKey, match.location, match.occurrence]),
    ).toEqual([
      ["turn-1", "u1:u1-p", "user", 0],
      ["turn-1", "a1:a1-p", "final", 0],
      ["turn-1", "a1:a1-p", "final", 1],
      ["turn-2", "a2:a2-p", "activity", 0],
    ]);
    expect(matches.map((match) => match.turnIndex)).toEqual([0, 0, 0, 1]);
  });

  it("does not search tool calls, reasoning, or shell turns", () => {
    expect(findTranscriptMatches(rows, "tool").matches).toEqual([]);
    expect(findTranscriptMatches(rows, "reasoning").matches).toEqual([]);
    expect(findTranscriptMatches(rows, "shell").matches).toEqual([]);
  });

  it("counts non-overlapping occurrences", () => {
    const repeated = [row("t", { user: message("u", "user", [text("p", "aaaa")]) })];
    expect(findTranscriptMatches(repeated, "aa").matches.map((match) => match.occurrence)).toEqual([
      0, 1,
    ]);
  });

  it("returns nothing for a blank query and truncates at the limit", () => {
    expect(findTranscriptMatches(rows, "   ").matches).toEqual([]);
    const limited = findTranscriptMatches(rows, "parser", 2);
    expect(limited.matches).toHaveLength(2);
    expect(limited.truncated).toBe(true);
  });

  it("reads message text when a message has no content parts", () => {
    const bare = { ...message("u", "user", []), text: "Plain prompt" } as PalotMessage;
    const matches = findTranscriptMatches([row("t", { user: bare })], "plain").matches;
    expect(matches.map((match) => match.partKey)).toEqual(["u:-1"]);
  });

  it("keys parts by id or by their position in the message", () => {
    const anonymous: PalotMessageContent = { type: "text", text: "second" };
    const source = message("m", "assistant", [text("first", "first"), anonymous]);
    expect(transcriptFindPartKey(source, source.content[0]!)).toBe("m:first");
    expect(transcriptFindPartKey(source, anonymous)).toBe("m:1");
  });
});

describe("match navigation", () => {
  it("wraps forward and backward", () => {
    expect(stepTranscriptMatch(2, 3, "next")).toBe(0);
    expect(stepTranscriptMatch(0, 3, "previous")).toBe(2);
    expect(stepTranscriptMatch(1, 3, "next")).toBe(2);
    expect(stepTranscriptMatch(-1, 3, "previous")).toBe(2);
    expect(stepTranscriptMatch(-1, 3, "next")).toBe(0);
    expect(stepTranscriptMatch(0, 0, "next")).toBe(-1);
  });

  const at = (turnIndex: number, occurrence = 0) => ({
    turnIndex,
    turnID: `turn-${turnIndex}`,
    partKey: `part-${turnIndex}`,
    location: "final" as const,
    occurrence,
  });

  it("starts at the first match at or after the turn being read, wrapping to the start", () => {
    const matches = [at(1), at(4), at(4, 1), at(9)];
    expect(initialTranscriptMatch(matches, null)).toBe(0);
    expect(initialTranscriptMatch(matches, 3)).toBe(1);
    expect(initialTranscriptMatch(matches, 4)).toBe(1);
    expect(initialTranscriptMatch(matches, 10)).toBe(0);
    expect(initialTranscriptMatch([], 2)).toBe(-1);
  });

  it("keeps the selected match when earlier history is prepended", () => {
    const selected = at(4, 1);
    const shifted = [at(0), at(2), at(6), { ...selected, turnIndex: 6 }].map((match, index) =>
      index === 3 ? match : { ...match, turnID: `older-${index}` },
    );
    expect(preservedTranscriptMatch(shifted, selected, 2)).toBe(3);
    expect(preservedTranscriptMatch([at(1)], selected, 5)).toBe(0);
    expect(preservedTranscriptMatch([], selected, 0)).toBe(-1);
  });
});
