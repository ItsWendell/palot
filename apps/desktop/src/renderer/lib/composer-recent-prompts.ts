/**
 * Recently sent prompts, remembered per connection profile and project so Up recall works across
 * tasks of one project without leaking into another project or server. Only portable context is
 * kept: text, resolved mentions, line comments, and small embedded attachments. Local file grants,
 * historical paths and remote URLs are never stored or replayed.
 */

import type { PalotFileAttachment } from "../../shared";
import {
  loadScopedPersistedValue,
  removeScopedPersistedValue,
  saveScopedPersistedValue,
} from "../atoms/persisted";
import {
  normalizeComposerDraft,
  type ComposerDraft,
  type ComposerMention,
  type ComposerMentionKind,
} from "./composer-draft";
import { composerHistoryEntry, type ComposerHistoryEntry } from "./composer-history";
import { isReviewComment, type ReviewComment } from "./review-comments";

const FAMILY = "composer.recent-prompts";
/** Profile × project scopes kept on disk; older scopes are evicted. */
export const MAX_RECENT_PROMPT_SCOPES = 12;
export const MAX_RECENT_PROMPTS = 25;
/** Longer prompts stay recallable from their task transcript but are not copied here. */
export const MAX_RECENT_PROMPT_TEXT = 4_000;
/** Embedded attachment budget per scope, in data-URI characters. Older entries lose bytes first. */
export const MAX_RECENT_PROMPT_EMBEDDED = 128 * 1024;
const MAX_COMMENTS = 50;

export interface RecentPrompt {
  text: string;
  mentions: ComposerMention[];
  comments: ReviewComment[];
  files: PalotFileAttachment[];
  omittedFiles: string[];
  createdAt: number;
}

const EMBEDDED_URI = /^data:[\w.+-]+\/[\w.+-]+;base64,[A-Za-z0-9+/]+={0,2}$/;
const MENTION_KINDS = new Set<ComposerMentionKind>(["file", "skill", "agent", "reference"]);

export function recentPromptScope(
  profileID: string | null | undefined,
  projectID: string | null | undefined,
): string | null {
  return profileID && projectID ? JSON.stringify([profileID, projectID]) : null;
}

/** Keeps only attachments whose bytes travel with the entry; everything else is omitted by name. */
export function portableComposerFiles(
  files: readonly PalotFileAttachment[],
  budget = MAX_RECENT_PROMPT_EMBEDDED,
): { files: PalotFileAttachment[]; omitted: string[] } {
  const kept: PalotFileAttachment[] = [];
  const omitted: string[] = [];
  let used = 0;
  for (const file of files) {
    if (
      typeof file.uri === "string" &&
      EMBEDDED_URI.test(file.uri) &&
      used + file.uri.length <= budget
    ) {
      used += file.uri.length;
      // Preview grants are per-run local capabilities; never persist or replay them.
      kept.push({ uri: file.uri, name: file.name, mime: file.mime, size: file.size ?? null });
    } else {
      omitted.push(file.name);
    }
  }
  return { files: kept, omitted };
}

export function recentPromptFromSubmission(input: {
  draft: ComposerDraft;
  files: readonly PalotFileAttachment[];
  comments: readonly ReviewComment[];
  createdAt: number;
}): RecentPrompt | null {
  const draft = normalizeComposerDraft(input.draft);
  if (!draft.text.trim() || draft.text.length > MAX_RECENT_PROMPT_TEXT) return null;
  const { files, omitted } = portableComposerFiles(input.files);
  return {
    text: draft.text,
    mentions: draft.mentions,
    comments: input.comments.slice(0, MAX_COMMENTS).map((comment) => ({ ...comment })),
    files,
    omittedFiles: omitted,
    createdAt: input.createdAt,
  };
}

/** Newest first, one entry per text, bounded in count and embedded bytes. */
export function rememberRecentPrompt(
  entries: readonly RecentPrompt[],
  entry: RecentPrompt,
): RecentPrompt[] {
  const next = [entry, ...entries.filter((item) => item.text !== entry.text)].slice(
    0,
    MAX_RECENT_PROMPTS,
  );
  let budget = MAX_RECENT_PROMPT_EMBEDDED;
  return next.map((item) => {
    const { files, omitted } = portableComposerFiles(item.files, budget);
    budget -= files.reduce((total, file) => total + file.uri.length, 0);
    return omitted.length === 0
      ? item
      : { ...item, files, omittedFiles: [...item.omittedFiles, ...omitted] };
  });
}

function isMention(value: unknown): value is ComposerMention {
  if (!value || typeof value !== "object") return false;
  const mention = value as Partial<ComposerMention>;
  return (
    typeof mention.localID === "string" &&
    typeof mention.kind === "string" &&
    MENTION_KINDS.has(mention.kind) &&
    typeof mention.value === "string" &&
    typeof mention.text === "string" &&
    typeof mention.start === "number" &&
    typeof mention.end === "number" &&
    (mention.path === undefined || typeof mention.path === "string") &&
    (mention.attachmentText === undefined || typeof mention.attachmentText === "string")
  );
}

function isFile(value: unknown): value is PalotFileAttachment {
  if (!value || typeof value !== "object") return false;
  const file = value as Partial<PalotFileAttachment>;
  return (
    typeof file.uri === "string" &&
    typeof file.name === "string" &&
    typeof file.mime === "string" &&
    (file.size === null || typeof file.size === "number")
  );
}

function isRecentPrompt(value: unknown): value is RecentPrompt {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<RecentPrompt>;
  return (
    typeof entry.text === "string" &&
    typeof entry.createdAt === "number" &&
    Array.isArray(entry.mentions) &&
    entry.mentions.every(isMention) &&
    Array.isArray(entry.comments) &&
    entry.comments.every(isReviewComment) &&
    Array.isArray(entry.files) &&
    entry.files.every(isFile) &&
    Array.isArray(entry.omittedFiles) &&
    entry.omittedFiles.every((name) => typeof name === "string")
  );
}

function isRecentPrompts(value: unknown): value is RecentPrompt[] {
  return Array.isArray(value) && value.every(isRecentPrompt);
}

export function loadRecentPrompts(scope: string | null): RecentPrompt[] {
  if (!scope) return [];
  return loadScopedPersistedValue<RecentPrompt[]>({
    family: FAMILY,
    scope,
    maxEntries: MAX_RECENT_PROMPT_SCOPES,
    initialValue: [],
    validate: isRecentPrompts,
  });
}

/** Read-modify-write from storage so another window's prompts are kept. */
export function saveRecentPrompt(scope: string | null, entry: RecentPrompt | null): void {
  if (!scope || !entry) return;
  saveScopedPersistedValue(
    FAMILY,
    scope,
    rememberRecentPrompt(loadRecentPrompts(scope), entry),
    MAX_RECENT_PROMPT_SCOPES,
  );
}

export function clearRecentPrompts(scope: string): void {
  removeScopedPersistedValue(FAMILY, scope);
}

/**
 * Turns stored prompts into recallable entries. Storage is untrusted: attachments are filtered
 * again through the portability rule and mentions are revalidated against the text.
 */
export function recentPromptHistory(entries: readonly RecentPrompt[]): ComposerHistoryEntry[] {
  return entries.flatMap((entry) => {
    const draft = normalizeComposerDraft({
      text: entry.text,
      mentions: entry.mentions,
      command: null,
    });
    if (!draft.text.trim()) return [];
    const { files, omitted } = portableComposerFiles(entry.files);
    return [
      composerHistoryEntry(draft, {
        files,
        comments: entry.comments.filter(isReviewComment),
        omittedFiles: [...entry.omittedFiles, ...omitted],
        createdAt: entry.createdAt,
      }),
    ];
  });
}
