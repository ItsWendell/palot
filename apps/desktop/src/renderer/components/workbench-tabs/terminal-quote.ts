import type { createStore } from "jotai";
import { composerStateAtomFamily } from "../../atoms/composer-state";
import { composerDraftAtomFamily } from "../../atoms/ui";
import { applyComposerTextEdit, type ComposerDraft } from "../../lib/composer-draft";
import { composerScope } from "../../lib/composer-scope";

/** Use a fence longer than any backticks in the output, retaining the exact selected text. */
export function terminalQuote(selection: string): string | null {
  if (!selection.trim()) return null;
  let longest = 0;
  for (const match of selection.matchAll(/`+/g)) longest = Math.max(longest, match[0].length);
  const fence = "`".repeat(Math.max(3, longest + 1));
  return `> Terminal output\n>\n${[`${fence}text`, selection, fence]
    .join("\n")
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n")}\n\n`;
}

/** Reuse the persisted task draft, including a currently edited inbox message. */
export function quoteTerminalInComposer(
  store: ReturnType<typeof createStore>,
  profileID: string,
  sessionID: string,
  selection: string,
): boolean {
  const quote = terminalQuote(selection);
  if (!quote) return false;
  const scope = composerScope(profileID, `session:${sessionID}`);
  const stateAtom = composerStateAtomFamily(scope);
  const state = store.get(stateAtom);
  if (state.sending) return false;
  const append = (draft: ComposerDraft) =>
    applyComposerTextEdit(draft, {
      start: draft.text.length,
      end: draft.text.length,
      text: `${draft.text && !draft.text.endsWith("\n\n") ? "\n\n" : ""}${quote}`,
    });
  if (state.edit) {
    store.set(stateAtom, (current) =>
      current.edit
        ? { ...current, edit: { ...current.edit, draft: append(current.edit.draft) } }
        : current,
    );
  } else {
    store.set(composerDraftAtomFamily(scope), append);
  }
  return true;
}
