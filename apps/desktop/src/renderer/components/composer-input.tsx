/**
 * The composer's text field: ProseMirror over one paragraph of source text, with mentions and
 * context as inline chips. The editor owns its document. It is seeded once from the draft, reports
 * every edit, and takes changes made elsewhere (a mention inserted, history recalled, the draft
 * cleared after sending) as targeted transactions, so typing never rebuilds the document.
 */

import { baseKeymap } from "prosemirror-commands";
import { closeHistory, history, redo, undo } from "prosemirror-history";
import { keymap } from "prosemirror-keymap";
import { Slice, type Node as PMNode } from "prosemirror-model";
import {
  EditorState,
  NodeSelection,
  Selection,
  TextSelection,
  type Transaction,
} from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { useImperativeHandle, useLayoutEffect, useRef, type Ref } from "react";
import { flushSync } from "react-dom";
import {
  applyComposerTextChange,
  normalizeComposerDraft,
  type ComposerDraft,
} from "../lib/composer-draft";
import {
  COMPOSER_FRAGMENT_TYPE,
  composerPasteAction,
  composerPasteInput,
} from "../lib/composer-paste";
import {
  composerMarkdownStyling,
  composerSchema,
  plainDocument,
  readRichDocument,
  richClipboardDraft,
  richCommentIDs,
  richDocument,
  richOffset,
  unwrappableChip,
} from "../lib/composer-rich-document";
import { isReviewComment, type ReviewComment } from "../lib/review-comments";
import { WORKSPACE_FILE_DRAG_TYPE } from "../lib/workspace-file-drag";
import "./composer-input.css";

export interface ComposerInputHandle {
  focus(): void;
  setSelectionRange(start: number, end: number): void;
  readonly selectionStart: number;
  readonly selectionEnd: number;
}

export interface ComposerDraftChange {
  /** The edit came from a paste, which must not open the suggestion list. */
  pasted: boolean;
}

export interface ComposerInputProps {
  ref?: Ref<ComposerInputHandle>;
  draft: ComposerDraft;
  comments: ReviewComment[];
  /** Shell commands: text only, without chips or Markdown styling. Fixed for the editor's life. */
  plain?: boolean;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  "aria-label"?: string;
  "aria-controls"?: string;
  "aria-expanded"?: boolean;
  "aria-activedescendant"?: string;
  onDraftChange(draft: ComposerDraft, change: ComposerDraftChange): void;
  onCommentsChange(comments: ReviewComment[]): void;
  onSelectionChange(selection: { start: number; end: number }): void;
  onKeyDown(event: React.KeyboardEvent<HTMLElement>): void;
  onCompositionStart(): void;
  onCompositionEnd(): void;
  /** Runs before the editor's own paste rules; preventing the default takes the paste. */
  onPaste(event: React.ClipboardEvent<HTMLElement>): void;
}

function sameDraft(left: ComposerDraft, right: ComposerDraft): boolean {
  if (left === right) return true;
  if (
    left.text !== right.text ||
    left.mentions.length !== right.mentions.length ||
    left.command?.name !== right.command?.name ||
    left.command?.start !== right.command?.start ||
    left.command?.end !== right.command?.end
  )
    return false;
  return left.mentions.every((mention, index) => {
    const other = right.mentions[index]!;
    return (
      mention.localID === other.localID &&
      mention.kind === other.kind &&
      mention.value === other.value &&
      mention.start === other.start &&
      mention.end === other.end &&
      mention.title === other.title &&
      mention.path === other.path &&
      mention.origin?.sessionID === other.origin?.sessionID &&
      mention.attachmentText === other.attachmentText
    );
  });
}

function documentFor(draft: ComposerDraft, comments: ReviewComment[], plain: boolean): PMNode {
  return plain ? plainDocument(draft.text) : richDocument(draft, comments);
}

/** A new document, caret at the end as in a field that was just filled. */
function createState(draft: ComposerDraft, comments: ReviewComment[], plain: boolean) {
  const doc = documentFor(draft, comments, plain);
  return EditorState.create({
    schema: composerSchema,
    doc,
    selection: Selection.atEnd(doc),
    plugins: [
      history(),
      keymap({ "Mod-z": undo, "Mod-Shift-z": redo, "Mod-y": redo }),
      keymap(baseKeymap),
      ...(plain ? [] : [composerMarkdownStyling()]),
    ],
  });
}

/** The draft the document holds; a selected command keeps its range through the edit. */
function draftOf(doc: PMNode, previous: ComposerDraft, plain: boolean): ComposerDraft {
  const read = plain ? { text: doc.textContent, mentions: [] } : readRichDocument(doc);
  const command = previous.command
    ? applyComposerTextChange({ ...previous, mentions: [] }, read.text).command
    : null;
  return normalizeComposerDraft({ text: read.text, mentions: read.mentions, command });
}

/** Comments keep the place their chip has now; new ones go where they were added. */
function placedComments(doc: PMNode, comments: ReviewComment[]): ReviewComment[] {
  if (comments.length === 0) return comments;
  const offsets = new Map(
    readRichDocument(doc).comments.map((comment) => [comment.id, comment.composerOffset]),
  );
  return comments.map((comment) =>
    offsets.has(comment.id) ? { ...comment, composerOffset: offsets.get(comment.id) } : comment,
  );
}

/** The smallest replacement that turns the editor's document into `target`, or null. */
function replacement(state: EditorState, target: PMNode): Transaction | null {
  const current = state.doc;
  const start = current.content.findDiffStart(target.content);
  if (start === null) return null;
  let { a, b } = current.content.findDiffEnd(target.content)!;
  const overlap = start - Math.min(a, b);
  if (overlap > 0) {
    a += overlap;
    b += overlap;
  }
  return state.tr.replace(start, a, target.slice(start, b));
}

/** Chips are one caret step and one Backspace; only a text selection inside text links. */
function chipBefore(state: EditorState): PMNode | null {
  const { selection } = state;
  if (!selection.empty || !(selection instanceof TextSelection)) return null;
  const node = selection.$from.nodeBefore;
  return node?.type.name === "context" ? node : null;
}

function chipAfter(state: EditorState): PMNode | null {
  const { selection } = state;
  if (!selection.empty || !(selection instanceof TextSelection)) return null;
  const node = selection.$from.nodeAfter;
  return node?.type.name === "context" ? node : null;
}

/** The chip a selection covers exactly: a clicked chip, or one crossed with Shift+Arrow. */
function selectedChip(state: EditorState): { node: PMNode; pos: number } | null {
  const { selection } = state;
  if (selection instanceof NodeSelection)
    return selection.node.type.name === "context"
      ? { node: selection.node, pos: selection.from }
      : null;
  const node = state.doc.nodeAt(selection.from);
  return node?.type.name === "context" && selection.to - selection.from === node.nodeSize
    ? { node, pos: selection.from }
    : null;
}

/** Chromium moves Home and End to the visual line's boundary inside nested editable content. */
const lineBoundaries =
  typeof window !== "undefined" && typeof window.Selection?.prototype.modify === "function";

/**
 * Engines without `Selection.modify` cannot move to a visual line boundary in nested editable
 * content; there Home and End move to the boundary of the logical line instead.
 */
function lineBoundary(state: EditorState, direction: -1 | 1, extend: boolean): Transaction {
  const { doc, selection } = state;
  const text = doc.textBetween(0, doc.content.size, "\n", "\ufffc");
  const head = selection.head - 1;
  const offset =
    direction < 0
      ? text.lastIndexOf("\n", head - 1) + 1
      : (() => {
          const end = text.indexOf("\n", head);
          return end < 0 ? text.length : end;
        })();
  const position = offset + 1;
  return state.tr.setSelection(
    TextSelection.create(doc, extend ? selection.anchor : position, position),
  );
}

/** The DOM caret sits between the editor's blocks, where typed text would land outside them. */
function caretOutsideText(view: EditorView): boolean {
  const selection = view.dom.ownerDocument.getSelection();
  return selection?.anchorNode === view.dom || selection?.focusNode === view.dom;
}

/** Where an `insertText` input lands: its target range, else the DOM selection. */
function inputTarget(view: EditorView, input: InputEvent): Selection | null {
  const range = input.getTargetRanges?.()[0];
  const dom = range
    ? {
        anchorNode: range.startContainer,
        anchorOffset: range.startOffset,
        focusNode: range.endContainer,
        focusOffset: range.endOffset,
      }
    : view.dom.ownerDocument.getSelection();
  if (!dom?.anchorNode || !view.dom.contains(dom.anchorNode)) return null;
  if (!dom.focusNode || !view.dom.contains(dom.focusNode)) return null;
  try {
    const { doc } = view.state;
    const anchor = view.posAtDOM(dom.anchorNode, dom.anchorOffset);
    const head = view.posAtDOM(dom.focusNode, dom.focusOffset);
    return TextSelection.between(doc.resolve(anchor), doc.resolve(head));
  } catch {
    return null;
  }
}

function selectionText(state: EditorState): string | null {
  const { from, to, empty } = state.selection;
  if (empty) return null;
  let chips = false;
  state.doc.nodesBetween(from, to, (node) => {
    if (node.type.name === "context") chips = true;
  });
  return chips ? null : state.doc.textBetween(from, to);
}

function textSlice(text: string, plain: boolean): Slice {
  const doc = plain ? plainDocument(text) : richDocument({ text, mentions: [], command: null }, []);
  return new Slice(doc.firstChild!.content, 0, 0);
}

/** Clipboard fragments are untrusted; chips get fresh identities so a paste never aliases them. */
function fragmentSlice(value: string): Slice | null {
  try {
    const parsed = JSON.parse(value) as { draft?: unknown; comments?: unknown };
    const draft = richClipboardDraft(parsed.draft);
    if (!draft || !Array.isArray(parsed.comments) || !parsed.comments.every(isReviewComment))
      return null;
    draft.mentions = draft.mentions.map((mention) => ({
      ...mention,
      localID: crypto.randomUUID(),
    }));
    const comments = (parsed.comments as ReviewComment[]).map((comment) => ({
      ...comment,
      id: crypto.randomUUID(),
    }));
    return new Slice(richDocument(draft, comments).firstChild!.content, 0, 0);
  } catch {
    return null;
  }
}

function attributesOf(props: ComposerInputProps, plain: boolean): Record<string, string> {
  return {
    class: `palot-composer-input ${props.className ?? ""}`,
    role: "textbox",
    "aria-multiline": "true",
    "aria-label": props["aria-label"] ?? "Message Palot",
    "aria-expanded": String(props["aria-expanded"] ?? false),
    ...(props["aria-controls"] ? { "aria-controls": props["aria-controls"] } : {}),
    ...(props["aria-activedescendant"]
      ? { "aria-activedescendant": props["aria-activedescendant"] }
      : {}),
    "aria-disabled": String(Boolean(props.disabled)),
    "data-placeholder": props.placeholder ?? "",
    "data-palot-composer-input": "",
    "data-slot": "input-group-control",
    ...(plain ? { "data-plain": "" } : {}),
    spellcheck: plain ? "false" : "true",
  };
}

function sameAttributes(left: Record<string, string>, right: Record<string, string>): boolean {
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every((key) => left[key] === right[key]);
}

const isPrevented = (_view: EditorView, event: Event) => event.defaultPrevented;

/**
 * The editor learns of a selection change from the document's `selectionchange` event, which
 * arrives after the change. A key pressed straight after a script selected text (automation,
 * select-all by a tool) would act on the old caret: Delete deleted nothing. Before a key, take
 * the selection the DOM holds when it differs. During composition the browser owns it.
 */
function adoptDOMSelection(view: EditorView) {
  // A selected chip or the editor's own select-all keep their kind; only a caret or text
  // selection can be stale this way.
  if (view.composing || !(view.state.selection instanceof TextSelection)) return;
  const dom = view.dom.ownerDocument.getSelection();
  if (!dom?.anchorNode || !dom.focusNode) return;
  if (!view.dom.contains(dom.anchorNode) || !view.dom.contains(dom.focusNode)) return;
  let anchor: number;
  let head: number;
  try {
    anchor = view.posAtDOM(dom.anchorNode, dom.anchorOffset);
    head = view.posAtDOM(dom.focusNode, dom.focusOffset);
  } catch {
    return;
  }
  const { selection, doc } = view.state;
  if (Math.min(anchor, head) === selection.from && Math.max(anchor, head) === selection.to) return;
  view.dispatch(
    view.state.tr.setSelection(TextSelection.between(doc.resolve(anchor), doc.resolve(head))),
  );
}

/** Comment chips move as text is typed before them; their places are kept when the editor goes. */
function keepCommentPlaces(doc: PMNode, props: ComposerInputProps) {
  const offsets = new Map(
    readRichDocument(doc).comments.map((comment) => [comment.id, comment.composerOffset]),
  );
  const moved = props.comments.some(
    (comment) => offsets.has(comment.id) && offsets.get(comment.id) !== comment.composerOffset,
  );
  if (!moved) return;
  props.onCommentsChange(
    props.comments.map((comment) =>
      offsets.has(comment.id) ? { ...comment, composerOffset: offsets.get(comment.id) } : comment,
    ),
  );
}

export function ComposerInput(props: ComposerInputProps) {
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const latest = useRef(props);
  // The draft and comments the document holds, by identity, so echoes of its own edits are free.
  const synced = useRef({ draft: props.draft, comments: props.comments });
  const pendingSync = useRef(false);
  const syncRef = useRef<(view: EditorView, fresh?: boolean) => void>(() => {});
  const unwrapRef = useRef<() => boolean>(() => false);
  const plainPaste = useRef(false);
  // Shell mode reconfigures the same editor, so the element and its focus stay.
  const plainRef = useRef(Boolean(props.plain));
  const attributes = useRef<Record<string, string> | null>(null);
  useLayoutEffect(() => {
    latest.current = props;
  });

  function sourceSelection(view: EditorView) {
    return {
      start: richOffset(view.state.doc, view.state.selection.from),
      end: richOffset(view.state.doc, view.state.selection.to),
    };
  }

  function select(view: EditorView, start: number, end: number) {
    const { doc } = view.state;
    view.dispatch(
      view.state.tr
        .setSelection(
          TextSelection.create(doc, richOffset(doc, start, true), richOffset(doc, end, true)),
        )
        .scrollIntoView(),
    );
  }

  useImperativeHandle(
    props.ref,
    () => ({
      focus: () => viewRef.current?.focus(),
      get selectionStart() {
        const view = viewRef.current;
        return view ? sourceSelection(view).start : 0;
      },
      get selectionEnd() {
        const view = viewRef.current;
        return view ? sourceSelection(view).end : 0;
      },
      setSelectionRange(start, end) {
        const view = viewRef.current;
        if (view) select(view, start, end);
      },
    }),
    [],
  );

  useLayoutEffect(() => {
    let external = false;
    let pasting = false;
    let emittedSelection = { start: -1, end: -1 };
    let commentIDs = "";
    syncRef.current = syncFromProps;

    function emitSelection(view: EditorView) {
      const next = sourceSelection(view);
      if (next.start === emittedSelection.start && next.end === emittedSelection.end) return;
      emittedSelection = next;
      latest.current.onSelectionChange(next);
    }

    /**
     * Makes the document hold the current props, as one undoable step of its own; `fresh`
     * starts a new document and history, as switching between prompt and shell mode does.
     */
    function syncFromProps(view: EditorView, fresh = false) {
      pendingSync.current = false;
      const { draft, comments } = latest.current;
      synced.current = { draft, comments };
      external = true;
      try {
        if (fresh || (!draft.text && comments.length === 0)) {
          // Sending, stashing or clearing: a fresh document, like a new text field.
          view.updateState(createState(draft, comments, plainRef.current));
        } else {
          const target = documentFor(
            draft,
            placedComments(view.state.doc, comments),
            plainRef.current,
          );
          const tr = replacement(view.state, target);
          if (tr) {
            view.dispatch(closeHistory(tr));
            view.dispatch(closeHistory(view.state.tr));
          }
        }
        commentIDs = plainRef.current ? "" : richCommentIDs(view.state.doc);
      } finally {
        external = false;
      }
      emitSelection(view);
    }

    function unwrapChip(view: EditorView, pos: number, node: PMNode) {
      const source: string = node.attrs.source;
      const tr = view.state.tr.replaceWith(pos, pos + node.nodeSize, composerSchema.text(source));
      tr.setSelection(TextSelection.create(tr.doc, pos + source.length));
      view.dispatch(tr.scrollIntoView());
    }

    function paste(view: EditorView, event: ClipboardEvent): boolean {
      const data = event.clipboardData;
      if (!data) return false;
      const plainRequested = plainPaste.current;
      plainPaste.current = false;
      const action = composerPasteAction(composerPasteInput(data), {
        plain: plainRequested || plainRef.current,
        attachments: !plainRef.current,
        selectedText: selectionText(view.state),
      });
      const tr = view.state.tr;
      switch (action.kind) {
        case "fragment": {
          const slice = fragmentSlice(action.value);
          if (slice) tr.replaceSelection(slice);
          else tr.replaceSelection(textSlice(data.getData("text/plain"), plainRef.current));
          break;
        }
        case "link":
          tr.insertText(action.text);
          break;
        case "text":
        case "attach-text":
          // Long text the composer could not attach (a remote server) is typed instead.
          tr.replaceSelection(textSlice(action.text, plainRef.current || plainRequested));
          break;
        case "attach-files":
        case "none":
          // Files are the composer's to attach, and rich content from other apps is dropped.
          return true;
      }
      pasting = true;
      try {
        view.dispatch(tr.scrollIntoView());
      } finally {
        pasting = false;
      }
      return true;
    }

    const view = new EditorView(host.current!, {
      state: createState(synced.current.draft, synced.current.comments, plainRef.current),
      editable: () => !latest.current.disabled,
      attributes: attributesOf(latest.current, plainRef.current),
      handleDOMEvents: {
        // The composer's own handlers run first; what they take, the editor leaves alone.
        keydown(view, event) {
          if (event.defaultPrevented) return true;
          adoptDOMSelection(view);
          return false;
        },
        paste: isPrevented,
        copy: isPrevented,
        cut: isPrevented,
        drop: isPrevented,
        beforeinput(view, event) {
          // A typed character is the browser's to insert, which leaves its DOM and caret in
          // place. Text inserted at once (filled in, dictated) and a caret the browser left
          // outside the paragraph go in as a transaction instead. Composition is always the
          // browser's, so IME input is never interrupted.
          const input = event as InputEvent;
          if (input.isComposing || view.composing || input.inputType !== "insertText") return false;
          if (!input.data) return false;
          if (input.data.length === 1 && input.data !== "\n" && !caretOutsideText(view))
            return false;
          event.preventDefault();
          const tr = view.state.tr;
          const target = inputTarget(view, input);
          if (target && !target.eq(tr.selection)) tr.setSelection(target);
          // Text inserted at once (filled in, dictated) gets its chips, as pasted text does.
          if (input.data.length > 1) tr.replaceSelection(textSlice(input.data, plainRef.current));
          else tr.insertText(input.data);
          view.dispatch(tr.scrollIntoView());
          return true;
        },
        compositionend(view) {
          if (pendingSync.current)
            setTimeout(() => {
              if (!view.isDestroyed && !view.composing && pendingSync.current) syncFromProps(view);
            }, 0);
          return false;
        },
      },
      dispatchTransaction(transaction) {
        view.updateState(view.state.apply(transaction));
        const callbacks = latest.current;
        if (transaction.docChanged && !external) {
          const draft = draftOf(view.state.doc, synced.current.draft, plainRef.current);
          synced.current = { ...synced.current, draft };
          callbacks.onDraftChange(draft, { pasted: pasting });
          if (!plainRef.current) {
            const ids = richCommentIDs(view.state.doc);
            if (ids !== commentIDs) {
              commentIDs = ids;
              const comments = readRichDocument(view.state.doc).comments;
              synced.current = { ...synced.current, comments };
              callbacks.onCommentsChange(comments);
            }
          }
        }
        emitSelection(view);
        if (pendingSync.current && !view.composing) syncFromProps(view);
      },
      handleKeyDown(view, event) {
        if (event.isComposing || event.keyCode === 229) return false;
        const modified = event.altKey || event.ctrlKey || event.metaKey;
        if (event.key === "Enter") {
          if (modified) return false;
          view.dispatch(view.state.tr.insertText("\n").scrollIntoView());
          return true;
        }
        if (modified) return false;
        if ((event.key === "Home" || event.key === "End") && !lineBoundaries) {
          view.dispatch(lineBoundary(view.state, event.key === "Home" ? -1 : 1, event.shiftKey));
          return true;
        }
        if (event.shiftKey) return false;
        const { from } = view.state.selection;
        const before = chipBefore(view.state);
        const after = chipAfter(view.state);
        if (event.key === "ArrowLeft" && before) {
          view.dispatch(
            view.state.tr.setSelection(
              TextSelection.create(view.state.doc, from - before.nodeSize),
            ),
          );
          return true;
        }
        if (event.key === "ArrowRight" && after) {
          view.dispatch(
            view.state.tr.setSelection(TextSelection.create(view.state.doc, from + after.nodeSize)),
          );
          return true;
        }
        if (event.key === "Backspace" && before) {
          view.dispatch(view.state.tr.delete(from - before.nodeSize, from).scrollIntoView());
          return true;
        }
        if (event.key === "Delete" && after) {
          view.dispatch(view.state.tr.delete(from, from + after.nodeSize).scrollIntoView());
          return true;
        }
        return false;
      },
      handleDoubleClickOn(view, _pos, node, nodePos, _event, direct) {
        if (!direct || !unwrappableChip(node)) return false;
        unwrapChip(view, nodePos, node);
        return true;
      },
      // Workspace files become mentions and OS files attachments; the composer handles both.
      handleDrop: (_view, event) =>
        Boolean(
          event.dataTransfer?.types.includes(WORKSPACE_FILE_DRAG_TYPE) ||
          event.dataTransfer?.types.includes("Files"),
        ),
      handlePaste: (view, event) => paste(view, event),
      clipboardTextSerializer: (slice) => {
        let text = "";
        slice.content.descendants((node) => {
          if (node.isText) text += node.text;
          else if (node.type.name === "context") text += node.attrs.source;
        });
        return text;
      },
    });
    viewRef.current = view;
    emittedSelection = sourceSelection(view);
    commentIDs = plainRef.current ? "" : richCommentIDs(view.state.doc);
    attributes.current = attributesOf(latest.current, plainRef.current);
    const detachSurface = attachTextareaSurface(view, {
      value: () => view.state.doc.textContent,
      setValue(value) {
        // Like assigning a textarea's value: one edit, caret at the end, chips outside kept.
        const draft = applyComposerTextChange(synced.current.draft, value);
        const target = documentFor(
          draft,
          placedComments(view.state.doc, latest.current.comments),
          plainRef.current,
        );
        const tr = replacement(view.state, target);
        if (tr) view.dispatch(tr.setSelection(Selection.atEnd(tr.doc)));
      },
      selection: () => sourceSelection(view),
      select: (start, end) => select(view, start, end),
    });
    unwrapRef.current = () => {
      const chip = selectedChip(view.state);
      if (!chip || !unwrappableChip(chip.node)) return false;
      unwrapChip(view, chip.pos, chip.node);
      return true;
    };
    return () => {
      detachSurface();
      viewRef.current = null;
      if (!plainRef.current) keepCommentPlaces(view.state.doc, latest.current);
      view.destroy();
    };
  }, []);

  useLayoutEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    if (Boolean(props.plain) !== plainRef.current) {
      plainRef.current = Boolean(props.plain);
      syncRef.current(view, true);
    } else if (
      !sameDraft(props.draft, synced.current.draft) ||
      props.comments !== synced.current.comments
    ) {
      // An edit made elsewhere. During IME composition it waits until the composition ends.
      pendingSync.current = true;
      if (!view.composing) syncRef.current(view);
    } else {
      synced.current = { draft: props.draft, comments: props.comments };
    }
    const next = attributesOf(props, plainRef.current);
    if (!attributes.current || !sameAttributes(attributes.current, next)) {
      attributes.current = next;
      view.setProps({ attributes: next });
    }
  });

  return (
    <div
      ref={host}
      className="min-h-0 w-full"
      onKeyDownCapture={(event) => {
        const key = event.nativeEvent;
        if ((key.ctrlKey || key.metaKey) && key.shiftKey && key.key.toLowerCase() === "v")
          plainPaste.current = true;
        // Enter on a selected file or agent chip edits it instead of sending.
        const bare = !key.shiftKey && !key.altKey && !key.ctrlKey && !key.metaKey;
        if (key.key === "Enter" && bare && !key.isComposing && unwrapRef.current()) {
          event.preventDefault();
          return;
        }
        props.onKeyDown(event);
      }}
      onPasteCapture={(event) => {
        if (!plainPaste.current && !plainRef.current) props.onPaste(event);
      }}
      onCompositionStart={props.onCompositionStart}
      onCompositionEnd={props.onCompositionEnd}
      onCopyCapture={(event) => copySelection(event, false)}
      onCutCapture={(event) => copySelection(event, true)}
    />
  );

  function copySelection(event: React.ClipboardEvent, cut: boolean) {
    const view = viewRef.current;
    if (!view || view.state.selection.empty || (cut && props.disabled)) return;
    const { from, to } = view.state.selection;
    const read = readRichDocument(view.state.doc.cut(from, to));
    event.preventDefault();
    event.clipboardData.setData("text/plain", read.text);
    if (!plainRef.current)
      event.clipboardData.setData(
        COMPOSER_FRAGMENT_TYPE,
        JSON.stringify({
          draft: { text: read.text, mentions: read.mentions, command: null },
          comments: read.comments,
        }),
      );
    if (cut) view.dispatch(view.state.tr.deleteSelection().scrollIntoView());
  }
}

interface TextareaSurface {
  value(): string;
  setValue(value: string): void;
  selection(): { start: number; end: number };
  select(start: number, end: number): void;
}

/**
 * Gives the editor element the scripting surface of the textarea it replaced (`value`,
 * `selectionStart`, `selectionEnd`, `setSelectionRange`, `placeholder`), so automation, tests
 * and tools that script the composer keep working. Assignments apply with the input or change
 * event that follows them, or at the end of the task, and render at once, as a field's do.
 */
function attachTextareaSurface(view: EditorView, surface: TextareaSurface): () => void {
  const element = view.dom;
  let pending: { value?: string; start?: number; end?: number } | null = null;
  const flush = () => {
    const next = pending;
    pending = null;
    if (!next || view.isDestroyed) return;
    flushSync(() => {
      if (next.value !== undefined) surface.setValue(next.value);
      if (next.start !== undefined || next.end !== undefined) {
        const current = surface.selection();
        const start = next.start ?? current.start;
        surface.select(start, next.end ?? Math.max(start, current.end));
      }
    });
  };
  const later = () => {
    if (pending) return pending;
    pending = {};
    queueMicrotask(flush);
    return pending;
  };
  Object.defineProperties(element, {
    value: {
      configurable: true,
      get: () => (pending?.value !== undefined ? pending.value : surface.value()),
      set: (value: unknown) => {
        later().value = String(value ?? "");
      },
    },
    selectionStart: {
      configurable: true,
      get: () => pending?.start ?? surface.selection().start,
      set: (value: number) => {
        later().start = value;
      },
    },
    selectionEnd: {
      configurable: true,
      get: () => pending?.end ?? surface.selection().end,
      set: (value: number) => {
        later().end = value;
      },
    },
    placeholder: {
      configurable: true,
      get: () => element.dataset.placeholder ?? "",
    },
    setSelectionRange: {
      configurable: true,
      value: (start: number, end: number) => {
        flush();
        surface.select(start, end);
      },
    },
  });
  for (const type of ["input", "change", "select"]) element.addEventListener(type, flush, true);
  return () => {
    for (const type of ["input", "change", "select"])
      element.removeEventListener(type, flush, true);
    for (const name of [
      "value",
      "selectionStart",
      "selectionEnd",
      "setSelectionRange",
      "placeholder",
    ])
      Reflect.deleteProperty(element, name);
  };
}
