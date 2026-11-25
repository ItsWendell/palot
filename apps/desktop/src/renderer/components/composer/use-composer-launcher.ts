/**
 * The `+` launcher and the typed `/`, `@` and `$` triggers, wired to the composer. The state lives
 * in an atom only the launcher's panel, the text field's ARIA and the `+` button read, so typing a
 * query renders the field and the list and nothing else. Every step goes through the pure
 * reducer in `composer-launcher/launcher-state.ts`; this hook carries out what a step reports.
 */

import { useQueryClient } from "@tanstack/react-query";
import { atom, useStore, type Atom, type PrimitiveAtom } from "jotai";
import { selectAtom } from "jotai/utils";
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { flushSync } from "react-dom";
import type { PalotComposerCatalog } from "../../../shared";
import { composerCatalogQueryOptions } from "../../hooks/use-composer-discovery";
import type { ComposerDraft, ComposerInsertion } from "../../lib/composer-draft";
import type { ComposerMode } from "../../lib/composer-history";
import { detectComposerQuery } from "../../lib/composer-query";
import { matchesShortcut, shortcutKeys } from "../../lib/keyboard-shortcuts";
import type { ReviewComment } from "../../lib/review-comments";
import type { ApprovalPreset } from "../../lib/session-permissions";
import type { LocationRef } from "@opencode/client";
import {
  insertCommandAtStart,
  insertMentionAt,
  launcherTrigger,
  mentionSelection,
  replaceTrigger,
  triggerQuery,
} from "../composer-launcher/launcher-insert";
import {
  REVIEW_COMMAND,
  type LauncherCategory,
  type LauncherSources,
} from "../composer-launcher/launcher-items";
import { applyComposerTextEdit } from "../../lib/composer-draft";
import {
  CLOSED_LAUNCHER,
  transition,
  type LauncherEvent,
  type LauncherOutcome,
  type LauncherState,
  type LauncherStep,
} from "../composer-launcher/launcher-state";
import {
  buildLauncherView,
  type LauncherSuggestionSource,
} from "../composer-launcher/launcher-view";
import type { ComposerDraftState, ComposerWriter } from "./use-composer-draft";
import type { ComposerFocus } from "./use-composer-focus";

/** What picked items do beyond editing the draft; the composer owns each of them. */
interface ComposerLauncherActions {
  attach(): void;
  enterShell(): void;
  sendToModels(): void;
  restoreStash(id: string): void;
  /** Removes a stashed prompt; true when it is gone from storage. */
  deleteStash(id: string): boolean;
  /** Runs a command Palot handles itself; false leaves it to be typed with its arguments. */
  runCommand(name: string): boolean;
  reviewChanges(): void;
  /** Runs `/review <arguments>` in the task, leaving the draft as it is. */
  review(args: string): void;
  /** Defaults applies at once; Full access asks first in its confirmation. */
  chooseApprovals(preset: ApprovalPreset): void;
}

interface ComposerLauncherInput {
  contents: ComposerDraftState;
  focus: ComposerFocus;
  mode: ComposerMode;
  /** The field takes no input (a missing workspace). */
  disabled: boolean;
  sessionID: string;
  /** Where the command catalog lives, to tell `/folder/` commands from paths. */
  connectionID: string;
  location: LocationRef;
  actions: ComposerLauncherActions;
}

/** What a key-time rebuild of the list needs: the panel's last sources and clock. */
interface LauncherViewInputs {
  sources: LauncherSources;
  now: number;
  suggestions?: readonly LauncherSuggestionSource[];
}

/** The draft `+` set aside, and the writer of the scope it came from. */
interface SetAside {
  scope: string;
  writer: ComposerWriter;
  draft: ComposerDraft;
  comments: ReviewComment[];
  selection: { start: number; end: number };
}

export interface ComposerLauncher {
  /** The listbox id the text field points at. */
  listId: string;
  stateAtom: Atom<LauncherState>;
  /** Open at all: a typed trigger or `+`. */
  openAtom: Atom<boolean>;
  /** Open from `+` or Mod+/: the field holds the query and the draft is set aside. */
  plusOpenAtom: Atom<boolean>;
  /** The highlighted row's id, published by the list once it knows its rows. */
  activeAtom: PrimitiveAtom<string | null>;
  /** Counts the launcher's own stash edits, so the list reads the stash again. */
  stashRevisionAtom: Atom<number>;
  /** The list's last data, so a key acts on the rows the current query lists. */
  viewInputs: { current: LauncherViewInputs | null };
  isOpen(): boolean;
  isPlusOpen(): boolean;
  toggle(via: "button" | "shortcut"): void;
  /** Opens under `+` drilled into a category (the approvals chip opens Approvals). */
  openCategory(category: LauncherCategory): void;
  dispatch(event: LauncherEvent): void;
  /** The text field's keydown, before its own keys; true when the launcher took the key. */
  handleKey(event: KeyboardEvent<HTMLElement>): boolean;
}

function launcherListId(sessionID: string): string {
  return `composer-launcher-${sessionID.replaceAll(/[^A-Za-z0-9_-]/g, "-")}`;
}

function draftPreview(draft: ComposerDraft): string | null {
  const line = draft.text
    .split("\n")
    .map((value) => value.trim())
    .find(Boolean);
  return line ?? null;
}

export function useComposerLauncher(input: ComposerLauncherInput): ComposerLauncher {
  const store = useStore();
  const queryClient = useQueryClient();
  const latest = useRef(input);
  useLayoutEffect(() => {
    latest.current = input;
  });

  const [launcher] = useState(() => {
    const stateAtom = atom<LauncherState>(CLOSED_LAUNCHER);
    const activeAtom = atom<string | null>(null);
    const stashRevisionAtom = atom(0);
    const viewInputs: { current: LauncherViewInputs | null } = { current: null };
    let aside: SetAside | null = null;
    // Edits the launcher makes itself are not typing; the feed looks once they are done.
    let muted = false;

    const read = () => store.get(stateAtom);
    const input = () => latest.current.focus.inputRef.current;

    function canLaunch() {
      const { mode, disabled } = latest.current;
      return mode !== "shell" && !disabled;
    }

    function commands(): PalotComposerCatalog["commands"] {
      const { connectionID, location } = latest.current;
      const catalog = queryClient.getQueryData(
        composerCatalogQueryOptions(connectionID, location).queryKey,
      );
      return catalog?.commands ?? [];
    }

    /** A picked mention or command starts here: its chip is not a trigger to suggest for. */
    function chipAt(start: number) {
      const { draft } = latest.current.contents.read();
      return (
        draft.command?.start === start ||
        draft.mentions.some((mention) => mention.start <= start && start < mention.end)
      );
    }

    /** Feeds the field's text and caret to the reducer: the query under `+`, else the trigger. */
    function sync() {
      if (muted) return;
      const state = read();
      const { contents, mode } = latest.current;
      if (state.status === "open" && state.source.type === "plus") {
        apply(transition(state, { type: "query", query: contents.read().draft.text }));
        return;
      }
      const query = mode === "shell" ? null : store.get(contents.activeQueryAtom);
      const trigger = query && !chipAt(query.start) ? launcherTrigger(query, commands()) : null;
      apply(transition(state, { type: "trigger", trigger }));
    }

    /** Writes the draft and places the caret now, so typing right after a pick lands after it. */
    function write(writer: ComposerWriter, inserted: ComposerInsertion) {
      flushSync(() => writer.setDraft(inserted.draft));
      const field = input();
      field?.focus();
      field?.setSelectionRange(inserted.selectionStart, inserted.selectionEnd);
    }

    function caret() {
      const field = input();
      return { start: field?.selectionStart ?? 0, end: field?.selectionEnd ?? 0 };
    }

    function setAside() {
      const { contents } = latest.current;
      const current = contents.read();
      const writer = contents.writer();
      aside = {
        scope: contents.scope,
        writer,
        draft: current.draft,
        comments: current.comments,
        selection: caret(),
      };
      flushSync(() => {
        writer.setDraft({ text: "", mentions: [], command: null });
        if (current.comments.length) writer.setComments(() => []);
      });
      input()?.focus();
    }

    /**
     * Puts the set-aside draft back (an empty one when there was none) and returns it with its
     * caret. Outside an event (a task switch, unmount) it only writes, into its own scope.
     */
    function restore(placeCaret: boolean): {
      draft: ComposerDraft;
      caret: number;
      writer: ComposerWriter;
    } {
      const { contents } = latest.current;
      const kept = aside;
      aside = null;
      const writer = kept?.writer ?? contents.writer();
      const draft = kept?.draft ?? { text: "", mentions: [], command: null };
      const put = () => {
        writer.setDraft(draft);
        if (kept?.comments.length) writer.setComments(() => kept.comments);
      };
      if (!placeCaret || (kept && kept.scope !== contents.scope)) {
        put();
        return { draft, caret: draft.text.length, writer };
      }
      // A restored draft opens no trigger until it is edited, as a pasted one does not.
      contents.suppressQuery(draft.text);
      flushSync(put);
      const selection = kept?.selection ?? { start: draft.text.length, end: draft.text.length };
      const field = input();
      field?.focus();
      field?.setSelectionRange(selection.start, selection.end);
      return { draft, caret: selection.start, writer };
    }

    function pick(outcome: Extract<LauncherOutcome, { type: "pick" }>) {
      const { contents, actions } = latest.current;
      const { action, target } = outcome;
      if (action.type === "command" && action.name.toLowerCase() === REVIEW_COMMAND) {
        // `/review` opens its picker: a typed trigger leaves the draft, which goes aside.
        if (target.type === "trigger") {
          const { draft } = contents.read();
          const at = caret();
          const query = triggerQuery(
            target.trigger,
            detectComposerQuery(draft.text, at.start, at.end),
          );
          flushSync(() =>
            contents
              .writer()
              .setDraft(
                applyComposerTextEdit(draft, { start: query.start, end: query.end, text: "" }),
              ),
          );
        } else restore(true);
        handle.openCategory("review");
        return;
      }
      if (target.type === "trigger") {
        const { draft } = contents.read();
        const at = caret();
        const fresh = detectComposerQuery(draft.text, at.start, at.end);
        const query = triggerQuery(target.trigger, fresh);
        const selection =
          action.type === "mention"
            ? mentionSelection(action.mention, crypto.randomUUID())
            : action.type === "command"
              ? ({ kind: "command", name: action.name } as const)
              : null;
        const inserted = selection ? replaceTrigger(draft, query, selection) : null;
        if (inserted) write(contents.writer(), inserted);
        return;
      }
      const restored = restore(true);
      switch (action.type) {
        case "mention":
          write(
            restored.writer,
            insertMentionAt(
              restored.draft,
              restored.caret,
              mentionSelection(action.mention, crypto.randomUUID()),
            ),
          );
          return;
        case "command":
          if (!actions.runCommand(action.name))
            write(restored.writer, insertCommandAtStart(restored.draft, action.name));
          return;
        case "attach-files":
          actions.attach();
          return;
        case "shell":
          actions.enterShell();
          return;
        case "send-to-models":
          actions.sendToModels();
          return;
        case "restore-stash":
          actions.restoreStash(action.id);
          return;
        case "review-changes":
          actions.reviewChanges();
          return;
        case "review":
          actions.review(action.arguments);
          return;
        case "review-typed":
          write(restored.writer, insertCommandAtStart(restored.draft, REVIEW_COMMAND));
          return;
        case "approvals":
          actions.chooseApprovals(action.preset);
          return;
      }
    }

    function carryOut(outcome: LauncherOutcome) {
      switch (outcome.type) {
        case "set-draft-aside":
          setAside();
          return;
        case "clear-query":
          flushSync(() =>
            latest.current.contents.writer().setDraft({ text: "", mentions: [], command: null }),
          );
          return;
        case "restore-draft":
          restore(true);
          return;
        case "pick":
          pick(outcome);
          return;
        case "delete-stash":
          if (latest.current.actions.deleteStash(outcome.id))
            store.set(stashRevisionAtom, (revision) => revision + 1);
          if (outcome.clearQuery)
            flushSync(() =>
              latest.current.contents.writer().setDraft({ text: "", mentions: [], command: null }),
            );
          return;
      }
    }

    function apply(step: LauncherStep) {
      if (step.state !== read()) store.set(stateAtom, step.state);
      if (!step.outcome) return;
      muted = true;
      try {
        carryOut(step.outcome);
      } finally {
        muted = false;
      }
      sync();
    }

    function items(state: LauncherState) {
      const inputs = viewInputs.current;
      if (!inputs) return [];
      return buildLauncherView(state, inputs.sources, {
        now: inputs.now,
        suggestions: inputs.suggestions,
      }).items;
    }

    const handle: ComposerLauncher & {
      sync(): void;
      /** Closes without placing the caret, for changes that come from outside an event. */
      leave(): void;
      /** Leaves a task's composer: its set-aside draft goes back to its own scope. */
      reset(): void;
    } = {
      listId: launcherListId(latest.current.sessionID),
      stateAtom,
      openAtom: selectAtom(stateAtom, (state) => state.status === "open"),
      plusOpenAtom: selectAtom(
        stateAtom,
        (state) => state.status === "open" && state.source.type === "plus",
      ),
      activeAtom,
      stashRevisionAtom,
      viewInputs,
      isOpen: () => read().status === "open",
      isPlusOpen: () => {
        const state = read();
        return state.status === "open" && state.source.type === "plus";
      },
      toggle(via) {
        if (!canLaunch()) return;
        const draft = latest.current.contents.read().draft;
        apply(transition(read(), { type: "toggle", via, draftPreview: draftPreview(draft) }));
      },
      openCategory(category) {
        if (!canLaunch()) return;
        const draft = latest.current.contents.read().draft;
        apply(
          transition(read(), {
            type: "open",
            via: "button",
            draftPreview: draftPreview(draft),
            category,
          }),
        );
      },
      dispatch(event) {
        apply(transition(read(), event));
      },
      handleKey(event) {
        const native = event.nativeEvent;
        if (native.isComposing || event.keyCode === 229) return false;
        if (matchesShortcut(native, shortcutKeys("composer.launcher")) && canLaunch()) {
          event.preventDefault();
          handle.toggle("shortcut");
          return true;
        }
        const state = read();
        if (state.status !== "open") return false;
        const { contents } = latest.current;
        const at = caret();
        const length = contents.read().draft.text.length;
        const step = transition(state, {
          type: "key",
          event: native,
          caret: { atStart: at.start === 0 && at.end === 0, atEnd: at.start >= length },
          items: items(state),
        });
        if (!step.handled) return false;
        event.preventDefault();
        apply(step);
        return true;
      },
      sync,
      leave() {
        const state = read();
        if (state.status !== "open") return;
        store.set(stateAtom, transition(state, { type: "close" }).state);
        if (state.source.type === "plus") restore(false);
      },
      reset() {
        if (aside) restore(false);
        store.set(stateAtom, CLOSED_LAUNCHER);
        store.set(activeAtom, null);
      },
    };
    return handle;
  });

  const { contents, mode } = input;
  const { activeQueryAtom, scope } = contents;
  const draftAtom = contents.atoms.draft;
  // The field's text and caret drive the launcher; subscribing here renders nothing.
  useEffect(() => {
    const unsubscribeQuery = store.sub(activeQueryAtom, launcher.sync);
    const unsubscribeDraft = store.sub(draftAtom, launcher.sync);
    return () => {
      unsubscribeQuery();
      unsubscribeDraft();
    };
  }, [activeQueryAtom, draftAtom, launcher, store]);
  // Shell mode closes the launcher, giving a set-aside draft back; it never lists suggestions.
  useEffect(() => {
    if (mode === "shell") launcher.leave();
  }, [launcher, mode]);
  // A task switch or unmount gives a set-aside draft back to the task it came from.
  useEffect(() => () => launcher.reset(), [launcher, scope]);

  return launcher;
}
