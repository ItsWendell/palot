import { createStore } from "jotai";
import { describe, expect, it } from "vitest";
import { composerStateAtomFamily } from "../../atoms/composer-state";
import { composerDraftAtomFamily } from "../../atoms/ui";
import { emptyComposerDraft, insertComposerFileMention } from "../../lib/composer-draft";
import { composerScope } from "../../lib/composer-scope";
import { quoteTerminalInComposer, terminalQuote } from "./terminal-quote";

describe("terminal quotes", () => {
  it("fences literal output containing backticks and preserves indentation and blank lines", () => {
    expect(terminalQuote("  failed\n\n```\n✓")).toBe(
      "> Terminal output\n>\n> ````text\n>   failed\n> \n> ```\n> ✓\n> ````\n\n",
    );
    expect(terminalQuote(" \n\t")).toBeNull();
  });

  it("appends to only the target profile's task draft without losing mention offsets", () => {
    const store = createStore();
    const scope = composerScope("terminal-profile", "session:target");
    const other = composerDraftAtomFamily(composerScope("other", "session:target"));
    const target = composerDraftAtomFamily(scope);
    const original = insertComposerFileMention(emptyComposerDraft(), 0, "file.ts", "file").draft;
    store.set(target, original);
    store.set(other, { ...emptyComposerDraft(), text: "Leave alone" });
    expect(quoteTerminalInComposer(store, "terminal-profile", "target", "error")).toBe(true);
    expect(store.get(target).text).toBe(`${original.text}\n\n${terminalQuote("error")}`);
    expect(store.get(target).mentions).toEqual(original.mentions);
    expect(store.get(other).text).toBe("Leave alone");
  });

  it("quotes into the active pending edit and refuses to mutate a sending composer", () => {
    const store = createStore();
    const scope = composerScope("terminal-profile", "session:edit");
    const state = composerStateAtomFamily(scope);
    const draft = composerDraftAtomFamily(scope);
    store.set(draft, { ...emptyComposerDraft(), text: "Parked draft" });
    store.set(state, (current) => ({
      ...current,
      edit: {
        id: "pending",
        delivery: "queue",
        draft: { ...emptyComposerDraft(), text: "Edit" },
        files: [],
        comments: [],
      },
    }));
    expect(quoteTerminalInComposer(store, "terminal-profile", "edit", "stderr")).toBe(true);
    expect(store.get(state).edit?.draft.text).toBe(`Edit\n\n${terminalQuote("stderr")}`);
    expect(store.get(draft).text).toBe("Parked draft");
    store.set(state, (current) => ({ ...current, sending: true }));
    const before = store.get(state);
    expect(quoteTerminalInComposer(store, "terminal-profile", "edit", "lost")).toBe(false);
    expect(store.get(state)).toBe(before);
  });
});
