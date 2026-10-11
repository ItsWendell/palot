import type { PalotMessage } from "../../shared";
import { emptyComposerDraft, normalizeComposerDraft, type ComposerDraft } from "./composer-draft";
import { composerDraftFromMessage } from "./composer-restoration";

export type ComposerMode = "normal" | "shell";

/** Active history position. `index` -1 means the live draft is shown. */
export interface ComposerHistoryCursor {
  index: number;
  saved: ComposerDraft | null;
}

export const IDLE_HISTORY_CURSOR: ComposerHistoryCursor = { index: -1, saved: null };

export interface ComposerHistoryNavigation {
  cursor: ComposerHistoryCursor;
  draft: ComposerDraft;
  caret: number;
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function shellDraft(command: string): ComposerDraft {
  return { text: command, mentions: [], command: null };
}

function withoutAdjacentDuplicates(drafts: ComposerDraft[]): ComposerDraft[] {
  return drafts.filter((draft, index) => drafts[index - 1]?.text !== draft.text);
}

/** Submitted prompts of a session, most recent first. Attachments stay out of recalled drafts. */
export function normalPromptHistory(messages: readonly PalotMessage[]): ComposerDraft[] {
  const drafts: ComposerDraft[] = [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!;
    if (message.type !== "user" || !message.text?.trim()) continue;
    const data = message.data;
    // Recall text and mentions only; omit the "attachments not restored" notice.
    const draft = composerDraftFromMessage({
      ...message,
      files: [],
      data:
        data && typeof data === "object" && !Array.isArray(data) ? { ...data, files: [] } : null,
    });
    if (draft.text.trim()) drafts.push(draft);
  }
  return withoutAdjacentDuplicates(drafts);
}

/** Shell commands from the transcript plus locally submitted ones, most recent first, deduplicated. */
export function shellCommandHistory(
  messages: readonly PalotMessage[],
  submitted: readonly string[] = [],
): ComposerDraft[] {
  const commands = [...submitted];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!;
    if (message.type !== "shell") continue;
    const command = record(message.data).command;
    if (typeof command === "string" && command.trim()) commands.push(command);
  }
  return [...new Set(commands)].map(shellDraft);
}

/**
 * Up recalls older entries when the composer is empty or the caret is collapsed at its start.
 * While browsing, either text boundary keeps navigating; Down past the newest entry restores the
 * draft that was in progress when browsing started.
 */
export function navigateComposerHistory(input: {
  direction: "up" | "down";
  draft: ComposerDraft;
  selectionStart: number;
  selectionEnd: number;
  entries: readonly ComposerDraft[];
  cursor: ComposerHistoryCursor;
}): ComposerHistoryNavigation | null {
  const { direction, draft, selectionStart, selectionEnd, entries, cursor } = input;
  if (selectionStart !== selectionEnd) return null;
  const length = draft.text.length;
  const caret = Math.max(0, Math.min(selectionStart, length));
  const browsing = cursor.index >= 0;
  if (browsing ? caret !== 0 && caret !== length : caret !== 0) return null;

  if (direction === "up") {
    const index = cursor.index + 1;
    const entry = entries[index];
    if (!entry) return null;
    return {
      cursor: { index, saved: browsing ? cursor.saved : draft },
      draft: normalizeComposerDraft(entry),
      caret: 0,
    };
  }

  if (!browsing) return null;
  if (cursor.index > 0) {
    const entry = entries[cursor.index - 1];
    if (!entry) return null;
    return {
      cursor: { index: cursor.index - 1, saved: cursor.saved },
      draft: normalizeComposerDraft(entry),
      caret: entry.text.length,
    };
  }
  const restored = cursor.saved ?? emptyComposerDraft();
  return { cursor: IDLE_HISTORY_CURSOR, draft: restored, caret: restored.text.length };
}
