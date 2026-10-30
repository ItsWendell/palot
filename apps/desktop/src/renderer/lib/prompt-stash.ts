import type { PalotFileAttachment } from "../../shared";
import { loadPersistedValue, savePersistedValue } from "../atoms/persisted";
import { isComposerDraft } from "../atoms/ui";
import { normalizeComposerDraft, type ComposerDraft } from "./composer-draft";

export interface StashedPrompt {
  id: string;
  createdAt: number;
  draft: ComposerDraft;
  files: PalotFileAttachment[];
}
const key = (scope: string) => `composer.stash:${scope}`;
function isStash(value: unknown): value is StashedPrompt[] {
  return (
    Array.isArray(value) &&
    value.every(
      (entry) =>
        entry &&
        typeof entry.id === "string" &&
        Number.isFinite(entry.createdAt) &&
        isComposerDraft(entry.draft) &&
        Array.isArray(entry.files) &&
        entry.files.every(
          (file: PalotFileAttachment) =>
            file &&
            typeof file.uri === "string" &&
            typeof file.name === "string" &&
            typeof file.mime === "string" &&
            (file.size === null || Number.isFinite(file.size)),
        ),
    )
  );
}
export function loadPromptStash(scope: string): StashedPrompt[] {
  return loadPersistedValue({ key: key(scope), initialValue: [], validate: isStash });
}
export function savePromptStash(scope: string, entries: StashedPrompt[]) {
  if (!savePersistedValue(key(scope), entries))
    throw new Error("Local storage is full or unavailable. Your prompt was not cleared.");
}
export function stashPrompt(scope: string, draft: ComposerDraft, files: PalotFileAttachment[]) {
  const entries = loadPromptStash(scope);
  if (entries.length >= 25)
    throw new Error("The prompt stash is full. Restore or delete a prompt first.");
  const entry = createStashedPrompt(draft, files);
  savePromptStash(scope, [entry, ...entries]);
  return entry;
}
function createStashedPrompt(draft: ComposerDraft, files: PalotFileAttachment[]): StashedPrompt {
  return {
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    draft: normalizeComposerDraft(draft),
    files,
  };
}
/** Replace in one durable write, even when all 25 stash slots are occupied. */
export function restorePromptStash(
  scope: string,
  id: string,
  draft: ComposerDraft,
  files: PalotFileAttachment[],
) {
  const entries = loadPromptStash(scope);
  const entry = entries.find((item) => item.id === id);
  if (!entry) throw new Error("This stashed prompt is no longer available.");
  const rest = entries.filter((item) => item.id !== id);
  savePromptStash(
    scope,
    draft.text.trim() || files.length ? [createStashedPrompt(draft, files), ...rest] : rest,
  );
  return { ...entry, draft: normalizeComposerDraft(entry.draft) };
}
