import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  emptyComposerDraft,
  insertComposerFileMention,
  type ComposerDraft,
} from "../lib/composer-draft";
import { COMPOSER_FRAGMENT_TYPE } from "../lib/composer-paste";
import type { ReviewComment } from "../lib/review-comments";
import {
  ComposerInput,
  type ComposerDraftChange,
  type ComposerInputHandle,
} from "./composer-input";
import type { ComposerEditorElement } from "../lib/composer-editor-element";

afterEach(cleanup);

const text = (value: string): ComposerDraft => ({ ...emptyComposerDraft(), text: value });

/** The editor with a parent that keeps its draft, as the composer's field does. */
function renderInput(initial: ComposerDraft, options: { plain?: boolean } = {}) {
  const handle = createRef<ComposerInputHandle>();
  const changes: ComposerDraftChange[] = [];
  const onKeyDown = vi.fn();
  const onPaste = vi.fn();
  const controls: {
    draft: ComposerDraft;
    setDraft(draft: ComposerDraft): void;
    setPlain(plain: boolean): void;
    comments: ReviewComment[];
    setComments(comments: ReviewComment[]): void;
  } = {} as never;
  function Harness() {
    const [draft, setDraft] = useState(initial);
    const [comments, setComments] = useState<ReviewComment[]>([]);
    const [plain, setPlain] = useState(Boolean(options.plain));
    Object.assign(controls, { draft, setDraft, setPlain, comments, setComments });
    return (
      <ComposerInput
        ref={handle}
        draft={draft}
        comments={comments}
        plain={plain}
        aria-label="Message Palot"
        placeholder="Do anything"
        onDraftChange={(next, change) => {
          changes.push(change);
          setDraft(next);
        }}
        onCommentsChange={setComments}
        onSelectionChange={() => undefined}
        onKeyDown={onKeyDown}
        onCompositionStart={() => undefined}
        onCompositionEnd={() => undefined}
        onPaste={onPaste}
      />
    );
  }
  render(<Harness />);
  const input = screen.getByRole<ComposerEditorElement>("textbox", { name: "Message Palot" });
  return { input, handle, changes, onKeyDown, onPaste, controls };
}

function external(controls: { setDraft(draft: ComposerDraft): void }, draft: ComposerDraft) {
  act(() => controls.setDraft(draft));
}

function paste(input: HTMLElement, data: Record<string, string>, files: File[] = []) {
  return fireEvent.paste(input, {
    clipboardData: {
      items: files.map((file) => ({ kind: "file", type: file.type, getAsFile: () => file })),
      types: Object.keys(data),
      getData: (type: string) => data[type] ?? "",
    },
  });
}

describe("ComposerInput", () => {
  it("reports typed text, Enter as a new line, and keeps the chips' DOM while typing", async () => {
    const user = userEvent.setup();
    const seeded = insertComposerFileMention(text("See "), 4, "src/a.ts", "file-1").draft;
    const { input, controls, changes } = renderInput(seeded);
    const chip = screen.getByRole("img", { name: "File: @src/a.ts" });

    await user.type(input, "now{Enter}next");

    expect(controls.draft.text).toBe("See @src/a.ts now\nnext");
    expect(controls.draft.mentions).toMatchObject([{ localID: "file-1", start: 4, end: 13 }]);
    expect(changes.every((change) => !change.pasted)).toBe(true);
    // Typing edits the document in place; it is never rebuilt from the draft.
    expect(screen.getByRole("img", { name: "File: @src/a.ts" })).toBe(chip);
  });

  it("keeps composition text alone and applies an outside change once composition ends", async () => {
    const { input, controls } = renderInput(text("Draft"));
    fireEvent.compositionStart(input);
    external(controls, text("Recalled prompt"));
    expect(input.value).toBe("Draft");
    // Typed text during composition is the browser's; the editor does not take it.
    const composing = new InputEvent("beforeinput", {
      inputType: "insertText",
      data: "か",
      isComposing: true,
      cancelable: true,
    });
    input.dispatchEvent(composing);
    expect(composing.defaultPrevented).toBe(false);
    fireEvent.compositionEnd(input);
    await waitFor(() => expect(input.value).toBe("Recalled prompt"));
  });

  it("moves over and removes a chip in one step and names it for assistive technology", async () => {
    const user = userEvent.setup();
    const { input, controls, handle } = renderInput(text("Check "));
    external(controls, insertComposerFileMention(controls.draft, 6, "src/a.ts", "file-1").draft);
    act(() => {
      input.focus();
      handle.current!.setSelectionRange(15, 15);
    });

    expect(screen.getByRole("img", { name: "File: @src/a.ts" })).toBeTruthy();
    await user.keyboard("{ArrowLeft}");
    expect(handle.current!.selectionStart).toBe(6);
    await user.keyboard("{ArrowRight}{Backspace}");
    expect(controls.draft).toEqual(text("Check  "));
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("turns a selected file chip back into text with Enter instead of sending", async () => {
    const user = userEvent.setup();
    const { input, controls, handle, onKeyDown } = renderInput(text("Read "));
    external(controls, insertComposerFileMention(controls.draft, 5, "src/a.ts", "file-1").draft);
    act(() => {
      input.focus();
      handle.current!.setSelectionRange(5, 14);
    });
    await user.keyboard("{Enter}");

    expect(onKeyDown).not.toHaveBeenCalledWith(expect.objectContaining({ key: "Enter" }));
    expect(controls.draft.text).toBe("Read @src/a.ts ");
    expect(controls.draft.mentions).toEqual([]);
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("undoes typing, then an inserted chip, then earlier typing, and redoes them", async () => {
    const user = userEvent.setup();
    const { input, controls, handle } = renderInput(emptyComposerDraft());
    await user.type(input, "Hello ");
    external(controls, insertComposerFileMention(controls.draft, 6, "a.ts", "file-1").draft);
    act(() => handle.current!.setSelectionRange(12, 12));
    await user.type(input, "world", { skipClick: true });
    expect(input.value).toBe("Hello @a.ts world");

    await user.keyboard("{Control>}z{/Control}");
    expect(input.value).toBe("Hello @a.ts ");
    await user.keyboard("{Control>}z{/Control}");
    expect(controls.draft).toEqual(text("Hello "));
    await user.keyboard("{Control>}{Shift>}z{/Shift}{/Control}");
    expect(controls.draft.mentions).toMatchObject([{ localID: "file-1", value: "a.ts" }]);
    expect(screen.getByRole("img", { name: "File: @a.ts" })).toBeTruthy();
  });

  it("replaces the document for a recalled prompt in the same element", () => {
    const { input, controls } = renderInput(text("Work in progress"));
    const recalled = insertComposerFileMention(text("Fix "), 4, "src/b.ts", "file-2").draft;
    external(controls, recalled);
    expect(screen.getByRole("textbox", { name: "Message Palot" })).toBe(input);
    expect(input.value).toBe("Fix @src/b.ts ");
    expect(screen.getByRole("img", { name: "File: @src/b.ts" })).toBeTruthy();
    external(controls, emptyComposerDraft());
    expect(input.value).toBe("");
  });

  it("pastes plain text, PR links as chips, and nothing from rich content alone", () => {
    const { input, controls, changes, onPaste } = renderInput(emptyComposerDraft());
    paste(input, { "text/html": "<b>bold</b>" });
    expect(input.value).toBe("");
    paste(input, {
      "text/plain": "Review https://github.com/acme/repo/pull/7 please",
      "text/html": "<a>x</a>",
    });
    expect(controls.draft.text).toBe("Review https://github.com/acme/repo/pull/7 please");
    expect(screen.getByRole("img", { name: "Pull request: PR #7" })).toBeTruthy();
    expect(changes.at(-1)).toEqual({ pasted: true });
    // The composer's own rules see the paste first.
    expect(onPaste).toHaveBeenCalledTimes(2);
  });

  it("pastes as plain text with Mod+Shift+V and skips the attachment rules", async () => {
    const user = userEvent.setup();
    const { input, onPaste } = renderInput(emptyComposerDraft());
    await user.click(input);
    await user.keyboard("{Control>}{Shift>}v{/Shift}{/Control}");
    paste(input, { "text/plain": "https://github.com/acme/repo/pull/7" });
    expect(input.value).toBe("https://github.com/acme/repo/pull/7");
    expect(screen.queryByRole("img")).toBeNull();
    expect(onPaste).not.toHaveBeenCalled();
  });

  it("makes a Markdown link of a URL pasted over selected text", () => {
    const { input, handle } = renderInput(text("Read the docs first"));
    act(() => handle.current!.setSelectionRange(9, 13));
    paste(input, { "text/plain": "https://example.com/docs" });
    expect(input.value).toBe("Read the [docs](https://example.com/docs) first");
  });

  it("copies and pastes chips within the composer with fresh identities", () => {
    const { input, controls } = renderInput(emptyComposerDraft());
    const copied = insertComposerFileMention(text("Use "), 4, "src/a.ts", "file-1").draft;
    paste(input, {
      "text/plain": copied.text,
      [COMPOSER_FRAGMENT_TYPE]: JSON.stringify({ draft: copied, comments: [] }),
    });
    expect(controls.draft.text).toBe(copied.text);
    expect(controls.draft.mentions).toMatchObject([{ kind: "file", value: "src/a.ts" }]);
    expect(controls.draft.mentions[0]!.localID).not.toBe("file-1");

    // Copying writes both the text and the fragment.
    const data = new Map<string, string>();
    act(() => {
      (input as ComposerEditorElement).setSelectionRange(0, copied.text.length);
    });
    fireEvent.copy(input, {
      clipboardData: { setData: (type: string, value: string) => data.set(type, value) },
    });
    expect(data.get("text/plain")).toBe(copied.text);
    expect(JSON.parse(data.get(COMPOSER_FRAGMENT_TYPE)!).draft.mentions).toHaveLength(1);
  });

  it("is the same editor in shell mode, without chips or styling", () => {
    const pr = "gh pr view https://github.com/acme/repo/pull/7";
    const { input, controls } = renderInput(text(pr), { plain: true });
    expect(screen.queryByRole("img")).toBeNull();
    expect(input.hasAttribute("data-plain")).toBe(true);
    expect(input.getAttribute("spellcheck")).toBe("false");
    paste(input, { "text/plain": " && @src" });
    expect(controls.draft.mentions).toEqual([]);
    act(() => controls.setPlain(false));
    expect(screen.getByRole("textbox", { name: "Message Palot" })).toBe(input);
    expect(screen.getByRole("img", { name: "Pull request: PR #7" })).toBeTruthy();
  });

  it("keeps a textarea's scripting surface: value, selection and placeholder", () => {
    const { input, controls } = renderInput(text("abc"));
    expect(input.placeholder).toBe("Do anything");
    fireEvent.change(input, { target: { value: "abcdef", selectionStart: 2, selectionEnd: 4 } });
    expect(controls.draft.text).toBe("abcdef");
    expect([input.selectionStart, input.selectionEnd]).toEqual([2, 4]);
  });
});
