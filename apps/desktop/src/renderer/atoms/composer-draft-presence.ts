/**
 * Which composer scopes hold something unsent: text, attachments, review or browser comments,
 * or a pending message pulled back for editing. One boolean per scope, written by the draft
 * and contents atoms only when it flips, so typing into a draft that already has text changes
 * nothing here. The task list reads it to mark tasks with a draft.
 */

import { atom, type Getter, type Setter } from "jotai";
import { loadPersistedValue, loadScopedPersistedValue, persistedStorageKey } from "./persisted";

export type ComposerDraftPart = "text" | "contents";

const FAMILIES: Record<ComposerDraftPart, string> = {
  text: "composer.draft",
  contents: "composer.contents",
};

/** Scopes with at least one unsent part; a scope with nothing unsent has no entry. */
export type ComposerDraftPresence = ReadonlyMap<string, ReadonlySet<ComposerDraftPart>>;

export function draftHasText(draft: unknown): boolean {
  const text = (draft as { text?: unknown } | null)?.text;
  return typeof text === "string" && text.trim().length > 0;
}

export function contentsHaveItems(contents: unknown): boolean {
  if (!contents || typeof contents !== "object") return false;
  const { files, comments, browserComments, edit } = contents as Record<string, unknown>;
  const some = (items: unknown) => Array.isArray(items) && items.length > 0;
  return some(files) || some(comments) || some(browserComments) || Boolean(edit);
}

const HAS: Record<ComposerDraftPart, (value: unknown) => boolean> = {
  text: draftHasText,
  contents: contentsHaveItems,
};

/** What earlier runs left in storage: the retained scopes of each family. */
function storedPresence(): ComposerDraftPresence {
  if (typeof window === "undefined") return new Map();
  const presence = new Map<string, Set<ComposerDraftPart>>();
  for (const part of ["text", "contents"] as const) {
    const family = FAMILIES[part];
    const scopes = loadPersistedValue({
      key: `${family}.__recent`,
      initialValue: [] as string[],
      validate: (value): value is string[] =>
        Array.isArray(value) && value.every((entry) => typeof entry === "string"),
    });
    for (const scope of scopes) {
      const value = loadScopedPersistedValue<unknown>({
        family,
        scope,
        maxEntries: Number.POSITIVE_INFINITY,
        initialValue: null,
        validate: (candidate): candidate is unknown => candidate !== null,
      });
      if (!HAS[part](value)) continue;
      const parts = presence.get(scope) ?? new Set();
      parts.add(part);
      presence.set(scope, parts);
    }
  }
  return presence;
}

function withPart(
  presence: ComposerDraftPresence,
  scope: string,
  part: ComposerDraftPart,
  value: boolean,
): ComposerDraftPresence {
  if ((presence.get(scope)?.has(part) ?? false) === value) return presence;
  const parts = new Set(presence.get(scope));
  if (value) parts.add(part);
  else parts.delete(part);
  const next = new Map(presence);
  if (parts.size > 0) next.set(scope, parts);
  else next.delete(scope);
  return next;
}

/** Null until something changes; reads fall back to storage. */
const changedAtom = atom<ComposerDraftPresence | null>(null);

// Another window's drafts reach this one through storage events.
changedAtom.onMount = (setValue) => {
  const prefixes = (["text", "contents"] as const).map(
    (part) => [part, `${persistedStorageKey(FAMILIES[part])}:`] as const,
  );
  const onStorage = (event: StorageEvent) => {
    if (event.storageArea !== window.localStorage) return;
    if (event.key === null) {
      setValue(storedPresence());
      return;
    }
    const match = prefixes.find(([, prefix]) => event.key!.startsWith(prefix));
    if (!match) return;
    const [part, prefix] = match;
    const scope = decodeURIComponent(event.key.slice(prefix.length));
    let value: unknown = null;
    try {
      value = (JSON.parse(event.newValue ?? "null") as { value?: unknown } | null)?.value;
    } catch {
      value = null;
    }
    setValue((previous) => withPart(previous ?? storedPresence(), scope, part, HAS[part](value)));
  };
  window.addEventListener("storage", onStorage);
  return () => window.removeEventListener("storage", onStorage);
};

export const composerDraftPresenceAtom = atom(
  (get): ComposerDraftPresence => get(changedAtom) ?? storedPresence(),
);

/** Called from the draft and contents atoms' writes; sets nothing unless the part flips. */
export function setComposerDraftPart(
  get: Getter,
  set: Setter,
  scope: string,
  part: ComposerDraftPart,
  value: boolean,
): void {
  const presence = get(composerDraftPresenceAtom);
  const next = withPart(presence, scope, part, value);
  if (next !== presence) set(changedAtom, next);
}

export function hasComposerDraft(presence: ComposerDraftPresence, scope: string): boolean {
  return presence.has(scope);
}
