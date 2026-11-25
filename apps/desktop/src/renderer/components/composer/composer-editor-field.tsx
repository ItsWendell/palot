/**
 * The text field and its keys. It is the only part of the composer that subscribes to the text,
 * so typing re-renders this and nothing else. While the launcher is open it gets each key first.
 */

import { useAtomValue, useSetAtom } from "jotai";
import type { ClipboardEvent, RefObject } from "react";
import type { ComposerMode } from "../../lib/composer-history";
import {
  composerEnterAction,
  type ComposerEnterAction,
  type ComposerEnterState,
} from "../../lib/composer-shortcuts";
import { matchesShortcut, shortcutKeys } from "../../lib/keyboard-shortcuts";
import { cn } from "../../lib/cn";
import { ComposerInput, type ComposerInputHandle } from "../composer-input";
import { launcherOptionId } from "../composer-launcher/launcher-list";
import type { ComposerDraftState } from "./use-composer-draft";
import type { ComposerLauncher } from "./use-composer-launcher";

interface ComposerEditorKeys {
  enterState: ComposerEnterState;
  onStash(): void;
  /** Steps through history; true when it did and the key must not move the caret. */
  onRecall(direction: "up" | "down", element: ComposerInputHandle): boolean;
  onEnter(action: Exclude<ComposerEnterAction, null>): void;
  onModeChange(mode: ComposerMode): void;
}

export function ComposerEditorField({
  contents,
  inputRef,
  launcher,
  mode,
  disabled,
  placeholder,
  keys,
  onPaste,
}: {
  contents: ComposerDraftState;
  inputRef: RefObject<ComposerInputHandle | null>;
  launcher: ComposerLauncher;
  mode: ComposerMode;
  disabled: boolean;
  /** Replaces the message placeholder while a request uses the field as its answer. */
  placeholder?: string;
  keys: ComposerEditorKeys;
  onPaste(event: ClipboardEvent<HTMLElement>): void;
}) {
  const draft = useAtomValue(contents.atoms.draft);
  const comments = useAtomValue(contents.atoms.comments);
  const open = useAtomValue(launcher.openAtom);
  const launching = useAtomValue(launcher.plusOpenAtom);
  const active = useAtomValue(launcher.activeAtom);
  const setComposing = useSetAtom(contents.composingAtom);
  const editing = contents.edit !== null;
  // A leading `!` in an empty prompt switches to shell mode instead of being typed; in the
  // launcher it is part of the query.
  const entersShell = (text: string) => !draft.text && text === "!" && !editing && !launching;

  return (
    <ComposerInput
      key={contents.scope}
      ref={inputRef}
      plain={mode === "shell"}
      draft={draft}
      comments={comments}
      onCommentsChange={(next) => contents.writer().setComments(() => next)}
      onDraftChange={(next, change) => {
        if (mode === "normal" && entersShell(next.text)) {
          keys.onModeChange("shell");
          return;
        }
        contents.writer().setDraft(next);
        if (change.pasted) contents.suppressQuery(next.text);
      }}
      onSelectionChange={contents.setSelection}
      aria-label={mode === "shell" ? "Shell command" : "Message Palot"}
      aria-controls={open ? launcher.listId : undefined}
      aria-expanded={open}
      aria-activedescendant={open && active ? launcherOptionId(launcher.listId, active) : undefined}
      className={cn(
        "palot-native-scrollbar max-h-[clamp(3rem,25cqh,11rem)] min-h-[calc(2lh+--spacing(4))] flex-none resize-none overflow-y-auto overscroll-contain px-5 pt-3 pb-1",
        mode === "shell" && "font-mono text-code",
      )}
      placeholder={
        mode === "shell"
          ? "Run a shell command"
          : launching
            ? "Type to search…"
            : (placeholder ?? "Do anything")
      }
      disabled={disabled}
      onCompositionStart={() => setComposing(true)}
      onCompositionEnd={() => setComposing(false)}
      onPaste={onPaste}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing || event.keyCode === 229) return;
        if (launcher.handleKey(event)) return;
        // Under `+` the field holds a search, which is never stashed, recalled or sent.
        const searching = launcher.isPlusOpen();
        if (matchesShortcut(event.nativeEvent, shortcutKeys("composer.stash"))) {
          event.preventDefault();
          event.stopPropagation();
          if (!searching) keys.onStash();
          return;
        }
        if (searching) {
          if (event.key === "Enter") event.preventDefault();
          return;
        }
        if (
          mode === "shell" &&
          (event.key === "Escape" ||
            (event.key === "Backspace" &&
              !draft.text &&
              !event.altKey &&
              !event.ctrlKey &&
              !event.metaKey))
        ) {
          event.preventDefault();
          keys.onModeChange("normal");
          return;
        }
        if (
          (event.key === "ArrowUp" || event.key === "ArrowDown") &&
          !event.altKey &&
          !event.ctrlKey &&
          !event.metaKey &&
          !event.shiftKey &&
          inputRef.current &&
          keys.onRecall(event.key === "ArrowUp" ? "up" : "down", inputRef.current)
        ) {
          event.preventDefault();
          // A recalled prompt opens no suggestions until it is edited.
          contents.suppressQuery(contents.read().draft.text);
          return;
        }
        const enter = composerEnterAction(event, keys.enterState);
        if (enter) {
          event.preventDefault();
          keys.onEnter(enter);
        }
      }}
    />
  );
}
