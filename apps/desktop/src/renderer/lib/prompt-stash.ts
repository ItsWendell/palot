import type { PalotAttachmentRestore, PalotFileAttachment } from "../../shared";
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
/** Removes one entry and returns it; a missing one is already gone. */
export function deletePromptStash(scope: string, id: string): StashedPrompt | null {
  const entries = loadPromptStash(scope);
  const entry = entries.find((item) => item.id === id) ?? null;
  if (entry)
    savePromptStash(
      scope,
      entries.filter((item) => item.id !== id),
    );
  return entry;
}

/**
 * The files to put back in the composer for a stashed prompt, given what main did with each one
 * (`outcomes` is in the same order). Missing files are dropped and named so the composer can say so.
 */
export function restoredStashFiles(
  files: readonly PalotFileAttachment[],
  outcomes: readonly PalotAttachmentRestore[],
): { files: PalotFileAttachment[]; missing: string[] } {
  const kept: PalotFileAttachment[] = [];
  const missing: string[] = [];
  for (const [index, file] of files.entries()) {
    const outcome = outcomes[index] ?? { status: "kept" };
    if (outcome.status === "missing") missing.push(file.name);
    else if (outcome.status === "kept") kept.push(file);
    else {
      const { previewGrant: _stale, ...rest } = file;
      kept.push({
        ...rest,
        uri: outcome.uri,
        ...(outcome.previewGrant ? { previewGrant: outcome.previewGrant } : {}),
      });
    }
  }
  return { files: kept, missing };
}

/** Swaps in the durable URIs main returned, in order; preview grants of copied files are dropped. */
export function withStashedURIs(
  files: readonly PalotFileAttachment[],
  uris: readonly string[],
): PalotFileAttachment[] {
  return files.map((file, index) => {
    const uri = uris[index] ?? file.uri;
    if (uri === file.uri) return file;
    const { previewGrant: _stale, ...rest } = file;
    return { ...rest, uri };
  });
}

/** Every local file URI saved drafts and stashed prompts reference, read straight from storage. */
export function retainedComposerAttachmentURIs(storage: Storage, namespace: string): string[] {
  const prefixes = ["composer.contents:", "composer.stash:"].map(
    (family) => `${namespace}${family}`,
  );
  const uris = new Set<string>();
  const visit = (value: unknown, depth: number): void => {
    if (depth > 8 || !value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1);
      return;
    }
    for (const [key, item] of Object.entries(value)) {
      if (key === "uri" && typeof item === "string" && item.startsWith("file:")) uris.add(item);
      else visit(item, depth + 1);
    }
  };
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (!key || !prefixes.some((prefix) => key.startsWith(prefix))) continue;
    try {
      visit(JSON.parse(storage.getItem(key) ?? "null"), 0);
    } catch {
      // Unreadable entries reference nothing.
    }
  }
  return [...uris];
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
