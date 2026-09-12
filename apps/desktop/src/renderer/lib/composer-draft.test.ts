import { describe, expect, it } from "vitest";
import type { ComposerQuery } from "./composer-query";
import {
  applyComposerTextChange,
  applyComposerTextEdit,
  insertComposerSelection,
  normalizeComposerDraft,
  projectComposerSubmission,
  type ComposerDraft,
  type ComposerMention,
} from "./composer-draft";

function mention(
  localID: string,
  kind: ComposerMention["kind"],
  value: string,
  start: number,
): ComposerMention {
  const text = `${kind === "file" ? "@" : "$"}${value}`;
  return { localID, kind, value, text, start, end: start + text.length };
}

describe("composer draft edits", () => {
  const draft: ComposerDraft = {
    text: "See @src/a.ts with $review",
    mentions: [mention("file-1", "file", "src/a.ts", 4), mention("skill-1", "skill", "review", 19)],
    command: null,
  };

  it("shifts mentions after insertions and deletions before them", () => {
    const inserted = applyComposerTextEdit(draft, { start: 0, end: 0, text: "Please " });
    expect(inserted.mentions.map(({ start, end }) => ({ start, end }))).toEqual([
      { start: 11, end: 20 },
      { start: 26, end: 33 },
    ]);

    const deleted = applyComposerTextEdit(inserted, { start: 0, end: 7, text: "" });
    expect(deleted).toEqual(draft);
  });

  it("invalidates only a mention edited inside its range", () => {
    const next = applyComposerTextEdit(draft, { start: 9, end: 10, text: "b" });
    expect(next.text).toBe("See @src/b.ts with $review");
    expect(next.mentions).toEqual([draft.mentions[1]]);
  });

  it("invalidates a mention when its delimiter is removed", () => {
    expect(applyComposerTextEdit(draft, { start: 4, end: 5, text: "" }).mentions).toHaveLength(1);
  });

  it("derives a focused edit from a textarea value change", () => {
    const next = applyComposerTextChange(draft, "See the @src/a.ts with $review");
    expect(next.mentions.map((item) => item.start)).toEqual([8, 23]);
  });

  it("rejects edits outside the draft", () => {
    expect(() => applyComposerTextEdit(draft, { start: 0, end: 100, text: "" })).toThrow(
      RangeError,
    );
  });
});

describe("composer discovery insertion", () => {
  it.each([
    [
      { kind: "file", start: 4, end: 8, query: "src" } as ComposerQuery,
      { kind: "file", path: "src/auth.ts", localID: "file-1" } as const,
      "See @src/auth.ts ",
    ],
    [
      { kind: "skill", start: 4, end: 8, query: "rev" } as ComposerQuery,
      { kind: "skill", id: "code-review", localID: "skill-1" } as const,
      "Use $code-review ",
    ],
  ])("replaces only the active %s query and creates a mention", (query, selection, expected) => {
    const result = insertComposerSelection(
      { text: query.kind === "file" ? "See @src" : "Use $rev", mentions: [], command: null },
      query,
      selection,
    );

    expect(result.draft.text).toBe(expected);
    expect(result.draft.mentions).toHaveLength(1);
    expect(result.selectionStart).toBe(expected.length);
    expect(result.selectionEnd).toBe(expected.length);
  });

  it("preserves text outside a query and avoids a duplicate separator", () => {
    const result = insertComposerSelection(
      { text: "Use @sr here", mentions: [], command: null },
      { kind: "file", start: 4, end: 7, query: "sr" },
      { kind: "file", path: "src/a.ts", localID: "file-1" },
    );
    expect(result.draft.text).toBe("Use @src/a.ts here");
  });

  it("stores a command identity separately from editable arguments", () => {
    const result = insertComposerSelection(
      { text: "/rev", mentions: [], command: null },
      { kind: "command", start: 0, end: 4, query: "rev" },
      { kind: "command", name: "review" },
    );
    expect(result.draft).toEqual({
      text: "/review ",
      mentions: [],
      command: { name: "review", start: 0, end: 7 },
    });
  });
});

describe("composer command validity", () => {
  const commandDraft: ComposerDraft = {
    text: "/review auth",
    mentions: [],
    command: { name: "review", start: 0, end: 7 },
  };

  it("preserves the command while arguments are edited", () => {
    const next = applyComposerTextEdit(commandDraft, { start: 12, end: 12, text: " flow" });
    expect(next.command).toEqual(commandDraft.command);
  });

  it.each([
    { start: 1, end: 2, text: "x" },
    { start: 0, end: 0, text: "ordinary " },
    { start: 7, end: 8, text: "" },
  ])("downgrades the command when its prefix is no longer valid", (edit) => {
    expect(applyComposerTextEdit(commandDraft, edit).command).toBeNull();
  });
});

describe("projectComposerSubmission", () => {
  it("projects sorted, non-overlapping file and skill references", () => {
    const text = "Use $review on @src/auth.ts";
    const draft: ComposerDraft = {
      text,
      mentions: [
        mention("file-1", "file", "src/auth.ts", 15),
        { ...mention("skill-1", "skill", "review", 4), attachmentText: "Pinned review skill" },
      ],
      command: null,
    };

    expect(projectComposerSubmission(draft)).toEqual({
      kind: "prompt",
      text,
      files: [
        {
          path: "src/auth.ts",
          name: "auth.ts",
          mention: { start: 15, end: 27, text: "@src/auth.ts" },
        },
      ],
      skills: [
        {
          id: "review",
          mention: { start: 4, end: 11, text: "$review" },
          text: "Pinned review skill",
        },
      ],
    });
  });

  it("projects a valid selected command and its raw arguments", () => {
    const draft: ComposerDraft = {
      text: "  /review  auth --deep",
      mentions: [],
      command: { name: "review", start: 2, end: 9 },
    };
    expect(projectComposerSubmission(draft)).toMatchObject({
      kind: "command",
      text: "/review auth --deep",
      command: "review",
      arguments: "auth --deep",
    });
  });

  it("normalizes command mention ranges after leading whitespace", () => {
    const draft: ComposerDraft = {
      text: "  /review @src/auth.ts with $review",
      mentions: [
        mention("file-1", "file", "src/auth.ts", 10),
        mention("skill-1", "skill", "review", 28),
      ],
      command: { name: "review", start: 2, end: 9 },
    };

    expect(projectComposerSubmission(draft)).toEqual({
      kind: "command",
      text: "/review @src/auth.ts with $review",
      command: "review",
      arguments: "@src/auth.ts with $review",
      files: [
        {
          path: "src/auth.ts",
          name: "auth.ts",
          mention: { start: 8, end: 20, text: "@src/auth.ts" },
        },
      ],
      skills: [{ id: "review", mention: { start: 26, end: 33, text: "$review" } }],
    });
  });

  it("downgrades malformed persisted structure to a plain prompt", () => {
    const draft: ComposerDraft = {
      text: "/changed @file.ts",
      mentions: [mention("bad", "file", "other.ts", 9)],
      command: { name: "review", start: 0, end: 7 },
    };
    expect(normalizeComposerDraft(draft)).toEqual({
      text: draft.text,
      mentions: [],
      command: null,
    });
    expect(projectComposerSubmission(draft)).toEqual({
      kind: "prompt",
      text: draft.text,
      files: [],
      skills: [],
    });
  });

  it("never projects overlapping persisted mentions", () => {
    const draft: ComposerDraft = {
      text: "@first.ts@second.ts",
      mentions: [
        { ...mention("first", "file", "first.ts@second.ts", 0) },
        mention("middle", "file", "second", 6),
        mention("last", "file", "second.ts", 9),
      ],
      command: null,
    };

    expect(projectComposerSubmission(draft).files).toHaveLength(1);
  });
});
