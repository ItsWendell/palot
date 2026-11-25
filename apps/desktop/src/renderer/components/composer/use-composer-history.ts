import { useState } from "react";
import {
  IDLE_HISTORY_CURSOR,
  composerHistoryEntry,
  mergeComposerHistory,
  navigateComposerHistory,
  normalPromptHistory,
  attachmentsNotRestoredMessage,
  shellCommandHistory,
  swapHistoryContext,
  type ComposerHistoryCursor,
  type ComposerHistoryEntry,
  type ComposerMode,
} from "../../lib/composer-history";
import { loadRecentPrompts, recentPromptHistory } from "../../lib/composer-recent-prompts";
import type { ComposerInputHandle } from "../composer-input";
import type { ComposerDraftState } from "./use-composer-draft";
import type { ComposerErrors } from "./use-composer-errors";
import type { ComposerLive } from "./use-latest";

const SHELL_HISTORY_LIMIT = 100;

/**
 * The composer's mode (prompt or shell) and its history recall. Mode, history position and the
 * shell commands run here belong to one draft scope; a request or an open edit forces prompt mode.
 */
export function useComposerHistory({
  draftScope,
  forceNormal,
  recentScope,
  live,
  contents,
  errors,
  focus,
}: {
  draftScope: string;
  /** A request card or an edited pending message owns the input. */
  forceNormal: { request: boolean; editing: boolean };
  recentScope: string | null;
  live: ComposerLive;
  contents: ComposerDraftState;
  errors: ComposerErrors;
  focus(): void;
}) {
  const [modeState, setModeState] = useState<{ scope: string; mode: ComposerMode } | null>(null);
  const mode: ComposerMode =
    !forceNormal.request && !forceNormal.editing && modeState?.scope === draftScope
      ? modeState.mode
      : "normal";
  const historyKey = `${draftScope}\0${mode}`;
  const [historyState, setHistoryState] = useState<{
    key: string;
    cursor: ComposerHistoryCursor;
    /** Context the recalled entry put in the composer, swapped out on the next step. */
    shown: Pick<ComposerHistoryEntry, "files" | "comments">;
  } | null>(null);
  const cursor = historyState?.key === historyKey ? historyState.cursor : IDLE_HISTORY_CURSOR;
  const [submittedShell, setSubmittedShell] = useState<{ scope: string; commands: string[] }>({
    scope: draftScope,
    commands: [],
  });

  function setMode(next: ComposerMode) {
    if (next === "shell" && (forceNormal.request || forceNormal.editing)) return;
    setModeState({ scope: draftScope, mode: next });
    setHistoryState(null);
    errors.clear();
    focus();
  }

  /** Returns true when the key recalled history and the default action must be suppressed. */
  function recall(direction: "up" | "down", element: ComposerInputHandle): boolean {
    const normal = mode === "normal";
    const entries = normal
      ? mergeComposerHistory(
          // Read storage at recall time so prompts sent from other windows are included.
          recentPromptHistory(loadRecentPrompts(recentScope)),
          normalPromptHistory(live.current.messages),
        )
      : shellCommandHistory(
          live.current.messages,
          submittedShell.scope === draftScope ? submittedShell.commands : [],
        );
    const { draft, files, comments } = contents.read();
    const current = composerHistoryEntry(draft, normal ? { files, comments } : {});
    const result = navigateComposerHistory({
      direction,
      current,
      selectionStart: element.selectionStart,
      selectionEnd: element.selectionEnd,
      entries,
      cursor,
    });
    if (!result) return false;
    const { entry } = result;
    const writer = contents.writer();
    writer.setDraft(entry.draft);
    if (normal) {
      // Recalled prompts bring their portable attachments and line comments; leaving the
      // history restores the in-progress draft's own. Browser comments are never swapped.
      const shown = historyState?.key === historyKey ? historyState.shown : current;
      writer.setFiles((value) =>
        swapHistoryContext(value, shown.files, entry.files, (file) => file.uri),
      );
      writer.setComments((value) =>
        swapHistoryContext(value, shown.comments, entry.comments, (comment) => comment.id),
      );
      errors.clear();
      if (entry.omittedFiles.length > 0)
        errors.report(attachmentsNotRestoredMessage(entry.omittedFiles));
    }
    setHistoryState(
      result.cursor.index < 0
        ? null
        : {
            key: historyKey,
            cursor: result.cursor,
            shown: { files: entry.files, comments: entry.comments },
          },
    );
    contents.setSelection({ start: result.caret, end: result.caret });
    requestAnimationFrame(() => element.setSelectionRange(result.caret, result.caret));
    return true;
  }

  return {
    mode,
    setMode,
    recall,
    /** Leaves history recall; the next Up starts from the newest entry. */
    reset: () => setHistoryState(null),
    /** Remembers a command run from this composer for shell history. */
    rememberShell(command: string) {
      setSubmittedShell((current) => ({
        scope: draftScope,
        commands: [
          command,
          ...(current.scope === draftScope ? current.commands : []).filter(
            (item) => item !== command,
          ),
        ].slice(0, SHELL_HISTORY_LIMIT),
      }));
    },
  };
}

export type ComposerHistory = ReturnType<typeof useComposerHistory>;
