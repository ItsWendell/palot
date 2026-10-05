import { atom } from "jotai";
import type { PalotFileAttachment } from "../../shared";
import { normalizeComposerDraft, type ComposerDraft } from "../lib/composer-draft";
import { loadScopedPersistedValue, scheduledScopedPersistence } from "./persisted";
import { isComposerDraft, type ComposerDelivery } from "./ui";
import { isReviewComment, type ReviewComment } from "../lib/review-comments";
import type { PalotBrowserComment } from "../../shared/browser-contract";
import { durableBrowserComment, isBrowserComment } from "../lib/browser-comments";

export interface PendingInputEdit {
  id: string;
  delivery: ComposerDelivery;
  draft: ComposerDraft;
  files: PalotFileAttachment[];
  comments: ReviewComment[];
  browserComments?: PalotBrowserComment[];
}

interface ComposerContents {
  files: PalotFileAttachment[];
  comments: ReviewComment[];
  browserComments?: PalotBrowserComment[];
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
  const { files, comments, browserComments, edit } = value as Partial<ComposerContents>;
  return (
    isFiles(files) &&
    (comments === undefined || (Array.isArray(comments) && comments.every(isReviewComment))) &&
    (browserComments === undefined ||
      (Array.isArray(browserComments) &&
        browserComments.length <= 10 &&
        browserComments.every(isBrowserComment))) &&
    (edit === null ||
      Boolean(
        edit &&
        typeof edit === "object" &&
        typeof edit.id === "string" &&
        (edit.delivery === "steer" || edit.delivery === "queue") &&
        isComposerDraft(edit.draft) &&
        isFiles(edit.files) &&
        (edit.comments === undefined ||
          (Array.isArray(edit.comments) && edit.comments.every(isReviewComment))) &&
        (edit.browserComments === undefined ||
          (Array.isArray(edit.browserComments) &&
            edit.browserComments.length <= 10 &&
            edit.browserComments.every(isBrowserComment))),
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
    initialValue: { files: [], comments: [], edit: null } as ComposerContents,
    validate: isContents,
  });
  const valueAtom = atom<ComposerState>({
    ...contents,
    ...(contents.browserComments
      ? { browserComments: contents.browserComments.map(durableBrowserComment) }
      : {}),
    comments: contents.comments ?? [],
    edit: contents.edit
      ? {
          ...contents.edit,
          comments: contents.edit.comments ?? [],
          ...(contents.edit.browserComments
            ? { browserComments: contents.edit.browserComments.map(durableBrowserComment) }
            : {}),
          draft: normalizeComposerDraft(contents.edit.draft),
        }
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
      if (
        current.files === next.files &&
        current.comments === next.comments &&
        current.browserComments === next.browserComments &&
        current.edit === next.edit
      )
        return;
      // Request flags survive navigation, but are not replayed after an app restart.
      if (
        !next.files.length &&
        !next.comments.length &&
        !next.browserComments?.length &&
        !next.edit
      )
        contentsPersistence.remove(scope);
      else
        contentsPersistence.save(scope, {
          files: next.files,
          comments: next.comments,
          ...(next.browserComments?.length
            ? { browserComments: next.browserComments.map(durableBrowserComment) }
            : {}),
          edit: next.edit
            ? {
                ...next.edit,
                ...(next.edit.browserComments
                  ? { browserComments: next.edit.browserComments.map(durableBrowserComment) }
                  : {}),
              }
            : null,
        });
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
