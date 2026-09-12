import { atom } from "jotai";
import type { PalotFileAttachment } from "../../shared";
import { normalizeComposerDraft, type ComposerDraft } from "../lib/composer-draft";
import { loadScopedPersistedValue, scheduledScopedPersistence } from "./persisted";
import { isComposerDraft, type ComposerDelivery } from "./ui";

export interface PendingInputEdit {
  id: string;
  delivery: ComposerDelivery;
  draft: ComposerDraft;
  files: PalotFileAttachment[];
}

interface ComposerContents {
  files: PalotFileAttachment[];
  edit: PendingInputEdit | null;
}

interface ComposerState extends ComposerContents {
  sending: boolean;
  cancelingID: string | null;
}

function isFiles(value: unknown): value is PalotFileAttachment[] {
  return (
    Array.isArray(value) &&
    value.every(
      (file) =>
        file &&
        typeof file === "object" &&
        typeof file.uri === "string" &&
        typeof file.name === "string" &&
        typeof file.mime === "string" &&
        (file.size === null || (typeof file.size === "number" && Number.isFinite(file.size))) &&
        (file.previewGrant === undefined || typeof file.previewGrant === "string"),
    )
  );
}

function isContents(value: unknown): value is ComposerContents {
  if (!value || typeof value !== "object") return false;
  const { files, edit } = value as Partial<ComposerContents>;
  return (
    isFiles(files) &&
    (edit === null ||
      Boolean(
        edit &&
        typeof edit === "object" &&
        typeof edit.id === "string" &&
        (edit.delivery === "steer" || edit.delivery === "queue") &&
        isComposerDraft(edit.draft) &&
        isFiles(edit.files),
      ))
  );
}

const MAX_PERSISTED_COMPOSERS = 100;
const contentsPersistence = scheduledScopedPersistence<ComposerContents>(
  "composer.contents",
  MAX_PERSISTED_COMPOSERS,
);
const states = new Map<string, ReturnType<typeof createComposerStateAtom>>();

function createComposerStateAtom(scope: string) {
  const contents = loadScopedPersistedValue({
    family: "composer.contents",
    scope,
    maxEntries: MAX_PERSISTED_COMPOSERS,
    initialValue: { files: [], edit: null } as ComposerContents,
    validate: isContents,
  });
  const valueAtom = atom<ComposerState>({
    ...contents,
    edit: contents.edit
      ? { ...contents.edit, draft: normalizeComposerDraft(contents.edit.draft) }
      : null,
    sending: false,
    cancelingID: null,
  });
  valueAtom.onMount = () => () => contentsPersistence.flush();
  return atom(
    (get) => get(valueAtom),
    (get, set, update: (current: ComposerState) => ComposerState) => {
      const current = get(valueAtom);
      const next = update(current);
      set(valueAtom, next);
      if (current.files === next.files && current.edit === next.edit) return;
      // Request flags survive navigation, but are not replayed after an app restart.
      if (!next.files.length && !next.edit) contentsPersistence.remove(scope);
      else contentsPersistence.save(scope, { files: next.files, edit: next.edit });
    },
  );
}

/** Local draft contents only. Pass a captured composerScope; OpenCode owns the inbox. */
export function composerStateAtomFamily(scope: string) {
  const existing = states.get(scope);
  if (existing) return existing;
  const state = createComposerStateAtom(scope);
  states.set(scope, state);
  return state;
}
