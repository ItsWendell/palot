import { describe, expect, it } from "vitest";
import type { PalotMessage } from "../../shared";
import type { ComposerDraft } from "./composer-draft";
import {
  IDLE_HISTORY_CURSOR,
  composerHistoryEntry,
  mergeComposerHistory,
  navigateComposerHistory,
  normalPromptHistory,
  shellCommandHistory,
  swapHistoryContext,
  type ComposerHistoryCursor,
  type ComposerHistoryEntry,
} from "./composer-history";

function message(
  id: string,
  type: string,
  text: string | null,
  data: PalotMessage["data"] = null,
): PalotMessage {
  return {
    id,
    type,
    createdAt: 1,
    completedAt: 1,
    text,
    agent: null,
    model: null,
    tokens: null,
    finish: null,
    content: [],
    data,
  };
}

const plain = (text: string): ComposerDraft => ({ text, mentions: [], command: null });
const entry = (text: string, createdAt = 0) => composerHistoryEntry(plain(text), { createdAt });

describe("composer history sources", () => {
  it("lists user prompts newest first, skipping blanks, non-user messages, and repeats", () => {
    const history = normalPromptHistory([
      message("1", "user", "Older"),
      message("2", "assistant", "Reply"),
      message("3", "user", "  "),
      message("4", "user", "Newer"),
      message("5", "user", "Newer"),
      message("6", "shell", null, { command: "ls" }),
    ]);
    expect(history.map((item) => item.draft.text)).toEqual(["Newer", "Older"]);
  });

  it("recalls file mentions with the prompt text", () => {
    const [recalled] = normalPromptHistory([
      {
        ...message("1", "user", "Read @src/app.ts"),
        fileReferences: [
          {
            uri: "file:///workspace/src/app.ts",
            name: "app.ts",
            mention: { start: 5, end: 16, text: "@src/app.ts" },
          },
        ],
      },
    ]);
    expect(recalled?.draft.mentions).toEqual([
      expect.objectContaining({ kind: "file", value: "src/app.ts", start: 5, end: 16 }),
    ]);
  });

  it("restores embedded attachments and line comments but never local or remote file sources", () => {
    const [recalled] = normalPromptHistory([
      message("1", "user", "Look", {
        files: [
          { name: "shot.png", mime: "image/png", data: "aGk=" },
          { name: "local.txt", mime: "text/plain", source: { uri: "file:///Users/me/local.txt" } },
          { name: "remote.pdf", mime: "application/pdf", uri: "https://example.com/remote.pdf" },
        ],
        metadata: {
          displayText: "Look",
          comments: [
            {
              path: "src/a.ts",
              comment: "Why?",
              selection: { startLine: 1, startChar: 0, endLine: 2, endChar: 0 },
            },
          ],
        },
      }),
    ]);
    expect(recalled?.draft.text).toBe("Look");
    expect(recalled?.files).toEqual([
      expect.objectContaining({ name: "shot.png", uri: "data:image/png;base64,aGk=" }),
    ]);
    expect(recalled?.omittedFiles).toEqual(["local.txt", "remote.pdf"]);
    expect(recalled?.comments).toEqual([
      expect.objectContaining({ path: "src/a.ts", comment: "Why?" }),
    ]);
  });

  it("merges remembered prompts with the session's, newest first and without repeats", () => {
    const remembered = [
      composerHistoryEntry(plain("shared"), { createdAt: 5, omittedFiles: ["kept.png"] }),
      entry("other task", 3),
    ];
    const session = [entry("latest here", 9), entry("shared", 5), entry("old", 1)];
    const merged = mergeComposerHistory(remembered, session);
    expect(merged.map((item) => item.draft.text)).toEqual([
      "latest here",
      "shared",
      "other task",
      "old",
    ]);
    // On equal time the remembered entry, which keeps richer context, wins.
    expect(merged[1]?.omittedFiles).toEqual(["kept.png"]);
  });

  it("puts locally submitted shell commands first and drops duplicates", () => {
    const history = shellCommandHistory(
      [
        message("1", "shell", null, { command: "pwd" }),
        message("2", "user", "not a command"),
        message("3", "shell", null, { command: "ls" }),
      ],
      ["git status", "ls"],
    );
    expect(history.map((item) => item.draft.text)).toEqual(["git status", "ls", "pwd"]);
  });
});

describe("navigateComposerHistory", () => {
  const entries = [entry("newest"), entry("older")];

  function step(
    direction: "up" | "down",
    current: ComposerHistoryEntry,
    caret: number,
    cursor: ComposerHistoryCursor,
  ) {
    return navigateComposerHistory({
      direction,
      current,
      selectionStart: caret,
      selectionEnd: caret,
      entries,
      cursor,
    });
  }

  it("walks back from an empty draft and forward to the saved draft", () => {
    const first = step("up", entry(""), 0, IDLE_HISTORY_CURSOR);
    expect(first?.entry.draft.text).toBe("newest");
    const second = step("up", first!.entry, 0, first!.cursor);
    expect(second?.entry.draft.text).toBe("older");
    expect(step("up", second!.entry, 0, second!.cursor)).toBeNull();

    const forward = step("down", second!.entry, second!.entry.draft.text.length, second!.cursor);
    expect(forward?.entry.draft.text).toBe("newest");
    const restored = step("down", forward!.entry, 0, forward!.cursor);
    expect(restored?.entry.draft.text).toBe("");
    expect(restored?.cursor).toEqual(IDLE_HISTORY_CURSOR);
  });

  it("leaves a draft alone unless the caret is collapsed at its start", () => {
    const current = entry("half typed");
    expect(step("up", current, current.draft.text.length, IDLE_HISTORY_CURSOR)).toBeNull();
    expect(step("up", current, 3, IDLE_HISTORY_CURSOR)).toBeNull();
    expect(
      navigateComposerHistory({
        direction: "up",
        current,
        selectionStart: 0,
        selectionEnd: 4,
        entries,
        cursor: IDLE_HISTORY_CURSOR,
      }),
    ).toBeNull();
    expect(step("down", current, 0, IDLE_HISTORY_CURSOR)).toBeNull();

    const recalled = step("up", current, 0, IDLE_HISTORY_CURSOR);
    expect(recalled?.entry.draft.text).toBe("newest");
    expect(step("down", recalled!.entry, 0, recalled!.cursor)?.entry).toBe(current);
  });

  it("keeps the in-progress context to restore when leaving history", () => {
    const file = { uri: "attachment:draft", name: "draft.txt", mime: "text/plain", size: 1 };
    const current = composerHistoryEntry(plain(""), { files: [file] });
    const recalled = step("up", current, 0, IDLE_HISTORY_CURSOR)!;
    expect(recalled.entry.files).toEqual([]);
    const back = step("down", recalled.entry, 0, recalled.cursor)!;
    expect(back.entry.files).toEqual([file]);
  });

  it("keeps browsing only from either edge of a recalled entry", () => {
    const recalled = step("up", entry(""), 0, IDLE_HISTORY_CURSOR)!;
    expect(step("up", recalled.entry, 3, recalled.cursor)).toBeNull();
    expect(step("down", recalled.entry, 3, recalled.cursor)).toBeNull();
  });

  it("does nothing without history", () => {
    expect(
      navigateComposerHistory({
        direction: "up",
        current: entry(""),
        selectionStart: 0,
        selectionEnd: 0,
        entries: [],
        cursor: IDLE_HISTORY_CURSOR,
      }),
    ).toBeNull();
  });
});

describe("swapHistoryContext", () => {
  const key = (value: string) => value;

  it("replaces the shown entry's items and keeps ones added from elsewhere", () => {
    expect(swapHistoryContext(["a", "b", "external"], ["a", "b"], ["c"], key)).toEqual([
      "c",
      "external",
    ]);
  });

  it("does not duplicate items the next entry already has", () => {
    expect(swapHistoryContext(["a", "x"], ["a"], ["x"], key)).toEqual(["x"]);
  });
});
