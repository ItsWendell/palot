/**
 * The draft, attachments and comments of one composer scope. The text lives in atoms that only the
 * editor field subscribes to; everything else reads rare-changing facts derived from it, or reads
 * the contents at the moment it acts.
 */

import { atom, useAtomValue, useSetAtom, useStore, type Atom, type PrimitiveAtom } from "jotai";
import { selectAtom } from "jotai/utils";
import { useEffect, useMemo, useState } from "react";
import type { PalotFileAttachment, PalotSession } from "../../../shared";
import type { PalotBrowserComment } from "../../../shared/browser-contract";
import {
  composerStateAtomFamily,
  type ComposerState,
  type PendingInputEdit,
} from "../../atoms/composer-state";
import { composerDraftAtomFamily, flushComposerDrafts } from "../../atoms/ui";
import { parseBtwQuestion } from "../../lib/btw";
import {
  emptyComposerDraft,
  normalizeComposerDraft,
  type ComposerDraft,
  type ComposerMention,
} from "../../lib/composer-draft";
import { detectComposerQuery, type ComposerQuery } from "../../lib/composer-query";
import { composerScope } from "../../lib/composer-scope";
import type { ReviewComment } from "../../lib/review-comments";

export interface ComposerContents {
  draft: ComposerDraft;
  files: PalotFileAttachment[];
  comments: ReviewComment[];
  browserComments: PalotBrowserComment[];
  /** The canceled pending message these contents belong to, if one is open for editing. */
  edit: PendingInputEdit | null;
}

export interface ComposerTextSelection {
  start: number;
  end: number;
}

/** Facts about the text that change rarely while typing. */
export interface ComposerDraftFacts {
  hasText: boolean;
  /** The text is a `/btw` side question. */
  btw: boolean;
}

type Update<T> = T | ((current: T) => T);

export interface ComposerWriter {
  setDraft(update: Update<ComposerDraft>): void;
  setFiles(update: Update<PalotFileAttachment[]>): void;
  setComments(update: (current: ReviewComment[]) => ReviewComment[]): void;
  setBrowserComments(update: (current: PalotBrowserComment[]) => PalotBrowserComment[]): void;
}

type DraftAtom = ReturnType<typeof composerDraftAtomFamily>;
type StateAtom = ReturnType<typeof composerStateAtomFamily>;

const NO_BROWSER_COMMENTS: PalotBrowserComment[] = [];

function sameFacts(left: ComposerDraftFacts, right: ComposerDraftFacts): boolean {
  return left.hasText === right.hasText && left.btw === right.btw;
}

/** Chips show a mention's identity, not its offsets, so typing around one does not redraw it. */
function sameMentionChips(left: ComposerMention[], right: ComposerMention[]): boolean {
  return (
    left.length === right.length &&
    left.every((mention, index) => {
      const other = right[index]!;
      return (
        mention.localID === other.localID &&
        mention.kind === other.kind &&
        mention.value === other.value &&
        mention.text === other.text &&
        mention.title === other.title &&
        mention.path === other.path
      );
    })
  );
}

function sameEdit(
  left: Pick<PendingInputEdit, "id" | "delivery"> | null,
  right: Pick<PendingInputEdit, "id" | "delivery"> | null,
): boolean {
  return left?.id === right?.id && left?.delivery === right?.delivery;
}

function sameQuery(left: ComposerQuery | null, right: ComposerQuery | null): boolean {
  return (
    left === right ||
    (left !== null &&
      right !== null &&
      left.kind === right.kind &&
      left.start === right.start &&
      left.end === right.end &&
      left.query === right.query)
  );
}

function createDerivedAtoms(draftAtom: DraftAtom, stateAtom: StateAtom) {
  const draft = atom((get) => get(stateAtom).edit?.draft ?? get(draftAtom));
  return {
    /** The text being written: the edited pending message's, or the scope's own draft. */
    draft,
    facts: selectAtom(
      draft,
      (value): ComposerDraftFacts => ({
        hasText: value.text.trim().length > 0,
        btw: parseBtwQuestion(value.text) !== null,
      }),
      sameFacts,
    ),
    mentions: selectAtom(draft, (value) => value.mentions, sameMentionChips),
    files: selectAtom(stateAtom, (state) => state.edit?.files ?? state.files),
    comments: selectAtom(stateAtom, (state) => state.edit?.comments ?? state.comments),
    browserComments: selectAtom(
      stateAtom,
      (state) =>
        (state.edit ? state.edit.browserComments : state.browserComments) ?? NO_BROWSER_COMMENTS,
    ),
    edit: selectAtom(
      stateAtom,
      (state) => (state.edit ? { id: state.edit.id, delivery: state.edit.delivery } : null),
      sameEdit,
    ),
    sending: selectAtom(stateAtom, (state) => state.sending),
    cancelingID: selectAtom(stateAtom, (state) => state.cancelingID),
  };
}

type ComposerDerivedAtoms = ReturnType<typeof createDerivedAtoms>;

const derivedAtoms = new WeakMap<StateAtom, ComposerDerivedAtoms>();

function derivedAtomsFor(draftAtom: DraftAtom, stateAtom: StateAtom): ComposerDerivedAtoms {
  let derived = derivedAtoms.get(stateAtom);
  if (!derived) {
    derived = createDerivedAtoms(draftAtom, stateAtom);
    derivedAtoms.set(stateAtom, derived);
  }
  return derived;
}

/** Caret and IME state belong to the mounted composer, not to the persisted scope. */
function createLocalAtoms() {
  return {
    selection: atom<ComposerTextSelection>({ start: 0, end: 0 }),
    composing: atom(false),
    /** Pasted text opens no suggestions; this holds the text a paste left until it changes. */
    pasted: atom<string | null>(null),
  };
}

function createQueryAtom(
  draft: Atom<ComposerDraft>,
  selection: PrimitiveAtom<ComposerTextSelection>,
  composing: PrimitiveAtom<boolean>,
  pasted: PrimitiveAtom<string | null>,
): Atom<ComposerQuery | null> {
  return selectAtom(
    atom((get) => {
      const range = get(selection);
      const { text } = get(draft);
      if (get(pasted) === text) return null;
      return detectComposerQuery(text, range.start, range.end, {
        isComposing: get(composing),
      });
    }),
    (query) => query,
    sameQuery,
  );
}

function contentsOf(state: ComposerState, draft: ComposerDraft): ComposerContents {
  const edit = state.edit;
  return {
    edit,
    draft: edit?.draft ?? draft,
    files: edit?.files ?? state.files,
    comments: edit?.comments ?? state.comments,
    browserComments: (edit ? edit.browserComments : state.browserComments) ?? NO_BROWSER_COMMENTS,
  };
}

export function draftScopeFor(
  profileID: string | null | undefined,
  session: PalotSession,
  newTask: boolean,
): string {
  return composerScope(
    profileID,
    newTask
      ? `new:${session.projectID}:${session.location.directory}:${session.location.workspaceID ?? ""}`
      : `session:${session.id}`,
  );
}

export function useComposerDraft(draftScope: string) {
  useEffect(() => () => flushComposerDrafts(), [draftScope]);
  const store = useStore();
  const draftAtom = composerDraftAtomFamily(draftScope);
  const stateAtom = composerStateAtomFamily(draftScope);
  const atoms = derivedAtomsFor(draftAtom, stateAtom);
  const [local] = useState(createLocalAtoms);
  const activeQueryAtom = useMemo(
    () => createQueryAtom(atoms.draft, local.selection, local.composing, local.pasted),
    [atoms.draft, local],
  );
  const setState = useSetAtom(stateAtom);
  const facts = useAtomValue(atoms.facts);
  const files = useAtomValue(atoms.files);
  const comments = useAtomValue(atoms.comments);
  const browserComments = useAtomValue(atoms.browserComments);
  const edit = useAtomValue(atoms.edit);
  const sending = useAtomValue(atoms.sending);
  const cancelingID = useAtomValue(atoms.cancelingID);

  function read(): ComposerContents {
    return contentsOf(store.get(stateAtom), store.get(draftAtom));
  }

  /** Writes go to the edit open now; a later edit or the original draft is never overwritten. */
  function writer(target: PendingInputEdit | null = store.get(stateAtom).edit): ComposerWriter {
    return {
      setDraft(update) {
        if (!target) {
          store.set(draftAtom, update);
          return;
        }
        setState((current) => {
          if (current.edit?.id !== target.id) return current;
          const next = typeof update === "function" ? update(current.edit.draft) : update;
          return { ...current, edit: { ...current.edit, draft: normalizeComposerDraft(next) } };
        });
      },
      setFiles(update) {
        setState((current) => {
          const edit = target ? current.edit : null;
          if (target && edit?.id !== target.id) return current;
          const previous = edit?.files ?? current.files;
          const next = typeof update === "function" ? update(previous) : update;
          return edit
            ? { ...current, edit: { ...edit, files: next } }
            : { ...current, files: next };
        });
      },
      setComments(update) {
        setState((current) => {
          if (!target) return { ...current, comments: update(current.comments) };
          if (current.edit?.id !== target.id) return current;
          return { ...current, edit: { ...current.edit, comments: update(current.edit.comments) } };
        });
      },
      setBrowserComments(update) {
        setState((current) => {
          if (!target)
            return { ...current, browserComments: update(current.browserComments ?? []) };
          if (current.edit?.id !== target.id) return current;
          return {
            ...current,
            edit: { ...current.edit, browserComments: update(current.edit.browserComments ?? []) },
          };
        });
      },
    };
  }

  /** Retires exactly the contents submitted; typing and navigation can continue during dispatch. */
  function clearSubmitted(submitted: ComposerContents) {
    const current = store.get(stateAtom);
    const { edit } = submitted;
    const unsent = <T>(items: T[] | undefined, sent: T[]) =>
      items?.filter((item) => !sent.includes(item));
    if (edit) {
      if (current.edit === edit) {
        setState((value) => ({ ...value, edit: null }));
      } else if (current.edit?.id === edit.id) {
        setState((value) =>
          value.edit
            ? {
                ...value,
                edit: {
                  ...value.edit,
                  comments: unsent(value.edit.comments, submitted.comments) ?? [],
                  browserComments: unsent(value.edit.browserComments, submitted.browserComments),
                },
              }
            : value,
        );
      }
      return;
    }
    if (store.get(draftAtom) === submitted.draft && current.files === submitted.files) {
      store.set(draftAtom, emptyComposerDraft());
      setState((value) => ({ ...value, files: [] }));
    }
    setState((value) => ({
      ...value,
      comments: unsent(value.comments, submitted.comments) ?? [],
      browserComments: unsent(value.browserComments, submitted.browserComments),
    }));
  }

  return {
    scope: draftScope,
    store,
    draftAtom,
    stateAtom,
    atoms,
    selectionAtom: local.selection,
    composingAtom: local.composing,
    activeQueryAtom,
    facts,
    files,
    comments,
    browserComments,
    /** The open edit's identity and delivery; its text is read through `read()`. */
    edit,
    sending,
    cancelingID,
    read,
    writer,
    clearSubmitted,
    setState,
    setSending: (value: boolean) => setState((current) => ({ ...current, sending: value })),
    setSelection: (selection: ComposerTextSelection) => store.set(local.selection, selection),
    /** Keeps the suggestion list closed until `text`, which a paste produced, changes. */
    suppressQuery: (text: string) => store.set(local.pasted, text),
    isComposing: () => store.get(local.composing),
  };
}

export type ComposerDraftState = ReturnType<typeof useComposerDraft>;
