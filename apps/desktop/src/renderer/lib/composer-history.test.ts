import { describe, expect, it } from "vitest";
import type { PalotMessage } from "../../shared";
import type { ComposerDraft } from "./composer-draft";
import {
  IDLE_HISTORY_CURSOR,
  navigateComposerHistory,
  normalPromptHistory,
  shellCommandHistory,
  type ComposerHistoryCursor,
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
    expect(history.map((draft) => draft.text)).toEqual(["Newer", "Older"]);
  });

  it("recalls file mentions with the prompt text", () => {
    const [draft] = normalPromptHistory([
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
    expect(draft?.mentions).toEqual([
      expect.objectContaining({ kind: "file", value: "src/app.ts", start: 5, end: 16 }),
    ]);
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
    expect(history.map((draft) => draft.text)).toEqual(["git status", "ls", "pwd"]);
  });
});

describe("navigateComposerHistory", () => {
  const entries = [plain("newest"), plain("older")];

  function step(
    direction: "up" | "down",
    draft: ComposerDraft,
    caret: number,
    cursor: ComposerHistoryCursor,
  ) {
    return navigateComposerHistory({
      direction,
      draft,
      selectionStart: caret,
      selectionEnd: caret,
      entries,
      cursor,
    });
  }

  it("walks back from an empty draft and forward to the saved draft", () => {
    const first = step("up", plain(""), 0, IDLE_HISTORY_CURSOR);
    expect(first?.draft.text).toBe("newest");
    const second = step("up", first!.draft, 0, first!.cursor);
    expect(second?.draft.text).toBe("older");
    expect(step("up", second!.draft, 0, second!.cursor)).toBeNull();

    const forward = step("down", second!.draft, second!.draft.text.length, second!.cursor);
    expect(forward?.draft.text).toBe("newest");
    const restored = step("down", forward!.draft, 0, forward!.cursor);
    expect(restored?.draft.text).toBe("");
    expect(restored?.cursor).toEqual(IDLE_HISTORY_CURSOR);
  });

  it("leaves a draft alone unless the caret is collapsed at its start", () => {
    const draft = plain("half typed");
    expect(step("up", draft, draft.text.length, IDLE_HISTORY_CURSOR)).toBeNull();
    expect(step("up", draft, 3, IDLE_HISTORY_CURSOR)).toBeNull();
    expect(
      navigateComposerHistory({
        direction: "up",
        draft,
        selectionStart: 0,
        selectionEnd: 4,
        entries,
        cursor: IDLE_HISTORY_CURSOR,
      }),
    ).toBeNull();
    expect(step("down", draft, 0, IDLE_HISTORY_CURSOR)).toBeNull();

    const recalled = step("up", draft, 0, IDLE_HISTORY_CURSOR);
    expect(recalled?.draft.text).toBe("newest");
    expect(step("down", recalled!.draft, 0, recalled!.cursor)?.draft).toBe(draft);
  });

  it("keeps browsing only from either edge of a recalled entry", () => {
    const recalled = step("up", plain(""), 0, IDLE_HISTORY_CURSOR)!;
    expect(step("up", recalled.draft, 3, recalled.cursor)).toBeNull();
    expect(step("down", recalled.draft, 3, recalled.cursor)).toBeNull();
  });

  it("does nothing without history", () => {
    expect(
      navigateComposerHistory({
        direction: "up",
        draft: plain(""),
        selectionStart: 0,
        selectionEnd: 0,
        entries: [],
        cursor: IDLE_HISTORY_CURSOR,
      }),
    ).toBeNull();
  });
});
