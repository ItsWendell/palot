import {
  insertComposerFileMention,
  removeComposerMention,
  type ComposerDraft,
} from "../../lib/composer-draft";
import type { ComposerDraftState } from "./use-composer-draft";
import type { ComposerFocus } from "./use-composer-focus";

/** Mentions added or removed outside typing: recent outputs, dropped files and chip removal. */
export function useComposerMentions(contents: ComposerDraftState, focus: ComposerFocus) {
  const draftScope = contents.scope;

  function apply(inserted: { draft: ComposerDraft; selectionStart: number; selectionEnd: number }) {
    contents.writer().setDraft(inserted.draft);
    contents.setSelection({ start: inserted.selectionStart, end: inserted.selectionEnd });
    requestAnimationFrame(() => {
      if (!focus.isActive(draftScope)) return;
      focus.inputRef.current?.focus();
      focus.inputRef.current?.setSelectionRange(inserted.selectionStart, inserted.selectionEnd);
    });
  }

  return {
    remove(localID: string) {
      const removed = removeComposerMention(contents.read().draft, localID);
      if (removed) apply(removed);
    },
    /** Mentions a workspace file by path; the server checks it again on send. */
    mentionFile(path: string) {
      const { draft } = contents.read();
      const existing = draft.mentions.find(
        (mention) => mention.kind === "file" && mention.value === path,
      );
      if (existing) {
        apply({ draft, selectionStart: existing.end, selectionEnd: existing.end });
        return;
      }
      const caret = focus.inputRef.current?.selectionStart ?? draft.text.length;
      apply(insertComposerFileMention(draft, caret, path, crypto.randomUUID()));
    },
  };
}
