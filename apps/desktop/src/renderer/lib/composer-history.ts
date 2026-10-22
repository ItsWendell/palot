import type { PalotFileAttachment, PalotMessage } from "../../shared";
import { emptyComposerDraft, normalizeComposerDraft, type ComposerDraft } from "./composer-draft";
import { composerDraftFromMessage, composerFilesFromMessage } from "./composer-restoration";
import { reviewCommentsFromMessage, type ReviewComment } from "./review-comments";

export type ComposerMode = "normal" | "shell";

/**
 * One recallable prompt. Normal-mode entries carry the portable context that was sent with
 * them; shell entries only carry text. `omittedFiles` names attachments that can't be replayed.
 */
export interface ComposerHistoryEntry {
  draft: ComposerDraft;
  files: PalotFileAttachment[];
  comments: ReviewComment[];
  omittedFiles: string[];
  createdAt: number;
}

/** Active history position. `index` -1 means the live draft is shown. */
export interface ComposerHistoryCursor {
  index: number;
  saved: ComposerHistoryEntry | null;
}

export const IDLE_HISTORY_CURSOR: ComposerHistoryCursor = { index: -1, saved: null };

export interface ComposerHistoryNavigation {
  cursor: ComposerHistoryCursor;
  entry: ComposerHistoryEntry;
  caret: number;
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function composerHistoryEntry(
  draft: ComposerDraft,
  context: Partial<Omit<ComposerHistoryEntry, "draft">> = {},
): ComposerHistoryEntry {
  return {
    draft,
    files: context.files ?? [],
    comments: context.comments ?? [],
    omittedFiles: context.omittedFiles ?? [],
    createdAt: context.createdAt ?? 0,
  };
}

/** Submitted prompts of a session, most recent first, with their portable context. */
export function normalPromptHistory(messages: readonly PalotMessage[]): ComposerHistoryEntry[] {
  const entries: ComposerHistoryEntry[] = [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!;
    if (message.type !== "user" || !message.text?.trim()) continue;
    const data = message.data;
    // Recall text and mentions without the "attachments not restored" notice; context follows.
    const draft = composerDraftFromMessage({
      ...message,
      files: [],
      data:
        data && typeof data === "object" && !Array.isArray(data) ? { ...data, files: [] } : null,
    });
    if (!draft.text.trim()) continue;
    // Only embedded bytes are portable; historical grants, paths and remote URLs are not.
    const { files, omitted } = composerFilesFromMessage(message);
    entries.push(
      composerHistoryEntry(draft, {
        files,
        omittedFiles: omitted,
        comments: reviewCommentsFromMessage(message) ?? [],
        createdAt: message.createdAt,
      }),
    );
  }
  return withoutDuplicateText(entries);
}

/**
 * Merges remembered project prompts with the open session's prompts, newest first. Equal text
 * keeps the newer entry; on a tie the remembered entry wins because it keeps richer context.
 */
export function mergeComposerHistory(
  remembered: readonly ComposerHistoryEntry[],
  session: readonly ComposerHistoryEntry[],
): ComposerHistoryEntry[] {
  const merged = [
    ...remembered.map((entry, order) => ({ entry, order, source: 0 })),
    ...session.map((entry, order) => ({ entry, order, source: 1 })),
  ].toSorted(
    (left, right) =>
      right.entry.createdAt - left.entry.createdAt ||
      left.source - right.source ||
      left.order - right.order,
  );
  return withoutDuplicateText(merged.map(({ entry }) => entry));
}

function withoutDuplicateText(entries: ComposerHistoryEntry[]): ComposerHistoryEntry[] {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    if (seen.has(entry.draft.text)) return false;
    seen.add(entry.draft.text);
    return true;
  });
}

/** Shell commands from the transcript plus locally submitted ones, most recent first, deduplicated. */
export function shellCommandHistory(
  messages: readonly PalotMessage[],
  submitted: readonly string[] = [],
): ComposerHistoryEntry[] {
  const commands = [...submitted];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!;
    if (message.type !== "shell") continue;
    const command = record(message.data).command;
    if (typeof command === "string" && command.trim()) commands.push(command);
  }
  return [...new Set(commands)].map((command) =>
    composerHistoryEntry({ text: command, mentions: [], command: null }),
  );
}

/**
 * Up recalls older entries when the composer is empty or the caret is collapsed at its start.
 * While browsing, either text boundary keeps navigating; Down past the newest entry restores the
 * draft (and its context) that was in progress when browsing started.
 */
export function navigateComposerHistory(input: {
  direction: "up" | "down";
  current: ComposerHistoryEntry;
  selectionStart: number;
  selectionEnd: number;
  entries: readonly ComposerHistoryEntry[];
  cursor: ComposerHistoryCursor;
}): ComposerHistoryNavigation | null {
  const { direction, current, selectionStart, selectionEnd, entries, cursor } = input;
  if (selectionStart !== selectionEnd) return null;
  const length = current.draft.text.length;
  const caret = Math.max(0, Math.min(selectionStart, length));
  const browsing = cursor.index >= 0;
  if (browsing ? caret !== 0 && caret !== length : caret !== 0) return null;

  if (direction === "up") {
    const index = cursor.index + 1;
    const entry = entries[index];
    if (!entry) return null;
    return {
      cursor: { index, saved: browsing ? cursor.saved : current },
      entry: { ...entry, draft: normalizeComposerDraft(entry.draft) },
      caret: 0,
    };
  }

  if (!browsing) return null;
  if (cursor.index > 0) {
    const entry = entries[cursor.index - 1];
    if (!entry) return null;
    return {
      cursor: { index: cursor.index - 1, saved: cursor.saved },
      entry: { ...entry, draft: normalizeComposerDraft(entry.draft) },
      caret: entry.draft.text.length,
    };
  }
  const restored = cursor.saved ?? composerHistoryEntry(emptyComposerDraft());
  return { cursor: IDLE_HISTORY_CURSOR, entry: restored, caret: restored.draft.text.length };
}

/**
 * Replaces the context shown for one history entry with the next one's. Items the composer
 * gained from elsewhere while browsing (a new line comment, say) stay put.
 */
export function swapHistoryContext<T>(
  current: readonly T[],
  shown: readonly T[],
  next: readonly T[],
  key: (item: T) => string,
): T[] {
  const shownKeys = new Set(shown.map(key));
  const nextKeys = new Set(next.map(key));
  return [
    ...next,
    ...current.filter((item) => !shownKeys.has(key(item)) && !nextKeys.has(key(item))),
  ];
}
